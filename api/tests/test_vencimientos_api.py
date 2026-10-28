"""Rebanada 8b a través de la API: las cuotas por mes (cada una es gasto en el corte que la factura),
prestar la tarjeta (también en cuotas: te debe todas) y el vencimiento de las deudas."""

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


# --- Las cuotas por mes -------------------------------------------------------------------------

def month_moves(ana: Con, when: date) -> list[dict]:
    month = ana.c.get("/moves", params={"month": when.isoformat()[:7]}).json()
    return [m for day in month["days"] for m in day["moves"]]


def test_la_compra_en_cuotas_no_es_gasto_hoy(ana: Con):
    """S/ 1,200 en 6 cuotas de S/ 207: la tarjeta sube por las 6 cuotas (1,242) y quedan «Cuotas por
    venir»; ninguna cuota es gasto hasta que el banco la factura."""
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "1200", installments=6, installment_amount="207", ref="Sofá")
    assert (d["summary"]["kind"], d["summary"]["amount"]) == ("transfer", "1242.00")
    assert d["splits"] == []
    assert [(x["principal"], x["interest"]) for x in d["plan"]["lines"]] == [("207.00", None)] * 6
    assert (d["plan"]["installment_amount"], d["plan"]["price"], d["plan"]["category"]) == ("207.00", "1200.00", "Hogar")
    s = next(x for x in ana.detail(card)["status"] if x["currency"] == "PEN")
    assert (s["total_debt"], s["unbilled"], s["next_bill"]) == ("1242.00", "1242.00", "207.00")
    assert not any(m["kind"] == "expense" for m in month_moves(ana, HOY))
    have = {a["name"]: a for a in ana.c.get("/accounts").json()["have"]}
    assert have["Cuotas por venir"]["kind"] == "installments" and have["Cuotas por venir"]["base_total"] == "1242.00"


def test_la_cuota_facturada_es_gasto_de_su_categoria_en_el_corte(ana: Con):
    card = ana.card()["account"]["id"]
    when = (CORTE - timedelta(days=2)).isoformat()
    ana.buy(card, "693", when, installments=3, installment_amount="262.02", ref="Unipiel")
    s = next(x for x in ana.detail(card)["status"] if x["currency"] == "PEN")
    assert (s["total_debt"], s["unbilled"], s["to_pay"]) == ("786.06", "524.04", "262.02")
    billed = next(c for c in ana.detail(card)["cycles"] if c["state"] == "billed")
    cuota = next(i for i in billed["items"] if i["kind"] == "installment")
    assert (cuota["amount"], cuota["interest"], cuota["sequence"], cuota["counterpart"]) == ("262.02", None, 1, "Hogar")
    cuotas = [m for m in month_moves(ana, CORTE) if m["ref"] == "Unipiel · cuota 1/3"]
    assert [(m["kind"], m["amount"], m["date"]) for m in cuotas] == [("expense", "262.02", CORTE.isoformat())]
    assert [c["name"] for c in cuotas[0]["categories"]] == ["Hogar"]


def test_sin_cuota_del_banco_son_partes_iguales_del_precio(ana: Con):
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "1000", installments=3)
    assert [x["principal"] for x in d["plan"]["lines"]] == ["333.33", "333.33", "333.34"]
    assert d["summary"]["amount"] == "1000.00"


def test_en_cuotas_va_una_sola_categoria(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    assert ana.fails(kind="expense", account_id=card, amount="100", installments=3,
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "50"}, {"partner_id": who, "amount": "50"}]) == \
        "En cuotas va una sola categoría; si es de otra persona, usa «Es de otra persona»"


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


def test_borrar_la_compra_borra_sus_cuotas_facturadas(ana: Con):
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "693", (CORTE - timedelta(days=2)).isoformat(), installments=3, installment_amount="262.02",
                ref="Unipiel")
    assert ana.c.delete(f"/moves/{d['summary']['id']}").status_code == 204
    assert not [m for m in month_moves(ana, CORTE) if m["ref"].startswith("Unipiel")]
    assert ana.c.get("/accounts").json()["have"][-1]["name"] != "Cuotas por venir"


# --- Prestar la tarjeta -------------------------------------------------------------------------

def test_le_preste_mi_tarjeta(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    d = lend(ana, account_id=card, amount="300", partner_id=who)
    assert (d["summary"]["kind"], d["summary"]["account"]) == ("lend", "Visa BBVA")
    assert [x["open"] for x in owes(ana, who)] == ["300.00"]


def test_le_preste_mi_tarjeta_en_cuotas_me_debe_todas(ana: Con):
    card, who = ana.card()["account"]["id"], luis(ana)
    d = lend(ana, account_id=card, amount="1200", partner_id=who, installments=6, installment_amount="207",
             ref="Laptop")
    assert (d["summary"]["kind"], d["summary"]["amount"]) == ("lend", "1242.00")
    items = owes(ana, who)
    assert [(x["part"], x["parts"], x["open"], x["billed"]) for x in items] == [(k, 6, "207.00", False) for k in range(1, 7)]
    assert items[0]["maturity_closing"] > CORTE.isoformat() and items[0]["date_maturity"] is None
    # Cuando escribes la fecha de pago de ese ciclo, la parte la toma
    closing = items[0]["maturity_closing"]
    due = (date.fromisoformat(closing) + timedelta(days=15)).isoformat()
    r = ana.c.put(f"/cards/{card}/due-date", json={"closing_date": closing, "date_due": due})
    assert r.status_code == 200, r.text
    first = next(x for x in owes(ana, who) if x["part"] == 1)
    assert first["date_maturity"] == due


def test_la_cuota_de_otra_persona_se_le_cobra_completa(ana: Con):
    """Unipiel de una amiga: te debe 262.02 × 3 = 786.06 desde la compra y ningún gasto es tuyo."""
    card, who = ana.card()["account"]["id"], luis(ana)
    when = (CORTE - timedelta(days=2)).isoformat()
    lend(ana, account_id=card, amount="693", partner_id=who, installments=3, installment_amount="262.02",
         ref="Unipiel", date=when)
    assert [(x["part"], x["open"], x["billed"]) for x in owes(ana, who)] == \
        [(1, "262.02", True), (2, "262.02", False), (3, "262.02", False)]
    assert not any(m["kind"] == "expense" for m in month_moves(ana, CORTE))


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
