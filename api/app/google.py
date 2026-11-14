"""Entrar con Google (OpenID Connect, con redirección desde el servidor).

Como una ventanilla: PPM manda a la persona a Google con un número de turno (`state`) y una seña
(`nonce`); Google la devuelve con un código que solo la API, con su secreto, puede cambiar por el
ID token. Ese token llega directo de Google por HTTPS, así que basta revisar que sea para PPM
(`aud`), de Google (`iss`), vigente (`exp`) y de este turno (`nonce`) (OpenID Connect Core 3.1.3.7).

No sabe nada de cookies ni de la base: arma la dirección de ida y valida la vuelta.
"""

import base64
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from app.config import get_settings

PROVIDER = "Google"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPE = "openid email profile"   # solo nombre y correo: nada de Gmail ni Drive


class GoogleError(Exception):
    """La vuelta de Google no sirve (código vencido, token ajeno, correo sin verificar…)."""


@dataclass(frozen=True)
class Identity:
    sub: str          # el número de la cuenta de Google: nunca cambia
    email: str
    name: str


@dataclass(frozen=True)
class Flow:
    """Lo que la API recuerda (en una cookie httpOnly) entre la ida y la vuelta."""
    state: str
    nonce: str
    verifier: str     # PKCE: solo quien empezó puede terminar


def enabled() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_client_secret)


def redirect_uri() -> str:
    """Adonde vuelve Google. Tiene que ser idéntica a la anotada en la consola de Google."""
    return f"{get_settings().app_url}/api/auth/google/callback"


def new_flow() -> Flow:
    return Flow(secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48))


def _challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def authorize_url(flow: Flow) -> str:
    s = get_settings()
    query = urllib.parse.urlencode({
        "client_id": s.google_client_id, "redirect_uri": redirect_uri(), "response_type": "code",
        "scope": SCOPE, "state": flow.state, "nonce": flow.nonce,
        "code_challenge": _challenge(flow.verifier), "code_challenge_method": "S256",
        "prompt": "select_account",   # que pueda elegir cuál de sus cuentas de Google
    })
    return f"{s.google_auth_url}?{query}"


def _post_form(url: str, data: dict[str, str]) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:   # noqa: S310 - la URL viene de la configuración
            return json.load(r)
    except (urllib.error.URLError, ValueError) as e:
        raise GoogleError(f"Google no respondió: {e}") from None


# Las pruebas la reemplazan por una Google falsa
post_form: Callable[[str, dict[str, str]], dict] = _post_form


def _claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise GoogleError("El ID token no se puede leer") from None


def finish(code: str, flow: Flow) -> Identity:
    """Cambia el código por el ID token y lo valida."""
    s = get_settings()
    tokens = post_form(s.google_token_url, {
        "code": code, "client_id": s.google_client_id or "", "client_secret": s.google_client_secret or "",
        "redirect_uri": redirect_uri(), "grant_type": "authorization_code", "code_verifier": flow.verifier,
    })
    if "id_token" not in tokens:
        raise GoogleError(f"Google no dio el ID token: {tokens.get('error', 'sin detalle')}")
    c = _claims(tokens["id_token"])
    if c.get("iss") not in ISSUERS:
        raise GoogleError("El ID token no es de Google")
    if c.get("aud") != s.google_client_id:
        raise GoogleError("El ID token no es para PPM")
    if not isinstance(c.get("exp"), int | float) or c["exp"] < time.time():
        raise GoogleError("El ID token venció")
    if not c.get("nonce") or not secrets.compare_digest(str(c["nonce"]), flow.nonce):
        raise GoogleError("El ID token no es de este inicio de sesión")
    if not c.get("sub") or not c.get("email"):
        raise GoogleError("Google no dio la cuenta ni el correo")
    if c.get("email_verified") is not True:
        raise GoogleError("Google no ha verificado ese correo")
    email = str(c["email"]).strip().lower()
    return Identity(str(c["sub"]), email, str(c.get("name") or email.split("@")[0])[:80])
