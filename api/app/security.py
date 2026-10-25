"""Contraseñas y números de sesión.

- Contraseñas: Argon2id. La base guarda solo la huella; ni siquiera PPM puede leer la contraseña.
- Sesiones y enlaces: un número al azar de 256 bits va al navegador (o al correo) y la base
  guarda solo su huella sha256. Si alguien copiara la base, no podría usar esas huellas.
"""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()   # Argon2id con los parámetros recomendados por la librería

# Para comparar contra algo cuando el correo no existe: así la respuesta tarda lo mismo
# y no delata qué correos tienen cuenta.
_DUMMY_HASH = _hasher.hash("contraseña-que-no-es-de-nadie")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def new_token() -> tuple[str, str]:
    """Devuelve (número para el navegador o el correo, huella para la base)."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
