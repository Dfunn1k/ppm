"""En el detalle de la tarjeta: cada cuota con su fecha (la 1, la de la compra; las demás, el día después
del corte anterior) y una compra con la parte de otra persona se nombra con tu categoría."""

from datetime import date, timedelta

import pytest

from tests.test_movimientos_api import HOY, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

COMPRA = HOY - timedelta(days=70)


@pytest.fixture
def ana() -> Con:
    return Con()


def items(ana: Con, card: int) -> list[dict]:
    return [i for c in ana.detail(card)["cycles"] for i in c["items"]]


def test_cada_cuota_con_la_fecha_de_su_ciclo(ana: Con):
    card = ana.card()["account"]["id"]
    m = ana.buy(card, "1200.00", COMPRA.isoformat(), installments=6, ref="Televisor")
    closings = {x["sequence"]: date.fromisoformat(x["closing_date"]) for x in m["plan"]["lines"]}
    cuotas = {i["sequence"]: date.fromisoformat(i["date"]) for i in items(ana, card) if i["kind"] == "installment"}
    assert cuotas[1] == COMPRA
    for k, d in cuotas.items():
        if k > 1:
            assert d == closings[k - 1] + timedelta(days=1)            # el primer día de su ciclo


def test_la_parte_de_otra_persona_no_la_vuelve_varias_categorias(ana: Con):
    card = ana.card()["account"]["id"]
    luis = ana.c.post("/partners", json={"name": "Luis"}).json()["id"]
    ana.register(kind="expense", account_id=card, amount="60", ref="Torta",
                 splits=[{"category_id": ana.cat["Regalos"], "amount": "30"}, {"partner_id": luis, "amount": "30"}])
    torta = next(i for i in items(ana, card) if i["ref"] == "Torta")
    assert torta["counterpart"] == "Regalos"
