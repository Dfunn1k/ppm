"""Las pruebas corren contra un PostgreSQL de verdad (DATABASE_URL), nunca contra una base simulada:
las reglas importantes de PPM viven en la base (cuadre, aislamiento por usuario, cuentas de sistema).

Cada prueba trabaja dentro de una transacción que se deshace al final, así no deja rastro."""

import os
from collections.abc import Callable

import psycopg
import pytest

from app.config import get_settings
from app.db import act_as_user


@pytest.fixture
def conn():
    """Una conexión como dueño de la base; todo se deshace al terminar la prueba."""
    with psycopg.connect(get_settings().database_url) as c:
        yield c
        c.rollback()


@pytest.fixture
def new_user(conn) -> Callable[..., int]:
    """Crea una persona como lo hará «Crear cuenta» (sin configurar todavía) y devuelve su id."""

    def make(login: str, name: str = "Prueba") -> int:
        conn.execute("RESET ROLE")
        return conn.execute(
            "INSERT INTO res_users (name, login, password) VALUES (%s, %s, 'x') RETURNING id",
            (name, login),
        ).fetchone()[0]

    return make


@pytest.fixture
def as_user(conn) -> Callable[[int], psycopg.Connection]:
    """Pasa la conexión a trabajar como esa persona (ppm_app + app.user_id)."""

    def switch(user_id: int) -> psycopg.Connection:
        conn.execute("RESET ROLE")
        act_as_user(conn, user_id)
        return conn

    return switch


def in_ci() -> bool:
    return os.environ.get("CI") == "true"
