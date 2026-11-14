"""Configuración leída del entorno, en un solo lugar."""

import os
from dataclasses import dataclass
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes", "si", "sí")


@dataclass(frozen=True)
class Settings:
    database_url: str
    app_url: str                # dónde vive la web: los enlaces de los correos apuntan ahí
    cookie_secure: bool         # true en producción (solo HTTPS)
    session_days: int           # cuánto dura una sesión
    reset_minutes: int          # cuánto dura el enlace para recuperar la contraseña
    smtp_host: str
    smtp_port: int
    smtp_user: str | None
    smtp_password: str | None
    smtp_starttls: bool
    mail_from: str
    admin_emails: frozenset[str]  # quienes ven y corrigen el tipo de cambio (Z1)
    rates_import: bool          # el importador diario de SUNAT corre dentro de la API
    sunat_url: str
    filestore_dir: str          # el almacén de adjuntos: una carpeta por persona
    google_client_id: str | None      # Entrar con Google: sin él, el botón no aparece
    google_client_secret: str | None
    google_auth_url: str              # adónde va el navegador a elegir su cuenta
    google_token_url: str             # dónde la API cambia el código por el ID token


@lru_cache
def get_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", "postgresql://ppm:ppm@localhost:5432/ppm"),
        app_url=os.environ.get("APP_URL", "http://localhost:5173").rstrip("/"),
        cookie_secure=_bool("COOKIE_SECURE", False),
        session_days=int(os.environ.get("SESSION_DAYS", "30")),
        reset_minutes=int(os.environ.get("RESET_MINUTES", "60")),
        smtp_host=os.environ.get("SMTP_HOST", "localhost"),
        smtp_port=int(os.environ.get("SMTP_PORT", "1025")),
        smtp_user=os.environ.get("SMTP_USER") or None,
        smtp_password=os.environ.get("SMTP_PASSWORD") or None,
        smtp_starttls=_bool("SMTP_STARTTLS", False),
        mail_from=os.environ.get("MAIL_FROM", "PPM <no-responder@ppm.local>"),
        admin_emails=frozenset(e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()),
        rates_import=_bool("RATES_IMPORT", False),
        sunat_url=os.environ.get("SUNAT_URL", "https://www.sunat.gob.pe/a/txt/tipoCambio.txt"),
        filestore_dir=os.environ.get("FILESTORE_DIR", "/var/lib/ppm/filestore"),
        google_client_id=os.environ.get("GOOGLE_CLIENT_ID") or None,
        google_client_secret=os.environ.get("GOOGLE_CLIENT_SECRET") or None,
        google_auth_url=os.environ.get("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
        google_token_url=os.environ.get("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    )
