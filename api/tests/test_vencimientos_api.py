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

def test_la_cuota_del_cronograma_estima_el_interes_sin_cargarlo_hoy(ana: Con):
    """S/ 1,200 en 6 cuotas de S/ 207: el gasto y la línea son el precio; S/ 7 de interés por cuota,
    estimado, que se carga recién cuando el banco factura cada cuota."""
    card = ana.card()["account"]["id"]
    d = ana.buy(card, "1200", installments=6, installment_amount="207")
    assert d["summary"]["amount"] == "1200.00"
    assert [(x["category"]["name"], x["amount"]) for x in d["splits"]] == [("Hogar", "1200.00")]
    assert [(x["principal"], x["interest"]) for x in d["plan"]["lines"]] == [("200.00", "7.00")] * 6
    assert d["plan"]["installment_amount"] == "207.00"
    total, unbilled, _ = next((s["total_debt"], s["unbilled"], s["to_pay"]) for s in ana.detail(card)["status"] if s["currency"] == "PEN")
    assert (total, unbilled) == ("1200.00", "1200.00")


def test_la_cuota_facturada_carga_su_interes_en_el_corte(ana: Con):
    """Una compra de antes del corte: la cuota 1 ya se facturó, su interés es un gasto de ese día."""
    card = ana.card()["account"]["id"]
    when = (CORTE - timedelta(days=2)).isoformat()
    d = ana.buy(card, "693", when, installments=3, installment_amount="262.02", ref="Unipiel")
    assert [x["interest"] for x in d["plan"]["lines"]] == ["31.02", "31.02", "31.02"]
    s = next(x for x in ana.detail(card)["status"] if x["currency"] == "PEN")
    assert (s["total_debt"], s["unbilled"], s["to_pay"]) == ("724.02", "462.00", "262.02")
    billed = next(c for c in ana.detail(card)["cycles"] if c["state"] == "billed")
    cuota = next(i for i in billed["items"] if i["kind"] == "installment")
    assert (cuota["amount"], cuota["interest"], cuota["sequence"]) == ("262.02", "31.02", 1)
    month = ana.c.get("/moves", params={"month": CORTE.isoformat()[:7]}).json()
    refs = [m["ref"] for day in month["days"] for m in day["moves"]]
    assert "Unipiel · cuota 1/3" in refs


def test_corregir_la_cuota_con_el_detalle_del_banco(ana: Con):
    card = ana.card()["account"]["id"]
    when = (CORTE - timedelta(days=2)).isoformat()
    d = ana.buy(card, "693", when, installments=3, installment_amount="262.02", ref="Unipiel")
    r = ana.c.put(f"/moves/{d['summary']['id']}/installments/1", json={"principal": "221.43", "interest": "40.59"})
    assert r.status_code == 200, r.text
    lines = r.json()["plan"]["lines"]
    assert [(x["principal"], x["interest"]) for x in lines] == \
        [("221.43", "40.59"), ("235.79", "31.02"), ("235.78", "31.02")]
    s = next(x for x in ana.detail(card)["status"] if x["currency"] == "PEN")
    # La cuota del banco no cambia (262.02); por facturar queda el capital que falta
    assert (s["total_debt"], s["unbilled"], s["to_pay"]) == ("733.59", "471.57", "262.02")
    bad = ana.c.put(f"/moves/{d['summary']['id']}/installments/3", json={"principal": "200", "interest": "0"})
    assert bad.status_code == 400 and "La última cuota cierra el capital" in bad.json()["detail"]


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
    assert (d["summary"]["kind"], d["summary"]["amount"]) == ("lend", "1200.00")
    items = owes(ana, who)
    assert [(x["part"], x["parts"], x["open"], x["billed"]) for x in items] == [(k, 6, "200.00", False) for k in range(1, 7)]
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
    assert d["plan"]["principal"] == "1200.00"


def test_la_cuota_facturada_de_otra_persona_le_suma_su_interes(ana: Con):
    """Unipiel de una amiga: ningún gasto tuyo; la cuota 1 facturada le cobra capital + interés."""
    card, who = ana.card()["account"]["id"], luis(ana)
    when = (CORTE - timedelta(days=2)).isoformat()
    d = lend(ana, account_id=card, amount="693", partner_id=who, installments=3, installment_amount="262.02",
             ref="Unipiel", date=when)
    items = owes(ana, who)
    assert [(x["part"], x["open"], x["interest"], x["billed"]) for x in items] == \
        [(1, "262.02", "31.02", True), (2, "231.00", None, False), (3, "231.00", None, False)]
    # El banco dice 221.43 + 40.59: su cuota sigue siendo 262.02 y el capital que falta se reparte
    r = ana.c.put(f"/moves/{d['summary']['id']}/installments/1", json={"principal": "221.43", "interest": "40.59"})
    assert r.status_code == 200, r.text
    assert [(x["part"], x["open"]) for x in owes(ana, who)] == [(1, "262.02"), (2, "235.79"), (3, "235.78")]
    mine = ana.c.get("/moves", params={"month": CORTE.isoformat()[:7]}).json()
    assert not any(m.get("category") == "Intereses" for day in mine["days"] for m in day["moves"])


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
