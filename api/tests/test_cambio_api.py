"""Dólares y tipo de cambio a través de la API: la diferencia realizada al cambiar de moneda (contra el
costo promedio), el tipo del día como sugerencia, Z1 del administrador y el importador de SUNAT."""

import dataclasses
import threading
from datetime import date, datetime
from decimal import Decimal

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import rates, users
from app.config import get_settings
from app.main import app
from tests.conftest import usd_today
from tests.test_movimientos_api import MES, Ana

ANTIGUO = date(2001, 1, 1)   # las pruebas cargan tipos antes de esta fecha y los borran al final


@pytest.fixture(autouse=True)
def limpiar():
    yield
    with psycopg.connect(get_settings().database_url) as c:
        c.execute("DELETE FROM res_users WHERE login LIKE '%@prueba.ppm'")
        c.execute("DELETE FROM res_currency_rate WHERE name < %s", (ANTIGUO,))


@pytest.fixture
def ana() -> Ana:
    return Ana()


@pytest.fixture
def admin(monkeypatch, ana: Ana) -> Ana:
    """Ana, y además en ADMIN_EMAILS."""
    email = ana.c.get("/me").json()["email"]
    s = dataclasses.replace(get_settings(), admin_emails=frozenset({email}))
    monkeypatch.setattr(users, "get_settings", lambda: s)
    return ana


def dia(on: str) -> tuple:
    """Lo que quedó en la base para el dólar ese día (compra, origen)."""
    with psycopg.connect(get_settings().database_url) as c:
        return c.execute("SELECT r.rate_buy, r.source FROM res_currency_rate r JOIN res_currency c"
                         " ON c.id = r.currency_id WHERE c.name = 'USD' AND r.name = %s", (on,)).fetchone()


def vender(ana: Ana, dolares: str, soles: str, **extra) -> dict:
    return ana.register(kind="transfer", account_id=ana.bbva, to_account_id=ana.bcp,
                        amount=dolares, to_amount=soles, **extra)


# --- La diferencia realizada --------------------------------------------------------------------

def test_vender_dolares_por_debajo_de_su_costo_registra_el_costo_del_cambio(ana: Ana):
    d = vender(ana, "100", "343")              # BBVA tiene US$ 200 a 3.70: esos 100 costaron S/ 370
    s = d["summary"]
    assert (s["kind"], s["amount"], s["to_amount"], s["fx"]) == ("transfer", "100.00", "343.00", "-27.00")
    assert (d["cost"], d["cost_rate"]) == ("370.00", "3.700000")
    assert ana.balance(ana.bcp) == "1343.00" and ana.balance(ana.bbva) == "100.00"
    m = ana.c.get("/moves", params={"month": MES}).json()
    assert m["expense_total"] == "27.00"        # el costo del cambio también salió en el mes
    top = ana.c.get("/home", params={"month": MES}).json()["top"]
    assert [(t["name"], t["amount"]) for t in top] == [("Gastos financieros", "27.00")]


def test_vender_dolares_por_encima_de_su_costo_registra_la_ganancia(ana: Ana):
    d = vender(ana, "100", "380")
    assert d["summary"]["fx"] == "10.00"
    assert ana.c.get("/moves", params={"month": MES}).json()["income_total"] == "10.00"


def test_al_mismo_costo_no_hay_diferencia(ana: Ana):
    d = vender(ana, "100", "370")
    assert d["summary"]["fx"] is None and d["cost"] is None


def test_si_se_van_todos_los_dolares_sale_su_valor_exacto(ana: Ana):
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.bbva, amount="345.10", to_amount="100")
    # Ahora US$ 300 que costaron 740 + 345.10 = 1,085.10 (3.617 en promedio)
    d = vender(ana, "300", "1030")
    assert (d["cost"], d["summary"]["fx"]) == ("1085.10", "-55.10")
    bbva = ana.c.get(f"/accounts/{ana.bbva}").json()["account"]["balances"][0]
    assert (bbva["amount"], bbva["book"]) == ("0.00", "0.00")


def test_al_editar_el_costo_no_cuenta_el_mismo_movimiento(ana: Ana):
    d = vender(ana, "100", "343")
    r = ana.c.put(f"/moves/{d['summary']['id']}", json={
        "kind": "transfer", "account_id": ana.bbva, "to_account_id": ana.bcp, "amount": "100", "to_amount": "350"})
    assert r.status_code == 200, r.text
    assert (r.json()["cost"], r.json()["summary"]["fx"]) == ("370.00", "-20.00")


def test_entre_dos_cuentas_en_dolares_pasan_a_su_costo(ana: Ana):
    caja = ana.c.post("/accounts/cash", json={"name": "Dólares en casa", "currency": "USD"}).json()["account"]["id"]
    d = ana.register(kind="transfer", account_id=ana.bbva, to_account_id=caja, amount="50")
    assert d["summary"]["fx"] is None
    caja_saldo = ana.c.get(f"/accounts/{caja}").json()["account"]["balances"][0]
    assert (caja_saldo["amount"], caja_saldo["book"]) == ("50.00", "185.00")


# --- El tipo del día --------------------------------------------------------------------------

def test_un_gasto_en_dolares_sin_tipo_usa_el_del_dia(ana: Ana):
    body = {"kind": "expense", "account_id": ana.bbva, "amount": "20",
            "splits": [{"category_id": ana.cat["Software y apps"], "amount": "20"}]}
    r = ana.c.post("/moves", json=body)
    hoy = usd_today()
    if hoy is None:
        assert r.status_code == 400 and r.json()["detail"] == "Falta el tipo de cambio de USD: escríbelo"
    else:
        assert r.status_code == 201, r.text
        assert r.json()["summary"]["base"] == str((20 * hoy[0]).quantize(Decimal("0.01")))


