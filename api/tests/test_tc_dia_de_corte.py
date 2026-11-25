"""El tipo de cambio escrito a mano el día del corte: ese día el corte de hoy ya es «el último» y el
ciclo abierto es el siguiente, así que lo escrito cuenta (antes se ignoraba hasta el otro corte)."""

from datetime import date
from decimal import Decimal

from app import card_statements
from tests.test_asientos import cur
from tests.test_cuotas_correcciones import ana  # noqa: F401
from tests.test_tarjetas import visa


def test_el_tc_escrito_el_dia_del_corte_cuenta(ana):
    ana.execute("SELECT set_config('ppm.today', '2026-11-20', false)")   # corte 20: hoy cierra
    card = visa(ana, closing_day=20)
    last = ana.execute("SELECT card_last_closing(%s, user_today())", (card,)).fetchone()[0]
    assert last == date(2026, 11, 20)
    ana.execute("INSERT INTO account_credit_card_rate (card_account_id, currency_id, rate, rate_date)"
                " VALUES (%s, %s, 3.90, user_today())", (card, cur(ana, "USD")))
    r = card_statements.open_rates(ana, card, last, today={})["USD"]
    assert (r.rate, r.edited) == (Decimal("3.900000"), True)
    # Lo escrito antes del corte era del ciclo que cerró: ya no cuenta
    assert card_statements.open_rates(ana, card, date(2026, 11, 21), today={}) == {}
