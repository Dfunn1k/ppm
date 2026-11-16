"""Cobrar o pagar a una persona en otra moneda, como en una casa de cambio: la deuda baja en su moneda
y la plata entra o sale en la de la cuenta. La diferencia con lo que valía la deuda es la ganancia por
tipo de cambio o el costo del cambio. El caso de los vuelos de Paul: le presté US$ 133.38 y me yapeó
en soles."""

from decimal import Decimal

from tests.test_movimientos_api import borrar_usuarios_de_prueba  # noqa: F401
from tests.test_personas_api import AYER, Con, ana  # noqa: F401


def lines(move: dict) -> dict[str, tuple[str, str]]:
    """Cada cuenta del asiento: (monto en su moneda, debe − haber en soles)."""
    return {x["account"]: (x["amount"], str(Decimal(x["debit"]) - Decimal(x["credit"])))
            for x in move["lines"]}


def test_cobrar_en_soles_una_deuda_en_dolares(ana: Con):
    paul = ana.person("Paul")
    vuelos = ana.register(kind="lend", account_id=ana.bbva, amount="133.38", rate="3.50", partner_id=paul, date=AYER)
    assert ana.detail(paul)["partner"]["owes_me"][0]["amount"] == "133.38"

    cobro = ana.register(kind="collect", account_id=ana.bcp, amount="466.90", partner_id=paul,
                         debt_currency="USD", debt_amount="133.38")
    s = cobro["summary"]
    assert (s["kind"], s["currency"], s["amount"], s["to_currency"], s["to_amount"]) == \
        ("collect", "PEN", "466.90", "USD", "133.38")
    assert s["fx"] == "0.07"                     # valía 133.38 × 3.50 = 466.83 y entraron 466.90
    assert s["ref"] == "Paul me pagó" and cobro["rate"] is None
    assert [x["amount"] for x in cobro["settled"]] == ["133.38"]
    assert ana.balance(ana.bcp) == "1466.90"
    assert ana.detail(paul)["partner"]["owes_me"] == []
    assert vuelos["summary"]["id"] in [x["move_id"] for x in cobro["settled"]]

    # Editarlo recalcula la diferencia; borrarlo devuelve la deuda
    r = ana.c.put(f"/moves/{s['id']}", json={"kind": "collect", "account_id": ana.bcp, "amount": "460.00",
                                             "partner_id": paul, "debt_currency": "USD", "debt_amount": "133.38"})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["fx"] == "-6.83"
    assert ana.c.delete(f"/moves/{s['id']}").status_code == 204
    assert ana.detail(paul)["partner"]["owes_me"][0]["amount"] == "133.38"


def test_cobrar_una_parte_va_a_su_valor_promedio(ana: Con):
    paul = ana.person("Paul")
    ana.register(kind="lend", account_id=ana.bbva, amount="100", rate="3.60", partner_id=paul, date=AYER)
    cobro = ana.register(kind="collect", account_id=ana.bcp, amount="170", partner_id=paul,
                         debt_currency="USD", debt_amount="50")
    assert cobro["summary"]["fx"] == "-10.00"    # la mitad valía 180
    assert ana.detail(paul)["owes_me"][0]["open"] == "50.00"


def test_pagar_en_soles_lo_que_debo_en_dolares(ana: Con):
    tia = ana.person("Tía Rosa")
    ana.register(kind="borrow", account_id=ana.bbva, amount="100", rate="3.60", partner_id=tia, date=AYER)
    pago = ana.register(kind="repay", account_id=ana.bcp, amount="350", partner_id=tia,
                        debt_currency="USD", debt_amount="100")
    assert (pago["summary"]["to_currency"], pago["summary"]["to_amount"], pago["summary"]["fx"]) == ("USD", "100.00", "10.00")
    assert ana.balance(ana.bcp) == "650.00"
    assert ana.detail(tia)["partner"]["i_owe"] == []


def test_cobrar_en_dolares_una_deuda_en_soles(ana: Con):
    paul = ana.person("Paul")
    ana.register(kind="lend", account_id=ana.bcp, amount="100", partner_id=paul, date=AYER)
    cobro = ana.register(kind="collect", account_id=ana.bbva, amount="27", partner_id=paul,
                         debt_currency="PEN", debt_amount="100")
    assert cobro["summary"]["fx"] is None        # los dólares entran a lo que valía la deuda
    assert lines(cobro)["BBVA $"] == ("27.00", "100.00")
    assert ana.balance(ana.bbva) == "227.00"
    assert ana.detail(paul)["partner"]["owes_me"] == []


def test_en_otra_moneda_tampoco_se_cobra_de_mas(ana: Con):
    paul = ana.person("Paul")
    ana.register(kind="lend", account_id=ana.bbva, amount="133.38", rate="3.50", partner_id=paul)
    assert ana.fails(kind="collect", account_id=ana.bcp, amount="501", partner_id=paul,
                     debt_currency="USD", debt_amount="144").startswith("Paul te debe US$ 133.38")
    assert ana.fails(kind="collect", account_id=ana.bcp, amount="501", partner_id=paul,
                     debt_currency="USD") == "Escribe cuánto de la deuda en USD cancela"
    assert ana.fails(kind="custody_in", account_id=ana.bcp, amount="34.10", partner_id=paul,
                     debt_currency="USD", debt_amount="10") == "En otra moneda va solo un cobro o un pago de una deuda"
    # En la misma moneda que la cuenta, es un cobro de siempre
    ok = ana.register(kind="collect", account_id=ana.bbva, amount="33.38", rate="3.50", partner_id=paul,
                      debt_currency="USD", debt_amount="33.38")
    assert ok["summary"]["to_currency"] is None and ok["summary"]["fx"] is None