def test_sin_ningun_tipo_anterior_hay_que_escribirlo(ana: Ana):
    r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bbva, "amount": "20", "date": "1990-01-02",
                                   "splits": [{"category_id": ana.cat["Software y apps"], "amount": "20"}]})
    assert r.status_code == 400 and r.json()["detail"] == "Falta el tipo de cambio de USD: escríbelo"


def test_el_tipo_de_mis_monedas_para_un_dia(admin: Ana):
    assert admin.c.post("/admin/rates", json={"currency": "USD", "date": "2000-12-29",
                                              "buy": "3.512", "sell": "3.519"}).status_code == 200
    r = admin.c.get("/rates", params={"date": "2000-12-31"}).json()
    assert r == [{"currency": "USD", "date": "2000-12-29", "buy": "3.5120", "sell": "3.5190", "stale": True}]


def test_antes_de_configurar_tambien_hay_sugerencia(admin: Ana):
    admin.c.post("/admin/rates", json={"currency": "USD", "date": "2000-12-29", "buy": "3.512", "sell": "3.519"})
    nuevo = TestClient(app)
    nuevo.post("/auth/signup", json={"name": "Beto", "email": "beto-sin-configurar@prueba.ppm",
                                     "password": "pan-para-mayo-2026"})
    r = nuevo.get("/rates", params={"date": "2000-12-31"}).json()
    assert [x["currency"] for x in r] == ["USD"]


def test_el_inicio_dice_con_que_tipo_cuentan_mis_dolares(ana: Ana):
    foreign = ana.c.get("/home", params={"month": MES}).json()["foreign"]
    hoy = usd_today()
    if hoy is None:
        assert foreign == []
    else:
        assert [(f["currency"], f["amount"], f["rate"]) for f in foreign] == [("USD", "200.00", str(hoy[0]))]


# --- Z1: el administrador ---------------------------------------------------------------------

def test_solo_el_administrador_ve_z1(ana: Ana):
    assert ana.c.get("/me").json()["is_admin"] is False
    assert ana.c.get("/admin/rates").status_code == 403
    assert ana.c.post("/admin/rates", json={"currency": "USD", "date": "2000-12-29",
                                            "buy": "3.5", "sell": "3.6"}).status_code == 403
    assert ana.c.post("/admin/rates/sunat").status_code == 403


def test_el_administrador_carga_a_mano_y_manda_el_ultimo(admin: Ana):
    assert admin.c.get("/me").json()["is_admin"] is True
    body = {"currency": "usd", "date": "2000-12-29", "buy": "3.512", "sell": "3.519"}
    r = admin.c.post("/admin/rates", json=body)
    assert r.status_code == 200 and r.json() == {"currency": "USD", "date": "2000-12-29",
                                                 "buy": "3.512", "sell": "3.519", "source": "manual"}
    admin.c.post("/admin/rates", json=body | {"buy": "3.500"})
    z1 = admin.c.get("/admin/rates").json()
    usd = next(x for x in z1["currencies"] if x["currency"] == "USD")
    assert usd["users"] >= 1
    assert dia("2000-12-29") == (Decimal("3.5000"), "manual")


def test_z1_rechaza_lo_que_no_cuadra(admin: Ana):
    r = admin.c.post("/admin/rates", json={"currency": "USD", "date": "2000-12-29", "buy": "3.6", "sell": "3.5"})
    assert r.status_code == 400 and r.json()["detail"] == "La venta no puede ser menor que la compra"
    r = admin.c.post("/admin/rates", json={"currency": "PEN", "date": "2000-12-29", "buy": "1", "sell": "1"})
    assert r.status_code == 400 and "el sol no lleva" in r.json()["detail"]


# --- El importador de SUNAT -------------------------------------------------------------------

def test_lee_el_archivo_de_sunat():
    r = rates.parse_sunat("25/10/2026|3.443|3.451|\n")
    assert (r.currency, r.date, r.buy, r.sell, r.source) == ("USD", date(2026, 10, 25),
                                                              Decimal("3.443"), Decimal("3.451"), "SUNAT")
    with pytest.raises(rates.RateError, match="no entendemos"):
        rates.parse_sunat("<html>Mantenimiento</html>")


def test_si_sunat_falla_reintenta_y_luego_carga():
    calls = []

    def fetch() -> str:
        calls.append(1)
        if len(calls) < 3:
            raise rates.RateError(502, "SUNAT no respondió")
        return "29/12/2000|3.512|3.519|"

    r = rates.import_with_retries(threading.Event(), fetch, retries=5, wait=0)
    assert r is not None and r.date == date(2000, 12, 29) and len(calls) == 3


def test_si_sunat_falla_seis_veces_se_rinde():
    calls = []

    def fetch() -> str:
        calls.append(1)
        raise rates.RateError(502, "SUNAT no respondió")

    assert rates.import_with_retries(threading.Event(), fetch, retries=5, wait=0) is None
    assert len(calls) == 6


def test_sunat_pisa_lo_cargado_a_mano(admin: Ana):
    admin.c.post("/admin/rates", json={"currency": "USD", "date": "2000-12-29", "buy": "3.6", "sell": "3.7"})
    rates.import_sunat(lambda: "29/12/2000|3.512|3.519|")
    assert dia("2000-12-29") == (Decimal("3.5120"), "SUNAT")


def test_la_proxima_corrida_es_a_las_nueve_de_lima():
    antes = datetime(2026, 10, 26, 8, 0, tzinfo=rates.LIMA)
    despues = datetime(2026, 10, 26, 10, 0, tzinfo=rates.LIMA)
    assert rates._seconds_until_next_run(antes) == 3600
    assert rates._seconds_until_next_run(despues) == 23 * 3600

