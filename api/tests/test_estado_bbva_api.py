"""El estado de cuenta BBVA importado del PDF, con el caso de Dany (Visa Platinum, del 11/10/26 al
10/11/26): línea S/ 3,300, utilizada S/ 888.23, disponible S/ 2,411.77; pago total S/ 755.51 y $0.
El BBVA no imprime subtotal: se calcula con el pago total − saldo anterior (1,169.68) − intereses
del periodo anterior (7.19) − desgravamen (5.71) − pagos (−1,780) = S/ 1,352.93, que son las compras
(1,240.00) más la cuota 2/3 (112.93). El texto del PDF está anonimizado en tests/fixtures."""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from app import card_pdf
from tests.test_estado_de_cuenta_api import upload
from tests.test_movimientos_api import borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

TEXT = (Path(__file__).parent / "fixtures" / "bbva_visa_2026-11.txt").read_text()
CORTE = "2026-11-10"

COMPRAS = [("2026-10-11", "52.50"), ("2026-10-17", "35.90"), ("2026-10-19", "10.00"), ("2026-10-20", "24.90"),
           ("2026-10-21", "58.90"), ("2026-10-24", "10.70"), ("2026-10-22", "24.90"), ("2026-10-27", "19.90"),
           ("2026-10-29", "7.90"), ("2026-10-29", "19.90"), ("2026-10-31", "36.90"), ("2026-10-31", "840.00"),
           ("2026-11-01", "22.90"), ("2026-11-03", "19.90"), ("2026-11-05", "37.90"), ("2026-11-06", "16.90")]


@pytest.fixture
def ana() -> Con:
    return Con()


@pytest.fixture
def pdf(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(card_pdf, "pdf_text", lambda data, fit=False: data.decode())


def platinum(ana: Con, skip: str | None = None) -> tuple[int, int]:
    card = ana.card(name="Visa Platinum", closing_day=10, credit_limit="3300", last4="1111")["account"]["id"]
    tienda = ana.buy(card, "338.80", "2026-09-12", installments=3, ref="Tienda")
    for on, amount in COMPRAS:
        if amount != skip:
            ana.buy(card, amount, on)
    ana.register(kind="income", account_id=ana.bcp, amount="2000.00", date="2026-10-30",
                 splits=[{"category_id": ana.cat["Salario y facturas"], "amount": "2000.00"}])
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="1780.00", date="2026-10-31")
    ana.register(kind="transfer", account_id=ana.bbva, to_account_id=card, amount="76.07", currency="USD",
                 date="2026-11-04")
    return card, tienda["summary"]["id"]


def test_el_lector_bbva_lee_el_texto_del_pdf():
    p = card_pdf.parse_text(TEXT)
    assert (p.bank, p.last4, p.date_from, p.closing_date, p.date_due) == \
        ("BBVA", "1111", date(2026, 10, 11), date(2026, 11, 10), date(2026, 12, 7))
    assert (p.credit_limit, p.used, p.available) == (Decimal("3300.00"), Decimal("888.23"), Decimal("2411.77"))
    by = {c.currency: c for c in p.currencies}
    assert (by["PEN"].billed, by["PEN"].subtotal, by["PEN"].installments) == \
        (Decimal("755.51"), Decimal("1352.93"), Decimal("112.94"))
    assert (by["USD"].billed, by["USD"].subtotal) == (Decimal("0"), Decimal("0.00"))
    moves = [x for x in p.lines if x.kind == "move"]
    assert len(moves) == 17 and sum(x.amount for x in moves) == Decimal("1352.93")
    assert moves[0].name == "DLC UBER RIDES" and moves[-1].name == "Cuota 2/3 MP*TIENDA TRES"
    assert [(x.amount, x.currency) for x in p.lines if x.kind == "payment"] == \
        [(Decimal("-1780.00"), "PEN"), (Decimal("-76.07"), "USD")]
    assert [(x.name, x.amount) for x in p.lines if x.kind == "fee"] == \
        [("Intereses y gastos del periodo anterior", Decimal("7.19")), ("Seguro de desgravamen", Decimal("5.71"))]
    assert [(x.name, x.sequence, x.n_installments, x.price, x.capital, x.interest) for x in p.installments] == \
        [("MP*TIENDA TRES", 2, 3, Decimal("338.80"), Decimal("112.93"), Decimal("0"))]
    assert p.unread == []


def test_el_caso_platinum_cuadra_al_centimo(ana: Con, pdf):
    card, tienda = platinum(ana)
    r = upload(ana, card, TEXT)
    assert (r["date_from"], r["closing_date"], r["date_due"]) == ("2026-10-11", CORTE, "2026-12-07")
    assert (r["credit_limit"], r["used"], r["available"]) == ("3300.00", "888.23", "2411.77")
    by = {c["currency"]: c for c in r["currencies"]}
    assert (by["PEN"]["bank_billed"], by["PEN"]["bank_subtotal"], by["PEN"]["read"], by["PEN"]["subtotal"]) == \
        ("755.51", "1352.93", "1352.93", "1352.93")
    assert "Subtotal en S/: cuadra al céntimo." in r["explanations"]
    assert "Subtotal en US$: cuadra al céntimo." in r["explanations"]
    assert not any(e.startswith("Lectura") for e in r["explanations"])
    # Cada compra, la cuota y los dos pagos tienen su par en PPM
    assert all(x["move_id"] is not None for x in r["lines"]) and r["unmatched"] == [] and r["unread"] == []
    assert len(r["lines"]) == 19
    assert [f["name"] for f in r["fees"]] == ["Intereses y gastos del periodo anterior", "Seguro de desgravamen"]
    cuota = r["installments"][0]
    assert (cuota["sequence"], cuota["capital"], cuota["move_id"], cuota["mine"]) == (2, "112.93", tienda, True)
    d = ana.detail(card)
    assert (d["used"], d["available"], d["line_from"]) == ("888.23", "2411.77", CORTE)


def test_una_compra_que_falta_en_ppm_se_explica(ana: Con, pdf):
    card, _ = platinum(ana, skip="840.00")
    r = upload(ana, card, TEXT)
    assert "Subtotal en S/: faltan S/ 840.00 (S/ 840.00 de movimientos del banco que no están en PPM)." \
        in r["explanations"]
    assert not any(e.startswith("Lectura") for e in r["explanations"])


def test_una_linea_que_no_se_lee_no_cuadra_con_el_pago_total(ana: Con, pdf):
    card, _ = platinum(ana)
    r = upload(ana, card, TEXT.replace("S/ 35.90", "S/ 35.9O"))
    assert len(r["unread"]) == 1 and "UBER" in r["unread"][0]
    assert any(e.startswith("Lectura en S/") and "1,317.03" in e for e in r["explanations"])


def test_un_pdf_que_no_es_de_bcp_ni_de_bbva(ana: Con, pdf):
    card = ana.card(closing_day=10)["account"]["id"]
    r = upload(ana, card, "Estado de cuenta de otro banco", status=400)
    assert "Por ahora PPM lee los de tarjetas BCP, BBVA e Interbank" in r["detail"]
