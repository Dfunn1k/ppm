"""Inicio a tu medida (migración 0024): qué cuentas se ven en el Inicio y en qué orden, la cuenta con
que arranca el + del Inicio y el modo privado."""

import pytest

from tests.test_movimientos_api import MES, Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def home_names(ana: Ana) -> list[str]:
    return [a["name"] for a in ana.c.get("/home", params={"month": MES}).json()["accounts"]]


def test_por_defecto_todas_por_antiguedad(ana: Ana):
    assert home_names(ana) == ["Efectivo", "BCP", "BBVA $"]
    s = ana.c.get("/home/setup").json()
    assert ([(a["name"], a["shown"]) for a in s["accounts"]], s["account_id"]) == \
        ([("Efectivo", True), ("BCP", True), ("BBVA $", True)], None)
    bbva = next(a for a in ana.c.get("/home", params={"month": MES}).json()["accounts"] if a["name"] == "BBVA $")
    assert (bbva["currency"], bbva["amount"]) == ("USD", "200.00")


def test_ordenar_esconder_y_la_cuenta_del_mas(ana: Ana):
    r = ana.c.put("/home/setup", json={"order": [ana.bcp, ana.efectivo, ana.bbva], "hidden": [ana.bbva],
                                       "account_id": ana.bcp})
    assert r.status_code == 200, r.text
    assert [(a["name"], a["shown"]) for a in r.json()["accounts"]] == [("BCP", True), ("Efectivo", True), ("BBVA $", False)]
    assert home_names(ana) == ["BCP", "Efectivo"]
    assert ana.c.get("/me").json()["home_account_id"] == ana.bcp

    # Una cuenta nueva aparece al final, visible
    nueva = ana.c.post("/accounts/cash", json={"name": "Alcancía", "currency": "PEN"}).json()["account"]["id"]
    assert home_names(ana) == ["BCP", "Efectivo", "Alcancía"]
    assert nueva

    # Elegirla cada vez
    order = [a["id"] for a in ana.c.get("/home/setup").json()["accounts"]]
    assert ana.c.put("/home/setup", json={"order": order, "account_id": None}).json()["account_id"] is None


def test_la_lista_tiene_que_estar_completa(ana: Ana):
    r = ana.c.put("/home/setup", json={"order": [ana.bcp]})
    assert (r.status_code, r.json()["detail"]) == (400, "La lista de cuentas cambió: vuelve a abrir Más › Inicio")
    r = ana.c.put("/home/setup", json={"order": [ana.efectivo, ana.bcp, ana.bbva], "account_id": 999999})
    assert r.status_code == 400


def test_el_modo_privado_se_recuerda(ana: Ana):
    assert ana.c.get("/me").json()["ui_private"] is False
    assert ana.c.patch("/me", json={"ui_private": True}).json()["ui_private"] is True
    assert ana.c.get("/me").json()["ui_private"] is True


def test_la_tarjeta_del_presupuesto_se_puede_esconder(ana: Ana):
    assert ana.c.get("/me").json()["home_budget"] is True
    assert ana.c.patch("/me", json={"home_budget": False}).json()["home_budget"] is False
    me = ana.c.get("/me").json()
    assert (me["home_budget"], me["ui_private"]) == (False, False)      # no toca lo demás
