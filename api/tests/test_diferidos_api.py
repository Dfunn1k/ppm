"""Ingresos y gastos diferidos: un gasto pagado por adelantado (o un ingreso cobrado por adelantado)
espera en «Pagos por adelantado» (o «Cobrado por adelantado») y cada parte pasa a su categoría al
llegar su fecha. Por días o por meses; cancelar lo que falta con lo que te devolvieron."""

import datetime as dt
from decimal import Decimal

import pytest

from app.accounts import AccountError
from app.moves import DeferralInput, _add_months, deferral_schedule
from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401

INICIO = _add_months(HOY.replace(day=1), -2)          # hace dos meses, el día 1: ya contaron 3 partes


@pytest.fixture
def ana() -> Ana:
    return Ana()


def seguro(ana: Ana, **deferral) -> dict:
    return ana.register(kind="expense", account_id=ana.bcp, amount="1200.00", date=INICIO.isoformat(),
                        ref="SOAT y seguro", splits=[{"category_id": ana.cat["Seguro vehicular"], "amount": "1200.00"}],
                        deferral=deferral or {"method": "months", "months": 12})


def sistema(ana: Ana, kind: str) -> str:
    o = ana.c.get("/accounts").json()
    rows = [a for a in o["have"] + o["owe"] if a["kind"] == kind]
    return rows[0]["base_total"] if rows else "0.00"


# --- El calendario ------------------------------------------------------------------------------

def test_por_dias_cada_mes_segun_sus_dias():
    parts = deferral_schedule(Decimal("1200.00"), DeferralInput("days", end=dt.date(2027, 11, 15)), dt.date(2026, 11, 16))
    assert len(parts) == 13
    assert parts[0] == (dt.date(2026, 11, 16), 15, Decimal("49.32"))
    assert parts[1] == (dt.date(2026, 12, 1), 31, Decimal("101.92"))
    assert parts[3] == (dt.date(2027, 2, 1), 28, Decimal("92.05"))
    assert parts[-1][:2] == (dt.date(2027, 11, 1), 15)
    assert sum(a for _, _, a in parts) == Decimal("1200.00")           # la última cierra el redondeo


def test_por_meses_partes_iguales_el_mismo_dia():
    parts = deferral_schedule(Decimal("100.00"), DeferralInput("months", months=3), dt.date(2027, 1, 31))
    assert [(d, a) for d, _, a in parts] == [(dt.date(2027, 1, 31), Decimal("33.33")),
                                             (dt.date(2027, 2, 28), Decimal("33.33")),     # febrero es más corto
                                             (dt.date(2027, 3, 31), Decimal("33.34"))]


@pytest.mark.parametrize(("d", "message"), [
    (DeferralInput("days", end=dt.date(2026, 11, 16)), "un día después"),
    (DeferralInput("days", end=dt.date(2026, 11, 30)), "más de un mes"),
    (DeferralInput("days", end=dt.date(2032, 1, 1)), "cinco años"),
    (DeferralInput("months", months=1), "2 a 60"),
])
def test_un_reparto_que_no_se_puede(d: DeferralInput, message: str):
    with pytest.raises(AccountError, match=message):
        deferral_schedule(Decimal("100.00"), d, dt.date(2026, 11, 16))


# --- Un gasto pagado por adelantado ------------------------------------------------------------

