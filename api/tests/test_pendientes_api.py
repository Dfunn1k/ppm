"""Pendientes a través de la API: la bandeja con los avisos que calcula PPM, posponerlos, los
recordatorios propios y con cuántos días avisar."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import CORTE, Con


@pytest.fixture
def ana() -> Con:
    return Con()


def inbox(ana: Con) -> dict:
    r = ana.c.get("/pending")
    assert r.status_code == 200, r.text
    return r.json()


def kinds(box: dict) -> list[str]:
    return [n["kind"] for n in box["notices"]]


def owed_by_luis(ana: Con, due, amount="50") -> int:
    who = ana.c.post("/partners", json={"name": "Luis Pérez"}).json()["id"]
    ana.register(kind="lend", account_id=ana.bcp, amount=amount, partner_id=who)
    [item] = ana.c.get(f"/partners/{who}").json()["owes_me"]
    assert ana.c.put(f"/move-lines/{item['line_id']}/maturity", json={"date": due.isoformat()}).status_code == 204
    return who


def test_sin_nada_pendiente_la_bandeja_esta_vacia(ana: Con):
    box = inbox(ana)
    assert (box["today"], box["notice_days"], box["notices"], box["activities"], box["late"]) == \
        (HOY.isoformat(), 3, [], [], 0)


def test_lo_que_te_deben_avisa_con_la_persona_y_el_monto(ana: Con):
    who = owed_by_luis(ana, HOY - timedelta(days=1))
    [n] = inbox(ana)["notices"]
    assert (n["kind"], n["partner_id"], n["partner"], n["late"]) == ("maturity", who, "Luis Pérez", True)
    assert n["amounts"] == [{"currency": "PEN", "amount": "50.00"}]
    assert inbox(ana)["late"] == 1


def test_el_aviso_llega_con_los_dias_que_elijas(ana: Con):
    owed_by_luis(ana, HOY + timedelta(days=7))
    assert inbox(ana)["notices"] == []
    me = ana.c.patch("/me", json={"notice_days": 10}).json()
    assert me["notice_days"] == 10
    assert kinds(inbox(ana)) == ["maturity"]
    assert ana.c.patch("/me", json={"notice_days": 61}).status_code == 422


def test_el_pago_de_tarjeta_y_los_por_confirmar(ana: Con):
    card = ana.card(to_pay=[{"currency": "PEN", "amount": "300"}],
                    date_due=(HOY + timedelta(days=2)).isoformat())["account"]["id"]
    ana.register(kind="expense", account_id=ana.bcp, amount="20", pending=True, date=HOY.isoformat(),
                 splits=[{"category_id": ana.cat["Hogar"], "amount": "20"}])
    box = inbox(ana)
    due = next(n for n in box["notices"] if n["kind"] == "card_due")
    assert (due["key"], due["account_id"], due["amounts"]) == \
        (f"card_due/{card}/{CORTE}", card, [{"currency": "PEN", "amount": "300.00"}])
    draft = next(n for n in box["notices"] if n["kind"] == "draft")
    assert (draft["count"], draft["move_id"] is not None, draft["bank_charges"]) == (1, True, 0)


def test_posponer_lo_esconde_y_se_puede_traer_de_vuelta(ana: Con):
    owed_by_luis(ana, HOY)
    key = inbox(ana)["notices"][0]["key"]
    later = (HOY + timedelta(days=5)).isoformat()
    assert ana.c.post("/pending/snooze", json={"key": key, "until": later}).status_code == 204
    box = inbox(ana)
    assert box["notices"] == [] and [(n["key"], n["snooze_until"]) for n in box["snoozed"]] == [(key, later)]
    assert ana.c.delete("/pending/snooze", params={"key": key}).status_code == 204
    assert kinds(inbox(ana)) == ["maturity"]

    r = ana.c.post("/pending/snooze", json={"key": key, "until": HOY.isoformat()})
    assert (r.status_code, r.json()["detail"]) == (400, "Pospónlo para un día después de hoy")
    r = ana.c.post("/pending/snooze", json={"key": "maturity/0/0/0", "until": later})
    assert r.status_code == 404


def test_un_recordatorio_propio_va_a_la_bandeja_y_queda_hecho(ana: Con):
    who = ana.c.post("/partners", json={"name": "Damaris"}).json()["id"]
    r = ana.c.post("/activities", json={"date": HOY.isoformat(), "summary": "  Llamar por la cuota ", "partner_id": who})
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    ana.c.post("/activities", json={"date": (HOY + timedelta(days=30)).isoformat(), "summary": "Renovar el SOAT"})
    [first, soat] = inbox(ana)["activities"]
    assert (first["summary"], first["partner"], first["late"]) == ("Llamar por la cuota", "Damaris", False)
    assert (soat["summary"], soat["partner_id"]) == ("Renovar el SOAT", None)

    ayer = (HOY - timedelta(days=1)).isoformat()
    assert ana.c.put(f"/activities/{aid}", json={"date": ayer, "summary": "Llamar a Damaris"}).status_code == 204
    assert inbox(ana)["late"] == 1
    assert ana.c.post(f"/activities/{aid}/done", json={}).status_code == 204
    assert [a["summary"] for a in inbox(ana)["activities"]] == ["Renovar el SOAT"]
    [done] = ana.c.get("/activities", params={"partner_id": who}).json()
    assert (done["done_date"], done["late"]) == (HOY.isoformat(), False)

    assert ana.c.post(f"/activities/{aid}/done", json={"done": False}).status_code == 204
    assert ana.c.delete(f"/activities/{aid}").status_code == 204
    assert ana.c.get("/activities", params={"partner_id": who}).json() == []
    assert ana.c.delete(f"/activities/{aid}").status_code == 404


def test_un_recordatorio_va_con_una_sola_cosa_y_de_quien_lo_escribe(ana: Con):
    who = ana.c.post("/partners", json={"name": "Damaris"}).json()["id"]
    r = ana.c.post("/activities", json={"date": HOY.isoformat(), "summary": "Dos", "partner_id": who,
                                        "account_id": ana.bcp})
    assert r.status_code == 400
    assert ana.c.post("/activities", json={"date": HOY.isoformat(), "summary": "   "}).status_code == 422

    otra = Con()
    r = otra.c.post("/activities", json={"date": HOY.isoformat(), "summary": "Ajeno", "partner_id": who})
    assert (r.status_code, r.json()["detail"]) == (404, "No encontramos a qué pegarle el recordatorio")
