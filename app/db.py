"""Puerto de base de datos: un pool de conexiones a PostgreSQL con psycopg 3.

La lógica nunca abre conexiones por su cuenta; las pide aquí. Más adelante,
cada conexión fijará `app.user_id` (SET LOCAL) para que la seguridad por fila
solo muestre los datos de quien inició sesión.
"""

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
