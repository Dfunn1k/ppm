"""Rebanada 8b a través de la API: la cuota con interés, prestar la tarjeta (también en cuotas, con el
interés de la persona o tuyo) y el vencimiento de las deudas."""

from datetime import date, timedelta

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import CORTE, Con


@pytest.fixture
def ana() -> Con:
    return Con()


def luis(ana: Con) -> int:
    return ana.c.post("/partners", json={"name": "Luis Pérez"}).json()["id"]


def owes(ana: Con, partner: int) -> list[dict]:
    return ana.c.get(f"/partners/{partner}").json()["owes_me"]


def lend(ana: Con, **body) -> dict:
    return ana.register(kind="lend", **body)


# --- La cuota con interés -----------------------------------------------------------------------

def test_la_cuota_del_cronograma_suma_intereses(ana: Con):
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "1200", installments=6, installment_amount="207")
    assert d["summary"]["amount"] == "1242.00"
    assert [(x["category"]["name"], x["amount"]) for x in d["splits"]] == [("Hogar", "1200.00"), ("Intereses", "42.00")]
    assert [x["principal"] for x in d["plan"]["lines"]] == ["207.00"] * 6
    total, unbilled, _ = next((s["total_debt"], s["unbilled"], s["to_pay"]) for s in ana.detail(card)["status"] if s["currency"] == "PEN")
    assert (total, unbilled) == ("1242.00", "1242.00")


def test_sin_intereses_no_hay_linea_de_intereses(ana: Con):
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "1200", installments=6, installment_amount="200")
    assert [x["category"]["name"] for x in d["splits"]] == ["Hogar"]


def test_la_cuota_no_puede_quedarse_corta(ana: Con):
    card = ana.card()["account"]["id"]
    detail = ana.fails(kind="expense", account_id=card, amount="1200", installments=6, installment_amount="150",
                       splits=[{"category_id": ana.cat["Hogar"], "amount": "1200"}])
    assert "no llegan a lo que costó" in detail


def test_la_cuota_va_con_las_cuotas(ana: Con):
    card = ana.card()["account"]["id"]
    assert ana.fails(kind="expense", account_id=card, amount="1200", installment_amount="207",
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "1200"}]) == \
        "El monto de la cuota va solo en un gasto con tarjeta en cuotas"


# --- Prestar la tarjeta -------------------------------------------------------------------------

def test_le_preste_mi_tarjeta(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    d = lend(ana, account_id=card, amount="300", partner_id=who)
    assert (d["summary"]["kind"], d["summary"]["account"]) == ("lend", "Visa BBVA")
    assert [x["open"] for x in owes(ana, who)] == ["300.00"]


def test_le_preste_mi_tarjeta_en_cuotas_con_su_interes(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    d = lend(ana, account_id=card, amount="1200", partner_id=who, installments=6, installment_amount="207",
             ref="Laptop")
    assert (d["summary"]["kind"], d["summary"]["amount"]) == ("lend", "1242.00")
    items = owes(ana, who)
    assert [(x["part"], x["parts"], x["open"]) for x in items] == [(k, 6, "207.00") for k in range(1, 7)]
    assert items[0]["maturity_closing"] > CORTE.isoformat() and items[0]["date_maturity"] is None
    # Cuando escribes la fecha de pago de ese ciclo, la parte la toma
    closing = items[0]["maturity_closing"]
    due = (date.fromisoformat(closing) + timedelta(days=15)).isoformat()
    r = ana.c.put(f"/cards/{card}/due-date", json={"closing_date": closing, "date_due": due})
    assert r.status_code == 200, r.text
    first = next(x for x in owes(ana, who) if x["part"] == 1)
    assert first["date_maturity"] == due


def test_si_el_interes_lo_pago_yo_me_debe_el_precio(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    d = lend(ana, account_id=card, amount="1200", partner_id=who, installments=6, installment_amount="207",
             interest_mine=True)
    assert [x["open"] for x in owes(ana, who)] == ["200.00"] * 6
    assert any(x["category"] and x["category"]["name"] == "Intereses" for x in d["splits"])
    assert d["plan"]["principal"] == "1242.00"


def test_desde_el_banco_no_va_en_cuotas(ana: Con):
    who = luis(ana)
    assert ana.fails(kind="lend", account_id=ana.bcp, amount="100", partner_id=who, installments=3) == \
        "En cuotas va solo un gasto o un préstamo con tarjeta"


def test_con_la_tarjeta_solo_se_presta(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    assert ana.fails(kind="borrow", account_id=card, amount="100", partner_id=who) == \
        "Con una tarjeta se registran gastos, devoluciones y su pago"


# --- Vencimientos -------------------------------------------------------------------------------

def test_ponerle_y_quitarle_la_fecha_a_una_deuda(ana: Con):
    who = luis(ana)
    lend(ana, account_id=ana.bcp, amount="50", partner_id=who)
    [item] = owes(ana, who)
    assert item["date_maturity"] is None
    due = (HOY + timedelta(days=15)).isoformat()
    assert ana.c.put(f"/move-lines/{item['line_id']}/maturity", json={"date": due}).status_code == 204
    item = owes(ana, who)[0]
    assert (item["date_maturity"], item["maturity_manual"]) == (due, due)
    d = ana.c.get(f"/moves/{item['move_id']}").json()
    assert next(x for x in d["lines"] if x["line_id"] == item["line_id"])["date_maturity"] == due
    assert ana.c.put(f"/move-lines/{item['line_id']}/maturity", json={"date": None}).status_code == 204
    assert owes(ana, who)[0]["date_maturity"] is None


def test_solo_una_deuda_tiene_vencimiento(ana: Con):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="10", splits=[{"category_id": ana.cat["Hogar"], "amount": "10"}])
    bank_line = next(x for x in d["lines"] if x["account_id"] == ana.bcp)["line_id"]
    assert ana.c.put(f"/move-lines/{bank_line}/maturity", json={"date": HOY.isoformat()}).status_code == 404


def test_un_pago_cancela_primero_lo_que_vence_antes(ana: Con):
    who = luis(ana)
    lend(ana, account_id=ana.bcp, amount="100", partner_id=who, date=(HOY - timedelta(days=10)).isoformat(), ref="Viejo")
    lend(ana, account_id=ana.bcp, amount="100", partner_id=who, date=(HOY - timedelta(days=5)).isoformat(), ref="Nuevo")
    viejo, nuevo = owes(ana, who)
    ana.c.put(f"/move-lines/{viejo['line_id']}/maturity", json={"date": (HOY + timedelta(days=30)).isoformat()})
    ana.c.put(f"/move-lines/{nuevo['line_id']}/maturity", json={"date": (HOY + timedelta(days=2)).isoformat()})
    assert [x["ref"] for x in owes(ana, who)] == ["Nuevo", "Viejo"]          # primero lo que vence antes
    ana.register(kind="collect", account_id=ana.bcp, amount="100", partner_id=who)
    assert [x["ref"] for x in owes(ana, who)] == ["Viejo"]
