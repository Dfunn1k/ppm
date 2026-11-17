"""Punto de entrada de la API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from app import rates as rates_logic
from app.config import get_settings
from app.db import close_pool, get_pool
from app.routes import (accounts, attachments, auth, cards, closing, home, me, moves, partners, pending, rates, recurring, reports,
                        statements, tags)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = rates_logic.start_daily() if get_settings().rates_import else None   # el importador de SUNAT
    yield
    if stop:
        stop.set()
    close_pool()


app = FastAPI(title="PPM API", version="0.18.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(accounts.router)
app.include_router(cards.router)
app.include_router(moves.router)
app.include_router(partners.router)
app.include_router(home.router)
app.include_router(rates.router)
app.include_router(statements.router)
app.include_router(recurring.router)
app.include_router(pending.router)
app.include_router(attachments.router)
app.include_router(reports.router)
app.include_router(closing.router)
app.include_router(tags.router)


class HealthOut(BaseModel):
    status: str
    postgres: str


@app.get("/health")
def health() -> HealthOut:
    """Responde si la API está viva y llega a la base de datos."""
    with get_pool().connection() as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
    return HealthOut(status="ok", postgres=version)


# Los monitores externos (UptimeRobot) consultan primero con HEAD. Va aparte y fuera del esquema:
# con una sola ruta para GET y HEAD, FastAPI repite el nombre de la operación en los tipos de la web.
@app.head("/health", include_in_schema=False)
def health_head() -> HealthOut:
    return health()
