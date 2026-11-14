"""Acceso: pantallas A1 (iniciar sesión, crear cuenta, entrar con Google) y X6 (contraseña,
Google, cerrar sesión)."""

import base64
import binascii
import json
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Header, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from app import auth, google
from app.config import get_settings
from app.mail import Mailer, get_mailer
from app.routes.deps import CurrentSession, clear_session_cookie, current_session, set_session_cookie
from app.routes.me import MeOut
from app.security import token_hash
from app.users import get_me

router = APIRouter(prefix="/auth", tags=["acceso"])

Password = Annotated[str, Field(min_length=8, max_length=128)]


class SignupIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    email: EmailStr
    password: Password


class LoginIn(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(max_length=128)]


class PasswordChangeIn(BaseModel):
    current_password: Annotated[str, Field(max_length=128)] | None = None   # sin contraseña aún (Google): se omite
    new_password: Password


class ResetRequestIn(BaseModel):
    email: EmailStr


class ResetConfirmIn(BaseModel):
    token: Annotated[str, Field(min_length=20, max_length=200)]
    new_password: Password


@router.post("/signup", status_code=status.HTTP_201_CREATED, summary="Crear cuenta")
def signup(body: SignupIn, response: Response,
           user_agent: Annotated[str | None, Header()] = None) -> MeOut:
    try:
        session = auth.signup(body.name, body.email, body.password, user_agent)
    except auth.EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese correo ya tiene una cuenta") from None
    set_session_cookie(response, session.token)
    return MeOut.of(get_me(session.user_id))


@router.post("/login", summary="Iniciar sesión")
def login(body: LoginIn, response: Response,
          user_agent: Annotated[str | None, Header()] = None) -> MeOut:
    try:
        session = auth.login(body.email, body.password, user_agent)
    except auth.BadCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Correo o contraseña incorrectos") from None
    set_session_cookie(response, session.token)
    return MeOut.of(get_me(session.user_id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Cerrar sesión")
def logout(response: Response, session: CurrentSession = Depends(current_session)) -> None:
    auth.logout(session.token)
    clear_session_cookie(response)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT,
             summary="Cerrar sesión en todos lados")
def logout_all(response: Response, session: CurrentSession = Depends(current_session)) -> None:
    auth.logout_everywhere(session.user_id)
    clear_session_cookie(response)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT,
             summary="Cambiar contraseña (o crearla, si entraste con Google y aún no tienes)")
def change_password(body: PasswordChangeIn, session: CurrentSession = Depends(current_session)) -> None:
    try:
        auth.change_password(session.user_id, session.token, body.current_password, body.new_password)
    except auth.BadCredentials:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual no es correcta") from None


@router.post("/password-reset", status_code=status.HTTP_202_ACCEPTED,
             summary="Pedir un enlace para recuperar la contraseña")
def request_reset(body: ResetRequestIn, background: BackgroundTasks,
                  mailer: Mailer = Depends(get_mailer)) -> dict:
    mail = auth.request_password_reset(body.email)
    if mail:
        background.add_task(auth.send_quietly, mailer, mail)
    # La misma respuesta exista o no la cuenta: no revela qué correos están registrados
    return {"detail": "Si ese correo tiene una cuenta, te llegará un enlace para cambiar la contraseña"}


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT,
             summary="Poner la contraseña nueva con el enlace del correo")
def confirm_reset(body: ResetConfirmIn) -> None:
    if not auth.confirm_password_reset(body.token, body.new_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "El enlace venció o ya se usó. Pide uno nuevo.")


# ── Entrar con Google ────────────────────────────────────────────────────────────────────────
# El navegador va y vuelve por direcciones (no por fetch): /auth/google/start lo manda a Google y
# Google lo devuelve a /auth/google/callback, que lo deja en la pantalla que toca de la web.

FLOW_COOKIE = "ppm_google"            # el turno: state, nonce y verificador, 10 minutos
PENDING_COOKIE = "ppm_google_pending"  # la unión que espera la contraseña, 15 minutos


class ProvidersOut(BaseModel):
    google: bool


class PendingOut(BaseModel):
    email: str          # la cuenta de PPM
    google_email: str   # la cuenta de Google que espera unirse


class PendingIn(BaseModel):
    password: Annotated[str, Field(max_length=128)]


def _set(response: Response, name: str, value: str, minutes: int) -> None:
    response.set_cookie(name, value, max_age=minutes * 60, httponly=True, samesite="lax",
                        secure=get_settings().cookie_secure, path="/")


def _clear(response: Response, name: str) -> None:
    response.delete_cookie(name, httponly=True, samesite="lax", secure=get_settings().cookie_secure, path="/")


def _go(path: str) -> RedirectResponse:
    """A una pantalla de la web, en el mismo sitio por el que entró (dirección relativa)."""
    return RedirectResponse(path, status.HTTP_303_SEE_OTHER)


def _read_flow(raw: str | None) -> tuple[google.Flow, str, str] | None:
    """(turno, 'login' o 'link', huella de la sesión que vincula) o None si no hay o está roto."""
    try:
        d = json.loads(base64.urlsafe_b64decode(raw or ""))
        return google.Flow(d["s"], d["n"], d["v"]), d["m"], d["k"]
    except (binascii.Error, ValueError, KeyError, TypeError):
        return None


