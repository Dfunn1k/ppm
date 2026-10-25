"""Puerto de base de datos: un pool de conexiones a PostgreSQL con psycopg 3.

La lógica nunca abre conexiones por su cuenta; las pide aquí. Para tocar datos de una
persona se usa `user_transaction(user_id)`: dentro de esa transacción la base trabaja
como `ppm_app` y con `app.user_id` fijado, así que la seguridad por fila solo deja ver
y escribir las filas de esa persona. Al terminar la transacción, ambas cosas se deshacen.
"""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

from app.config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(get_settings().database_url, min_size=1, max_size=10, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def act_as_user(conn: psycopg.Connection, user_id: int) -> None:
    """Dentro de la transacción abierta: trabajar como ppm_app y como esa persona."""
    conn.execute("SET LOCAL ROLE ppm_app")
    conn.execute("SELECT set_config('app.user_id', %s, true)", (str(user_id),))


@contextmanager
def user_transaction(user_id: int) -> Iterator[psycopg.Connection]:
    """Una transacción que solo ve los datos de `user_id`. Confirma al salir sin errores."""
    with get_pool().connection() as conn, conn.transaction():
        act_as_user(conn, user_id)
        yield conn
