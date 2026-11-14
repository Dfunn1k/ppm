"""Lógica de acceso: crear cuenta, iniciar y cerrar sesión, contraseñas.

No sabe nada de HTTP: recibe datos simples y devuelve dataclasses o lanza errores propios.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg

from app import google
from app.config import get_settings
from app.db import anon_transaction, user_transaction
from app.mail import Mail, Mailer
from app.security import hash_password, new_token, token_hash, verify_password


class EmailTaken(Exception):
    """Ese correo ya tiene una cuenta."""


class BadCredentials(Exception):
    """Correo o contraseña incorrectos (no decimos cuál de los dos)."""


@dataclass(frozen=True)
class NewSession:
    user_id: int
    token: str          # va a la cookie; la base solo guarda su huella


def _open_session(conn: psycopg.Connection, user_id: int, user_agent: str | None) -> NewSession:
    token, digest = new_token()
    expires = datetime.now(UTC) + timedelta(days=get_settings().session_days)
    conn.execute("SELECT auth_session_create(%s, %s, %s, %s)", (user_id, digest, expires, user_agent))
    return NewSession(user_id, token)


def signup(name: str, email: str, password: str, user_agent: str | None = None) -> NewSession:
    with anon_transaction() as conn:
        try:
            with conn.transaction():
                user_id = conn.execute("SELECT auth_signup(%s, %s, %s)",
                                       (name, email, hash_password(password))).fetchone()[0]
        except psycopg.errors.UniqueViolation:
            raise EmailTaken from None
        return _open_session(conn, user_id, user_agent)


def login(email: str, password: str, user_agent: str | None = None) -> NewSession:
    with anon_transaction() as conn:
        row = conn.execute("SELECT user_id, password_hash FROM auth_login_lookup(%s)", (email,)).fetchone()
        user_id, password_hash = row if row else (None, None)
        if not verify_password(password_hash, password):   # tarda lo mismo si el correo no existe
            raise BadCredentials
        return _open_session(conn, user_id, user_agent)


def session_user(token: str) -> int | None:
    """¿De quién es esta cookie? None si no existe o venció."""
    with anon_transaction() as conn:
        return conn.execute("SELECT auth_session_user(%s)", (token_hash(token),)).fetchone()[0]


def logout(token: str) -> None:
    with anon_transaction() as conn:
        conn.execute("SELECT auth_session_delete(%s)", (token_hash(token),))


def logout_everywhere(user_id: int) -> int:
    with user_transaction(user_id) as conn:
        return conn.execute("SELECT auth_session_delete_all()").fetchone()[0]


def change_password(user_id: int, current_token: str, current: str | None, new: str) -> None:
    """Pide la contraseña actual; cierra las demás sesiones y deja viva esta. Quien entró con
    Google y todavía no tiene contraseña la crea sin «actual»."""
    with user_transaction(user_id) as conn:
        stored = conn.execute("SELECT password FROM res_users").fetchone()[0]
        if stored is not None and not verify_password(stored, current or ""):
            raise BadCredentials
        conn.execute("SELECT auth_password_set(%s, %s)", (hash_password(new), token_hash(current_token)))


def request_password_reset(email: str) -> Mail | None:
    """Prepara el correo con el enlace, o None si el correo no tiene cuenta."""
    s = get_settings()
    token, digest = new_token()
    expires = datetime.now(UTC) + timedelta(minutes=s.reset_minutes)
    with anon_transaction() as conn:
        exists = conn.execute("SELECT auth_reset_request(%s, %s, %s)", (email, digest, expires)).fetchone()[0]
    if not exists:
        return None
    link = f"{s.app_url}/restablecer?token={token}"
    return Mail(
        to=email,
        subject="Recupera tu contraseña de PPM",
        body=(
            "Hola:\n\n"
            "Alguien pidió cambiar la contraseña de tu cuenta de PPM. Si fuiste tú, abre este enlace:\n\n"
            f"{link}\n\n"
            f"El enlace sirve una sola vez y vence en {s.reset_minutes} minutos. "
            "Si no lo pediste, ignora este correo: tu contraseña sigue igual.\n"
        ),
    )


def confirm_password_reset(token: str, new: str) -> bool:
    """Pone la contraseña nueva y cierra todas las sesiones. False si el enlace venció o ya se usó."""
    with anon_transaction() as conn:
        return conn.execute("SELECT auth_reset_confirm(%s, %s)",
                            (token_hash(token), hash_password(new))).fetchone()[0]


def send_quietly(mailer: Mailer, mail: Mail) -> None:
    """Se llama después de responder: si el correo falla, queda en el registro."""
    try:
        mailer.send(mail)
    except Exception:  # noqa: BLE001 - el registro basta; la respuesta ya se dio
        logging.getLogger("ppm.mail").exception("No se pudo enviar el correo a %s", mail.to)


# ── Entrar con Google ────────────────────────────────────────────────────────────────────────

PENDING_MINUTES = 15


class GoogleInUse(Exception):
    """Esa cuenta de Google ya entra a otra cuenta de PPM."""


class GoogleLinkedOther(Exception):
    """El correo tiene cuenta, pero unida a otra cuenta de Google."""


class PendingExpired(Exception):
    """La unión pendiente venció o ya se usó."""


class NoOtherKey(Exception):
    """Sin contraseña, desvincular Google la dejaría sin forma de entrar."""


@dataclass(frozen=True)
class GoogleResult:
    session: NewSession | None = None   # entró (o se creó la cuenta)
    pending: str | None = None          # el correo ya tiene cuenta: este número espera su contraseña


def google_login(who: google.Identity, user_agent: str | None = None) -> GoogleResult:
    with anon_transaction() as conn:
        user_id, outcome = conn.execute("SELECT * FROM auth_oauth_lookup(%s, %s, %s)",
                                        (google.PROVIDER, who.sub, who.email)).fetchone()
        if outcome == "login":
            return GoogleResult(session=_open_session(conn, user_id, user_agent))
        if outcome == "linked_other":
            raise GoogleLinkedOther
        if outcome == "existing":
            token, digest = new_token()
            expires = datetime.now(UTC) + timedelta(minutes=PENDING_MINUTES)
            conn.execute("SELECT auth_oauth_pending_create(%s, %s, %s, %s, %s, %s)",
                         (user_id, digest, expires, google.PROVIDER, who.sub, who.email))
            return GoogleResult(pending=token)
        try:
            with conn.transaction():
                user_id = conn.execute("SELECT auth_oauth_signup(%s, %s, %s, %s)",
                                       (who.name, google.PROVIDER, who.sub, who.email)).fetchone()[0]
        except psycopg.errors.UniqueViolation:   # alguien con ese correo o esa Google justo ahora
            raise GoogleInUse from None
        return GoogleResult(session=_open_session(conn, user_id, user_agent))


@dataclass(frozen=True)
class Pending:
    email: str          # la cuenta de PPM
    google_email: str   # la cuenta de Google que espera unirse


def google_pending(token: str) -> Pending | None:
    with anon_transaction() as conn:
        row = conn.execute("SELECT login, oauth_email FROM auth_oauth_pending(%s)", (token_hash(token),)).fetchone()
    return Pending(*row) if row else None


def google_pending_confirm(token: str, password: str, user_agent: str | None = None) -> NewSession:
    """Une la cuenta de Google pendiente con la contraseña de la cuenta de PPM, y entra."""
    with anon_transaction() as conn:
        row = conn.execute("SELECT user_id, password_hash FROM auth_oauth_pending(%s)", (token_hash(token),)).fetchone()
        if row is None:
            raise PendingExpired
        if not verify_password(row[1], password):
            raise BadCredentials
        try:
            with conn.transaction():
                user_id = conn.execute("SELECT auth_oauth_pending_confirm(%s)", (token_hash(token),)).fetchone()[0]
        except psycopg.errors.UniqueViolation:
            raise GoogleInUse from None
        if user_id is None:
            raise PendingExpired
        return _open_session(conn, user_id, user_agent)


def google_link(user_id: int, who: google.Identity) -> None:
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                conn.execute("SELECT auth_oauth_link(%s, %s, %s)", (google.PROVIDER, who.sub, who.email))
        except psycopg.errors.UniqueViolation:
            raise GoogleInUse from None


def google_unlink(user_id: int) -> None:
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                conn.execute("SELECT auth_oauth_unlink()")
        except psycopg.errors.CheckViolation:
            raise NoOtherKey from None
