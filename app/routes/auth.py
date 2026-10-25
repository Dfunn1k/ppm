"""Acceso: pantallas A1 (iniciar sesión, crear cuenta) y X6 (contraseña, cerrar sesión)."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field

from app import auth
from app.mail import Mailer, get_mailer
from app.routes.deps import CurrentSession, clear_session_cookie, current_session, set_session_cookie
from app.routes.me import MeOut
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
    current_password: Annotated[str, Field(max_length=128)]
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


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, summary="Cambiar contraseña")
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
