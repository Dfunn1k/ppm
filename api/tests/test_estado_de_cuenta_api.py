"""El estado de cuenta de una tarjeta, con el caso de Dany (Visa Qore, ciclo que cierra el 25/10):
subtotal S/ 1,117.82 + US$ 30.84; total facturado S/ 1,120.23 (con el desgravamen de 2.41); saldo
de compras en cuotas según banco S/ 487.72; línea disponible del banco con Spotify US$ 0.60 de
después del corte."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import CORTE, DESPUES, Con

LIMITE = "7010.91"   # la línea de la prueba: con ella el banco y PPM dan la misma disponible


@pytest.fixture
def ana() -> Con:
    return Con()


def day(n: int) -> str:
    return (CORTE - timedelta(days=n)).isoformat()


def qore(ana: Con) -> tuple[int, int]:
    card = ana.card(name="Visa Qore", credit_limit=LIMITE)["account"]["id"]
    ana.buy(card, "500.00", day(20), ref="Supermercado")
    ana.buy(card, "355.80", day(12), ref="Farmacia")
    unipiel = ana.buy(card, "693.00", day(8), installments=3, installment_amount="262.02", ref="Unipiel")
    ana.buy(card, "30.84", day(5), currency="USD", rate="3.762", ref="ChatGPT")
    ana.buy(card, "0.60", DESPUES, currency="USD", rate="3.762", ref="Spotify")      # después del corte
    return card, unipiel["summary"]["id"]


def statement(ana: Con, card: int, **body) -> dict:
    r = ana.c.put(f"/cards/{card}/statements/{CORTE.isoformat()}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


BANCO = [
    {"date": day(20), "name": "SUPERMERCADOS PERUANOS", "amount": "500.00", "currency": "PEN"},
    {"date": day(11), "name": "BOTICAS INKAFARMA", "amount": "355.80", "currency": "PEN"},
    {"date": CORTE.isoformat(), "name": "UNIPIEL CUOTA 01/03", "amount": "262.02", "currency": "PEN"},
    {"date": day(4), "name": "OPENAI *CHATGPT", "amount": "30.84", "currency": "USD"},
    {"date": CORTE.isoformat(), "name": "SEGURO DESGRAVAMEN", "amount": "2.41", "currency": "PEN"},
]


def test_el_caso_qore_cuadra_y_explica_cada_diferencia(ana: Con):
    card, unipiel = qore(ana)
    r = ana.c.get(f"/cards/{card}/statements/{CORTE.isoformat()}").json()
    by = {c["currency"]: c for c in r["currencies"]}
    assert (by["PEN"]["subtotal"], by["USD"]["subtotal"]) == ("1117.82", "30.84")   # cuota 1 = 231 + 31.02
    assert r["billed"] == "1117.82"

    # El banco: el desgravamen no está en PPM; las cuotas, con el detalle del plan
    r = statement(ana, card, subtotals=[{"currency": "PEN", "amount": "1117.82"}, {"currency": "USD", "amount": "30.84"}],
                  billed="1120.23", installments="487.72", lines=BANCO)
    text = " ".join(r["explanations"])
    assert "Subtotal en S/: cuadra al céntimo." in text and "Subtotal en US$: cuadra al céntimo." in text
    assert "S/ 2.41 son cargos del banco" in text
    assert [x["name"] for x in r["lines"] if x["move_id"] is None] == ["SEGURO DESGRAVAMEN"]
    assert r["unmatched"] == []

    # Se registra el desgravamen y se corrige la cuota 1 con el detalle del banco
    ana.register(kind="expense", account_id=card, amount="2.41", date=CORTE.isoformat(), ref="Seguro de desgravamen",
                 splits=[{"category_id": ana.cat["Seguros"], "amount": "2.41"}])
    fix = ana.c.put(f"/moves/{unipiel}/installments/1", json={"principal": "221.43", "interest": "40.59"})
    assert fix.status_code == 200, fix.text
    r = ana.c.get(f"/cards/{card}/statements/{CORTE.isoformat()}").json()
    assert (r["billed"], r["bank_charges"], r["installments"]) == ("1120.23", "2.41", "471.57")
    assert "Total facturado: cuadra al céntimo." in r["explanations"]
    assert any("16.15" in e and "devengó" in e for e in r["explanations"])
    assert all(x["move_id"] is not None for x in r["lines"])

    # La línea: cuotas del banco (+16.15) y los US$ 31.44 al tipo escrito para este ciclo
    d = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": "3.80"}).json()
    assert d["line_matched"] and [(x["currency"], x["rate"], x["edited"]) for x in d["rates"]] == [("USD", "3.800000", True)]
    # PEN 855.80 + 693 + 40.59 + 2.41 = 1,591.80; cuotas del banco +16.15; US$ 31.44 × 3.80 = 119.47
    assert d["used"] == "1727.42" and d["available"] == "5283.49"
    r = statement(ana, card, available="5283.49", installments="487.72")
    assert "Línea disponible: cuadra al céntimo." in r["explanations"]


def test_sin_estado_de_cuenta_la_linea_es_estimada_y_el_tc_del_ciclo_se_edita(ana: Con):
    card, _ = qore(ana)
    d = ana.detail(card)
    assert d["line_matched"] is False
    d = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": "3.90"}).json()
    assert next(x for x in d["rates"] if x["currency"] == "USD")["rate"] == "3.900000"
    d = ana.c.put(f"/cards/{card}/rates/USD", json={"rate": None}).json()
    assert all(not x["edited"] for x in d["rates"])


def test_el_ciclo_cerrado_guarda_su_foto(ana: Con):
    card, _ = qore(ana)
    r = ana.c.get(f"/cards/{card}/statements/{CORTE.isoformat()}").json()
    first = r["used_at_closing"]
    ana.c.put(f"/cards/{card}/rates/USD", json={"rate": "4.50"})       # el TC de hoy no toca el ciclo cerrado
    assert ana.c.get(f"/cards/{card}/statements/{CORTE.isoformat()}").json()["used_at_closing"] == first
    bad = ana.c.get(f"/cards/{card}/statements/{(CORTE + timedelta(days=1)).isoformat()}")
    assert bad.status_code == 400
