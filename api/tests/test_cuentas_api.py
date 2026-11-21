"""Cuentas a través de la API: la lista con sus totales, el detalle, las altas y las correcciones.
La API confirma de verdad, así que cada prueba usa correos @prueba.ppm y los borra al terminar."""

import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import owner_url, usd_value_today


@pytest.fixture(autouse=True)
def borrar_usuarios_de_prueba():
    yield
    with psycopg.connect(owner_url()) as c:
        c.execute("DELETE FROM res_users WHERE login LIKE '%@prueba.ppm'")


def person(currencies=("USD",)) -> TestClient:
    """Una persona nueva, con sesión y ya configurada en Perú."""
    c = TestClient(app)
    r = c.post("/auth/signup", json={"name": "Ana", "email": f"{uuid.uuid4().hex[:10]}@prueba.ppm",
                                     "password": "pan-para-mayo-2026"})
    assert r.status_code == 201, r.text
    r = c.post("/me/setup", json={"country": "PE", "other_currencies": list(currencies)})
    assert r.status_code == 200, r.text
    return c


def bank_id(c: TestClient, name: str) -> int:
    return next(b["id"] for b in c.get("/catalog").json()["banks"] if b["name"] == name)


def by_name(rows: list[dict], name: str) -> dict:
    return next(r for r in rows if r["name"] == name)


def test_recien_configurada_tiene_su_efectivo_en_cero():
    c = person()
    o = c.get("/accounts").json()
    assert o["currency"] == "PEN"
    assert o["real_total"] == "0.00"
    assert [a["name"] for a in o["have"]] == ["Efectivo"]
    assert o["custody"] == [] and o["owe"] == []


def test_el_catalogo_trae_los_bancos_con_su_codigo_de_cci():
    banks = {b["name"]: b["cci_code"] for b in person().get("/catalog").json()["banks"]}
    assert banks == {"BBVA": "011", "BCP": "002", "Interbank": "003", "Scotiabank": "009"}


def test_el_saldo_del_efectivo_desde_el_paso_3():
    c = person()
    efectivo = c.get("/accounts").json()["have"][0]["id"]
    r = c.put(f"/accounts/{efectivo}/opening", json={"amount": "320.00", "date": "2026-10-01"})
    assert r.status_code == 200, r.text
    assert r.json()["opening"] == {"date": "2026-10-01", "amount": "320.00", "rate": None}
    assert c.get("/accounts").json()["real_total"] == "320.00"


def test_el_banco_va_en_el_subtitulo_si_el_nombre_no_lo_dice():
    c = person()
    r = c.post("/accounts/bank", json={"name": "Sueldo", "currency": "PEN", "bank_id": bank_id(c, "BCP")})
    assert r.status_code == 201, r.text
    assert (r.json()["account"]["subtitle"], r.json()["account"]["bank"]) == ("Ahorros en soles", "BCP")


def test_cuenta_de_banco_en_soles():
    c = person()
    r = c.post("/accounts/bank", json={
        "name": "Cuenta digital BCP", "currency": "PEN", "bank_id": bank_id(c, "BCP"),
        "acc_number": "191-12345678-0-12", "cci": "002-191-001234567890-12",   # con guiones se acepta
        "opening": {"amount": "8240.30", "date": "2026-10-01"}})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["account"]["kind"] == "bank"
    assert d["account"]["subtitle"] == "Ahorros en soles"          # el nombre ya dice BCP: no se repite
    assert d["account"]["balances"] == [{"currency": "PEN", "amount": "8240.30", "base": "8240.30", "book": "8240.30"}]
    assert d["bank"] == {"bank_id": bank_id(c, "BCP"), "bank_name": "BCP", "acc_kind": "savings",
                         "acc_number": "191-12345678-0-12", "cci": "00219100123456789012"}
    [line] = d["lines"]
    assert (line["ref"], line["amount"], line["running"], line["counterpart_role"]) == \
           ("Saldo inicial", "8240.30", "8240.30", "opening")


def test_cuenta_en_dolares_con_su_tipo_de_cambio():
    c = person()
    r = c.post("/accounts/bank", json={
        "name": "Ahorros BBVA", "currency": "USD", "bank_id": bank_id(c, "BBVA"),
        "opening": {"amount": "1520.00", "date": "2026-10-01", "rate": "3.75"}})
    assert r.status_code == 201, r.text
    hoy = usd_value_today("1520.00", "5700.00")   # en libros a 3.75; hoy, al tipo de compra del día
    assert r.json()["account"]["balances"] == [{"currency": "USD", "amount": "1520.00", "base": hoy, "book": "5700.00"}]
    assert r.json()["opening"]["rate"] == "3.750000"
    assert c.get("/accounts").json()["have_total"] == hoy


def test_en_dolares_sin_tipo_de_cambio_no_se_puede():
    c = person()
    r = c.post("/accounts/cash", json={"name": "Sobre", "currency": "USD", "opening": {"amount": "100"}})
    assert r.status_code == 400 and r.json()["detail"] == "Falta el tipo de cambio"


def test_solo_las_monedas_que_usa():
    c = person(currencies=())
    r = c.post("/accounts/cash", json={"name": "Sobre", "currency": "EUR"})
    assert r.status_code == 400 and r.json()["detail"] == "No usas EUR. Agrégala primero a tus monedas."


