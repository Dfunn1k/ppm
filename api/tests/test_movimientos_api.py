"""Registrar, editar, confirmar y borrar movimientos, y la lista por mes, a través de la API."""

import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

HOY = datetime.now(ZoneInfo("America/Lima")).date()   # «hoy» es el de la zona de la persona
MES = HOY.strftime("%Y-%m")


@pytest.fixture(autouse=True)
def borrar_usuarios_de_prueba():
    yield
    with psycopg.connect(get_settings().database_url) as c:
        c.execute("DELETE FROM res_users WHERE login LIKE '%@prueba.ppm'")


class Ana:
    """Una persona configurada en Perú con dólares, efectivo S/ 500, BCP S/ 1,000 y BBVA US$ 200."""

    def __init__(self) -> None:
        self.c = TestClient(app)
        assert self.c.post("/auth/signup", json={"name": "Ana", "email": f"{uuid.uuid4().hex[:10]}@prueba.ppm",
                                                 "password": "pan-para-mayo-2026"}).status_code == 201
        assert self.c.post("/me/setup", json={"country": "PE", "other_currencies": ["USD"]}).status_code == 200
        efectivo = self.c.get("/accounts").json()["have"][0]["id"]
        self.c.put(f"/accounts/{efectivo}/opening", json={"amount": "500", "date": "2026-01-01"})
        banks = {b["name"]: b["id"] for b in self.c.get("/catalog").json()["banks"]}
        self.efectivo = efectivo
        self.bcp = self.c.post("/accounts/bank", json={"name": "BCP", "currency": "PEN", "bank_id": banks["BCP"],
                                                       "opening": {"amount": "1000", "date": "2026-01-01"}}).json()["account"]["id"]
        self.bbva = self.c.post("/accounts/bank", json={"name": "BBVA $", "currency": "USD", "bank_id": banks["BBVA"],
                                                        "opening": {"amount": "200", "date": "2026-01-01", "rate": "3.70"}}).json()["account"]["id"]
        cats = {}
        for kind in ("expense", "income"):
            for g in self.c.get("/categories", params={"kind": kind}).json()["groups"]:
                for k in g["children"]:
                    cats.setdefault(k["name"], k["id"])
        self.cat = cats

    def balance(self, account_id: int) -> str:
        return self.c.get(f"/accounts/{account_id}").json()["account"]["balances"][0]["amount"]

    def register(self, **body) -> dict:
        r = self.c.post("/moves", json=body)
        assert r.status_code == 201, r.text
        return r.json()


@pytest.fixture
def ana() -> Ana:
    return Ana()


def test_categorias_por_tipo(ana: Ana):
    gastos = ana.c.get("/categories", params={"kind": "expense"}).json()
    comida = next(g for g in gastos["groups"] if g["name"] == "Comida y bebida")
    assert comida["color"] == 2
    assert [k["name"] for k in comida["children"]] == ["Supermercado y mercado", "Restaurantes y delivery", "Cafés y bares"]
    assert all(k["color"] == 2 for k in comida["children"])          # heredan el color
    nombres = [k["name"] for g in gastos["groups"] for k in g["children"]]
    assert "Costo del cambio" not in nombres                          # ese lo pone la app

    ingresos = ana.c.get("/categories", params={"kind": "income"}).json()
    assert [g["name"] for g in ingresos["groups"]] == ["Ingresos"]
    assert "Salario y facturas" in [k["name"] for k in ingresos["groups"][0]["children"]]
    assert "Ganancia por tipo de cambio" not in [k["name"] for k in ingresos["groups"][0]["children"]]


def test_un_gasto_baja_la_cuenta(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="35.50",
                     splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "35.50"}],
                     ref="Almuerzo con el equipo")
    s = d["summary"]
    assert (s["kind"], s["amount"], s["posted"], s["ref"], s["account"]) == \
           ("expense", "35.50", True, "Almuerzo con el equipo", "BCP")
    assert s["categories"][0]["icon"] == "restaurant" and s["categories"][0]["color"] == 2
    assert ana.balance(ana.bcp) == "964.50"


def test_sin_nota_la_glosa_es_la_categoria(ana: Ana):
    d = ana.register(kind="income", account_id=ana.bcp, amount="4200",
                     splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "4200"}])
    assert d["summary"]["ref"] == "Salario y facturas"
    assert ana.balance(ana.bcp) == "5200.00"


