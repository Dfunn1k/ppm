"""Recurrentes y préstamos de banco a través de la API."""

from datetime import date, timedelta

import psycopg
import pytest

from tests.conftest import owner_url

from tests.test_movimientos_api import HOY, Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def first_of_next_month() -> date:
    return (HOY.replace(day=1) + timedelta(days=32)).replace(day=1)


def netflix(ana: Ana, mode="auto", start=None, **rule) -> int:
    r = ana.c.post("/recurring", json={
        "move": {"kind": "expense", "account_id": ana.bcp, "amount": "44.90", "ref": "Netflix",
                 "splits": [{"category_id": ana.cat["Software y apps"], "amount": "44.90"}]},
        "rule": {"interval": "month", "start": (start or HOY).isoformat(), **rule}, "mode": mode})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_se_repite_desde_hoy_registra_la_de_hoy_y_lista_la_proxima(ana: Ana):
    rid = netflix(ana)
    lista = ana.c.get("/recurring").json()
    row = next(r for r in lista["rows"] if r["id"] == rid)
    assert (row["name"], row["kind"], row["mode"], row["amount"], row["account"]) == \
           ("Netflix", "expense", "auto", "-44.90", "BCP")
    assert row["category"]["name"] == "Software y apps"
    assert date.fromisoformat(row["next"]["date"]) > HOY             # la de hoy ya se registró
    assert ana.balance(ana.bcp) == "955.10"
    d = ana.c.get(f"/recurring/{rid}").json()
    assert d["rule"]["month_days"] == [HOY.day]
    assert [(x["occurrence"], x["posted"], x["amount"]) for x in d["done"]] == [(HOY.isoformat(), True, "-44.90")]
    assert lista["outgoing"] in ("0.00", "44.90")                   # en 30 días puede caer una


def test_por_confirmar_nace_en_borrador_y_el_inicio_lo_avisa(ana: Ana):
    rid = netflix(ana, mode="draft")
    assert ana.balance(ana.bcp) == "1000.00"
    assert ana.c.get("/recurring/pending").json()["drafts_due"] == 1
    d = ana.c.get(f"/recurring/{rid}").json()
    assert d["done"][0]["posted"] is False


def test_un_recordatorio_avisa_hasta_que_lo_haces(ana: Ana):
    rid = netflix(ana, mode="reminder")
    assert ana.balance(ana.bcp) == "1000.00"
    p = ana.c.get("/recurring/pending").json()
    assert [(x["recurring_id"], x["occurrence"], x["amount"]) for x in p["reminders"]] == \
           [(rid, HOY.isoformat(), "-44.90")]
    assert ana.c.post(f"/recurring/{rid}/occurrences/{HOY.isoformat()}/done").status_code == 204
    assert ana.c.get("/recurring/pending").json()["reminders"] == []


def test_solo_esta_vez_saltar_y_otro_monto(ana: Ana):
    start = first_of_next_month()
    rid = netflix(ana, start=start)
    nxt = ana.c.get(f"/recurring/{rid}").json()["next"]
    a, b = nxt[0]["occurrence"], nxt[1]["occurrence"]
    assert ana.c.put(f"/recurring/{rid}/occurrences/{a}", json={"skip": True}).status_code == 204
    assert ana.c.put(f"/recurring/{rid}/occurrences/{b}", json={"total": "50"}).status_code == 204
    nxt = ana.c.get(f"/recurring/{rid}").json()["next"]
    assert (nxt[0]["skipped"], nxt[1]["changed"], nxt[1]["amount"]) == (True, True, "-50.00")
    row = next(r for r in ana.c.get("/recurring").json()["rows"] if r["id"] == rid)
    assert row["next"]["occurrence"] == b                            # la saltada no es la próxima
    assert ana.c.delete(f"/recurring/{rid}/occurrences/{a}").status_code == 204
    assert ana.c.get(f"/recurring/{rid}").json()["next"][0]["skipped"] is False
    r = ana.c.put(f"/recurring/{rid}/occurrences/2020-01-05", json={"skip": True})
    assert r.status_code == 400


def test_pausar_y_reanudar_no_recupera_las_fechas_de_la_pausa(ana: Ana):
    rid = netflix(ana, start=first_of_next_month())
    assert ana.c.post(f"/recurring/{rid}/state", json={"action": "pause"}).status_code == 204
    row = next(r for r in ana.c.get("/recurring").json()["rows"] if r["id"] == rid)
    assert (row["state"], row["next"]) == ("paused", None)
    assert ana.c.post(f"/recurring/{rid}/state", json={"action": "resume"}).status_code == 204
    assert ana.c.post(f"/recurring/{rid}/state", json={"action": "end"}).status_code == 204
    assert rid not in [r["id"] for r in ana.c.get("/recurring").json()["rows"]]


def test_cambiarla_aplica_desde_la_proxima(ana: Ana):
    rid = netflix(ana)
    body = {"move": {"kind": "expense", "account_id": ana.bcp, "amount": "54.90", "ref": "Netflix",
                     "splits": [{"category_id": ana.cat["Software y apps"], "amount": "54.90"}]},
            "rule": {"interval": "month", "start": HOY.isoformat()}, "mode": "auto"}
    assert ana.c.put(f"/recurring/{rid}", json=body).status_code == 204
    d = ana.c.get(f"/recurring/{rid}").json()
    assert d["done"][0]["amount"] == "-44.90" and d["next"][0]["amount"] == "-54.90"


