"""Las pruebas corren contra un PostgreSQL de verdad (DATABASE_URL), nunca contra una base simulada:
las reglas importantes de PPM viven en la base (cuadre, aislamiento por usuario, cuentas de sistema).

Cada prueba trabaja dentro de una transacción que se deshace al final, así no deja rastro."""

import os
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal

import psycopg
import pytest

from app.config import get_settings
from app.db import act_as_user


def owner_url() -> str:
    """El dueño de la base, para preparar y limpiar datos. La API de las pruebas entra como ppm_api
    (DATABASE_URL), igual que en producción; PPM_OWNER_URL dice cómo entrar como dueño."""
    return os.environ.get("PPM_OWNER_URL") or get_settings().database_url


@pytest.fixture
def conn():
    """Una conexión como dueño de la base; todo se deshace al terminar la prueba."""
    with psycopg.connect(owner_url()) as c:
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


def usd_today():
    """El último tipo del dólar que hay hasta hoy (compra, venta), o None si no se cargó ninguno.
    La API valora los dólares con él; las pruebas no lo fijan para no pisar el de la base."""
    with psycopg.connect(owner_url()) as c:
        return c.execute(
            "SELECT rate_buy, rate_sell FROM res_currency_rate r JOIN res_currency c ON c.id = r.currency_id"
            " WHERE c.name = 'USD' AND r.name <= (now() AT TIME ZONE 'America/Lima')::date"
            " ORDER BY r.name DESC LIMIT 1").fetchone()


def usd_value_today(amount: str, book: str) -> str:
    """Lo que vale hoy un monto en dólares que se tiene: a la compra de hoy, o en libros si no hay tipo."""
    r = usd_today()
    if r is None:
        return book
    return str((Decimal(amount) * r[0]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def in_ci() -> bool:
    return os.environ.get("CI") == "true"
