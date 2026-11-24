"""El estado de cuenta Interbank importado del PDF (Visa Clásica, del 21/10/26 al 20/11/26): línea
S/ 2,600, disponible S/ 714.74, deuda total S/ 1,892.35; pago del mes S/ 1,811.70, que es la suma de
los subtotales: pagos −43.00 (lo que debías, 1,650.58, menos lo pagado, 1,693.58), consumos 1,766.94,
la cuota 5/6 (80.67) y el desgravamen (7.09). Lo que suma PPM, consumos más la cuota, es S/ 1,847.61.
El texto del PDF está anonimizado en tests/fixtures."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app import card_pdf
from tests.test_estado_de_cuenta_api import upload
from tests.test_movimientos_api import borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

TEXT = (Path(__file__).parent / "fixtures" / "interbank_visa_2026-11.txt").read_text()
CORTE = "2026-11-20"

CONSUMOS = [("2026-10-21", "268.00"), ("2026-10-22", "50.00"), ("2026-10-23", "92.09"), ("2026-10-26", "50.00"),
            ("2026-10-27", "78.00"), ("2026-10-28", "59.90"), ("2026-10-28", "149.90"), ("2026-10-31", "154.80"),
            ("2026-10-31", "79.90"), ("2026-10-31", "36.90"), ("2026-11-05", "40.00"), ("2026-11-06", "125.00"),
            ("2026-11-06", "15.90"), ("2026-11-06", "72.48"), ("2026-11-06", "131.87"), ("2026-11-08", "49.80"),
            ("2026-11-12", "18.90"), ("2026-11-13", "22.90"), ("2026-11-13", "17.90"), ("2026-11-13", "14.90"),
            ("2026-11-13", "6.90"), ("2026-11-15", "3.00"), ("2026-11-15", "15.90"), ("2026-11-19", "212.00")]
PAGOS = [("2026-10-28", "268.00"), ("2026-10-30", "1084.50"), ("2026-10-31", "86.50"), ("2026-10-31", "73.50"),
         ("2026-11-12", "138.08"), ("2026-11-16", "30.00"), ("2026-11-19", "13.00")]


@pytest.fixture
def ana() -> Con:
    return Con()


@pytest.fixture
def pdf(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(card_pdf, "pdf_text", lambda data, fit=False: data.decode())


def clasica(ana: Con, skip: str | None = None) -> tuple[int, int]:
    card = ana.card(name="Visa Clásica", closing_day=20, credit_limit="2600", last4="1111")["account"]["id"]
    plan = ana.buy(card, "484.00", "2026-06-24", installments=6, ref="Mercado Pago")
    for on, amount in CONSUMOS:
        if amount != skip:
            ana.buy(card, amount, on)
    ana.register(kind="income", account_id=ana.bcp, amount="2000.00", date="2026-10-27",
                 splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "2000.00"}])
    for on, amount in PAGOS:
        ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount=amount, date=on)
    return card, plan["summary"]["id"]


def test_el_lector_interbank_lee_el_texto_del_pdf():
    p = card_pdf.parse_text(TEXT)
    assert (p.bank, p.last4, p.date_from, p.closing_date, p.date_due) == \
        ("Interbank", "1111", date(2026, 10, 21), date(2026, 11, 20), date(2026, 12, 15))
    assert (p.credit_limit, p.used, p.available) == (Decimal("2600.00"), Decimal("1892.35"), Decimal("714.74"))
    by = {c.currency: c for c in p.currencies}
    assert (by["PEN"].billed, by["PEN"].subtotal, by["PEN"].installments) == \
        (Decimal("1811.70"), Decimal("1847.61"), Decimal("80.65"))
    assert (by["USD"].billed, by["USD"].subtotal) == (Decimal("0.00"), Decimal("0.00"))
    moves = [x for x in p.lines if x.kind == "move"]
    assert len(moves) == 25 and sum(x.amount for x in moves) == Decimal("1847.61")
    assert (moves[0].date, moves[0].name) == (date(2026, 10, 21), "MDOPAGO*FREEPASS")
    assert (moves[-1].date, moves[-1].name, moves[-1].amount) == \
        (date(2026, 11, 20), "Cuota 5/6 MDOPAGO*MDOPAGO", Decimal("80.67"))
    pagos = [x for x in p.lines if x.kind == "payment"]
    assert len(pagos) == 7 and sum(x.amount for x in pagos) == Decimal("-1693.58")
    assert all(x.currency == "PEN" and x.name == "PAGO TARJ WEB APP" for x in pagos)
    assert [(x.name, x.amount, x.currency) for x in p.lines if x.kind == "fee"] == \
        [("Seguro desgravamen", Decimal("7.09"), "PEN")]
    assert [(x.date, x.name, x.sequence, x.n_installments, x.price, x.capital, x.interest, x.total)
            for x in p.installments] == \
        [(date(2026, 6, 24), "MDOPAGO*MDOPAGO", 5, 6, Decimal("484.00"), Decimal("80.67"), Decimal("0.00"),
          Decimal("80.67"))]
    assert p.unread == []


def test_una_compra_de_otro_anio_toma_el_anio_anterior():
    # Un corte de enero con una compra en cuotas de junio: la compra fue el año anterior
    text = TEXT.replace("del 21/10/2026 al cierre de 20/11/2026", "del 21/12/2026 al cierre de 20/01/2027")
    p = card_pdf.parse_text(text)
    assert p.closing_date == date(2027, 1, 20)
    assert p.installments[0].date == date(2026, 6, 24)


def test_el_caso_clasica_cuadra_al_centimo(ana: Con, pdf):
    card, plan = clasica(ana)
    r = upload(ana, card, TEXT)
    assert (r["date_from"], r["closing_date"], r["date_due"]) == ("2026-10-21", CORTE, "2026-12-15")
    assert (r["credit_limit"], r["used"], r["available"]) == ("2600.00", "1892.35", "714.74")
    by = {c["currency"]: c for c in r["currencies"]}
    assert (by["PEN"]["bank_billed"], by["PEN"]["bank_subtotal"], by["PEN"]["read"], by["PEN"]["subtotal"]) == \
        ("1811.70", "1847.61", "1847.61", "1847.61")
    assert "Subtotal en S/: cuadra al céntimo." in r["explanations"]
    assert not any(e.startswith("Lectura") for e in r["explanations"])
    # Cada consumo, la cuota y los siete pagos tienen su par en PPM
    assert all(x["move_id"] is not None for x in r["lines"]) and r["unmatched"] == [] and r["unread"] == []
    assert len(r["lines"]) == 32
    assert [f["name"] for f in r["fees"]] == ["Seguro desgravamen"]
    cuota = r["installments"][0]
    assert (cuota["sequence"], cuota["capital"], cuota["move_id"], cuota["mine"]) == (5, "80.67", plan, True)


def test_un_consumo_que_falta_en_ppm_se_explica(ana: Con, pdf):
    card, _ = clasica(ana, skip="212.00")
    r = upload(ana, card, TEXT)
    assert "Subtotal en S/: faltan S/ 212.00 (S/ 212.00 de movimientos del banco que no están en PPM)." \
        in r["explanations"]


def test_una_linea_que_no_se_lee_no_cuadra_con_el_subtotal(ana: Con, pdf):
    card, _ = clasica(ana)
    r = upload(ana, card, TEXT.replace("125.00 0.00", "125.O0 0.00"))
    assert len(r["unread"]) == 1 and "PLIN.BODEGA" in r["unread"][0]
    assert any(e.startswith("Lectura en S/") for e in r["explanations"])
