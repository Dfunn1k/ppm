"""Lo que comparten las rutas: la cookie de sesión y quién está conectado."""

from dataclasses import dataclass

from fastapi import Cookie, Depends, HTTPException, Response, status

from app import auth, users
from app.config import get_settings

COOKIE = "ppm_session"


@dataclass(frozen=True)
class CurrentSession:
    user_id: int
    token: str


def current_session(ppm_session: str | None = Cookie(default=None)) -> CurrentSession:
    user_id = auth.session_user(ppm_session) if ppm_session else None
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Inicia sesión para continuar")
    return CurrentSession(user_id, ppm_session)


def current_admin(session: CurrentSession = Depends(current_session)) -> CurrentSession:
    """Solo quien está en ADMIN_EMAILS: el tipo de cambio es de todos."""
    if not users.get_me(session.user_id).is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esto lo ve solo el administrador de PPM")
    return session


def set_session_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(COOKIE, token, max_age=s.session_days * 86400, httponly=True,
                        samesite="lax", secure=s.cookie_secure, path="/")


def clear_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(COOKIE, httponly=True, samesite="lax", secure=s.cookie_secure, path="/")
