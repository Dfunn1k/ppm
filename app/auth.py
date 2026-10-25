"""Lógica de acceso: crear cuenta, iniciar y cerrar sesión, contraseñas.

No sabe nada de HTTP: recibe datos simples y devuelve dataclasses o lanza errores propios.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg

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


def change_password(user_id: int, current_token: str, current: str, new: str) -> None:
    """Pide la contraseña actual; cierra las demás sesiones y deja viva esta."""
    with user_transaction(user_id) as conn:
        stored = conn.execute("SELECT password FROM res_users").fetchone()[0]
        if not verify_password(stored, current):
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
