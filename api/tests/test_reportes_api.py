"""Reportes: Gastos e Ingresos por periodo contra el anterior, Flujo, Patrimonio y Personas.
Las fechas van relativas a hoy (en la zona de la persona)."""

from datetime import timedelta
from decimal import Decimal

import pytest

from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401

ANTES = HOY.replace(day=1) - timedelta(days=1)          # el mes anterior
MES_ANTES = ANTES.strftime("%Y-%m")


@pytest.fixture
def ana() -> Ana:
    return Ana()


def gasto(ana: Ana, cat: str, amount: str, when=HOY, account=None, ref=None) -> dict:
    return ana.register(kind="expense", account_id=account or ana.bcp, amount=amount, date=when.isoformat(), ref=ref,
                        splits=[{"category_id": ana.cat[cat], "amount": amount}])


def ingreso(ana: Ana, amount: str, when=HOY) -> dict:
    return ana.register(kind="income", account_id=ana.bcp, amount=amount, date=when.isoformat(),
                        splits=[{"category_id": ana.cat["Salario y facturas"], "amount": amount}])


def reporte(ana: Ana, path: str, **params) -> dict:
    r = ana.c.get(f"/reports/{path}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_gastos_por_grupo_con_sus_hijas_y_el_mes_anterior(ana: Ana):
    gasto(ana, "Supermercado y mercado", "120.00")
    gasto(ana, "Restaurantes y delivery", "80.00")
    gasto(ana, "Taxi y apps", "30.00")
    gasto(ana, "Supermercado y mercado", "100.00", when=ANTES)
    ana.register(kind="refund", account_id=ana.bcp, amount="20.00", date=HOY.isoformat(),
                 splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "20.00"}])
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="50.00")   # no es gasto
    ana.register(kind="expense", account_id=ana.bcp, amount="15.00", later=True)                     # por clasificar

    r = reporte(ana, "expenses", period=MES)
    assert (r["total"], r["previous"]) == ("210.00", "100.00")
    assert r["unclassified"] == {"count": 1, "amount": "15.00"}
    comida, transporte = r["groups"]
    assert (comida["name"], comida["amount"], comida["previous"]) == ("Comida y bebida", "180.00", "100.00")
    assert [(k["name"], k["amount"], k["refunded"]) for k in comida["children"]] == [
        ("Supermercado y mercado", "120.00", "0.00"), ("Restaurantes y delivery", "60.00", "20.00")]
    assert (transporte["name"], transporte["amount"], transporte["previous"]) == ("Transporte", "30.00", "0.00")
    assert r["months"] == []


def test_el_anio_trae_los_doce_meses(ana: Ana):
    gasto(ana, "Taxi y apps", "30.00")
    gasto(ana, "Taxi y apps", "10.00", when=ANTES)
    r = reporte(ana, "expenses", period=str(HOY.year))
    assert len(r["months"]) == 12
    by = {m["month"]: m["total"] for m in r["months"]}
    assert by[MES] == "30.00"
    if ANTES.year == HOY.year:
        assert (r["total"], by[MES_ANTES]) == ("40.00", "10.00")
    assert all(len(m["groups"]) == len(r["groups"]) for m in r["months"])


def test_ingresos_y_flujo_con_lo_guardado(ana: Ana):
    ingreso(ana, "1000.00")
    gasto(ana, "Supermercado y mercado", "300.00")
    gasto(ana, "Taxi y apps", "100.00")
    assert reporte(ana, "income", period=MES)["total"] == "1000.00"
    f = reporte(ana, "flow", period=MES)
    assert (f["income"], f["expense"], f["saved"]) == ("1000.00", "400.00", "600.00")
    assert [(n["name"], n["amount"]) for n in f["sources"]] == [("Salario y facturas", "1000.00")]
    assert [(n["name"], n["amount"]) for n in f["uses"]] == [
        ("Comida y bebida", "300.00"), ("Transporte", "100.00"), ("Guardaste", "600.00")]
    assert len(f["savings"]) == 12 and f["savings"][-1] == {"month": MES, "income": "1000.00", "expense": "400.00", "percent": 60}


def test_si_sale_mas_de_lo_que_entra_viene_de_tus_ahorros(ana: Ana):
    ingreso(ana, "100.00")
    gasto(ana, "Taxi y apps", "150.00")
    f = reporte(ana, "flow", period=MES)
    assert f["saved"] == "-50.00"
    assert ("De tus ahorros", "50.00") in [(n["name"], n["amount"]) for n in f["sources"]]
    assert "Guardaste" not in [n["name"] for n in f["uses"]]


def test_patrimonio_hoy_como_el_inicio_y_sus_dolares(ana: Ana):
    gasto(ana, "Taxi y apps", "30.00", when=ANTES)
    r = reporte(ana, "net-worth")
    home = ana.c.get("/home", params={"month": MES}).json()
    assert r["today"] == home["real_total"] and r["months"][-1]["amount"] == home["real_total"]
    assert len(r["months"]) == 12 and r["months"][-1]["date"] == HOY.isoformat()
    parts = {p["key"]: p["amount"] for p in r["have"]}
    assert (parts["cash"], parts["bank"]) == ("500.00", "970.00")
    [usd] = r["foreign"]
    assert (usd["currency"], usd["amount"], usd["book"]) == ("USD", "200.00", "740.00")
    assert Decimal(parts["foreign"]) == Decimal(usd["today"])


def test_personas_por_antiguedad(ana: Ana):
    luis = ana.c.post("/partners", json={"name": "Luis Pérez"}).json()["id"]
    maria = ana.c.post("/partners", json={"name": "María López"}).json()["id"]
    ana.register(kind="lend", account_id=ana.bcp, amount="50.00", partner_id=luis, date=(HOY - timedelta(days=100)).isoformat())
    ana.register(kind="lend", account_id=ana.bcp, amount="20.00", partner_id=luis, date=HOY.isoformat())
    ana.register(kind="borrow", account_id=ana.bcp, amount="30.00", partner_id=maria, date=(HOY - timedelta(days=10)).isoformat())
    r = reporte(ana, "people")
    assert (r["owes_me"], r["i_owe"]) == ("70.00", "30.00")
    assert r["ages"] == ["20.00", "0.00", "0.00", "50.00"]
    [d] = r["debtors"]
    assert (d["name"], d["amount"], d["oldest_days"], d["overdue"]) == ("Luis Pérez", "70.00", 100, False)
    assert [(c["name"], c["amount"], c["oldest_days"]) for c in r["creditors"]] == [("María López", "30.00", 10)]


def test_el_indice_trae_una_cifra_de_cada_reporte(ana: Ana):
    ingreso(ana, "1000.00")
    gasto(ana, "Taxi y apps", "250.00")
    s = reporte(ana, "summary", month=MES)
    assert (s["expense"], s["income"], s["saved"], s["saved_percent"]) == ("250.00", "1000.00", "750.00", 75)
    assert [g["name"] for g in s["expense_groups"]] == ["Transporte"] and len(s["net_worth_months"]) == 12


def test_un_periodo_que_no_existe(ana: Ana):
    assert ana.c.get("/reports/expenses", params={"period": "octubre"}).status_code == 422
