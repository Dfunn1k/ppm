"""Punto de entrada de la API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db import close_pool, get_pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    close_pool()


app = FastAPI(title="PPM API", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    """Responde si la API está viva y llega a la base de datos."""
    with get_pool().connection() as conn:
        version = conn.execute("SHOW server_version").fetchone()[0]
    return {"status": "ok", "postgres": version}
