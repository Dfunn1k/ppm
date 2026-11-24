"""Reportes: Gastos e Ingresos por periodo contra el anterior, Flujo, Patrimonio y Personas.
Las fechas van relativas a hoy (en la zona de la persona)."""

from datetime import timedelta
from decimal import Decimal

import pytest

from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

ANTES = HOY.replace(day=1) - timedelta(days=1)          # el mes anterior
MES_ANTES = ANTES.strftime("%Y-%m")


@pytest.fixture
def ana() -> Ana:
    return Ana()


@pytest.fixture
def con() -> Con:
    return Con()


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


def test_lo_que_quedo_en_cero_no_se_lista_pero_cuenta_en_lo_anterior(ana: Ana):
    gasto(ana, "Supermercado y mercado", "50.00")
    gasto(ana, "Restaurantes y delivery", "40.00", when=ANTES)     # el mes pasado sí, este no
    gasto(ana, "Taxi y apps", "25.00", when=ANTES)                 # todo un grupo que este mes quedó en cero

    r = reporte(ana, "expenses", period=MES)
    assert (r["total"], r["previous"]) == ("50.00", "65.00")
    [comida] = r["groups"]
    assert (comida["amount"], comida["previous"]) == ("50.00", "40.00")
    assert [k["name"] for k in comida["children"]] == ["Supermercado y mercado"]


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
        ("Comida y bebida", "300.00"), ("Transporte", "100.00"), ("Patrimonio", "600.00")]
    assert len(f["savings"]) == 12 and f["savings"][-1] == {"month": MES, "income": "1000.00", "expense": "400.00", "percent": 60}


def test_si_gastas_mas_de_lo_que_entra_viene_de_tu_patrimonio(ana: Ana):
    ingreso(ana, "100.00")
    gasto(ana, "Taxi y apps", "150.00")
    f = reporte(ana, "flow", period=MES)
    assert f["saved"] == "-50.00"
    assert ("De tu patrimonio", "50.00") in [(n["name"], n["amount"]) for n in f["sources"]]
    assert "Patrimonio" not in [n["name"] for n in f["uses"]]


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


# --- Tu plata (el puente de caja de Flujo) --------------------------------------------------------

def _plata(ana: Con) -> tuple[int, str]:
    """Una tarjeta, un sueldo, un gasto en efectivo y otro con tarjeta, pagar la tarjeta, prestar y que
    te devuelvan una parte, y pasar plata entre tus cuentas. Devuelve la tarjeta y a la persona."""
    card = ana.card()["account"]["id"]
    luis = ana.c.post("/partners", json={"name": "Luis Pérez"}).json()["id"]
    ingreso(ana, "1000.00")
    gasto(ana, "Supermercado y mercado", "300.00")
    ana.buy(card, "200.00", HOY.isoformat())
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="150.00", date=HOY.isoformat())
    ana.register(kind="lend", account_id=ana.bcp, amount="100.00", partner_id=luis, date=HOY.isoformat())
    ana.register(kind="collect", account_id=ana.efectivo, amount="40.00", partner_id=luis, date=HOY.isoformat())
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="50.00", date=HOY.isoformat())
    return card, "Luis Pérez"


def test_tu_plata_de_principio_a_fin_y_por_que_no_es_tu_patrimonio(con: Con):
    _plata(con)
    f = reporte(con, "flow", period=MES)
    c = f["cash"]
    lines = {(x["kind"], x["direction"]): x for x in c["lines"]}
    assert lines[("income", "in")]["amount"] == "1000.00"
    assert (lines[("expense", "out")]["amount"], lines[("expense", "out")]["other"]) == ("-300.00", "200.00")
    assert lines[("card", "out")]["amount"] == "-150.00"
    assert (lines[("receivable", "out")]["amount"], lines[("receivable", "in")]["amount"]) == ("-100.00", "40.00")
    assert not any(k == "other" for k, _ in lines)                  # pasar entre tus cuentas no aparece
    # El puente cuadra: lo que tenías más lo que entró y salió es lo que tienes (fx: lo que movió el dólar)
    assert Decimal(c["start"]) + sum(Decimal(x["amount"]) for x in c["lines"]) == Decimal(c["end"])
    assert c["end_date"] == HOY.isoformat()
    # «Hoy tienes» es lo que suman hoy tus cuentas de efectivo y bancos en Cuentas, al tipo de hoy
    have = con.c.get("/accounts").json()["have"]
    assert Decimal(c["end"]) == sum(Decimal(a["base_total"]) for a in have if a["kind"] in ("cash", "bank"))
    assert (c["patrimony"], f["saved"]) == ("500.00", "500.00")
    # Y lo que creció tu patrimonio es lo que subió tu plata más lo que no está en tus cuentas
    assert Decimal(c["end"]) - Decimal(c["start"]) + sum(Decimal(d["amount"]) for d in c["diffs"]) == Decimal(c["patrimony"])
    diffs = {d["kind"]: d for d in c["diffs"]}
    tarjeta, personas = diffs["card"], diffs["receivable"]
    assert (tarjeta["amount"], tarjeta["paid"], tarjeta["other"]) == ("-50.00", "150.00", "200.00")   # debes S/ 50 más
    assert [(d["name"], d["amount"]) for d in tarjeta["details"]] == [("Visa BBVA", "-50.00")]
    assert (personas["amount"], personas["paid"], personas["other"]) == ("60.00", "40.00", "100.00")  # te debe S/ 60 más
    assert [(d["name"], d["amount"]) for d in personas["details"]] == [("Luis Pérez", "60.00")]


def test_los_movimientos_de_una_linea_de_tu_plata(con: Con):
    _plata(con)
    [pago] = reporte(con, "flow/moves", period=MES, kind="card", direction="out")
    assert (pago["amount"], pago["accounts"], pago["date"], pago["count"]) == ("-150.00", "BCP", HOY.isoformat(), 1)
    assert pago["move_id"] is not None
    [mes] = reporte(con, "flow/moves", period=str(HOY.year), kind="receivable", direction="out")
    assert (mes["move_id"], mes["ref"], mes["amount"], mes["count"]) == (None, MES, "-100.00", 1)
    r = con.c.get("/reports/flow/moves", params={"period": MES, "kind": "nada", "direction": "in"})
    assert r.status_code == 400


def test_pagar_solo_la_tarjeta_baja_tu_plata_pero_no_tu_patrimonio(con: Con):
    card = con.card()["account"]["id"]
    con.buy(card, "80.00", ANTES.isoformat())                     # la compra fue el mes pasado
    con.register(kind="transfer", account_id=con.bcp, to_account_id=card, amount="80.00", date=HOY.isoformat())
    c = reporte(con, "flow", period=MES)["cash"]
    assert c["patrimony"] == "0.00"
    assert [(x["kind"], x["amount"]) for x in c["lines"] if x["kind"] != "fx"] == [("card", "-80.00")]
    [tarjeta] = [d for d in c["diffs"] if d["kind"] != "fx"]
    assert (tarjeta["kind"], tarjeta["amount"], tarjeta["paid"], tarjeta["other"]) == ("card", "80.00", "80.00", "0.00")
    assert Decimal(c["end"]) - Decimal(c["start"]) + sum(Decimal(d["amount"]) for d in c["diffs"]) == Decimal(c["patrimony"])