def test_dividir_en_varias_categorias(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="186.40", ref="Plaza Vea",
                     splits=[{"category_id": ana.cat["Supermercado y mercado"], "amount": "120"},
                             {"category_id": ana.cat["Hogar"], "amount": "66.40"}])
    assert [(x["category"]["name"], x["amount"]) for x in d["splits"]] == \
           [("Supermercado y mercado", "120.00"), ("Hogar", "66.40")]
    r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "100",
                                   "splits": [{"category_id": ana.cat["Hogar"], "amount": "60"},
                                              {"category_id": ana.cat["Farmacia"], "amount": "30"}]})
    assert r.status_code == 400 and r.json()["detail"] == "Las partes no suman el total"


def test_un_gasto_en_dolares_pide_tipo_de_cambio_y_se_ve_en_soles(ana: Ana):
    body = {"kind": "expense", "account_id": ana.bbva, "amount": "20",
            "splits": [{"category_id": ana.cat["Software y apps"], "amount": "20"}]}
    r = ana.c.post("/moves", json=body)
    assert r.status_code == 400 and r.json()["detail"] == "Falta el tipo de cambio de USD"
    d = ana.register(**body, rate="3.75")
    assert (d["summary"]["currency"], d["summary"]["amount"], d["summary"]["base"]) == ("USD", "20.00", "75.00")
    assert d["rate"] == "3.750000"
    assert ana.balance(ana.bbva) == "180.00"


def test_dividir_en_dolares_cuadra_exacto_en_soles(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bbva, amount="10", rate="3.333",
                     splits=[{"category_id": ana.cat["Electrónica"], "amount": "3.33"},
                             {"category_id": ana.cat["Software y apps"], "amount": "6.67"}])
    assert d["summary"]["base"] == "33.33"
    assert [x["amount"] for x in d["splits"]] == ["3.33", "6.67"]


def test_transferencia_en_la_misma_moneda(ana: Ana):
    d = ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="200")
    s = d["summary"]
    assert (s["kind"], s["account"], s["ref"]) == ("transfer", "BCP → Efectivo", "Transferencia a Efectivo")
    assert ana.balance(ana.bcp) == "800.00" and ana.balance(ana.efectivo) == "700.00"


def test_cambio_de_soles_a_dolares_con_los_dos_montos(ana: Ana):
    r = ana.c.post("/moves", json={"kind": "transfer", "account_id": ana.bcp, "to_account_id": ana.bbva, "amount": "375"})
    assert r.status_code == 400 and r.json()["detail"] == "Escribe cuánto entró en USD"
    d = ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.bbva, amount="375", to_amount="100")
    s = d["summary"]
    assert (s["currency"], s["amount"], s["to_currency"], s["to_amount"], s["base"]) == \
           ("PEN", "375.00", "USD", "100.00", "375.00")
    assert ana.balance(ana.bbva) == "300.00"


def test_no_se_transfiere_a_la_misma_cuenta(ana: Ana):
    r = ana.c.post("/moves", json={"kind": "transfer", "account_id": ana.bcp, "to_account_id": ana.bcp, "amount": "1"})
    assert r.status_code == 400


def test_una_categoria_que_agrupa_no_se_elige(ana: Ana):
    comida = next(g for g in ana.c.get("/categories", params={"kind": "expense"}).json()["groups"]
                  if g["name"] == "Comida y bebida")["id"]
    r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "10",
                                   "splits": [{"category_id": comida, "amount": "10"}]})
    assert r.status_code == 400 and "agrupa otras" in r.json()["detail"]


def test_un_ingreso_no_usa_categorias_de_gasto(ana: Ana):
    r = ana.c.post("/moves", json={"kind": "income", "account_id": ana.bcp, "amount": "10",
                                   "splits": [{"category_id": ana.cat["Hogar"], "amount": "10"}]})
    assert r.status_code == 400 and r.json()["detail"] == "«Hogar» no es una categoría de ingreso"


def test_con_fecha_futura_queda_por_confirmar_y_no_cuenta(ana: Ana):
    futuro = HOY + timedelta(days=5)
    d = ana.register(kind="expense", account_id=ana.bcp, amount="1000", date=futuro.isoformat(),
                     splits=[{"category_id": ana.cat["Alquiler"], "amount": "1000"}])
    assert d["summary"]["posted"] is False
    assert ana.balance(ana.bcp) == "1000.00"
    r = ana.c.post(f"/moves/{d['summary']['id']}/state", json={"pending": False})
    assert r.status_code == 400 and "fecha futura" in r.json()["detail"]


def test_por_confirmar_y_confirmar(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="50", pending=True,
                     splits=[{"category_id": ana.cat["Servicios"], "amount": "50"}])
    assert d["summary"]["posted"] is False and ana.balance(ana.bcp) == "1000.00"
    r = ana.c.post(f"/moves/{d['summary']['id']}/state", json={"pending": False})
    assert r.status_code == 200 and r.json()["summary"]["posted"] is True
    assert ana.balance(ana.bcp) == "950.00"


