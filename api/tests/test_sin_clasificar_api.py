"""Un gasto sin saber en qué fue (migración 0023): «Lo clasifico después» lo deja en Por clasificar
(baja la cuenta, no es gasto hasta clasificarlo y avisa en Pendientes) y «Ajuste» es la categoría de
gasto para lo que nunca se sabrá o un descuadre."""

import pytest

from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def test_lo_clasifico_despues_baja_la_cuenta_pero_no_es_gasto(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="48.90", later=True)
    assert (d["summary"]["kind"], d["summary"]["ref"], d["summary"]["incoming"]) == ("unclassified", "Por clasificar", False)
    assert ana.balance(ana.bcp) == "951.10"
    month = ana.c.get("/moves", params={"month": MES}).json()
    assert month["expense_total"] == "0.00"
    assert [u["move_id"] for u in ana.c.get("/unclassified").json()] == [d["summary"]["id"]]
    assert [(n["kind"], n["count"]) for n in ana.c.get("/pending").json()["notices"]] == [("suspense", 1)]

    # Al clasificarlo pasa a ser gasto de su categoría
    r = ana.c.post("/unclassified/classify", json={"move_ids": [d["summary"]["id"]], "account_id": ana.cat["Cafés y bares"]})
    assert r.status_code == 204, r.text
    assert ana.c.get("/moves", params={"month": MES}).json()["expense_total"] == "48.90"
    assert ana.c.get("/pending").json()["notices"] == []


def test_un_ingreso_que_no_reconoces(ana: Ana):
    d = ana.register(kind="income", account_id=ana.bcp, amount="120", later=True, ref="Depósito sin nombre",
                     date=HOY.isoformat())
    assert (d["summary"]["kind"], d["summary"]["incoming"], d["summary"]["ref"]) == ("unclassified", True, "Depósito sin nombre")
    assert ana.balance(ana.bcp) == "1120.00"
    assert ana.c.get("/moves", params={"month": MES}).json()["income_total"] == "0.00"


def test_va_en_un_movimiento_entero(ana: Ana):
    split = {"category_id": ana.cat["Cafés y bares"], "amount": "10"}
    luis = ana.c.post("/partners", json={"name": "Luis"}).json()["id"]
    for body in ({"splits": [split]}, {"kind": "transfer", "to_account_id": ana.efectivo}, {"paid_by_partner_id": luis}):
        r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "10", "later": True, **body})
        assert r.status_code == 400, r.text
        assert "Lo clasifico después" in r.json()["detail"]


def test_ajuste_es_un_gasto_suelto_en_otras(ana: Ana):
    groups = ana.c.get("/categories", params={"kind": "expense"}).json()["groups"]
    otras = groups[-1]
    assert (otras["name"], [k["name"] for k in otras["children"]]) == ("Otras", ["Ajuste"])
    ajuste = otras["children"][0]
    assert (ajuste["icon"], ajuste["color"]) == ("balance", 0)
    assert "Ajuste" not in [k["name"] for g in ana.c.get("/categories", params={"kind": "income"}).json()["groups"]
                            for k in g["children"]]

    d = ana.register(kind="expense", account_id=ana.efectivo, amount="3.50", ref="No cuadraba el efectivo",
                     splits=[{"category_id": ajuste["id"], "amount": "3.50"}])
    assert d["summary"]["kind"] == "expense"
    assert ana.c.get("/moves", params={"month": MES}).json()["expense_total"] == "3.50"
