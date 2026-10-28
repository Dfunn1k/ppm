"""Cargos del banco de una tarjeta: el desgravamen de cada corte y la membresía anual nacen por
confirmar, no cuentan hasta que los confirmas y sugieren el último monto confirmado."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con


@pytest.fixture
def ana() -> Con:
    return Con()


def charge(ana: Con, card: int, **body) -> dict:
    r = ana.c.post(f"/cards/{card}/charges", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def pen(d: dict) -> dict:
    return next(s for s in d["status"] if s["currency"] == "PEN")


def test_el_desgravamen_es_cada_corte_y_no_cuenta_hasta_confirmarlo(ana: Con):
    card = ana.card(closing_day=HOY.day)["account"]["id"]       # hoy es el corte: el de hoy ya sale
    d = charge(ana, card, kind="insurance", amount="2.41")
    [c] = d["charges"]
    assert (c["name"], c["amount"], c["drafts"], c["yearly"]) == ("Seguro de desgravamen", "2.41", 1, False)
    assert c["next_date"] > HOY.isoformat()
    assert pen(d)["total_debt"] == "0.00"                          # por confirmar: no cuenta
    p = ana.c.get("/recurring/pending").json()
    assert (p["bank_charges"], p["bank_charge_move_id"] is not None) == (1, True)

    # Confirmarlo con el monto del estado de cuenta: el próximo sugiere ese monto
    move = p["bank_charge_move_id"]
    m = ana.c.get(f"/moves/{move}").json()
    body = {"kind": "expense", "account_id": card, "amount": "2.50", "ref": "Seguro de desgravamen", "pending": True,
            "splits": [{"category_id": m["splits"][0]["category"]["id"], "amount": "2.50"}], "date": m["summary"]["date"]}
    assert ana.c.put(f"/moves/{move}", json=body).status_code == 200
    assert ana.c.post(f"/moves/{move}/state", json={"pending": False}).status_code == 200
    d = ana.detail(card)
    assert pen(d)["total_debt"] == "2.50"
    assert (d["charges"][0]["amount"], d["charges"][0]["drafts"]) == ("2.50", 0)
    assert ana.c.get("/recurring/pending").json()["bank_charges"] == 0


def test_la_membresia_es_un_cargo_futuro_de_cada_anio(ana: Con):
    card = ana.card()["account"]["id"]
    when = (HOY + timedelta(days=362)).isoformat()
    d = charge(ana, card, kind="membership", amount="170", date=when)
    [c] = d["charges"]
    assert (c["name"], c["amount"], c["next_date"], c["drafts"], c["yearly"]) == ("Membresía anual", "170.00", when, 0, True)
    assert ana.c.post(f"/cards/{card}/charges", json={"kind": "membership", "amount": "170"}).status_code == 400


def test_otro_cargo_necesita_nombre(ana: Con):
    card = ana.card()["account"]["id"]
    r = ana.c.post(f"/cards/{card}/charges", json={"kind": "other", "amount": "5"})
    assert r.status_code == 400 and r.json()["detail"] == "Escribe cómo se llama el cargo"
    d = charge(ana, card, kind="other", amount="5", name="Comisión por envío de estado")
    assert d["charges"][0]["name"] == "Comisión por envío de estado"