@router.get("/providers", summary="Formas de entrar disponibles (el botón de Google aparece si está configurado)")
def providers() -> ProvidersOut:
    return ProvidersOut(google=google.enabled())


@router.get("/google/start", summary="Ir a Google para entrar o vincular", response_class=RedirectResponse,
            status_code=status.HTTP_303_SEE_OTHER)
def google_start(mode: Literal["login", "link"] = "login",
                 ppm_session: str | None = Cookie(default=None)) -> RedirectResponse:
    if not google.enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrar con Google no está configurado")
    session = ""
    if mode == "link":   # vincular es para quien ya está dentro: el turno queda atado a su sesión
        if not ppm_session or auth.session_user(ppm_session) is None:
            return _go("/entrar")
        session = token_hash(ppm_session)
    flow = google.new_flow()
    response = RedirectResponse(google.authorize_url(flow), status.HTTP_303_SEE_OTHER)
    raw = json.dumps({"s": flow.state, "n": flow.nonce, "v": flow.verifier, "m": mode, "k": session})
    _set(response, FLOW_COOKIE, base64.urlsafe_b64encode(raw.encode()).decode(), 10)
    return response


@router.get("/google/callback", summary="La vuelta de Google", response_class=RedirectResponse,
            status_code=status.HTTP_303_SEE_OTHER)
def google_callback(code: str | None = None, state: str | None = None, error: str | None = None,
                    ppm_google: str | None = Cookie(default=None), ppm_session: str | None = Cookie(default=None),
                    user_agent: Annotated[str | None, Header()] = None) -> RedirectResponse:
    saved = _read_flow(ppm_google)
    mode = saved[1] if saved else "login"
    back = "/mas/cuenta?google=" if mode == "link" else "/entrar?google="

    def done(response: RedirectResponse) -> RedirectResponse:
        _clear(response, FLOW_COOKIE)   # el turno sirve una sola vez
        return response

    if error:   # canceló en Google (access_denied) u otro motivo
        return done(_go(back + "cancelado"))
    if not saved or not code or not state or not secrets.compare_digest(state, saved[0].state):
        return done(_go(back + "fallo"))
    try:
        who = google.finish(code, saved[0])
    except google.GoogleError:
        return done(_go(back + "fallo"))

    if mode == "link":
        user_id = auth.session_user(ppm_session) if ppm_session else None
        if user_id is None or not secrets.compare_digest(token_hash(ppm_session or ""), saved[2]):
            return done(_go(back + "fallo"))
        try:
            auth.google_link(user_id, who)
        except auth.GoogleInUse:
            return done(_go(back + "en-uso"))
        return done(_go(back + "vinculado"))

    try:
        result = auth.google_login(who, user_agent)
    except auth.GoogleLinkedOther:
        return done(_go(back + "otra-google"))
    except auth.GoogleInUse:
        return done(_go(back + "fallo"))
    if result.pending:
        response = _go("/entrar/google")
        _set(response, PENDING_COOKIE, result.pending, auth.PENDING_MINUTES)
        return done(response)
    assert result.session
    response = _go("/inicio" if get_me(result.session.user_id).configured else "/bienvenida/1")
    set_session_cookie(response, result.session.token)
    return done(response)


@router.get("/google/pending", summary="La cuenta de Google que espera unirse a tu cuenta",
            responses={404: {"description": "No hay ninguna, o venció"}})
def google_pending(ppm_google_pending: str | None = Cookie(default=None)) -> PendingOut:
    pending = auth.google_pending(ppm_google_pending) if ppm_google_pending else None
    if pending is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pasaron más de 15 minutos. Vuelve a entrar con Google.")
    return PendingOut(email=pending.email, google_email=pending.google_email)


@router.post("/google/pending", summary="Unir la cuenta de Google con tu contraseña, y entrar")
def google_pending_confirm(body: PendingIn, response: Response,
                           ppm_google_pending: str | None = Cookie(default=None),
                           user_agent: Annotated[str | None, Header()] = None) -> MeOut:
    try:
        session = auth.google_pending_confirm(ppm_google_pending or "", body.password, user_agent)
    except auth.BadCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No es la contraseña de esa cuenta") from None
    except auth.PendingExpired:
        raise HTTPException(status.HTTP_410_GONE, "Pasaron más de 15 minutos. Vuelve a entrar con Google.") from None
    except auth.GoogleInUse:
        raise HTTPException(status.HTTP_409_CONFLICT, "Esa cuenta de Google ya entra a otra cuenta de PPM") from None
    _clear(response, PENDING_COOKIE)
    set_session_cookie(response, session.token)
    return MeOut.of(get_me(session.user_id))


@router.delete("/google", status_code=status.HTTP_204_NO_CONTENT, summary="Desvincular Google",
               responses={409: {"description": "Sin contraseña: te quedarías sin forma de entrar"}})
def google_unlink(session: CurrentSession = Depends(current_session)) -> None:
    try:
        auth.google_unlink(session.user_id)
    except auth.NoOtherKey:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Primero crea una contraseña: sin ella no tendrías cómo entrar") from None
