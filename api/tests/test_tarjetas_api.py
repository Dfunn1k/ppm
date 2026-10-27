"""Tarjetas a través de la API: el alta con lo que toca pagar, comprar (también en cuotas y en
dólares), pagarla un bolsillo a la vez, la fecha de pago, las cuotas de antes de PPM y los
movimientos agrupados por ciclo."""

from datetime import timedelta
from decimal import Decimal

import pytest

from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401

# El corte de la tarjeta de prueba fue hace 3 días: lo de antes ya se factura, lo de después no
CORTE = HOY - timedelta(days=3)
ANTES = (HOY - timedelta(days=5)).isoformat()
DESPUES = (HOY - timedelta(days=1)).isoformat()


class Con(Ana):
    def card(self, **body) -> dict:
        data = {"name": "Visa BBVA", "closing_day": CORTE.day, "credit_limit": "5000", "brand": "Visa",
                "last4": "4417", **body}
        r = self.c.post("/cards", json=data)
        assert r.status_code == 201, r.text
        return r.json()

    def detail(self, card_id: int) -> dict:
        r = self.c.get(f"/cards/{card_id}")
        assert r.status_code == 200, r.text
        return r.json()

    def buy(self, card_id: int, amount: str, when: str | None = None, **extra) -> dict:
        return self.register(kind="expense", account_id=card_id, amount=amount, date=when,
                             splits=[{"category_id": self.cat["Hogar"], "amount": amount}], **extra)

    def fails(self, **body) -> str:
        r = self.c.post("/moves", json=body)
        assert r.status_code == 400, r.text
        return r.json()["detail"]


@pytest.fixture
def ana() -> Con:
    return Con()


def status(d: dict, currency: str = "PEN") -> tuple[str, str, str]:
    s = next(x for x in d["status"] if x["currency"] == currency)
    return s["total_debt"], s["unbilled"], s["to_pay"]


def test_alta_con_lo_que_toca_pagar(ana: Con):
    d = ana.card(to_pay=[{"currency": "PEN", "amount": "1284.90"}, {"currency": "USD", "amount": "45.00", "rate": "3.762"}],
                 date_due=(CORTE + timedelta(days=15)).isoformat())
    assert d["account"]["kind"] == "card"
    assert d["account"]["subtitle"] == "Visa •••• 4417"
    assert (d["last_closing"], d["date_due"]) == (CORTE.isoformat(), (CORTE + timedelta(days=15)).isoformat())
    assert status(d) == ("1284.90", "0.00", "1284.90")
    assert status(d, "USD") == ("45.00", "0.00", "45.00")
    assert d["credit_limit"] == "5000.00" and d["limit_currency"] == "PEN"
    assert Decimal(d["used"]) > Decimal("1284.90")                       # los dólares también ocupan la línea
    assert Decimal(d["available"]) == Decimal("5000") - Decimal(d["used"])

    owe = ana.c.get("/accounts").json()["owe"]
    visa = next(a for a in owe if a["id"] == d["account"]["id"])
    assert [(x["currency"], x["amount"]) for x in visa["card"]["to_pay"]] == [("PEN", "1284.90"), ("USD", "45.00")]
    assert visa["card"]["date_due"] == (CORTE + timedelta(days=15)).isoformat()


def test_una_tarjeta_nueva_aparece_en_cuentas_aunque_no_debas(ana: Con):
    d = ana.card()
    owe = ana.c.get("/accounts").json()["owe"]
    visa = next(a for a in owe if a["id"] == d["account"]["id"])
    assert visa["card"]["to_pay"] == [] and visa["card"]["date_due"] is None
    assert d["available"] == "5000.00" and d["cycles"] == [] and d["plans"] == []


def test_comprar_antes_y_despues_del_corte(ana: Con):
    card = ana.card()["account"]["id"]
    ana.buy(card, "900.00", ANTES)
    ana.buy(card, "145.80", DESPUES)
    ana.buy(card, "12.99", DESPUES, currency="USD", rate="3.762")
    d = ana.detail(card)
    assert status(d) == ("1045.80", "145.80", "900.00")
    assert status(d, "USD") == ("12.99", "12.99", "0.00")
    current, billed = d["cycles"][0], d["cycles"][1]
    assert (current["state"], billed["state"], billed["closing_date"]) == ("current", "billed", CORTE.isoformat())
    assert [(c["currency"], c["amount"]) for c in current["charges"]] == [("PEN", "145.80"), ("USD", "12.99")]
    assert [(i["kind"], i["amount"], i["counterpart"]) for i in billed["items"]] == [("charge", "900.00", "Hogar")]


