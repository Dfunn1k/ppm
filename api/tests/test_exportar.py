"""Exportar mis datos: un ZIP con datos.json (todas las tablas de la persona, fiel al modelo),
csv/ (una tabla por archivo, con nombres en vez de ids) y adjuntos/. Solo lo suyo, sin la huella de
la contraseña, con o sin adjuntos."""

import csv
import io
import json
import zipfile

from tests.test_adjuntos_api import JPG, subir
from tests.test_movimientos_api import HOY, Ana, borrar_usuarios_de_prueba  # noqa: F401


def bajar(ana: Ana, **params) -> zipfile.ZipFile:
    r = ana.c.get("/me/export/zip", params=params)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] == f'attachment; filename="ppm-{HOY.isoformat()}.zip"'
    return zipfile.ZipFile(io.BytesIO(r.content))


def hoja(z: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    raw = z.read(f"csv/{name}.csv")
    assert raw.startswith(b"\xef\xbb\xbf")          # con BOM, para que Excel lea las tildes
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))


def test_el_zip_trae_todo_lo_suyo_y_nada_de_otra_persona():
    ana, otra = Ana(), Ana()
    m = ana.register(kind="expense", account_id=ana.bcp, amount="40.50", date=HOY.isoformat(), ref="Almuerzo",
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "40.50"}])["summary"]["id"]
    subir(ana, m, JPG, "boleta: marzo.jpg")
    otra.register(kind="expense", account_id=otra.bcp, amount="99", date=HOY.isoformat(), ref="De la otra",
                  splits=[{"category_id": otra.cat["Hogar"], "amount": "99"}])

    s = ana.c.get("/me/export").json()
    assert (s["accounts"], s["attachments"], s["attachments_bytes"]) == (3, 1, len(JPG))
    assert s["moves"] >= 4 and s["categories"] > 0

    z = bajar(ana)
    names = set(z.namelist())
    assert {"LEEME.txt", "datos.json", "csv/cuentas.csv", "csv/categorias.csv", "csv/movimientos.csv",
            "csv/personas.csv", "csv/recurrentes.csv", "csv/tipos_de_cambio.csv", "csv/adjuntos.csv"} <= names

    data = json.loads(z.read("datos.json"))
    assert (data["formato"], data["version"], data["con_adjuntos"]) == ("ppm-exportacion", 1, True)
    t = data["tablas"]
    uid = ana.c.get("/me").json()["id"]
    assert [u["id"] for u in t["res_users"]] == [uid] and "password" not in t["res_users"][0]
    assert all(r["user_id"] == uid for name, rows in t.items() if name != "res_users" for r in rows)
    assert len(t["account_move"]) == s["moves"] and not any(x["ref"] == "De la otra" for x in t["account_move"])
    assert {"res_currency", "res_bank", "res_country", "res_lang"} <= set(data["catalogos"])
    line = next(x for x in t["account_move_line"] if x["move_id"] == m and x["account_id"] == ana.bcp)
    assert line["balance"] == "-40.50"               # los montos como texto, con punto decimal

    cuentas = {r["nombre"]: r for r in hoja(z, "cuentas")}
    assert (cuentas["BCP"]["tipo"], cuentas["BCP"]["moneda"], cuentas["BCP"]["saldo"]) == \
        ("Cuenta bancaria", "PEN", "959.50")
    assert (cuentas["BBVA $"]["moneda"], cuentas["BBVA $"]["saldo"]) == ("USD", "200.00")
    movs = [r for r in hoja(z, "movimientos") if r["movimiento"] == str(m)]
    assert {(r["cuenta o categoría"], r["monto"]) for r in movs} == {("BCP", "-40.50"), ("Hogar", "40.50")}
    assert movs[0]["fecha"] == HOY.isoformat() and movs[0]["referencia"] == "Almuerzo"
    assert any(r["nombre"] == "Hogar" and r["tipo"] == "Gasto" for r in hoja(z, "categorias"))

    a = t["ir_attachment"][0]
    assert z.read(f"adjuntos/{a['id']}-boleta_ marzo.jpg") == JPG      # «:» no vale en un nombre de Windows


def test_sin_adjuntos_solo_quedan_sus_fichas():
    ana = Ana()
    m = ana.register(kind="expense", account_id=ana.bcp, amount="10", date=HOY.isoformat(),
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "10"}])["summary"]["id"]
    subir(ana, m, JPG, "boleta.jpg")
    z = bajar(ana, attachments="false")
    assert not any(n.startswith("adjuntos/") for n in z.namelist())
    data = json.loads(z.read("datos.json"))
    assert data["con_adjuntos"] is False and [x["name"] for x in data["tablas"]["ir_attachment"]] == ["boleta.jpg"]
    assert [r["nombre"] for r in hoja(z, "adjuntos")] == ["boleta.jpg"]


def test_sin_sesion_no_se_exporta():
    from fastapi.testclient import TestClient

    from app.main import app
    c = TestClient(app)
    assert c.get("/me/export").status_code == 401
    assert c.get("/me/export/zip").status_code == 401
