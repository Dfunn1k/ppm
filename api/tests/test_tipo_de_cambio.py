"""El tipo de cambio global: manda el último que se cargó, el último anterior si falta un día,
compra para lo que tienes y venta para lo que debes, y solo el administrador lo escribe."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

USD = "(SELECT id FROM res_currency WHERE name = 'USD')"


@pytest.fixture
def admin(conn):
    conn.execute("RESET ROLE")
    conn.execute("SET ROLE ppm_admin")
    conn.execute("DELETE FROM res_currency_rate")   # la prueba parte de cero; se deshace al final
    return conn


@pytest.fixture
def ana(new_user, as_user):
    def make() -> psycopg.Connection:
        c = as_user(new_user("ana@correo.com", "Ana"))
        c.execute("SELECT setup_user('PE', '{USD}')")
        return c
    return make


def _rate(c, on: date):
    return c.execute(f"SELECT rate_buy, rate_sell, source FROM res_currency_rate"
                     f" WHERE currency_id = {USD} AND name = %s", (on,)).fetchone()


def test_manda_el_ultimo_que_se_cargo(admin):
    d = date(2026, 10, 24)
    admin.execute("SELECT set_currency_rate('USD', %s, 3.447, 3.455)", (d,))
    admin.execute("SELECT set_currency_rate('usd', %s, 3.450, 3.458, 'manual')", (d,))
    assert _rate(admin, d) == (Decimal("3.4500"), Decimal("3.4580"), "manual")
    admin.execute("SELECT set_currency_rate('USD', %s, 3.447, 3.455)", (d,))   # SUNAT vuelve a pisarlo
    assert _rate(admin, d) == (Decimal("3.4470"), Decimal("3.4550"), "SUNAT")
    assert admin.execute("SELECT count(*) FROM res_currency_rate").fetchone()[0] == 1


def test_la_venta_no_es_menor_que_la_compra(admin):
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute("SELECT set_currency_rate('USD', '2026-10-24', 3.46, 3.45)")


def test_el_sol_no_lleva_tipo_de_cambio(admin):
    with pytest.raises(psycopg.errors.CheckViolation, match="el sol no lleva"):
        admin.execute("SELECT set_currency_rate('PEN', '2026-10-24', 1, 1)")


def test_las_personas_solo_leen(admin, ana):
    admin.execute("SELECT set_currency_rate('USD', '2026-10-24', 3.447, 3.455)")
    c = ana()
    assert c.execute("SELECT count(*) FROM res_currency_rate").fetchone()[0] == 1
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute(f"INSERT INTO res_currency_rate (currency_id, name, rate_buy, rate_sell)"
                  f" VALUES ({USD}, '2026-10-25', 1, 1)")


def test_las_personas_no_cargan_con_la_funcion(admin, ana):
    c = ana()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute("SELECT set_currency_rate('USD', '2026-10-25', 3.4, 3.5)")


def test_get_rate_usa_el_del_dia_o_el_ultimo_anterior(admin, ana):
    admin.execute("SELECT set_currency_rate('USD', '2026-10-23', 3.450, 3.458)")   # viernes
    admin.execute("SELECT set_currency_rate('USD', '2026-10-27', 3.440, 3.449)")   # martes
    c = ana()
    rate = lambda on, side: c.execute(f"SELECT get_rate({USD}, %s, %s)", (on, side)).fetchone()[0]  # noqa: E731
    assert rate(date(2026, 10, 23), "buy") == Decimal("3.4500")
    assert rate(date(2026, 10, 25), "buy") == Decimal("3.4500")    # domingo: el del viernes
    assert rate(date(2026, 10, 25), "sell") == Decimal("3.4580")
    assert rate(date(2026, 10, 30), "buy") == Decimal("3.4400")
    with pytest.raises(psycopg.errors.NoDataFound, match="Falta el tipo de cambio de USD"):
        rate(date(2026, 10, 1), "buy")


def test_get_rate_de_la_moneda_base_es_uno(ana):
    c = ana()
    assert c.execute("SELECT get_rate((SELECT id FROM res_currency WHERE name = 'PEN'), '2026-10-25', 'buy')"
                     ).fetchone()[0] == 1


def test_compra_para_lo_que_tienes_y_venta_para_lo_que_debes(conn):
    sides = conn.execute("SELECT rate_side('asset'), rate_side('liability')").fetchone()
    assert sides == ("buy", "sell")


def test_el_estado_dice_que_monedas_estan_desactualizadas(admin, ana):
    ana()
    admin.execute("RESET ROLE")
    admin.execute("SET ROLE ppm_admin")
    hoy = admin.execute("SELECT (now() AT TIME ZONE 'America/Lima')::date").fetchone()[0]
    estado = lambda: admin.execute(  # noqa: E731
        "SELECT dias, desactualizado, personas FROM res_currency_rate_status WHERE currency = 'USD'").fetchone()
    assert estado()[1] is True and estado()[2] >= 1    # sin ningún tipo todavía
    admin.execute("SELECT set_currency_rate('USD', %s::date - 4, 3.45, 3.46)", (hoy,))
    assert estado()[:2] == (4, True)
    admin.execute("SELECT set_currency_rate('USD', %s::date - 3, 3.45, 3.46)", (hoy,))
    assert estado()[:2] == (3, False)
    monedas = {r[0] for r in admin.execute("SELECT currency FROM res_currency_rate_status")}
    assert "PEN" not in monedas
