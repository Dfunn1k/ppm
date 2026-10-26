"""Punto de entrada de la API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from app.db import close_pool, get_pool
from app.routes import accounts, auth, home, me, moves


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    close_pool()


app = FastAPI(title="PPM API", version="0.1.0", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(accounts.router)
app.include_router(moves.router)
app.include_router(home.router)


class HealthOut(BaseModel):
    status: str
    postgres: str


@app.get("/health")
def health() -> HealthOut:
    """Responde si la API está viva y llega a la base de datos."""
    with get_pool().connection() as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
    return HealthOut(status="ok", postgres=version)
