"""Importar extractos y Por clasificar a través de la API: leer el Excel o el CSV, la vista previa
sin guardar nada, importar, el mapeo recordado, el control de saldo, los extractos anteriores, el
archivo guardado, deshacer, la bandeja y clasificar."""

import io
import json
from datetime import timedelta
from pathlib import Path

import openpyxl
import pytest

from app.config import get_settings
from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401

D = {k: (HOY - timedelta(days=k)) for k in range(1, 9)}   # D[3] = hace 3 días
DDMM = {k: d.strftime("%d/%m/%Y") for k, d in D.items()}


def xlsx(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    for r in rows:
        wb.active.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def bcp_xlsx() -> bytes:
    """Como lo descarga el banco: un título y filas vacías antes de los encabezados (fila 5)."""
    return xlsx([
        ["Movimientos de la cuenta 191-12345678-0-12"], [], ["Del 01 al 26"], [],
        ["Fecha operación", "Descripción operación", "Monto", "Operación - Número"],
        [DDMM[2], "POS PLAZA VEA SURCO", "S/ -186.40", "06771621"],
        [DDMM[3], "YAPE A JUAN PER", -50, "004512"],
        [],
        [DDMM[4], "PLIN-MARIA LOPEZ", 120, ""],
        [DDMM[6], "APERTURA DE CUENTA", 0, ""],
    ])


class Con(Ana):
    def send(self, account_id: int, content: bytes, name: str = "movimientos.xlsx", save: bool = False,
             expect: int | None = None, **form) -> dict:
        url = f"/accounts/{account_id}/statements" + ("" if save else "/preview")
        if "columns" in form:
            form["columns"] = json.dumps(form["columns"])
        r = self.c.post(url, files={"file": (name, content)}, data=form)
        assert r.status_code == (expect or (201 if save else 200)), r.text
        return r.json()

    def classify(self, move_ids: list[int], expect: int = 204, **body) -> dict | None:
        r = self.c.post("/unclassified/classify", json={"move_ids": move_ids, **body})
        assert r.status_code == expect, r.text
        return None if expect == 204 else r.json()

    def pending(self, **params) -> list[dict]:
        return self.c.get("/unclassified", params=params).json()


@pytest.fixture
def ana() -> Con:
    return Con()


def by_ref(items: list[dict], ref: str) -> dict:
    return next(x for x in items if (x.get("payment_ref") or x.get("ref")) == ref)


# --- Leer y la vista previa ---------------------------------------------------------------------

def test_la_vista_previa_lee_el_excel_y_no_guarda_nada(ana: Con):
    p = ana.send(ana.bcp, bcp_xlsx(), balance_end="883.60")
    assert p["mapping"] == {"header_row": 5, "date_format": "DD/MM/YYYY", "decimal_separator": ".",
                            "columns": {"date": "Fecha operación", "payment_ref": "Descripción operación",
                                        "amount": "Monto", "operation_number": "Operación - Número"}}
    assert p["remembered"] is False
    assert p["counts"] == {"new": 3, "matched": 0, "duplicate": 0, "zero": 1, "problems": 0}
    assert [s["amount"] for s in p["sample"]] == ["-186.40", "-50.00", "120.00"]
    assert (p["date_from"], p["date_to"]) == (D[4].isoformat(), D[2].isoformat())
    assert p["check"] == {"source": "typed", "bank": "883.60", "book": "883.60", "difference": "0.00"}
    assert p["statement_id"] is None
    assert ana.pending() == []                                       # nada quedó guardado
    assert ana.balance(ana.bcp) == "1000.00"


def test_importar_deja_lo_nuevo_por_clasificar(ana: Con):
    r = ana.send(ana.bcp, bcp_xlsx(), save=True)
    assert r["statement_id"] and r["counts"]["new"] == 3
    items = ana.pending()
    assert [(x["payment_ref"], x["amount"]) for x in items] == [
        ("POS PLAZA VEA SURCO", "-186.40"), ("YAPE A JUAN PER", "-50.00"), ("PLIN-MARIA LOPEZ", "120.00")]
    assert by_ref(items, "POS PLAZA VEA SURCO")["operation_number"] == "06771621"
    assert ana.balance(ana.bcp) == "883.60"                          # el saldo ya es el del banco


def test_la_segunda_vez_recuerda_las_columnas_y_no_duplica(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    p = ana.send(ana.bcp, bcp_xlsx())
    assert p["remembered"] is True
    assert p["counts"]["duplicate"] == 3 and p["counts"]["new"] == 0
    r = ana.send(ana.bcp, bcp_xlsx(), save=True, expect=400)
    assert r["detail"] == "No hay nada nuevo que importar en ese archivo"


def test_lo_anotado_a_mano_se_enlaza(ana: Con):
    ana.register(kind="expense", account_id=ana.bcp, amount="186.40", date=D[3].isoformat(),
                 splits=[{"category_id": ana.cat["Supermercado y mercado"], "amount": "186.40"}])
    p = ana.send(ana.bcp, bcp_xlsx(), save=True)
    assert (p["counts"]["new"], p["counts"]["matched"]) == (2, 1)
    assert len(ana.pending()) == 2


def test_csv_con_cargo_y_abono_y_coma_decimal(ana: Con):
    csv = ("Fecha;Concepto;Cargo;Abono;Moneda\n"
           f"{DDMM[2]};COMISION MANTENIMIENTO;9,00;;S/\n"
           f"{DDMM[3]};TRANSF. DE INTERBANK;;1.000,50;S/\n"
           f"31/02/2026;FECHA MALA;5,00;;S/\n"
           f"{DDMM[4]};COMPRA EN DOLARES;10,00;;US$\n"
           ";TOTAL;19,00;1.000,50;\n").encode("cp1252")
    cols = {"date": "Fecha", "payment_ref": "Concepto", "debit": "Cargo", "credit": "Abono", "currency": "Moneda"}
    p = ana.send(ana.bcp, csv, name="ibk.csv", header_row="1", decimal_separator=",", columns=cols)
    assert p["counts"] == {"new": 2, "matched": 0, "duplicate": 0, "zero": 0, "problems": 2}
    assert [x["row"] for x in p["problems"]] == [4, 5]
    assert "31/02/2026" in p["problems"][0]["reason"] and "otra moneda" in p["problems"][1]["reason"]
    assert [s["amount"] for s in p["sample"]] == ["-9.00", "1000.50"]


def test_el_saldo_del_archivo_dice_cuanto_falta(ana: Con):
    content = xlsx([["Fecha", "Descripción", "Monto", "Saldo"],
                    [DDMM[2], "POS TOTTUS", -86.40, 904.60],      # el banco va de lo nuevo a lo viejo
                    [DDMM[3], "COMISION", -9, 991.00]])
    p = ana.send(ana.bcp, content)
    assert p["check"] == {"source": "file", "bank": "904.60", "book": "904.60", "difference": "0.00"}
    content = xlsx([["Fecha", "Descripción", "Monto", "Saldo"], [DDMM[2], "POS TOTTUS", -86.40, 895.60]])
    assert ana.send(ana.bcp, content)["check"]["difference"] == "-18.00"


def test_un_mapeo_que_no_calza_dice_que_falta(ana: Con):
    r = ana.send(ana.bcp, bcp_xlsx(), columns={"date": "Fecha operación"}, header_row="5", expect=400)
    assert r["detail"] == "Falta decir qué columna es la fecha y cuál la descripción"
    r = ana.send(ana.bcp, bcp_xlsx(), columns={"date": "Día", "payment_ref": "X", "amount": "Monto"},
                 header_row="5", expect=400)
    assert r["detail"] == "El archivo no tiene la columna «Día»"


def test_solo_a_cuentas_de_banco(ana: Con):
    r = ana.send(ana.efectivo, bcp_xlsx(), expect=400)
    assert r["detail"] == "Por ahora el extracto se importa solo a cuentas de banco"


def test_un_archivo_que_no_es_excel(ana: Con):
    r = ana.send(ana.bcp, b"PK\x03\x04no-es-un-excel", expect=400)
    assert r["detail"].startswith("No pudimos leer ese Excel")


# --- Extractos anteriores, el archivo y deshacer ------------------------------------------------

def test_el_extracto_guarda_su_archivo_y_se_puede_deshacer(ana: Con):
    content = bcp_xlsx()
    st = ana.send(ana.bcp, content, save=True, balance_end="883.60")["statement_id"]
    [row] = ana.c.get(f"/accounts/{ana.bcp}/statements").json()
    assert (row["id"], row["lines"], row["difference"]) == (st, 3, "0.00")

    f = ana.c.get(f"/statements/{st}/file")
    assert f.status_code == 200 and f.content == content
    assert "movimientos.xlsx" in f.headers["content-disposition"]

    plaza = by_ref(ana.pending(), "POS PLAZA VEA SURCO")["move_id"]
    ana.classify([plaza], account_id=ana.cat["Supermercado y mercado"])
    d = ana.c.get(f"/statements/{st}").json()
    assert (d["pending"], d["classified"], d["matched"], d["has_file"]) == (2, 1, 0, True)

    uid = ana.c.get("/me").json()["id"]
    stored = list((Path(get_settings().filestore_dir) / str(uid)).glob("??/*"))
    assert len(stored) == 1
    assert ana.c.delete(f"/statements/{st}").json() == {"deleted": 2}
    assert ana.pending() == []
    assert ana.c.get(f"/moves/{plaza}").status_code == 200           # lo clasificado se queda
    assert ana.c.get(f"/statements/{st}").status_code == 404
    assert not stored[0].exists()                                    # el archivo ya no se usa


# --- Por clasificar -----------------------------------------------------------------------------

def test_en_movimientos_sale_como_por_clasificar(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    moves = [m for d in ana.c.get("/moves", params={"month": MES, "kind": "unclassified"}).json()["days"]
             for m in d["moves"]] if D[2].strftime("%Y-%m") == MES else []
    if moves:
        plin = by_ref(moves, "PLIN-MARIA LOPEZ")
        assert (plin["kind"], plin["incoming"], plin["account"], plin["amount"]) == ("unclassified", True, "BCP", "120.00")
    m = by_ref(ana.pending(), "YAPE A JUAN PER")
    d = ana.c.get(f"/moves/{m['move_id']}").json()
    assert d["summary"]["kind"] == "unclassified" and d["summary"]["incoming"] is False
    assert [(b["payment_ref"], b["operation_number"], b["statement"]) for b in d["bank"]] == [
        ("YAPE A JUAN PER", "004512", "movimientos.xlsx")]


def test_la_cuenta_y_el_inicio_dicen_cuantos_faltan(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True, balance_end="883.60")
    acc = ana.c.get(f"/accounts/{ana.bcp}").json()
    assert acc["unclassified"] == 3
    assert (acc["last_statement"]["name"], acc["last_statement"]["difference"]) == ("movimientos.xlsx", "0.00")
    assert ana.c.get("/home", params={"month": MES}).json()["unclassified"] == 3


def test_clasificar_varios_en_una_categoria(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    items = ana.pending()
    ids = [by_ref(items, r)["move_id"] for r in ("POS PLAZA VEA SURCO", "YAPE A JUAN PER")]
    ana.classify(ids, account_id=ana.cat["Supermercado y mercado"])
    assert [x["payment_ref"] for x in ana.pending()] == ["PLIN-MARIA LOPEZ"]
    d = ana.c.get(f"/moves/{ids[0]}").json()
    assert d["summary"]["kind"] == "expense"
    assert d["summary"]["ref"] == "POS PLAZA VEA SURCO"              # la glosa empieza como la del banco


def test_clasificar_como_transferencia_a_otra_cuenta(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    plin = by_ref(ana.pending(), "PLIN-MARIA LOPEZ")["move_id"]
    ana.classify([plin], account_id=ana.efectivo)
    assert ana.c.get(f"/moves/{plin}").json()["summary"]["kind"] == "transfer"
    assert ana.balance(ana.efectivo) == "380.00"


def test_le_preste_a_juan_y_me_pago_sin_pasarse(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    juan = ana.c.post("/partners", json={"name": "Juan Pérez"}).json()["id"]
    items = ana.pending()
    yape, plin = by_ref(items, "YAPE A JUAN PER")["move_id"], by_ref(items, "PLIN-MARIA LOPEZ")["move_id"]
    ana.classify([yape], role="receivable", partner_id=juan)
    assert ana.c.get(f"/moves/{yape}").json()["summary"]["kind"] == "lend"
    r = ana.classify([plin], role="receivable", partner_id=juan, expect=400)      # entraron 120, debe 50
    assert r["detail"].startswith("Juan te debe S/ 50.00")
    assert [x["payment_ref"] for x in ana.pending()] == ["POS PLAZA VEA SURCO", "PLIN-MARIA LOPEZ"]


def test_con_una_persona_hay_que_decir_con_quien(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    yape = by_ref(ana.pending(), "YAPE A JUAN PER")["move_id"]
    assert ana.classify([yape], role="receivable", expect=400)["detail"] == "Elige con quién"
    assert ana.classify([yape], expect=400)["detail"] == "Elige en qué fue: una categoría, una cuenta o una persona"


def test_a_una_cuenta_en_dolares_no_se_clasifica(ana: Con):
    ana.send(ana.bcp, bcp_xlsx(), save=True)
    yape = by_ref(ana.pending(), "YAPE A JUAN PER")["move_id"]
    r = ana.classify([yape], account_id=ana.bbva, expect=400)
    assert "otra moneda" in r["detail"]


# --- Aislamiento --------------------------------------------------------------------------------

def test_nadie_ve_ni_deshace_los_extractos_de_otro(ana: Con):
    st = ana.send(ana.bcp, bcp_xlsx(), save=True)["statement_id"]
    beto = Con()
    assert beto.pending() == []
    assert beto.c.get(f"/statements/{st}").status_code == 404
    assert beto.c.get(f"/statements/{st}/file").status_code == 404
    assert beto.c.delete(f"/statements/{st}").status_code == 404
    assert beto.c.get(f"/accounts/{ana.bcp}/statements").status_code == 404
    yape = by_ref(ana.pending(), "YAPE A JUAN PER")["move_id"]
    assert beto.classify([yape], account_id=beto.cat["Hogar"], expect=404)