def test_lo_que_no_se_repite(ana: Ana):
    def post(move, **rule):
        return ana.c.post("/recurring", json={"move": move, "rule": {"interval": "month", **rule}, "mode": "auto"})

    r = post({"kind": "lend", "account_id": ana.bcp, "amount": "10", "partner_id": 1})
    assert r.status_code == 400 and r.json()["detail"] == "Se repite un gasto, un ingreso o una transferencia"
    r = post({"kind": "transfer", "account_id": ana.bcp, "to_account_id": ana.bbva, "amount": "10", "to_amount": "3"})
    assert r.status_code == 400 and "cambio de moneda" in r.json()["detail"]
    r = post({"kind": "expense", "account_id": ana.bcp, "amount": "10",
              "splits": [{"category_id": ana.cat["Hogar"], "amount": "10"}]}, end_type="count")
    assert r.status_code == 400 and r.json()["detail"] == "Escribe cuántas veces"
    assert Ana().c.get(f"/recurring/{netflix(ana)}").status_code == 404


def test_un_sueldo_y_una_transferencia(ana: Ana):
    r = ana.c.post("/recurring", json={
        "move": {"kind": "income", "account_id": ana.bcp, "amount": "4200",
                 "splits": [{"category_id": ana.cat["Salario y facturas"], "amount": "4200"}]},
        "rule": {"interval": "month", "start": first_of_next_month().isoformat(), "month_days": [1]},
        "mode": "auto"})
    assert r.status_code == 201
    r = ana.c.post("/recurring", json={
        "move": {"kind": "transfer", "account_id": ana.bcp, "to_account_id": ana.efectivo, "amount": "200"},
        "rule": {"interval": "week", "start": first_of_next_month().isoformat()}, "mode": "auto"})
    assert r.status_code == 201
    rows = {x["name"]: x for x in ana.c.get("/recurring").json()["rows"]}
    assert rows["Salario y facturas"]["amount"] == "4200.00" and rows["Salario y facturas"]["kind"] == "income"
    assert rows["Transferencia a Efectivo"]["to_account"] == "Efectivo"


# --- Préstamos --------------------------------------------------------------------------------

def bcp_bank(ana: Ana) -> int:
    return next(b["id"] for b in ana.c.get("/catalog").json()["banks"] if b["name"] == "BCP")


def new_loan(ana: Ana, fresh=False) -> int:
    r = ana.c.post("/loans", json={"name": "Préstamo vehicular", "bank_id": bcp_bank(ana), "currency": "PEN",
                                   "fresh": fresh, "amount": "38850" if not fresh else "50000",
                                   "pay_account_id": ana.bcp, "day": 15, "left": 23,
                                   "capital": "1050", "interest": "610", "insurance": "28"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_ya_lo_venia_pagando_no_mueve_tus_cuentas(ana: Ana):
    loan = new_loan(ana)
    assert ana.balance(ana.bcp) == "1000.00"
    owe = ana.c.get("/accounts").json()["owe"]
    row = next(a for a in owe if a["id"] == loan)
    assert (row["kind"], row["subtitle"], row["bank"]) == ("loan", "Préstamo en soles", "BCP")
    d = ana.c.get(f"/loans/{loan}").json()
    assert (d["debt"], d["bank"], d["paid_count"], d["left_count"], d["pay_account"]) == \
           ("38850.00", "BCP", 0, 23, "BCP")
    assert d["next"]["total"] == "1688.00"
    assert [(p["name"], p["amount"]) for p in d["next"]["parts"]] == \
           [("Capital", "1050.00"), ("Interés", "610.00"), ("Seguro", "28.00")]


def test_recien_me_lo_dieron_entra_a_la_cuenta(ana: Ana):
    loan = new_loan(ana, fresh=True)
    assert ana.balance(ana.bcp) == "51000.00"
    assert ana.c.get(f"/loans/{loan}").json()["debt"] == "50000.00"


def test_pagar_la_cuota_con_la_boleta(ana: Ana):
    loan = new_loan(ana, fresh=True)
    r = ana.c.post(f"/loans/{loan}/pay", json={"account_id": ana.bcp, "capital": "1050.10", "interest": "609.90",
                                               "insurance": "28"})
    assert r.status_code == 201, r.text
    d = ana.c.get(f"/loans/{loan}").json()
    assert (d["debt"], d["paid_count"], d["left_count"]) == ("48949.90", 1, 22)
    assert d["paid"][0]["total"] == "1688.00"
    assert d["next"]["occurrence"] > d["paid"][0]["occurrence"]     # la siguiente, no la misma
    assert ana.balance(ana.bcp) == "49312.00"
    # la cuota del préstamo no se cambia como una recurrente cualquiera
    r = ana.c.put(f"/recurring/{d['recurring_id']}", json={
        "move": {"kind": "expense", "account_id": ana.bcp, "amount": "1",
                 "splits": [{"category_id": ana.cat["Hogar"], "amount": "1"}]},
        "rule": {"interval": "month"}, "mode": "draft"})
    assert r.status_code == 400


def test_un_prestamo_ajeno_no_se_ve(ana: Ana):
    loan = new_loan(ana)
    assert Ana().c.get(f"/loans/{loan}").status_code == 404



def test_al_abrir_la_app_se_registra_lo_que_toca(ana: Ana):
    rid = netflix(ana, start=first_of_next_month())
    with psycopg.connect(owner_url()) as c:     # como si hubiera pasado un mes sin abrir la app
        c.execute("UPDATE account_recurring SET date_start = %s, month_days = %s WHERE id = %s",
                  (HOY - timedelta(days=40), [HOY.day], rid))
    assert ana.c.get("/me").status_code == 200
    done = ana.c.get(f"/recurring/{rid}").json()["done"]
    assert len(done) >= 1 and all(x["posted"] for x in done)