def test_el_gasto_espera_y_cada_parte_cuenta_en_su_mes(ana: Ana):
    d = seguro(ana)
    assert d["summary"]["kind"] == "transfer"                       # de BCP a «Pagos por adelantado»
    assert ana.balance(ana.bcp) == "-200.00"
    f = d["deferral"]
    assert (f["kind"], f["method"], f["months"], f["amount"], f["category"]["name"]) == \
        ("expense", "months", 12, "1200.00", "Seguro vehicular")
    assert [p["date"] for p in f["parts"][:3]] == [INICIO.isoformat(), _add_months(INICIO, 1).isoformat(),
                                                   _add_months(INICIO, 2).isoformat()]
    assert [p["posted"] for p in f["parts"]] == [True] * 3 + [False] * 9
    assert f["remaining"] == "900.00" and sistema(ana, "prepaid") == "900.00"

    # La parte de este mes es un gasto de su categoría, desde «Pagos por adelantado»
    mes = ana.c.get("/moves", params={"month": MES}).json()
    parte = next(m for day in mes["days"] for m in day["moves"] if (m["ref"], m["part"], m["parts"]) == ("SOAT y seguro", 3, 12))
    assert (parte["kind"], parte["base"], parte["account"]) == ("expense", "100.00", "Pagos por adelantado")
    assert mes["expense_total"] == "100.00"
    r = ana.c.get("/reports/expenses", params={"period": MES}).json()
    assert r["total"] == "100.00"

    p = ana.c.get(f"/moves/{parte['id']}").json()
    assert p["deferral_of"] == {"move_id": d["summary"]["id"], "ref": "SOAT y seguro", "sequence": 3, "parts": 12}


def test_ni_el_original_ni_sus_partes_se_editan(ana: Ana):
    d = seguro(ana)
    parte = d["deferral"]["parts"][0]["move_id"]
    body = {"kind": "expense", "account_id": ana.bcp, "amount": "10",
            "splits": [{"category_id": ana.cat["Seguro vehicular"], "amount": "10"}]}
    r = ana.c.put(f"/moves/{d['summary']['id']}", json=body)
    assert r.status_code == 400 and "bórralo y regístralo" in r.json()["detail"]
    r = ana.c.put(f"/moves/{parte}", json=body)
    assert r.status_code == 400 and "se arma sola" in r.json()["detail"]
    r = ana.c.delete(f"/moves/{parte}")
    assert r.status_code == 400 and "no se borra sola" in r.json()["detail"]
    r = ana.c.post(f"/moves/{parte}/state", json={"pending": True})
    assert r.status_code == 400


def test_cancelar_lo_que_falta_con_lo_que_devolvieron_y_deshacer(ana: Ana):
    d = seguro(ana)
    move = d["summary"]["id"]
    r = ana.c.post(f"/moves/{move}/deferral/cancel", json={"refund": "1000", "account_id": ana.bcp})
    assert r.status_code == 400 and "más de lo que falta" in r.json()["detail"]

    r = ana.c.post(f"/moves/{move}/deferral/cancel", json={"refund": "600", "account_id": ana.bcp})
    assert r.status_code == 200, r.text
    f = r.json()["deferral"]
    assert f["remaining"] == "0.00" and sum(p["canceled"] for p in f["parts"]) == 9
    c = f["canceled"]
    assert (c["date"], c["refund"], c["account"], c["rest"]) == (HOY.isoformat(), "600.00", "BCP", "300.00")
    assert ana.balance(ana.bcp) == "400.00" and sistema(ana, "prepaid") == "0.00"
    # Los 300 que no volvieron cuentan como gasto hoy
    assert ana.c.get("/reports/expenses", params={"period": MES}).json()["total"] == "400.00"
    assert ana.c.get(f"/moves/{c['move_id']}").json()["deferral_of"]["sequence"] is None
    r = ana.c.post(f"/moves/{move}/deferral/cancel", json={})
    assert r.status_code == 400 and "Ya cancelaste" in r.json()["detail"]

    # Deshacer: borrar la cancelación devuelve las partes
    assert ana.c.delete(f"/moves/{c['move_id']}").status_code == 204
    f = ana.c.get(f"/moves/{move}").json()["deferral"]
    assert f["canceled"] is None and f["remaining"] == "900.00" and not any(p["canceled"] for p in f["parts"])
    assert ana.balance(ana.bcp) == "-200.00"