def test_el_cci_de_otro_banco_lo_explica():
    c = person()
    r = c.post("/accounts/bank", json={"name": "Cuenta BCP", "currency": "PEN", "bank_id": bank_id(c, "BCP"),
                                       "cci": "01100101234567890123"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Ese CCI no es de BCP: los de BCP empiezan con 002"


def test_el_cci_tiene_20_digitos():
    c = person()
    r = c.post("/accounts/bank", json={"name": "Cuenta BCP", "currency": "PEN", "bank_id": bank_id(c, "BCP"),
                                       "cci": "0021"})
    assert r.status_code == 422


def test_mismo_nombre_y_moneda_no_se_repite():
    c = person()
    assert c.post("/accounts/cash", json={"name": "Alcancía", "currency": "PEN"}).status_code == 201
    r = c.post("/accounts/cash", json={"name": "Alcancía", "currency": "PEN"})
    assert r.status_code == 409


def test_los_montos_viajan_como_texto_exacto():
    c = person()
    r = c.post("/accounts/cash", json={"name": "Billetera", "currency": "PEN",
                                       "opening": {"amount": 0.1, "date": "2026-10-01"}})
    assert r.json()["account"]["balances"][0]["amount"] == "0.10"
    r = c.post("/accounts/cash", json={"name": "Otra", "currency": "PEN", "opening": {"amount": "1.005"}})
    assert r.status_code == 422   # más de 2 decimales


def test_plata_que_guardo_de_otros():
    c = person()
    efectivo = c.get("/accounts").json()["have"][0]["id"]
    c.put(f"/accounts/{efectivo}/opening", json={"amount": "500"})
    sandra = c.post("/partners", json={"name": "  Sandra   Machado "}).json()
    assert sandra["name"] == "Sandra Machado"
    assert c.get("/partners").json() == [sandra]

    r = c.post("/custody", json={"partner_id": sandra["id"], "currency": "PEN", "amount": "200"})
    assert r.status_code == 204, r.text
    o = c.get("/accounts").json()
    assert o["custody"] == [{"partner_id": sandra["id"], "partner_name": "Sandra Machado",
                             "balances": [{"currency": "PEN", "amount": "200.00", "base": "200.00", "book": "200.00"}],
                             "base_total": "200.00"}]
    assert (o["have_total"], o["custody_total"], o["real_total"]) == ("500.00", "200.00", "300.00")


def test_guardar_exige_un_monto_y_una_persona_propia():
    c = person()
    assert c.post("/custody", json={"partner_id": 1, "currency": "PEN", "amount": "0"}).status_code == 422
    assert c.post("/custody", json={"partner_id": 999999, "currency": "PEN", "amount": "5"}).status_code == 404


def test_renombrar_y_editar_datos_del_banco():
    c = person()
    acc = c.post("/accounts/bank", json={"name": "BCP", "currency": "PEN", "bank_id": bank_id(c, "BCP"),
                                         "cci": "00219100123456789012"}).json()["account"]["id"]
    r = c.patch(f"/accounts/{acc}", json={"name": "Cuenta sueldo", "acc_kind": "checking",
                                          "acc_number": "191-999999-0-01", "clear": ["cci"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["account"]["name"] == "Cuenta sueldo"
    assert (d["bank"]["acc_kind"], d["bank"]["acc_number"], d["bank"]["cci"]) == ("checking", "191-999999-0-01", None)


def test_archivar_solo_con_saldo_cero():
    c = person()
    acc = c.post("/accounts/cash", json={"name": "Alcancía", "currency": "PEN",
                                         "opening": {"amount": "20"}}).json()["account"]["id"]
    r = c.post(f"/accounts/{acc}/archive")
    assert r.status_code == 400 and r.json()["detail"] == "Para archivarla, su saldo tiene que estar en cero"
    c.put(f"/accounts/{acc}/opening", json={"amount": "0"})
    assert c.post(f"/accounts/{acc}/archive").status_code == 204
    assert "Alcancía" not in [a["name"] for a in c.get("/accounts").json()["have"]]


def test_las_cuentas_de_sistema_no_se_archivan():
    c = person()
    efectivo_y_sistema = c.get("/accounts").json()
    assert efectivo_y_sistema["have"][0]["name"] == "Efectivo"
    # Por clasificar no aparece con saldo cero, pero existe y es de sistema
    with psycopg.connect(owner_url()) as db:
        suspense = db.execute(
            "SELECT a.id FROM account_account a JOIN res_users u ON u.id = a.user_id"
            " WHERE a.system_role = 'suspense' ORDER BY a.id DESC LIMIT 1").fetchone()[0]
    r = c.post(f"/accounts/{suspense}/archive")
    assert r.status_code == 400 and "la usa la app" in r.json()["detail"]


def test_nadie_ve_la_cuenta_de_otro():
    ana, beto = person(), person()
    acc = ana.post("/accounts/cash", json={"name": "Secreta", "currency": "PEN"}).json()["account"]["id"]
    assert beto.get(f"/accounts/{acc}").status_code == 404
    assert beto.patch(f"/accounts/{acc}", json={"name": "mía"}).status_code == 404
    assert beto.post(f"/accounts/{acc}/archive").status_code == 404


def test_sin_sesion_no_hay_cuentas():
    assert TestClient(app).get("/accounts").status_code == 401
