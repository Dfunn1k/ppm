"""La fila de movimiento, igual en todas las listas (decisión del 18-nov-2026): cada movimiento trae el
ícono de su cuenta, sus etiquetas y cuántos adjuntos tiene, en Movimientos, en una cuenta y en una tarjeta."""

import pytest

from tests.test_adjuntos_api import JPG, subir
from tests.test_etiquetas_api import tag
from tests.test_movimientos_api import HOY, MES, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con


@pytest.fixture
def ana() -> Con:
    return Con()


def _rows(ana: Con) -> dict[str, dict]:
    days = ana.c.get("/moves", params={"month": MES}).json()["days"]
    return {m["ref"]: m for d in days for m in d["moves"]}


def test_movimientos_traen_cuenta_etiquetas_y_adjuntos(ana: Con):
    cusco = tag(ana, "Viaje a Cusco", color=2)
    hotel = ana.register(kind="expense", account_id=ana.bcp, amount="320", ref="Hotel en Cusco", date=HOY.isoformat(), tag_ids=[cusco],
                         splits=[{"category_id": ana.cat["Hogar"], "amount": "320"}])["summary"]["id"]
    subir(ana, hotel, JPG, "boleta.jpg")
    subir(ana, hotel, JPG + b"2", "boleta-2.jpg")
    ana.register(kind="expense", account_id=ana.efectivo, amount="12", ref="Taxi", date=HOY.isoformat(),
                 splits=[{"category_id": ana.cat["Hogar"], "amount": "12"}])
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.bbva, amount="375", to_amount="100",
                 ref="Compra de dólares", date=HOY.isoformat())
    visa = ana.card()["account"]["id"]
    ana.buy(visa, "40", HOY.isoformat(), ref="Netflix")

    rows = _rows(ana)
    assert rows["Hotel en Cusco"]["tags"] == [{"id": cusco, "name": "Viaje a Cusco", "color": 2}]
    assert rows["Hotel en Cusco"]["attachments"] == 2
    assert (rows["Taxi"]["tags"], rows["Taxi"]["attachments"]) == ([], 0)
    assert rows["Hotel en Cusco"]["account_icon"] == "account_balance"      # un banco
    assert rows["Taxi"]["account_icon"] == "payments"                       # el efectivo
    assert rows["Netflix"]["account_icon"] == "credit_card"                  # la tarjeta
    assert rows["Compra de dólares"]["account_icon"] == "account_balance"   # la de donde sale

    home = {m["ref"]: m for m in ana.c.get("/home", params={"month": MES}).json()["recent"]}
    assert (home["Netflix"]["account_icon"], home["Taxi"]["attachments"]) == ("credit_card", 0)   # en Inicio, igual


def test_una_cuenta_trae_la_otra_cuenta_etiquetas_y_adjuntos(ana: Con):
    cusco = tag(ana, "Viaje a Cusco")
    hotel = ana.register(kind="expense", account_id=ana.bcp, amount="320", ref="Hotel en Cusco", date=HOY.isoformat(), tag_ids=[cusco],
                         splits=[{"category_id": ana.cat["Hogar"], "amount": "320"}])["summary"]["id"]
    subir(ana, hotel, JPG, "boleta.jpg")
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="50", ref="Retiro", date=HOY.isoformat())

    lines = {x["ref"]: x for x in ana.c.get(f"/accounts/{ana.bcp}").json()["lines"]}
    h, r = lines["Hotel en Cusco"], lines["Retiro"]
    assert ([t["name"] for t in h["tags"]], h["attachments"], h["counterpart_money"]) == (["Viaje a Cusco"], 1, False)
    assert (r["counterpart"], r["counterpart_icon"], r["counterpart_money"]) == ("Efectivo", "payments", True)


def test_una_tarjeta_trae_etiquetas_adjuntos_y_de_que_cuenta_se_pago(ana: Con):
    cusco = tag(ana, "Viaje a Cusco")
    visa = ana.card()["account"]["id"]
    compra = ana.buy(visa, "120", HOY.isoformat(), ref="Hotel en Cusco", tag_ids=[cusco])["summary"]["id"]
    subir(ana, compra, JPG, "boleta.jpg")
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=visa, amount="50", ref="Pago", date=HOY.isoformat())

    items = {i["ref"]: i for c in ana.detail(visa)["cycles"] for i in c["items"]}
    assert ([t["name"] for t in items["Hotel en Cusco"]["tags"]], items["Hotel en Cusco"]["attachments"]) == (["Viaje a Cusco"], 1)
    assert (items["Pago"]["counterpart"], items["Pago"]["counterpart_icon"]) == ("BCP", "account_balance")
