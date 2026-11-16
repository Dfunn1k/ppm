"""Etiquetas en las recurrentes (cada movimiento que generan nace con ellas) y «Con quién»: solo
informativo, al registrar un gasto o un ingreso, que se cambia o se quita desde el detalle."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import HOY, Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def tag(ana: Ana, name: str) -> int:
    return ana.c.post("/tags", json={"name": name}).json()["id"]


def netflix(ana: Ana, tag_ids: list[int], start=HOY) -> int:
    r = ana.c.post("/recurring", json={
        "move": {"kind": "expense", "account_id": ana.bcp, "amount": "44.90", "ref": "Netflix", "tag_ids": tag_ids,
                 "splits": [{"category_id": ana.cat["Software y apps"], "amount": "44.90"}]},
        "rule": {"interval": "month", "start": start.isoformat()}, "mode": "auto"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def tags_of(ana: Ana, move_id: int) -> list[str]:
    return [t["name"] for t in ana.c.get(f"/moves/{move_id}").json()["tags"]]


# --- Etiquetas en las recurrentes ---------------------------------------------------------------

def test_cada_vez_nace_con_las_etiquetas_de_la_recurrente(ana: Ana):
    casa, ocio = tag(ana, "Casa"), tag(ana, "Ocio")
    rid = netflix(ana, [ocio], start=HOY - timedelta(days=62))      # ya pasaron tres meses
    d = ana.c.get(f"/recurring/{rid}").json()
    assert [t["name"] for t in d["tags"]] == ["Ocio"]
    hechas = [x["move_id"] for x in d["done"]]
    assert len(hechas) >= 3 and all(tags_of(ana, m) == ["Ocio"] for m in hechas)

    # Cada una se cambia suelta, como cualquier movimiento
    assert ana.c.put(f"/moves/{hechas[0]}/tags", json={"tag_ids": [casa]}).status_code == 204
    assert tags_of(ana, hechas[0]) == ["Casa"] and tags_of(ana, hechas[1]) == ["Ocio"]

    # Cambiar las de la recurrente vale desde la próxima: lo ya registrado no cambia
    body = {"move": {"kind": "expense", "account_id": ana.bcp, "amount": "44.90", "ref": "Netflix", "tag_ids": [casa],
                     "splits": [{"category_id": ana.cat["Software y apps"], "amount": "44.90"}]},
            "rule": {"interval": "month", "start": (HOY - timedelta(days=62)).isoformat()}, "mode": "auto"}
    assert ana.c.put(f"/recurring/{rid}", json=body).status_code == 204
    assert [t["name"] for t in ana.c.get(f"/recurring/{rid}").json()["tags"]] == ["Casa"]
    assert tags_of(ana, hechas[1]) == ["Ocio"]


def test_eliminar_la_etiqueta_la_quita_de_la_recurrente(ana: Ana):
    ocio = tag(ana, "Ocio")
    rid = netflix(ana, [ocio])
    assert ana.c.delete(f"/tags/{ocio}").status_code == 204
    assert ana.c.get(f"/recurring/{rid}").json()["tags"] == []


# --- Con quién: solo informativo --------------------------------------------------------------

def test_con_quien_al_registrar_cambiarlo_y_quitarlo(ana: Ana):
    juan = ana.c.post("/partners", json={"name": "Juan"}).json()["id"]
    pedro = ana.c.post("/partners", json={"name": "Pedro"}).json()["id"]
    cat = ana.cat["Restaurantes y delivery"]
    d = ana.register(kind="expense", account_id=ana.bcp, amount="80", with_partner_id=juan,
                     splits=[{"category_id": cat, "amount": "80"}])
    move = d["summary"]["id"]
    assert (d["with_partner_id"], d["with_partner"]) == (juan, "Juan")
    p = ana.c.get(f"/partners/{juan}").json()
    assert p["owes_me"] == [] and p["i_owe"] == []                       # no es una deuda

    # Editar sin decir nada lo conserva, aunque cambie la categoría
    body = {"kind": "expense", "account_id": ana.bcp, "amount": "90",
            "splits": [{"category_id": ana.cat["Supermercado y mercado"], "amount": "90"}]}
    assert ana.c.put(f"/moves/{move}", json=body).json()["with_partner"] == "Juan"
    assert ana.c.put(f"/moves/{move}", json={**body, "with_partner_id": None}).json()["with_partner"] is None

    # Desde el detalle
    r = ana.c.put(f"/moves/{move}/with-partner", json={"partner_id": pedro})
    assert r.status_code == 200 and r.json()["with_partner"] == "Pedro"
    assert ana.c.put(f"/moves/{move}/with-partner", json={"partner_id": None}).json()["with_partner_id"] is None

    t = ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="10")["summary"]["id"]
    r = ana.c.put(f"/moves/{t}/with-partner", json={"partner_id": juan})
    assert r.status_code == 400 and "gasto o un ingreso" in r.json()["detail"]


def test_con_quien_en_un_gasto_dividido_no_toca_la_parte_de_otro(ana: Ana):
    juan = ana.c.post("/partners", json={"name": "Juan"}).json()["id"]
    luis = ana.c.post("/partners", json={"name": "Luis"}).json()["id"]
    d = ana.register(kind="expense", account_id=ana.bcp, amount="100", with_partner_id=juan,
                     splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "60"},
                             {"partner_id": luis, "amount": "40"}])
    assert d["with_partner"] == "Juan"
    assert [(x["partner"], x["amount"]) for x in d["splits"] if x["partner"]] == [("Luis", "40.00")]
