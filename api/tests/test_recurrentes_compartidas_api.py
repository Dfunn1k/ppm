"""Recurrentes compartidas: un gasto o un ingreso que se repite, repartido con otra persona, y también
el que paga o cobra ella. Un ingreso compartido suelto: la parte del otro se la debes."""

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_personas_api import Con


@pytest.fixture
def ana() -> Con:
    return Con()


def recurrente(ana: Con, move: dict, mode: str = "auto") -> dict:
    r = ana.c.post("/recurring", json={"move": move, "rule": {"interval": "month", "start": HOY.isoformat()}, "mode": mode})
    assert r.status_code == 201, r.text
    return ana.c.get(f"/recurring/{r.json()['id']}").json()


def test_ingreso_compartido_suelto_le_debes_su_parte(ana: Con):
    luis = ana.person("Luis Pérez")
    m = ana.register(kind="income", account_id=ana.bcp, amount="1000.00", ref="Alquiler del depa",
                     splits=[{"category_id": ana.cat["Ingresos por alquiler"], "amount": "600.00"},
                             {"partner_id": luis, "amount": "400.00"}])
    assert m["summary"]["kind"] == "income"
    assert ana.balance(ana.bcp) == "2000.00"
    assert [i["open"] for i in ana.detail(luis)["i_owe"]] == ["400.00"]
    d = ana.c.get(f"/moves/{m['summary']['id']}").json()
    assert [(s["partner_id"], s["amount"]) for s in d["splits"]] == [(None, "600.00"), (luis, "400.00")]


def test_ingreso_que_cobro_otra_persona_te_debe_tu_parte(ana: Con):
    luis = ana.person("Luis Pérez")
    m = ana.register(kind="income", account_id=None, amount="600.00", paid_by_partner_id=luis,
                     splits=[{"category_id": ana.cat["Ingresos por alquiler"], "amount": "600.00"}])
    assert (m["summary"]["kind"], m["summary"]["account"]) == ("income", "Cobró Luis")
    assert ana.balance(ana.bcp) == "1000.00"
    assert [i["open"] for i in ana.detail(luis)["owes_me"]] == ["600.00"]
    d = ana.c.get(f"/moves/{m['summary']['id']}").json()
    assert d["paid_by_partner_id"] == luis


def test_gasto_que_se_repite_compartido_luis_te_debe_cada_vez(ana: Con):
    luis = ana.person("Luis Pérez")
    d = recurrente(ana, {"kind": "expense", "account_id": ana.bcp, "amount": "120.00", "ref": "Internet",
                         "splits": [{"category_id": ana.cat["Internet"], "amount": "60.00"},
                                    {"partner_id": luis, "amount": "60.00"}]})
    assert d["row"]["kind"] == "expense" and d["row"]["account"] == "BCP"
    assert d["row"]["shares"] == [{"partner_id": luis, "name": "Luis Pérez", "amount": "60.00", "owes_me": True}]
    assert d["categories"][0]["name"] == "Internet" and d["splits"] == ["60.00"]
    assert ana.balance(ana.bcp) == "880.00"                          # la de hoy ya se registró
    assert [i["open"] for i in ana.detail(luis)["owes_me"]] == ["60.00"]


def test_lo_que_luis_ya_te_habia_dado_se_compensa_al_registrarse_sola(ana: Con):
    luis = ana.person("Luis Pérez")
    # Luis te dio S/ 60 por adelantado: un asiento con Por cobrar al Haber (saldo a su favor)
    por_cobrar = {a["name"]: a for a in ana.c.get("/manual-accounts").json()}["Por cobrar"]["id"]
    ana.register(kind="manual", lines=[{"account_id": ana.bcp, "debit": "60.00"},
                                       {"account_id": por_cobrar, "credit": "60.00", "partner_id": luis}])
    recurrente(ana, {"kind": "expense", "account_id": ana.bcp, "amount": "120.00", "ref": "Internet",
                     "splits": [{"category_id": ana.cat["Internet"], "amount": "60.00"},
                                {"partner_id": luis, "amount": "60.00"}]})
    assert ana.detail(luis)["owes_me"] == []                         # la parte de hoy ya quedó pagada


def test_gasto_que_se_repite_y_paga_luis_le_debes_tu_parte(ana: Con):
    luis = ana.person("Luis Pérez")
    d = recurrente(ana, {"kind": "expense", "account_id": None, "amount": "60.00", "ref": "Internet",
                         "paid_by_partner_id": luis,
                         "splits": [{"category_id": ana.cat["Internet"], "amount": "60.00"}]})
    assert (d["row"]["paid_by_partner_id"], d["row"]["paid_by"]) == (luis, "Luis Pérez")
    assert d["row"]["shares"] == [{"partner_id": luis, "name": "Luis Pérez", "amount": "60.00", "owes_me": False}]
    assert d["row"]["amount"] == "-60.00"
    assert ana.balance(ana.bcp) == "1000.00"                         # no toca tus cuentas
    assert [i["open"] for i in ana.detail(luis)["i_owe"]] == ["60.00"]
    m = ana.c.get(f"/moves/{d['done'][0]['move_id']}").json()
    assert (m["summary"]["account"], m["paid_by_partner_id"]) == ("Pagó Luis", luis)


def test_ingreso_que_se_repite_compartido_y_el_que_cobra_luis(ana: Con):
    luis = ana.person("Luis Pérez")
    cat = ana.cat["Ingresos por alquiler"]
    d = recurrente(ana, {"kind": "income", "account_id": ana.bcp, "amount": "1000.00", "ref": "Alquiler del depa",
                         "splits": [{"category_id": cat, "amount": "600.00"}, {"partner_id": luis, "amount": "400.00"}]})
    assert d["row"]["kind"] == "income"
    assert d["row"]["shares"] == [{"partner_id": luis, "name": "Luis Pérez", "amount": "400.00", "owes_me": False}]
    assert ana.balance(ana.bcp) == "2000.00"
    assert [i["open"] for i in ana.detail(luis)["i_owe"]] == ["400.00"]

    otro = recurrente(ana, {"kind": "income", "account_id": None, "amount": "600.00", "ref": "Alquiler de la cochera",
                            "paid_by_partner_id": luis, "splits": [{"category_id": cat, "amount": "600.00"}]})
    assert otro["row"]["shares"] == [{"partner_id": luis, "name": "Luis Pérez", "amount": "600.00", "owes_me": True}]
    assert [i["open"] for i in ana.detail(luis)["owes_me"]] == ["600.00"]


def test_por_confirmar_compartida_no_cuenta_hasta_confirmarla(ana: Con):
    luis = ana.person("Luis Pérez")
    d = recurrente(ana, {"kind": "expense", "account_id": ana.bcp, "amount": "120.00", "ref": "Luz",
                         "splits": [{"category_id": ana.cat["Internet"], "amount": "60.00"},
                                    {"partner_id": luis, "amount": "60.00"}]}, mode="draft")
    assert ana.detail(luis)["owes_me"] == []
    assert d["done"][0]["posted"] is False
