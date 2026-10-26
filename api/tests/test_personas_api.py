"""Personas a través de la API: prestar, cobrar, pagar, guardar y devolver plata de otros, dividir un
gasto con alguien, el gasto que pagó otra persona, reembolsos, asientos manuales, compensar y dar
por perdido. Las deudas se concilian solas, de la más antigua a la más nueva."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401

AYER = (HOY - timedelta(days=1)).isoformat()
ANTEAYER = (HOY - timedelta(days=2)).isoformat()


class Con(Ana):
    def person(self, name: str) -> int:
        r = self.c.post("/partners", json={"name": name})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def detail(self, partner_id: int) -> dict:
        r = self.c.get(f"/partners/{partner_id}")
        assert r.status_code == 200, r.text
        return r.json()

    def fails(self, **body) -> str:
        r = self.c.post("/moves", json=body)
        assert r.status_code == 400, r.text
        return r.json()["detail"]


@pytest.fixture
def ana() -> Con:
    return Con()


def test_prestar_y_cobrar_concilia_la_deuda_mas_antigua(ana: Con):
    sandra = ana.person("Sandra Machado")
    cena = ana.register(kind="lend", account_id=ana.bcp, amount="59.00", partner_id=sandra, date=ANTEAYER)
    ana.register(kind="lend", account_id=ana.bcp, amount="50.00", partner_id=sandra, date=AYER)
    assert cena["summary"]["kind"] == "lend"
    assert cena["summary"]["partner"] == "Sandra Machado"
    assert cena["summary"]["ref"] == "Préstamo a Sandra"
    assert ana.balance(ana.bcp) == "891.00"

    pago = ana.register(kind="collect", account_id=ana.bcp, amount="20.00", partner_id=sandra)
    assert pago["summary"]["kind"] == "collect"
    assert [s["amount"] for s in pago["settled"]] == ["20.00"]

    d = ana.detail(sandra)
    assert [(i["amount"], i["open"]) for i in d["owes_me"]] == [("59.00", "39.00"), ("50.00", "50.00")]
    assert d["owes_me"][0]["days"] == 2
    assert d["partner"]["owes_me"][0]["amount"] == "89.00"
    assert d["partner"]["net"] == "89.00"


def test_no_se_cobra_mas_de_lo_que_te_deben(ana: Con):
    sandra = ana.person("Sandra Machado")
    ana.register(kind="lend", account_id=ana.bcp, amount="39.00", partner_id=sandra)
    msg = ana.fails(kind="collect", account_id=ana.bcp, amount="60.00", partner_id=sandra)
    assert msg.startswith("Sandra te debe S/ 39.00. Escribe hasta S/ 39.00")
    assert ana.fails(kind="collect", account_id=ana.bcp, amount="1.00", partner_id=ana.person("Luis")) \
        == "Luis no te debe nada en PEN"


def test_elegir_otra_deuda(ana: Con):
    sandra = ana.person("Sandra")
    ana.register(kind="lend", account_id=ana.bcp, amount="30.00", partner_id=sandra, date=ANTEAYER)
    ana.register(kind="lend", account_id=ana.bcp, amount="50.00", partner_id=sandra, date=AYER)
    nueva = ana.detail(sandra)["owes_me"][1]["line_id"]
    ana.register(kind="collect", account_id=ana.bcp, amount="50.00", partner_id=sandra, debt_line_id=nueva)
    assert [i["open"] for i in ana.detail(sandra)["owes_me"]] == ["30.00"]


def test_me_prestaron_y_pague(ana: Con):
    maria = ana.person("María López")
    ana.register(kind="borrow", account_id=ana.bcp, amount="300.00", partner_id=maria)
    assert ana.balance(ana.bcp) == "1300.00"
    assert ana.detail(maria)["i_owe"][0]["open"] == "300.00"
    assert ana.fails(kind="repay", account_id=ana.bcp, amount="301.00", partner_id=maria) \
        .startswith("Le debes S/ 300.00 a María")
    ana.register(kind="repay", account_id=ana.bcp, amount="300.00", partner_id=maria)
    d = ana.detail(maria)
    assert d["i_owe"] == [] and d["partner"]["i_owe"] == []


def test_plata_que_guardo_entra_y_se_devuelve(ana: Con):
    sandra = ana.person("Sandra")
    ana.register(kind="custody_in", account_id=ana.bcp, amount="200.00", partner_id=sandra)
    cuentas = ana.c.get("/accounts").json()
    assert cuentas["custody_total"] == "200.00"
    assert ana.fails(kind="custody_out", account_id=ana.bcp, amount="250.00", partner_id=sandra) \
        == "Guardas S/ 200.00 de Sandra. Escribe hasta S/ 200.00"
    r = ana.register(kind="custody_out", account_id=ana.bcp, amount="50.00", partner_id=sandra)
    assert r["summary"]["kind"] == "custody_out" and r["summary"]["ref"] == "Devolución a Sandra"
    d = ana.detail(sandra)
    assert d["partner"]["keep"][0]["amount"] == "150.00"
    assert d["keep_since"] == HOY.isoformat()


def test_dividir_un_gasto_con_una_persona(ana: Con):
    ana_t = ana.person("Ana Torres")
    r = ana.register(kind="expense", account_id=ana.bcp, amount="200.00", splits=[
        {"category_id": ana.cat["Restaurantes y delivery"], "amount": "100.00"},
        {"partner_id": ana_t, "amount": "100.00"}])
    assert r["summary"]["kind"] == "expense"
    assert r["summary"]["amount"] == "200.00" and r["summary"]["base"] == "100.00"   # tu gasto es tu parte
    assert [(s["partner"], s["amount"]) for s in r["splits"]] == [(None, "100.00"), ("Ana Torres", "100.00")]
    assert ana.detail(ana_t)["owes_me"][0]["open"] == "100.00"
    mes = ana.c.get("/moves", params={"month": MES}).json()
    assert mes["expense_total"] == "100.00"


def test_al_dividir_una_parte_es_tuya(ana: Con):
    luis = ana.person("Luis")
    assert ana.fails(kind="expense", account_id=ana.bcp, amount="50.00",
                     splits=[{"partner_id": luis, "amount": "50.00"}]) \
        == "Al dividir, al menos una parte es tuya: elige su categoría"


def test_gasto_que_pago_otra_persona(ana: Con):
    sandra = ana.person("Sandra")
    r = ana.register(kind="expense", amount="45.00", paid_by_partner_id=sandra,
                     splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "45.00"}])
    assert r["summary"]["account"] == "Pagó Sandra"
    assert r["paid_by_partner_id"] == sandra and r["account_id"] is None
    assert ana.balance(ana.bcp) == "1000.00"                          # no salió de tus cuentas
    assert ana.detail(sandra)["i_owe"][0]["open"] == "45.00"
    assert ana.c.get("/moves", params={"month": MES}).json()["expense_total"] == "45.00"


def test_reembolso_resta_del_gasto(ana: Con):
    ropa = ana.cat["Ropa y calzado"]
    ana.register(kind="expense", account_id=ana.bcp, amount="120.00", splits=[{"category_id": ropa, "amount": "120.00"}])
    r = ana.register(kind="refund", account_id=ana.bcp, amount="80.00", splits=[{"category_id": ropa, "amount": "80.00"}])
    assert r["summary"]["kind"] == "refund"
    mes = ana.c.get("/moves", params={"month": MES}).json()
    assert mes["expense_total"] == "40.00" and mes["income_total"] == "0.00"
    assert ana.balance(ana.bcp) == "960.00"


def test_asiento_manual(ana: Con):
    ana_t = ana.person("Ana Torres")
    cuentas = {a["name"]: a for a in ana.c.get("/manual-accounts").json()}
    assert "Saldos iniciales" not in cuentas and "BBVA $" not in cuentas     # ni el saldo inicial ni dólares
    assert cuentas["Por cobrar"]["partner_required"]
    lineas = [{"account_id": ana.bcp, "credit": "120.00"},
              {"account_id": ana.cat["Restaurantes y delivery"], "debit": "100.00"},
              {"account_id": cuentas["Por cobrar"]["id"], "debit": "10.00", "partner_id": ana_t}]
    assert ana.fails(kind="manual", lines=lineas) == "Falta S/ 10.00 en «Entra a» para que cuadre"
    lineas[2]["debit"] = "20.00"
    r = ana.register(kind="manual", lines=lineas, ref="Cena con Ana")
    assert r["summary"]["kind"] == "expense"                           # cuadra como un gasto dividido
    assert len(r["lines"]) == 3
    sin_persona = [{"account_id": ana.bcp, "credit": "5.00"}, {"account_id": cuentas["Por cobrar"]["id"], "debit": "5.00"}]
    assert ana.fails(kind="manual", lines=sin_persona) == "«Por cobrar» necesita con quién"


def test_compensar(ana: Con):
    sandra = ana.person("Sandra")
    ana.register(kind="lend", account_id=ana.bcp, amount="39.00", partner_id=sandra)
    ana.register(kind="expense", amount="50.00", paid_by_partner_id=sandra,
                 splits=[{"category_id": ana.cat["Eventos"], "amount": "50.00"}])
    r = ana.c.post(f"/partners/{sandra}/offset")
    assert r.status_code == 201, r.text
    assert ana.c.get(f"/moves/{r.json()['move_id']}").json()["summary"]["kind"] == "offset"
    d = ana.detail(sandra)
    assert d["owes_me"] == [] and [i["open"] for i in d["i_owe"]] == ["11.00"]
    assert d["partner"]["net"] == "-11.00"
    assert ana.balance(ana.bcp) == "961.00"                            # no se movió plata
    assert ana.c.post(f"/partners/{sandra}/offset").json()["detail"].startswith("Para compensar, Sandra")


def test_dar_por_perdido(ana: Con):
    luis = ana.person("Luis Pérez")
    ana.register(kind="lend", account_id=ana.bcp, amount="50.00", partner_id=luis)
    r = ana.c.post(f"/partners/{luis}/write-off")
    assert r.status_code == 201, r.text
    m = ana.c.get(f"/moves/{r.json()['move_id']}").json()
    assert m["summary"]["kind"] == "write_off" and m["summary"]["categories"][0]["name"] == "Deudas incobrables"
    assert ana.detail(luis)["owes_me"] == []
    assert ana.c.get("/moves", params={"month": MES}).json()["expense_total"] == "50.00"   # es un gasto del mes
    assert ana.c.put(f"/moves/{r.json()['move_id']}", json={"kind": "lend", "account_id": ana.bcp,
                                                             "amount": "1.00", "partner_id": luis}).status_code == 400


def test_borrar_o_editar_el_cobro_devuelve_la_deuda(ana: Con):
    sandra = ana.person("Sandra")
    ana.register(kind="lend", account_id=ana.bcp, amount="40.00", partner_id=sandra)
    pago = ana.register(kind="collect", account_id=ana.bcp, amount="40.00", partner_id=sandra)
    assert ana.detail(sandra)["owes_me"] == []
    r = ana.c.put(f"/moves/{pago['summary']['id']}", json={"kind": "collect", "account_id": ana.bcp,
                                                            "amount": "15.00", "partner_id": sandra})
    assert r.status_code == 200, r.text
    assert [i["open"] for i in ana.detail(sandra)["owes_me"]] == ["25.00"]
    assert ana.c.delete(f"/moves/{pago['summary']['id']}").status_code == 204
    assert [i["open"] for i in ana.detail(sandra)["owes_me"]] == ["40.00"]


def test_un_cobro_por_confirmar_no_cancela_hasta_confirmarlo(ana: Con):
    sandra = ana.person("Sandra")
    ana.register(kind="lend", account_id=ana.bcp, amount="40.00", partner_id=sandra)
    pago = ana.register(kind="collect", account_id=ana.bcp, amount="40.00", partner_id=sandra, pending=True)
    assert [i["open"] for i in ana.detail(sandra)["owes_me"]] == ["40.00"]
    r = ana.c.post(f"/moves/{pago['summary']['id']}/state", json={"pending": False})
    assert r.status_code == 200, r.text
    assert ana.detail(sandra)["owes_me"] == []


def test_lista_de_personas(ana: Con):
    sandra, luis, maria = ana.person("Sandra"), ana.person("Luis"), ana.person("María")
    ana.register(kind="lend", account_id=ana.bcp, amount="39.00", partner_id=sandra)
    ana.register(kind="custody_in", account_id=ana.bcp, amount="200.00", partner_id=sandra)
    ana.register(kind="lend", account_id=ana.bcp, amount="50.00", partner_id=luis)
    ana.register(kind="expense", amount="50.00", paid_by_partner_id=sandra,
                 splits=[{"category_id": ana.cat["Eventos"], "amount": "50.00"}])
    o = ana.c.get("/partners/overview").json()
    assert (o["owes_me_total"], o["i_owe_total"], o["keep_total"]) == ("89.00", "50.00", "200.00")
    assert [p["name"] for p in o["people"]] == ["Luis", "Sandra", "María"]   # primero quien tiene pendientes
    assert next(p for p in o["people"] if p["id"] == sandra)["net"] == "-11.00"
    assert next(p for p in o["people"] if p["id"] == maria)["last_date"] is None

    cuentas = ana.c.get("/accounts").json()
    por_cobrar = next(a for a in cuentas["have"] if a["kind"] == "receivable")
    assert por_cobrar["partners"] == 2


def test_editar_persona(ana: Con):
    sandra = ana.person("Sandra")
    r = ana.c.patch(f"/partners/{sandra}", json={"name": "Sandra Machado", "phone": " 987 654 321 ",
                                                 "email": "Sandra@Correo.com"})
    assert r.status_code == 204, r.text
    p = ana.detail(sandra)["partner"]
    assert (p["name"], p["phone"], p["email"]) == ("Sandra Machado", "987 654 321", "sandra@correo.com")
    assert ana.c.patch(f"/partners/{sandra}", json={"name": "S", "email": "no-es-correo"}).status_code == 400
    r = ana.c.post("/partners", json={"name": "Ana Torres", "phone": "999"})
    assert r.status_code == 201 and ana.detail(r.json()["id"])["partner"]["phone"] == "999"
