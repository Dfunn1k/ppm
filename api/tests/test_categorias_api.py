"""Crear categorías desde Más › Categorías, a través de la API."""

import psycopg
import pytest

from tests.conftest import owner_url

from tests.test_movimientos_api import Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def groups(ana: Ana, kind: str) -> dict[str | None, dict]:
    return {g["name"]: g for g in ana.c.get("/categories", params={"kind": kind}).json()["groups"]}


def test_una_categoria_dentro_de_un_grupo_hereda_su_color(ana: Ana):
    comida = groups(ana, "expense")["Comida y bebida"]
    assert comida["icon"] == "restaurant"
    r = ana.c.post("/categories", json={"kind": "expense", "name": " Panadería ", "parent_id": comida["id"],
                                        "icon": "bakery_dining"})
    assert r.status_code == 201, r.text
    assert r.json() | {"id": 0} == {"id": 0, "name": "Panadería", "icon": "bakery_dining", "color": 2}
    hijas = [k["name"] for k in groups(ana, "expense")["Comida y bebida"]["children"]]
    assert hijas[-1] == "Panadería"
    # y se puede usar al registrar
    ana.register(kind="expense", account_id=ana.bcp, amount="8",
                 splits=[{"category_id": r.json()["id"], "amount": "8"}])


def test_un_grupo_nuevo_nace_con_su_primera_categoria(ana: Ana):
    r = ana.c.post("/categories", json={"kind": "expense", "name": "Veterinario", "group": "Mascotas",
                                        "icon": "pets", "color": 9})
    assert r.status_code == 201, r.text
    assert (r.json()["icon"], r.json()["color"]) == ("pets", 9)        # los hereda del grupo
    mascotas = groups(ana, "expense")["Mascotas"]
    assert (mascotas["icon"], mascotas["color"]) == ("pets", 9)
    assert [k["name"] for k in mascotas["children"]] == ["Veterinario"]
    # el grupo nuevo ya acepta más categorías
    r = ana.c.post("/categories", json={"kind": "expense", "name": "Comida de Toby", "parent_id": mascotas["id"]})
    assert r.status_code == 201 and r.json()["color"] == 9
    r = ana.c.post("/categories", json={"kind": "expense", "name": "Otra", "group": "Mascotas",
                                        "icon": "pets", "color": 1})
    assert r.status_code == 409 and r.json()["detail"] == "Ya tienes un grupo con ese nombre"


def test_las_de_ingreso_van_sueltas(ana: Ana):
    r = ana.c.post("/categories", json={"kind": "income", "name": "Freelance", "icon": "work", "color": 10})
    assert r.status_code == 201
    assert "Freelance" in [k["name"] for k in groups(ana, "income")["Ingresos"]["children"]]
    salario = ana.cat["Salario y facturas"]
    r = ana.c.post("/categories", json={"kind": "income", "name": "Bono", "parent_id": salario,
                                        "icon": "work", "color": 10})
    assert r.status_code == 400 and r.json()["detail"] == "Las de ingreso van sueltas: no tienen grupo"
    r = ana.c.post("/categories", json={"kind": "income", "name": "Bono"})
    assert r.status_code == 400 and r.json()["detail"] == "Elige un ícono y un color"


def test_lo_que_no_se_puede(ana: Ana):
    comida = groups(ana, "expense")["Comida y bebida"]["id"]
    def post(**body):
        return ana.c.post("/categories", json={"kind": "expense", **body})

    r = post(name="Cafés y bares", parent_id=comida)
    assert r.status_code == 409 and r.json()["detail"] == "Ya tienes una categoría con ese nombre ahí"
    r = post(name="Suelta")
    assert r.status_code == 400 and r.json()["detail"] == "Elige un grupo o crea uno nuevo"
    r = post(name="Pan", parent_id=ana.cat["Cafés y bares"])         # una hija no agrupa
    assert r.status_code == 400 and r.json()["detail"] == "Esa categoría no puede agrupar otras"
    r = post(name="Pan", parent_id=ana.cat["Salario y facturas"])    # otro tipo
    assert r.status_code == 404
    r = post(name="Pan", parent_id=ana.bcp)                           # una cuenta no es grupo
    assert r.status_code == 404
    r = post(name="Pan", group="Panes", icon="Mal Ícono", color=1)
    assert r.status_code == 422
    assert Ana().c.post("/categories", json={"kind": "expense", "name": "Pan", "parent_id": comida}).status_code == 404


def test_un_grupo_con_movimientos_propios_no_tiene_hijas(ana: Ana):
    # una categoría de gasto suelta (la plantilla no trae ninguna) y usada
    with psycopg.connect(owner_url()) as c:
        suelta = c.execute("""
            INSERT INTO account_account (user_id, name, account_type, currency_id, icon, color)
            SELECT user_id, 'Varios', 'expense', currency_id, 'category', 0 FROM account_account WHERE id = %s
            RETURNING id""", (ana.bcp,)).fetchone()[0]
    ana.register(kind="expense", account_id=ana.bcp, amount="3",
                 splits=[{"category_id": suelta, "amount": "3"}])
    r = ana.c.post("/categories", json={"kind": "expense", "name": "Hija", "parent_id": suelta})
    assert r.status_code == 400
    assert r.json()["detail"] == "Ese grupo ya tiene movimientos propios: no puede tener categorías adentro"