def test_editar_cambia_monto_categoria_y_cuenta(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="35.50",
                     splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "35.50"}])
    move_id = d["summary"]["id"]
    r = ana.c.put(f"/moves/{move_id}", json={
        "kind": "expense", "account_id": ana.efectivo, "amount": "40", "ref": "Cena",
        "splits": [{"category_id": ana.cat["Cafés y bares"], "amount": "40"}]})
    assert r.status_code == 200, r.text
    s = r.json()["summary"]
    assert (s["id"], s["amount"], s["account"], s["ref"], s["categories"][0]["name"]) == \
           (move_id, "40.00", "Efectivo", "Cena", "Cafés y bares")
    assert ana.balance(ana.bcp) == "1000.00" and ana.balance(ana.efectivo) == "460.00"


def test_borrar(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="12",
                     splits=[{"category_id": ana.cat["Taxi y apps"], "amount": "12"}])
    assert ana.c.delete(f"/moves/{d['summary']['id']}").status_code == 204
    assert ana.balance(ana.bcp) == "1000.00"
    assert ana.c.get(f"/moves/{d['summary']['id']}").status_code == 404


def test_el_saldo_inicial_no_se_edita_ni_borra_aqui(ana: Ana):
    with psycopg.connect(get_settings().database_url) as db:
        opening = db.execute("SELECT move_id FROM account_move_line WHERE account_id = %s", (ana.bcp,)).fetchone()[0]
    assert ana.c.delete(f"/moves/{opening}").status_code == 400


def test_la_lista_del_mes_con_totales_y_filtros(ana: Ana):
    ana.register(kind="income", account_id=ana.bcp, amount="4200",
                 splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "4200"}], ref="Sueldo")
    ana.register(kind="expense", account_id=ana.bcp, amount="35.50", ref="Almuerzo",
                 splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "35.50"}])
    ana.register(kind="expense", account_id=ana.efectivo, amount="12", ref="Taxi",
                 splits=[{"category_id": ana.cat["Taxi y apps"], "amount": "12"}])
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="100")
    ana.register(kind="expense", account_id=ana.bcp, amount="9", pending=True, ref="Por ver",
                 splits=[{"category_id": ana.cat["Comisiones bancarias"], "amount": "9"}])

    m = ana.c.get("/moves", params={"month": MES}).json()
    assert (m["income_total"], m["expense_total"], m["pending_count"]) == ("4200.00", "47.50", 1)
    [dia] = [d for d in m["days"] if d["date"] == HOY.isoformat()]
    assert dia["total"] == "4152.50"   # las transferencias y lo por confirmar no suman
    assert "Saldo inicial" not in [x["ref"] for d in m["days"] for x in d["moves"]]

    def refs(**params):
        r = ana.c.get("/moves", params={"month": MES, **params}).json()
        return sorted(x["ref"] for d in r["days"] for x in d["moves"])

    assert refs(account_id=ana.efectivo) == ["Taxi", "Transferencia a Efectivo"]
    assert refs(kind="transfer") == ["Transferencia a Efectivo"]
    assert refs(pending=True) == ["Por ver"]
    assert refs(q="almu") == ["Almuerzo"]
    assert refs(q="35.50") == ["Almuerzo"]
    comida = next(g for g in ana.c.get("/categories", params={"kind": "expense"}).json()["groups"]
                  if g["name"] == "Comida y bebida")["id"]
    assert refs(category_id=comida) == ["Almuerzo"]   # la principal trae a sus hijas


def test_las_mas_usadas_primero(ana: Ana):
    for _ in range(3):
        ana.register(kind="expense", account_id=ana.bcp, amount="5",
                     splits=[{"category_id": ana.cat["Cafés y bares"], "amount": "5"}])
    frequent = ana.c.get("/categories", params={"kind": "expense"}).json()["frequent"]
    assert frequent[0]["name"] == "Cafés y bares"


def test_nadie_ve_ni_toca_los_movimientos_de_otro(ana: Ana):
    d = ana.register(kind="expense", account_id=ana.bcp, amount="5",
                     splits=[{"category_id": ana.cat["Cafés y bares"], "amount": "5"}])
    beto = Ana()
    move_id = d["summary"]["id"]
    assert beto.c.get(f"/moves/{move_id}").status_code == 404
    assert beto.c.delete(f"/moves/{move_id}").status_code == 404
    r = beto.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "5",
                                    "splits": [{"category_id": beto.cat["Cafés y bares"], "amount": "5"}]})
    assert r.status_code == 404
