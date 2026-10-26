"""ppm_api, el usuario con que entra la API (migración 0011): sin ponerse un rol no lee nada, solo
puede asumir ppm_app o ppm_admin, y nunca hacerse pasar por el dueño de la base."""

from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from app.db import act_as_user, get_pool
from tests.conftest import owner_url


@pytest.fixture
def api_conn():
    """Una conexión como ppm_api. La contraseña de prueba es la misma que usa Docker Compose en desarrollo."""
    owner = owner_url()
    with psycopg.connect(owner, autocommit=True) as c:
        c.execute("ALTER ROLE ppm_api LOGIN PASSWORD 'ppm_api'")
    u = urlsplit(owner)
    url = urlunsplit(u._replace(netloc=f"ppm_api:ppm_api@{u.hostname}:{u.port or 5432}"))
    with psycopg.connect(url) as c:
        yield c
        c.rollback()


def test_entra_sin_ser_dueno_ni_superusuario(api_conn):
    user, superuser = api_conn.execute(
        "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user").fetchone()
    assert (user, superuser) == ("ppm_api", False)
    assert api_conn.execute("SHOW server_version").fetchone()[0]   # lo que usa /health


def test_sin_rol_no_lee_ninguna_tabla(api_conn):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        api_conn.execute("SELECT count(*) FROM res_users")


def test_no_puede_hacerse_pasar_por_el_dueno(api_conn):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        api_conn.execute("SET ROLE ppm")


def test_como_ppm_app_ve_solo_lo_de_su_persona(api_conn, new_user, conn):
    ana = new_user("ana-rol@correo.com", "Ana")
    new_user("luis-rol@correo.com", "Luis")
    conn.commit()
    try:
        with api_conn.transaction():
            act_as_user(api_conn, ana)
            assert api_conn.execute("SELECT login FROM res_users").fetchall() == [("ana-rol@correo.com",)]
        with api_conn.transaction():
            api_conn.execute("SET LOCAL ROLE ppm_admin")
            assert api_conn.execute("SELECT count(*) FROM res_currency_rate").fetchone()[0] >= 0
    finally:
        conn.execute("RESET ROLE")
        conn.execute("DELETE FROM res_users WHERE login LIKE '%-rol@correo.com'")
        conn.commit()


def test_como_ppm_admin_solo_ve_el_tipo_de_cambio(api_conn):
    with api_conn.transaction():
        api_conn.execute("SET LOCAL ROLE ppm_admin")
        api_conn.execute("SELECT count(*) FROM res_currency_rate_status").fetchone()   # Z1: cuántas personas por moneda
        with pytest.raises(psycopg.errors.InsufficientPrivilege), api_conn.transaction():
            api_conn.execute("SELECT count(*) FROM res_users")
        with pytest.raises(psycopg.errors.InsufficientPrivilege), api_conn.transaction():
            api_conn.execute("SELECT count(*) FROM account_move_line")


def test_la_api_de_las_pruebas_entra_como_ppm_api():
    """Todas las pruebas de la API pasan por el mismo usuario restringido que producción."""
    with get_pool().connection() as c:
        user, superuser = c.execute(
            "SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user").fetchone()
    assert (user, superuser) == ("ppm_api", False), "Corre las pruebas con DATABASE_URL de ppm_api y PPM_OWNER_URL del dueño"