def test_una_compra_con_tarjeta_es_un_gasto_del_mes(ana: Con):
    card = ana.card()["account"]["id"]
    s = ana.buy(card, "35.50", DESPUES)["summary"]
    assert (s["kind"], s["account"], s["currency"]) == ("expense", "Visa BBVA", "PEN")
    if DESPUES[:7] == MES:
        assert ana.c.get("/moves", params={"month": MES}).json()["expense_total"] == "35.50"


def test_comprar_en_cuotas(ana: Con):
    card = ana.card()["account"]["id"]
    m = ana.buy(card, "1200.00", ANTES, installments=6, ref="Televisor")
    plan = m["plan"]
    assert (plan["n_installments"], plan["principal"], plan["card_id"]) == (6, "1200.00", card)
    assert [x["principal"] for x in plan["lines"]] == ["200.00"] * 6
    assert plan["lines"][0]["closing_date"] == CORTE.isoformat() and plan["lines"][0]["billed"]
    assert plan["remaining"] == "1000.00"
    assert m["summary"]["base"] == "1200.00"                           # el gasto cuenta completo hoy

    d = ana.detail(card)
    assert status(d) == ("1200.00", "1000.00", "200.00")
    p = d["plans"][0]
    assert (p["name"], p["billed"], p["remaining"], p["next_installment"]) == ("Televisor", 1, "1000.00", "200.00")
    billed = next(c for c in d["cycles"] if c["state"] == "billed")
    assert [(i["kind"], i["sequence"], i["n_installments"], i["amount"]) for i in billed["items"]] == \
        [("installment", 1, 6, "200.00")]


def test_una_compra_en_cuotas_no_se_edita_pero_se_borra(ana: Con):
    card = ana.card()["account"]["id"]
    m = ana.buy(card, "1200.00", ANTES, installments=6)
    r = ana.c.put(f"/moves/{m['summary']['id']}", json={
        "kind": "expense", "account_id": card, "amount": "1000.00",
        "splits": [{"category_id": ana.cat["Hogar"], "amount": "1000.00"}]})
    assert r.status_code == 400 and r.json()["detail"] == "Una compra en cuotas no se edita: bórrala y regístrala de nuevo"
    r = ana.c.post(f"/moves/{m['summary']['id']}/state", json={"pending": True})
    assert r.status_code == 400 and "no se edita" in r.json()["detail"]
    assert ana.c.delete(f"/moves/{m['summary']['id']}").status_code == 204
    assert ana.detail(card)["plans"] == []


def test_en_cuotas_solo_un_gasto_con_tarjeta(ana: Con):
    msg = ana.fails(kind="expense", account_id=ana.bcp, amount="100", installments=3,
                    splits=[{"category_id": ana.cat["Hogar"], "amount": "100"}])
    assert msg == "En cuotas va solo un gasto con tarjeta"


def test_pagar_la_tarjeta_un_bolsillo_a_la_vez(ana: Con):
    card = ana.card(to_pay=[{"currency": "PEN", "amount": "300"}, {"currency": "USD", "amount": "45", "rate": "3.762"}])
    card = card["account"]["id"]
    pago = ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="300.00")
    assert pago["summary"]["kind"] == "transfer" and pago["summary"]["account"] == "BCP → Visa BBVA"
    assert status(ana.detail(card))[2] == "0.00"
    assert ana.balance(ana.bcp) == "700.00"

    msg = ana.fails(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="45.00", currency="USD")
    assert msg == "La deuda en dólares se paga desde una cuenta en dólares: si no tienes, compra dólares primero"
    ana.register(kind="transfer", account_id=ana.bbva, to_account_id=card, amount="45.00", currency="USD")
    d = ana.detail(card)
    assert status(d, "USD")[2] == "0.00"
    payments = [i for c in d["cycles"] for i in c["items"] if i["kind"] == "payment"]
    assert sorted(i["amount"] for i in payments) == ["-300.00", "-45.00"]


