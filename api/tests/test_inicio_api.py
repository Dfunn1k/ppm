"""El Inicio y la apariencia, a través de la API."""

from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg
import pytest

from app.config import get_settings
from tests.conftest import usd_value_today
from tests.test_movimientos_api import Ana

HOY = datetime.now(ZoneInfo("America/Lima")).date()
MES = HOY.strftime("%Y-%m")


@pytest.fixture(autouse=True)
def borrar_usuarios_de_prueba():
    yield
    with psycopg.connect(get_settings().database_url) as c:
        c.execute("DELETE FROM res_users WHERE login LIKE '%@prueba.ppm'")


@pytest.fixture
def ana() -> Ana:
    return Ana()


def gasto(ana: Ana, categoria: str, monto: str, **extra):
    return ana.register(kind="expense", account_id=ana.bcp, amount=monto,
                        splits=[{"category_id": ana.cat[categoria], "amount": monto}], **extra)


def test_el_inicio_de_un_mes_normal(ana: Ana):
    ana.register(kind="income", account_id=ana.bcp, amount="4850",
                 splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "4850"}], ref="Sueldo")
    gasto(ana, "Alquiler", "1000")
    gasto(ana, "Supermercado y mercado", "500")
    gasto(ana, "Restaurantes y delivery", "140.80")
    gasto(ana, "Taxi y apps", "212")
    gasto(ana, "Celular", "50")
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="100")

    h = ana.c.get("/home", params={"month": MES}).json()
    # Hoy: efectivo 600, BCP 1000 + 4850 − 1902.80 − 100 = 3847.20, BBVA US$ 200 al tipo de hoy
    total = str(Decimal("4447.20") + Decimal(usd_value_today("200", "740.00")))
    assert (h["have_total"], h["real_total"]) == (total, total)
    assert (h["income_total"], h["expense_total"], h["saved"], h["saved_percent"]) == ("4850.00", "1902.80", "2947.20", 61)
    # Por categoría principal: la hija suma a su principal; la transferencia no es gasto
    assert [(t["name"], t["amount"], t["share"]) for t in h["top"]] == [
        ("Vivienda", "1000.00", 53), ("Comida y bebida", "640.80", 34), ("Transporte", "212.00", 11)]
    assert h["top"][0]["icon"] == "home" and h["top"][0]["color"] == 6
    assert [r["ref"] for r in h["recent"]] == ["Transferencia a Efectivo", "Celular", "Taxi y apps"]


def test_un_mes_en_negativo(ana: Ana):
    gasto(ana, "Alquiler", "300")
    h = ana.c.get("/home", params={"month": MES}).json()
    assert (h["income_total"], h["saved"], h["saved_percent"]) == ("0.00", "-300.00", None)


def test_otro_mes_cambia_lo_del_mes_pero_no_lo_de_hoy(ana: Ana):
    gasto(ana, "Alquiler", "300")
    pasado = (HOY.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    h = ana.c.get("/home", params={"month": pasado}).json()
    assert (h["expense_total"], h["top"]) == ("0.00", [])
    assert h["real_total"] == ana.c.get("/home", params={"month": MES}).json()["real_total"]


def test_aviso_de_por_confirmar_cuya_fecha_llego(ana: Ana):
    gasto(ana, "Servicios", "50", pending=True)                                   # hoy: ya llegó
    gasto(ana, "Alquiler", "1000", date=(HOY + timedelta(days=5)).isoformat())   # futuro: aún no
    assert ana.c.get("/home", params={"month": MES}).json()["overdue_pending"] == 1


def test_guardar_tema_y_acento(ana: Ana):
    r = ana.c.patch("/me", json={"ui_theme": "dark", "ui_accent": "morado"})
    assert r.status_code == 200 and (r.json()["ui_theme"], r.json()["ui_accent"]) == ("dark", "morado")
    assert ana.c.patch("/me", json={"ui_accent": "verde"}).status_code == 422   # la paleta es cerrada
    assert ana.c.get("/me").json()["ui_accent"] == "morado"