def test_cancelar_sin_que_devuelvan_nada_es_gasto_de_hoy(ana: Ana):
    move = seguro(ana)["summary"]["id"]
    r = ana.c.post(f"/moves/{move}/deferral/cancel", json={})
    assert r.status_code == 200, r.text
    c = r.json()["deferral"]["canceled"]
    assert (c["refund"], c["account"], c["rest"]) == ("0.00", None, "900.00")
    s = ana.c.get(f"/moves/{c['move_id']}").json()["summary"]
    assert (s["kind"], s["base"]) == ("expense", "900.00")


def test_borrar_el_original_se_lleva_todo(ana: Ana):
    move = seguro(ana)["summary"]["id"]
    ana.c.post(f"/moves/{move}/deferral/cancel", json={"refund": "100", "account_id": ana.bcp})
    assert ana.c.delete(f"/moves/{move}").status_code == 204
    assert ana.balance(ana.bcp) == "1000.00" and sistema(ana, "prepaid") == "0.00"
    assert ana.c.get("/reports/expenses", params={"period": MES}).json()["total"] == "0.00"


def test_por_dias_desde_la_api(ana: Ana):
    end = _add_months(INICIO, 12) - dt.timedelta(days=1)
    f = seguro(ana, method="days", end=end.isoformat())["deferral"]
    assert (f["method"], f["end"], f["months"]) == ("days", end.isoformat(), None)
    assert len(f["parts"]) == 12 and all(p["days"] for p in f["parts"])
    assert sum(Decimal(p["amount"]) for p in f["parts"]) == Decimal("1200.00")
    assert [p["posted"] for p in f["parts"][:4]] == [True, True, True, False]


# --- Un ingreso cobrado por adelantado ---------------------------------------------------------

def test_el_adelanto_es_lo_que_debes_hasta_ganarlo(ana: Ana):
    d = ana.register(kind="income", account_id=ana.bcp, amount="3000.00", date=INICIO.isoformat(), ref="Adelanto web",
                     splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "3000.00"}],
                     deferral={"method": "months", "months": 6})
    assert ana.balance(ana.bcp) == "4000.00"
    assert d["deferral"]["remaining"] == "1500.00" and sistema(ana, "unearned") == "-1500.00"
    o = ana.c.get("/accounts").json()
    assert any(a["kind"] == "unearned" for a in o["owe"])          # algo que debes, en el patrimonio
    assert ana.c.get("/reports/income", params={"period": MES}).json()["total"] == "500.00"

    r = ana.c.post(f"/moves/{d['summary']['id']}/deferral/cancel", json={"refund": "1000", "account_id": ana.bcp})
    c = r.json()["deferral"]["canceled"]
    assert (c["refund"], c["rest"]) == ("1000.00", "500.00")        # devolviste 1000; 500 los ganaste hoy
    assert ana.balance(ana.bcp) == "3000.00" and sistema(ana, "unearned") == "0.00"
    assert ana.c.get("/reports/income", params={"period": MES}).json()["total"] == "1000.00"


# --- Lo que no va -------------------------------------------------------------------------------

def test_lo_que_no_se_reparte(ana: Ana):
    cat = ana.cat["Seguro vehicular"]
    every = {"method": "months", "months": 3}
    for body, message in [
        ({"splits": [{"category_id": cat, "amount": "50"}, {"category_id": ana.cat["Hogar"], "amount": "50"}]},
         "una sola categoría"),
        ({"later": True, "splits": []}, "Lo clasifico después"),
        ({"deferral": {"method": "months", "months": 61}}, None),
    ]:
        r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "100",
                                       "splits": [{"category_id": cat, "amount": "100"}], "deferral": every, **body})
        assert r.status_code in (400, 422), r.text
        if message:
            assert message in r.json()["detail"]
    r = ana.c.post("/moves", json={"kind": "transfer", "account_id": ana.bcp, "to_account_id": ana.efectivo,
                                   "amount": "100", "deferral": every})
    assert r.status_code == 400 and "solo en un gasto o un ingreso" in r.json()["detail"]
