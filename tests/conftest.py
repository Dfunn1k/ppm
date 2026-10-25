"""Las pruebas corren contra un PostgreSQL de verdad (DATABASE_URL), nunca contra una base simulada:
las reglas importantes de PPM viven en la base (cuadre, aislamiento por usuario, cuentas de sistema)."""

import os

import psycopg
import pytest

from app.config import get_settings


@pytest.fixture
def conn():
    """Una conexión que deshace todo al terminar cada prueba."""
    with psycopg.connect(get_settings().database_url) as c:
        yield c
        c.rollback()


def in_ci() -> bool:
    return os.environ.get("CI") == "true"