def test_pagar_de_mas_deja_saldo_a_favor(ana: Con):
    card = ana.card(to_pay=[{"currency": "PEN", "amount": "100"}])["account"]["id"]
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="150.00")
    assert status(ana.detail(card))[2] == "-50.00"


def test_una_devolucion_baja_la_deuda(ana: Con):
    card = ana.card()["account"]["id"]
    ana.buy(card, "200.00", DESPUES)
    r = ana.register(kind="refund", account_id=card, amount="50.00",
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "50.00"}])
    assert r["summary"]["kind"] == "refund"
    d = ana.detail(card)
    assert status(d)[0] == "150.00"
    assert [i["kind"] for i in d["cycles"][0]["items"]] == ["refund", "charge"]


def test_lo_que_no_va_con_una_tarjeta(ana: Con):
    card = ana.card()["account"]["id"]
    assert ana.fails(kind="income", account_id=card, amount="10",
                     splits=[{"category_id": ana.cat["Venta"], "amount": "10"}]).startswith("Una tarjeta no recibe ingresos")
    sandra = ana.c.post("/partners", json={"name": "Sandra"}).json()["id"]
    assert ana.fails(kind="lend", account_id=card, amount="10", partner_id=sandra) == \
        "Con una tarjeta se registran gastos, devoluciones y su pago"
    assert ana.fails(kind="transfer", account_id=card, to_account_id=ana.bcp, amount="10") == \
        "Con una tarjeta se registran gastos, devoluciones y su pago"


def test_la_fecha_de_pago_se_escribe_despues(ana: Con):
    card = ana.card()["account"]["id"]
    due = (CORTE + timedelta(days=15)).isoformat()
    r = ana.c.put(f"/cards/{card}/due-date", json={"closing_date": CORTE.isoformat(), "date_due": due})
    assert r.status_code == 200 and r.json()["date_due"] == due
    r = ana.c.put(f"/cards/{card}/due-date", json={"closing_date": CORTE.isoformat(), "date_due": None})
    assert r.json()["date_due"] is None
    r = ana.c.put(f"/cards/{card}/due-date", json={"closing_date": HOY.isoformat(), "date_due": due})
    assert r.status_code == 400 and "no es un día de corte" in r.json()["detail"]


def test_cuotas_de_antes_de_ppm(ana: Con):
    card = ana.card()["account"]["id"]
    r = ana.c.post(f"/cards/{card}/installments", json={"currency": "PEN", "each": "250", "n": 4, "ref": "Laptop"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert status(d) == ("1000.00", "1000.00", "0.00")
    p = d["plans"][0]
    assert (p["name"], p["opening"], p["billed"], p["n_installments"], p["next_installment"]) == \
        ("Laptop", True, 0, 4, "250.00")
    assert p["next_closing"] == d["next_closing"]
    # No es un gasto: no aparece en Movimientos
    assert all(s["ref"] != "Laptop" for day in ana.c.get("/moves", params={"month": CORTE.strftime("%Y-%m")}).json()["days"]
               for s in day["moves"])
    assert ana.c.delete(f"/moves/{p['move_id']}").status_code == 204   # y se borra si te equivocaste
    assert ana.detail(card)["plans"] == []


def test_corregir_lo_que_tocaba_pagar(ana: Con):
    card = ana.card(to_pay=[{"currency": "PEN", "amount": "100"}])["account"]["id"]
    r = ana.c.put(f"/accounts/{card}/opening", json={"amount": "200"})
    assert r.status_code == 400
    r = ana.c.put(f"/cards/{card}/opening", json={"currency": "PEN", "amount": "120"})
    assert r.status_code == 200, r.text
    assert status(r.json()) == ("120.00", "0.00", "120.00")


def test_editar_corte_y_linea(ana: Con):
    card = ana.card()["account"]["id"]
    r = ana.c.patch(f"/cards/{card}", json={"name": "Visa Signature", "credit_limit": "8000", "clear": ["last4"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["account"]["name"], d["credit_limit"], d["last4"]) == ("Visa Signature", "8000.00", None)


def test_nadie_ve_la_tarjeta_de_otro(ana: Con):
    card = ana.card()["account"]["id"]
    beto = Con()
    assert beto.c.get(f"/cards/{card}").status_code == 404
    assert beto.c.post(f"/cards/{card}/installments",
                       json={"currency": "PEN", "each": "10", "n": 1, "ref": "x"}).status_code == 404
