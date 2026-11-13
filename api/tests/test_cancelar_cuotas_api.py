"""Cancelar las cuotas que faltan por la API: el detalle de la compra las muestra canceladas, el
asiento de la cancelación no se edita y borrarlo la deshace; pagar lo que faltaba desde una cuenta
registra también el pago de la tarjeta."""

from datetime import timedelta
from decimal import Decimal

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

COMPRA = (HOY - timedelta(days=70)).isoformat()   # dos o tres cortes ya facturados


@pytest.fixture
def ana() -> Con:
    return Con()


def televisor(ana: Con) -> tuple[int, dict]:
    card = ana.card()["account"]["id"]
    m = ana.buy(card, "1200.00", COMPRA, installments=6, installment_amount="215.00", ref="Televisor")
    return card, m


def cancel(ana: Con, plan_id: int, status: int = 200, **body) -> dict:
    r = ana.c.post(f"/plans/{plan_id}/cancel", json=body)
    assert r.status_code == status, r.text
    return r.json()


def test_lo_devolvi_por_la_api(ana: Con):
    card, m = televisor(ana)
    plan = m["plan"]
    billed = sum(x["billed"] for x in plan["lines"])
    d = cancel(ana, plan["plan_id"], kind="returned")
    p = d["plan"]
    assert p["canceled"]["kind"] == "returned"
    assert Decimal(p["canceled"]["amount"]) == Decimal("215.00") * (6 - billed)
    assert p["canceled"]["charged"] is None and p["remaining"] == "0.00"
    assert [x["canceled"] for x in p["lines"]] == [False] * billed + [True] * (6 - billed)
    assert Decimal(ana.detail(card)["status"][0]["total_debt"]) == Decimal("215.00") * billed

    c = ana.c.get(f"/moves/{p['canceled']['move_id']}").json()
    assert c["cancels"] == {"move_id": m["summary"]["id"], "ref": "Televisor"}


def test_la_cancelacion_no_se_edita_y_borrarla_la_deshace(ana: Con):
    _, m = televisor(ana)
    d = cancel(ana, m["plan"]["plan_id"], kind="returned")
    cid = d["plan"]["canceled"]["move_id"]
    r = ana.c.put(f"/moves/{cid}", json={"kind": "transfer", "account_id": ana.bcp, "amount": "10", "to_account_id": ana.efectivo})
    assert r.status_code == 400 and "bórrala para deshacerla" in r.json()["detail"]
    r = ana.c.post(f"/moves/{cid}/state", json={"pending": True})
    assert r.status_code == 400 and "no pasa a por confirmar" in r.json()["detail"]
    assert ana.c.delete(f"/moves/{cid}").status_code == 204
    p = ana.c.get(f"/moves/{m['summary']['id']}").json()["plan"]
    assert p["canceled"] is None and not any(x["canceled"] for x in p["lines"]) and len(p["lines"]) == 6


def test_pague_lo_que_faltaba_desde_el_bcp(ana: Con):
    card, m = televisor(ana)
    plan = m["plan"]
    left = sum(Decimal(x["principal"]) for x in plan["lines"] if not x["billed"])
    charged = left - Decimal("20.00")
    before = Decimal(ana.balance(ana.bcp))
    d = cancel(ana, plan["plan_id"], kind="prepaid", charged=str(charged), account_id=ana.bcp)
    assert Decimal(d["plan"]["canceled"]["charged"]) == charged
    assert Decimal(ana.balance(ana.bcp)) == before - charged
    billed = sum(Decimal(x["principal"]) for x in plan["lines"] if x["billed"])
    assert Decimal(ana.detail(card)["status"][0]["total_debt"]) == billed      # lo que cobró, ya pagado

    # Deshacer se lleva también el pago: el BCP vuelve a como estaba
    assert d["plan"]["canceled"]["payment_move_id"] is not None
    assert ana.c.delete(f"/moves/{d['plan']['canceled']['move_id']}").status_code == 204
    assert Decimal(ana.balance(ana.bcp)) == before
    assert ana.c.get(f"/moves/{d['plan']['canceled']['payment_move_id']}").status_code == 404


def test_pague_lo_que_faltaba_sin_pagar_todavia(ana: Con):
    card, m = televisor(ana)
    plan = m["plan"]
    left = sum(Decimal(x["principal"]) for x in plan["lines"] if not x["billed"])
    cancel(ana, plan["plan_id"], kind="prepaid", charged=str(left))
    billed = sum(Decimal(x["principal"]) for x in plan["lines"] if x["billed"])
    assert Decimal(ana.detail(card)["status"][0]["total_debt"]) == billed + left


def test_devolver_no_lleva_monto_ni_cuenta(ana: Con):
    _, m = televisor(ana)
    r = cancel(ana, m["plan"]["plan_id"], 400, kind="returned", account_id=ana.bcp)
    assert "nada que pagar" in r["detail"]


def test_si_falla_el_pago_no_se_cancela_nada(ana: Con):
    """Pagar en soles una compra en dólares no se puede: la cancelación tampoco queda."""
    card = ana.card()["account"]["id"]
    m = ana.buy(card, "300.00", COMPRA, installments=6, currency="USD", rate="3.70")
    plan = m["plan"]
    left = sum(Decimal(x["principal"]) for x in plan["lines"] if not x["billed"])
    cancel(ana, plan["plan_id"], 400, kind="prepaid", charged=str(left), account_id=ana.bcp)
    assert ana.c.get(f"/moves/{m['summary']['id']}").json()["plan"]["canceled"] is None


def test_una_compra_que_no_existe(ana: Con):
    assert cancel(ana, 999999, 404, kind="returned")["detail"] == "No encontramos esa compra en cuotas"
