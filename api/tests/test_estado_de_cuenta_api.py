"""El estado de cuenta de una tarjeta, importado del PDF, con el caso de Dany (Visa Qore, ciclo del
28/09/26 al 25/10/26): crédito disponible S/ 5,283.53 y línea utilizada S/ 1,716.47; total facturado
S/ 1,120.23 (con el desgravamen de 2.41) + US$ 30.84; cuota 1/3 de Unipiel = 221.43 + 40.59.

El PDF se reemplaza por su texto extraído y anonimizado (tests/fixtures): la prueba no depende de
pdfplumber, que se prueba aparte con el lector."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app import card_pdf
from tests.test_movimientos_api import borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

TEXT = (Path(__file__).parent / "fixtures" / "bcp_visa_2026-10.txt").read_text()
CORTE = "2026-10-25"

PEN = [("2026-10-03", "22.30"), ("2026-10-04", "16.00"), ("2026-10-06", "126.00"), ("2026-10-08", "266.30"),
       ("2026-10-07", "49.80"), ("2026-10-09", "98.60"), ("2026-10-10", "97.00"), ("2026-10-13", "19.90"),
       ("2026-10-16", "79.90"), ("2026-10-17", "80.00")]
USD = [("2026-10-12", "6.83"), ("2026-10-17", "24.01")]


@pytest.fixture
def ana() -> Con:
    return Con()


@pytest.fixture
def pdf(monkeypatch: pytest.MonkeyPatch):
    """El «PDF» que se sube es su texto: así se puede cambiar una línea en cada prueba."""
    monkeypatch.setattr(card_pdf, "pdf_text", lambda data, fit=False: data.decode())


def qore(ana: Con) -> tuple[int, int]:
    card = ana.card(name="Visa Qore", closing_day=25, credit_limit="7010.91", last4="1111")["account"]["id"]
    for on, amount in PEN:
        ana.buy(card, amount, on)
    for on, amount in USD:
        ana.buy(card, amount, on, currency="USD", rate="3.500")
    unipiel = ana.buy(card, "693.00", "2026-10-14", installments=3, installment_amount="262.02", ref="Unipiel")
    return card, unipiel["summary"]["id"]


def upload(ana: Con, card: int, text: str = TEXT, status: int = 201) -> dict:
    r = ana.c.post(f"/cards/{card}/statements", files={"file": ("EECC_VISA.pdf", text.encode(), "application/pdf")})
    assert r.status_code == status, r.text
    return r.json()


def test_el_caso_qore_toma_la_foto_del_banco_y_divide_la_cuota(ana: Con, pdf):
    card, unipiel = qore(ana)
    assert ana.c.get(f"/cards/{card}/statements/{CORTE}").status_code == 404

    r = upload(ana, card)
    assert (r["date_from"], r["closing_date"], r["date_due"]) == ("2026-09-28", CORTE, "2026-11-23")
    assert (r["credit_limit"], r["used"], r["available"]) == ("7000.00", "1716.47", "5283.53")
    by = {c["currency"]: c for c in r["currencies"]}
    assert (by["PEN"]["bank_billed"], by["USD"]["bank_billed"], by["PEN"]["bank_installments"]) == \
        ("1120.23", "30.84", "487.72")
    assert (by["PEN"]["read"], by["PEN"]["subtotal"], by["USD"]["read"], by["USD"]["subtotal"]) == \
        ("1117.82", "1117.82", "30.84", "30.84")
    assert "Subtotal en S/: cuadra al céntimo." in r["explanations"]
    assert "Subtotal en US$: cuadra al céntimo." in r["explanations"]
    assert any("Cargos del banco en S/" in e and "2.41" in e for e in r["explanations"])
    assert [(f["name"], f["amount"]) for f in r["fees"]] == [("Gasto mensual por seguro de desgravamen", "2.41")]
    assert all(x["move_id"] is not None for x in r["lines"]) and r["unmatched"] == [] and r["unread"] == []
    cuota = r["installments"][0]
    assert (cuota["capital"], cuota["interest"], cuota["move_id"], cuota["mine"]) == ("221.43", "40.59", unipiel, True)

    # La cuota 1/3: capital a su categoría e interés a Intereses
    month = ana.c.get("/moves", params={"month": "2026-10"}).json()
    m = next(m for day in month["days"] for m in day["moves"] if (m["ref"], m["part"], m["parts"]) == ("Unipiel", 1, 3))
    assert (m["kind"], m["amount"]) == ("expense", "262.02")
    assert sorted(c["name"] for c in m["categories"]) == ["Hogar", "Intereses"]
    plan = ana.c.get(f"/moves/{unipiel}").json()["plan"]
    assert [x["interest"] for x in plan["lines"]] == ["40.59", None, None]

    # La línea: la foto del banco (la línea de crédito se corrige a 7,000) y lo de después
    d = ana.detail(card)
    assert (d["credit_limit"], d["used"], d["available"], d["line_from"]) == ("7000.00", "1716.47", "5283.53", CORTE)
    assert d["line_matched"] is (d["last_closing"] == CORTE)
    assert next(c for c in d["cycles"] if c["closing_date"] == CORTE)["statement"] is True
    rate = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": "3.50"}).json()
    ana.buy(card, "0.60", "2026-10-26", currency="USD", rate="3.500", ref="Spotify")          # después del corte
    ana.buy(card, "300.00", "2026-10-27", installments=3, installment_amount="110", ref="Silla")   # ocupa su precio
    d = ana.detail(card)
    if any(x["currency"] == "USD" and x["edited"] for x in rate["rates"]):
        assert (d["used"], d["available"]) == ("2018.57", "4981.43")    # 1,716.47 + 2.10 + 300
    assert d["line_matched"] is False


def test_importarlo_de_nuevo_lo_reemplaza(ana: Con, pdf):
    card, _ = qore(ana)
    upload(ana, card)
    r = upload(ana, card)
    assert len(r["installments"]) == 1 and len(r["lines"]) == 13


def test_las_fechas_del_banco_mandan_sobre_el_dia_de_corte(ana: Con, pdf):
    """El ciclo empieza el 28/09: una compra del 26/09 era del ciclo que cerró el 27/09."""
    card, _ = qore(ana)
    ana.buy(card, "50.00", "2026-09-26", ref="Antes del ciclo")
    upload(ana, card)
    cycles = {c["closing_date"]: c for c in ana.detail(card)["cycles"]}
    assert [i["ref"] for i in cycles["2026-09-27"]["items"]] == ["Antes del ciclo"]
    assert "Antes del ciclo" not in [i["ref"] for i in cycles[CORTE]["items"]]


def test_una_linea_que_no_se_lee_se_muestra(ana: Con, pdf):
    card, _ = qore(ana)
    r = upload(ana, card, TEXT.replace("05Oct  03Oct BODEGA", "05Oct  O3Oct BODEGA"))
    assert len(r["unread"]) == 1 and "BODEGA UNO" in r["unread"][0]
    by = {c["currency"]: c for c in r["currencies"]}
    assert by["PEN"]["read"] == "1095.52"
    assert any(e.startswith("Lectura en S/") and "1,095.52" in e and "no se pudieron leer" in e
               for e in r["explanations"])


def test_la_cuota_de_otra_persona_no_se_divide(ana: Con, pdf):
    card = ana.card(name="Visa Qore", closing_day=25, last4="1111")["account"]["id"]
    who = ana.c.post("/partners", json={"name": "Damaris"}).json()["id"]
    ana.register(kind="lend", account_id=card, amount="693.00", partner_id=who, installments=3,
                 installment_amount="262.02", ref="Unipiel", date="2026-10-14")
    r = upload(ana, card)
    assert (r["installments"][0]["mine"], r["installments"][0]["move_id"] is not None) == (False, True)
    owes = ana.c.get(f"/partners/{who}").json()["owes_me"]
    assert [x["open"] for x in owes] == ["262.02"] * 3


def test_el_estado_de_otra_tarjeta_no_entra(ana: Con, pdf):
    card = ana.card(closing_day=25, last4="4417")["account"]["id"]
    r = upload(ana, card, status=400)
    assert r["detail"] == "Ese estado de cuenta es de la tarjeta •••• 1111, no de esta (•••• 4417)"


def test_un_pdf_que_no_es_de_bcp(ana: Con, pdf):
    card = ana.card(closing_day=25)["account"]["id"]
    r = upload(ana, card, "Estado de cuenta de otro banco", status=400)
    assert "Por ahora PPM lee los de tarjetas BCP y BBVA" in r["detail"]


def test_sin_estado_de_cuenta_la_linea_es_estimada_y_el_tc_del_ciclo_se_edita(ana: Con):
    card, _ = qore(ana)
    d = ana.detail(card)
    assert d["line_matched"] is False and d["line_from"] is None
    d = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": "3.90"}).json()
    assert next(x for x in d["rates"] if x["currency"] == "USD")["rate"] == "3.900000"
    d = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": None}).json()
    assert all(not x["edited"] for x in d["rates"])


def test_el_lector_bcp_lee_un_pdf_de_letra_chica():
    """El mismo estado impreso por el navegador en letra de 7 px: los dólares siguen en su columna."""
    data = (Path(__file__).parent / "fixtures" / "bcp_visa_2026-10_letra_chica.pdf").read_bytes()
    p = card_pdf.parse_pdf(data)
    by = {c.currency: c for c in p.currencies}
    assert (by["PEN"].subtotal, by["PEN"].billed) == (Decimal("1117.82"), Decimal("1120.23"))
    assert (by["USD"].subtotal, by["USD"].billed) == (Decimal("30.84"), Decimal("30.84"))
    moves = [x for x in p.lines if x.kind == "move"]
    assert sum(x.amount for x in moves if x.currency == "USD") == Decimal("30.84") and p.unread == []


def test_el_lector_bcp_lee_el_texto_del_pdf():
    p = card_pdf.parse_text(TEXT)
    assert (p.bank, p.last4, p.date_from, p.closing_date) == ("BCP", "1111", date(2026, 9, 28), date(2026, 10, 25))
    moves = [x for x in p.lines if x.kind == "move"]
    assert len(moves) == 13 and sum(x.amount for x in moves if x.currency == "USD") == Decimal("30.84")
    assert moves[-1].name == "CUOTA DEL MES" and moves[0].name == "BODEGA UNO LIMA"
    assert [(x.name, x.sequence, x.n_installments, x.capital, x.interest) for x in p.installments] == \
        [("TIENDA CUOTAS", 1, 3, Decimal("221.43"), Decimal("40.59"))]


# --- La cuota del banco es distinta (0027) ----------------------------------------------------

def unipiel_sin_cuota(ana: Con) -> tuple[int, int]:
    """Unipiel registrada sin escribir la cuota: en PPM son 3 × S/ 231.00, el banco cobra 262.02."""
    card = ana.card(name="Visa Qore", closing_day=25, credit_limit="7010.91", last4="1111")["account"]["id"]
    m = ana.buy(card, "693.00", "2026-10-14", installments=3, ref="Unipiel")
    return card, m["summary"]["id"]


def test_la_cuota_del_banco_distinta_se_avisa_y_se_usa(ana: Con, pdf):
    card, unipiel = unipiel_sin_cuota(ana)
    r = upload(ana, card)
    inst = r["installments"][0]
    assert inst["move_id"] is None
    assert inst["differs"] == {"plan_id": inst["differs"]["plan_id"], "move_id": unipiel, "ref": "Unipiel", "each": "231.00"}

    r = ana.c.post(f"/cards/{card}/statements/{CORTE}/installments/{inst['id']}/use-bank")
    assert r.status_code == 200, r.text
    inst = r.json()["installments"][0]
    assert (inst["move_id"], inst["mine"], inst["differs"]) == (unipiel, True, None)
    plan = ana.c.get(f"/moves/{unipiel}").json()["plan"]
    assert (plan["principal"], plan["installment_amount"], plan["price"]) == ("786.06", "262.02", "693.00")
    assert [x["principal"] for x in plan["lines"]] == ["262.02"] * 3
    assert (plan["lines"][0]["interest"], plan["lines"][1]["interest"]) == ("40.59", None)
    assert next(s for s in ana.detail(card)["status"] if s["currency"] == "PEN")["total_debt"] == "786.06"


def test_no_es_esta_compra(ana: Con, pdf):
    card, _ = unipiel_sin_cuota(ana)
    inst = upload(ana, card)["installments"][0]
    r = ana.c.post(f"/cards/{card}/statements/{CORTE}/installments/{inst['id']}/reject",
                   json={"plan_id": inst["differs"]["plan_id"]})
    assert r.status_code == 200, r.text
    assert r.json()["installments"][0]["differs"] is None
    r = ana.c.post(f"/cards/{card}/statements/{CORTE}/installments/{inst['id']}/use-bank")
    assert r.status_code == 400 and r.json()["detail"] == "No encontramos una compra tuya para esa cuota"


def test_si_la_cuota_cuadra_no_hay_aviso(ana: Con, pdf):
    card, _ = qore(ana)
    assert upload(ana, card)["installments"][0]["differs"] is None


def test_tras_usar_la_del_banco_el_ciclo_cuadra(ana: Con, pdf):
    """El caso Qore completo, pero con Unipiel registrada sin cuota: tras «Usar la del banco», el
    subtotal en soles cuadra al céntimo y la cuota queda emparejada."""
    card = ana.card(name="Visa Qore", closing_day=25, credit_limit="7010.91", last4="1111")["account"]["id"]
    for on, amount in PEN:
        ana.buy(card, amount, on)
    for on, amount in USD:
        ana.buy(card, amount, on, currency="USD", rate="3.500")
    ana.buy(card, "693.00", "2026-10-14", installments=3, ref="Unipiel")
    r = upload(ana, card)
    assert "Subtotal en S/: cuadra al céntimo." not in r["explanations"]
    inst = r["installments"][0]
    r = ana.c.post(f"/cards/{card}/statements/{CORTE}/installments/{inst['id']}/use-bank").json()
    assert "Subtotal en S/: cuadra al céntimo." in r["explanations"]
    assert not [x for x in r["lines"] if x["move_id"] is None]


# --- Cierre de periodo (0028) -----------------------------------------------------------------

def test_un_pdf_que_llega_despues_del_cierre_no_divide_la_cuota(ana: Con, pdf):
    """Se cerró octubre antes de importar el corte del 25 oct: la foto queda y la cuota de Unipiel no
    se divide; la conciliación dice qué hacer."""
    card, unipiel = qore(ana)
    r = ana.c.put("/closing", json={"lock_date": "2026-10-31"})
    assert r.status_code == 200, r.text
    r = upload(ana, card)
    assert r["used"] == "1716.47"
    assert r["installments"][0]["not_split"] is True
    assert ana.c.get(f"/moves/{unipiel}").json()["plan"]["lines"][0]["interest"] is None

    assert ana.c.put("/closing", json={"lock_date": None}).status_code == 200
    r = upload(ana, card)
    assert r["installments"][0]["not_split"] is False
