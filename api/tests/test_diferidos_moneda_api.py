"""Cancelar un reparto con lo devuelto en otra moneda: si vuelve en la misma moneda en que pagaste,
vale lo que costó (al tipo de entonces) y la diferencia con el de hoy es la ganancia o el costo del
cambio, como al cobrar a una persona en otra moneda."""

import pytest

from tests.test_diferidos_api import INICIO
from tests.test_movimientos_api import Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def seguro_en_dolares(ana: Ana) -> int:
    """US$ 300 a 3.70 (S/ 1,110) en 12 meses desde hace dos: faltan 9 partes, S/ 832.50 (US$ 225)."""
    d = ana.register(kind="expense", account_id=ana.bbva, amount="300.00", rate="3.70", date=INICIO.isoformat(),
                     ref="Seguro de viaje", splits=[{"category_id": ana.cat["Seguro vehicular"], "amount": "300.00"}],
                     deferral={"method": "months", "months": 12})
    assert d["deferral"]["remaining"] == "832.50"
    return d["summary"]["id"]


def cancel(ana: Ana, move: int, **body) -> dict:
    r = ana.c.post(f"/moves/{move}/deferral/cancel", json=body)
    assert r.status_code == 200, r.text
    return r.json()["deferral"]["canceled"]


def test_el_dolar_subio_es_ganancia_por_tipo_de_cambio(ana: Ana):
    c = cancel(ana, seguro_en_dolares(ana), refund="225", account_id=ana.bbva, rate="3.80")
    assert (c["currency"], c["refund_currency"], c["refund"], c["rest"], c["fx"]) == ("USD", "225.00", "855.00", "0.00", "22.50")
    assert ana.balance(ana.bbva) == "125.00"                          # 200 − 300 + 225
    s = ana.c.get(f"/moves/{c['move_id']}").json()
    assert {(x["account"], x["debit"], x["credit"]) for x in s["lines"]} >= {("Ganancia por tipo de cambio", "0.00", "22.50")}


def test_el_dolar_bajo_es_costo_del_cambio_y_lo_no_devuelto_es_gasto(ana: Ana):
    c = cancel(ana, seguro_en_dolares(ana), refund="200", account_id=ana.bbva, rate="3.60")
    # US$ 200 valen S/ 740 al tipo de entonces; volvieron S/ 720: costo 20. No volvieron US$ 25 (S/ 92.50)
    assert (c["refund"], c["rest"], c["fx"]) == ("720.00", "92.50", "-20.00")


def test_en_soles_a_una_cuenta_en_soles_no_hay_diferencia(ana: Ana):
    c = cancel(ana, seguro_en_dolares(ana), refund="500", account_id=ana.bcp)
    assert (c["currency"], c["refund"], c["rest"], c["fx"]) == ("PEN", "500.00", "332.50", "0.00")


def test_no_puede_pasar_de_lo_que_falta_en_la_moneda_original(ana: Ana):
    move = seguro_en_dolares(ana)
    r = ana.c.post(f"/moves/{move}/deferral/cancel", json={"refund": "226", "account_id": ana.bbva, "rate": "3.80"})
    assert r.status_code == 400 and "más de lo que falta" in r.json()["detail"]


def test_un_adelanto_en_dolares_que_devuelves_cuando_el_dolar_subio(ana: Ana):
    d = ana.register(kind="income", account_id=ana.bbva, amount="600.00", rate="3.70", date=INICIO.isoformat(),
                     ref="Adelanto", splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "600.00"}],
                     deferral={"method": "months", "months": 6})
    c = cancel(ana, d["summary"]["id"], refund="300", account_id=ana.bbva, rate="3.80")
    # Devolviste US$ 300 que te costaron S/ 1,140 y valían S/ 1,110: costo del cambio 30
    assert (c["refund"], c["rest"], c["fx"]) == ("1140.00", "0.00", "-30.00")
