"""Tarjetas: ciclos de corte, fecha de pago, cuotas y el estado de la tarjeta (migración 0014)."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, commit_check, cur, move

HOY = date(2026, 10, 26)   # el último corte fue el 20 oct; el próximo es el 20 nov


@pytest.fixture
def ana(new_user, as_user):
    """Ana, configurada en Perú con dólares; la conexión trabaja como ella."""
    uid = new_user("ana@correo.com", "Ana")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")
    return c


def visa(c, closing_day=20, limit="5000") -> int:
    return c.execute("SELECT create_credit_card('Visa BBVA', %s, %s, NULL, 'Visa', '4417')",
                     (closing_day, Decimal(limit))).fetchone()[0]


def bcp(c) -> int:
    return c.execute("SELECT create_cash_account('Cuenta BCP', %s, 5000, '2026-09-01')",
                     (cur(c, "PEN"),)).fetchone()[0]


def buy(c, card, amount, when, currency="PEN", rate="1") -> int:
    """Una compra con la tarjeta: Debe un gasto / Haber la tarjeta."""
    amt, cid = Decimal(amount), cur(c, currency)
    base = (amt * Decimal(rate)).quantize(Decimal("0.01"))
    return move(c, [(account(c, "Hogar"), base, 0, cur(c, "PEN"), base), (card, 0, base, cid, -amt)], date=when)


def pay(c, bank, card, amount, when) -> int:
    amt = Decimal(amount)
    return move(c, [(card, amt, 0, cur(c, "PEN"), amt), (bank, 0, amt, cur(c, "PEN"), -amt)], date=when)


def status(c, card, currency="PEN", today=HOY) -> dict:
    row = c.execute(
        "SELECT last_closing, next_closing, date_due, total_debt, unbilled, to_pay"
        " FROM credit_card_status(%s) WHERE account_id = %s AND currency_id = %s",
        (today, card, cur(c, currency))).fetchone()
    return dict(zip(["last", "next", "due", "debt", "unbilled", "to_pay"], row))


def plan_lines(c, plan) -> list[tuple]:
    return c.execute("SELECT sequence, closing_date, principal FROM account_installment_plan_line"
                     " WHERE plan_id = %s ORDER BY sequence", (plan,)).fetchall()


# --- Alta y ciclos ----------------------------------------------------------------------------

def test_la_tarjeta_es_una_cuenta_de_pasivo_multimoneda(ana):
    card = visa(ana)
    kind, currency, icon = ana.execute(
        "SELECT account_type, currency_id, icon FROM account_account WHERE id = %s", (card,)).fetchone()
    assert (kind, currency, icon) == ("liability", None, "credit_card")
    limit, limit_cur = ana.execute(
        "SELECT credit_limit, limit_currency_id FROM account_credit_card WHERE account_id = %s", (card,)).fetchone()
    assert (limit, limit_cur) == (Decimal("5000.00"), cur(ana, "PEN"))


def test_solo_los_ultimos_4_digitos(ana):
    with pytest.raises(psycopg.errors.DataError):
        ana.execute("SELECT create_credit_card('Visa', 20, 5000, NULL, 'Visa', '4417 1234')")


@pytest.mark.parametrize(("when", "closing"), [
    ("2026-09-25", "2026-10-20"),   # después del corte: el próximo
    ("2026-10-20", "2026-10-20"),   # el día del corte entra en ese ciclo
    ("2026-10-05", "2026-10-20"),
])
def test_el_corte_que_le_toca_a_una_compra(ana, when, closing):
    card = visa(ana)
    assert ana.execute("SELECT card_closing_for(%s, %s)", (card, when)).fetchone()[0] == date.fromisoformat(closing)


def test_corte_31_en_febrero_es_el_ultimo_dia(ana):
    card = visa(ana, closing_day=31)
    assert ana.execute("SELECT card_closing_for(%s, '2027-02-10')", (card,)).fetchone()[0] == date(2027, 2, 28)
    assert ana.execute("SELECT card_last_closing(%s, '2027-03-10')", (card,)).fetchone()[0] == date(2027, 2, 28)


def test_la_fecha_de_pago_se_copia_del_estado_de_cuenta(ana):
    card = visa(ana)
    assert status(ana, card)["due"] is None                     # sin fecha hasta que la escribas
    ana.execute("SELECT set_card_due_date(%s, '2026-10-20', '2026-11-05')", (card,))
    assert status(ana, card)["due"] == date(2026, 11, 5)
    ana.execute("SELECT set_card_due_date(%s, '2026-10-20', '2026-11-04')", (card,))   # se corrige
    assert status(ana, card)["due"] == date(2026, 11, 4)


def test_la_fecha_de_pago_va_despues_de_un_corte(ana):
    card = visa(ana)
    with pytest.raises(psycopg.errors.CheckViolation, match="no es un día de corte"), ana.transaction():
        ana.execute("SELECT set_card_due_date(%s, '2026-10-19', '2026-11-05')", (card,))
    with pytest.raises(psycopg.errors.CheckViolation, match="después del corte"), ana.transaction():
        ana.execute("SELECT set_card_due_date(%s, '2026-10-20', '2026-10-20')", (card,))


# --- Estado de la tarjeta ---------------------------------------------------------------------

def test_lo_del_ultimo_estado_de_cuenta_queda_a_pagar(ana):
    card = visa(ana)
    ana.execute("SELECT post_card_opening(%s, %s, 1284.90, 1, %s)", (card, cur(ana, "PEN"), HOY))
    commit_check(ana)
    s = status(ana, card)
    assert (s["last"], s["next"]) == (date(2026, 10, 20), date(2026, 11, 20))
    assert (s["debt"], s["unbilled"], s["to_pay"]) == (Decimal("1284.90"), 0, Decimal("1284.90"))


def test_las_compras_despues_del_corte_estan_por_facturar(ana):
    card, bank = visa(ana), bcp(ana)
    buy(ana, card, "900.00", "2026-10-12")      # ciclo que cerró el 20 oct
    buy(ana, card, "145.80", "2026-10-24")      # ciclo actual
    s = status(ana, card)
    assert (s["debt"], s["unbilled"], s["to_pay"]) == (Decimal("1045.80"), Decimal("145.80"), Decimal("900.00"))

    pay(ana, bank, card, "900.00", "2026-10-26")
    commit_check(ana)
    s = status(ana, card)
    assert (s["to_pay"], s["unbilled"]) == (0, Decimal("145.80"))


def test_pagar_de_mas_deja_saldo_a_favor(ana):
    card, bank = visa(ana), bcp(ana)
    buy(ana, card, "100.00", "2026-10-12")
    pay(ana, bank, card, "150.00", "2026-10-26")
    commit_check(ana)
    assert status(ana, card)["to_pay"] == Decimal("-50.00")


def test_cada_moneda_va_por_su_lado(ana):
    card = visa(ana)
    buy(ana, card, "45.00", "2026-10-03", currency="USD", rate="3.762")
    buy(ana, card, "12.99", "2026-10-22", currency="USD", rate="3.762")
    commit_check(ana)
    usd = status(ana, card, "USD")
    assert (usd["debt"], usd["unbilled"], usd["to_pay"]) == (Decimal("57.99"), Decimal("12.99"), Decimal("45.00"))
    assert status(ana, card, "PEN")["debt"] == 0


def test_un_borrador_no_cuenta(ana):
    card = visa(ana)
    m = buy(ana, card, "100.00", "2026-10-12")
    ana.execute("UPDATE account_move SET state = 'draft' WHERE id = %s", (m,))
    assert status(ana, card)["debt"] == 0


# --- Cuotas -----------------------------------------------------------------------------------

def test_el_televisor_en_6_cuotas(ana):
    """El ejemplo del documento: S/ 1,200 en 6 cuotas, comprado el 25 sep con corte 20."""
    card = visa(ana)
    tv = buy(ana, card, "1200.00", "2025-09-25")
    plan = ana.execute("SELECT create_installment_plan(%s, 6)", (tv,)).fetchone()[0]
    assert plan_lines(ana, plan) == [
        (1, date(2025, 10, 20), Decimal("200.00")), (2, date(2025, 11, 20), Decimal("200.00")),
        (3, date(2025, 12, 20), Decimal("200.00")), (4, date(2026, 1, 20), Decimal("200.00")),
        (5, date(2026, 2, 20), Decimal("200.00")), (6, date(2026, 3, 20), Decimal("200.00"))]


def test_la_ultima_cuota_cierra_el_redondeo(ana):
    card = visa(ana)
    m = buy(ana, card, "1000.00", "2026-10-24")
    plan = ana.execute("SELECT create_installment_plan(%s, 3)", (m,)).fetchone()[0]
    assert [p for _, _, p in plan_lines(ana, plan)] == [Decimal("333.33"), Decimal("333.33"), Decimal("333.34")]


def test_en_cuotas_solo_se_factura_la_cuota_del_ciclo(ana):
    card = visa(ana)
    tv = buy(ana, card, "1200.00", "2026-09-25")
    ana.execute("SELECT create_installment_plan(%s, 6)", (tv,))
    commit_check(ana)
    s = status(ana, card)       # la cuota 1 (corte 20 oct) se paga ahora; las otras 5 vienen
    assert (s["debt"], s["unbilled"], s["to_pay"]) == (Decimal("1200.00"), Decimal("1000.00"), Decimal("200.00"))
    nov = status(ana, card, today=date(2026, 11, 21))
    assert (nov["unbilled"], nov["to_pay"]) == (Decimal("800.00"), Decimal("400.00"))


def test_una_compra_en_cuotas_despues_del_corte_no_se_paga_aun(ana):
    card = visa(ana)
    m = buy(ana, card, "1200.00", "2026-10-26")
    ana.execute("SELECT create_installment_plan(%s, 6)", (m,))
    commit_check(ana)
    s = status(ana, card)
    assert (s["unbilled"], s["to_pay"]) == (Decimal("1200.00"), 0)


def test_solo_una_compra_con_tarjeta_va_en_cuotas(ana):
    bank = bcp(ana)
    pen = cur(ana, "PEN")
    m = move(ana, [(account(ana, "Hogar"), 100, 0, pen, 100), (bank, 0, 100, pen, -100)])
    with pytest.raises(psycopg.errors.CheckViolation, match="con una tarjeta"):
        ana.execute("SELECT create_installment_plan(%s, 3)", (m,))


def test_de_2_a_60_cuotas(ana):
    card = visa(ana)
    m = buy(ana, card, "100.00", "2026-10-24")
    with pytest.raises(psycopg.errors.CheckViolation, match="de 2 a 60"):
        ana.execute("SELECT create_installment_plan(%s, 1)", (m,))


def test_una_compra_en_cuotas_no_se_edita(ana):
    card = visa(ana)
    m = buy(ana, card, "1200.00", "2026-10-24")
    ana.execute("SELECT create_installment_plan(%s, 6)", (m,))
    with pytest.raises(psycopg.errors.CheckViolation, match="no se edita"), ana.transaction():
        ana.execute("UPDATE account_move_line SET credit = 1000, amount_currency = -1000"
                    " WHERE move_id = %s AND account_id = %s", (m, card))
    with pytest.raises(psycopg.errors.CheckViolation, match="no se edita"), ana.transaction():
        ana.execute("UPDATE account_move SET date = '2026-10-25' WHERE id = %s", (m,))


def test_borrar_la_compra_borra_sus_cuotas(ana):
    card = visa(ana)
    m = buy(ana, card, "1200.00", "2026-10-24")
    plan = ana.execute("SELECT create_installment_plan(%s, 6)", (m,)).fetchone()[0]
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    assert plan_lines(ana, plan) == []


def test_el_plan_va_por_el_monto_de_la_compra(ana):
    card = visa(ana)
    m = buy(ana, card, "1200.00", "2026-10-24")
    with pytest.raises(psycopg.errors.CheckViolation, match="mismo monto"):
        ana.execute("INSERT INTO account_installment_plan (move_id, card_account_id, currency_id, principal,"
                    " n_installments, first_closing) VALUES (%s, %s, %s, 999, 3, '2026-11-20')",
                    (m, card, cur(ana, "PEN")))


def test_cuotas_de_antes_de_ppm(ana):
    """La laptop: faltan 4 cuotas de S/ 250. No es gasto del mes y se factura desde el próximo corte."""
    card = visa(ana)
    m = ana.execute("SELECT post_card_installments_opening(%s, %s, 250, 4, 'Laptop', 1, %s)",
                    (card, cur(ana, "PEN"), HOY)).fetchone()[0]
    commit_check(ana)
    when, ref = ana.execute("SELECT date, ref FROM account_move WHERE id = %s", (m,)).fetchone()
    assert (when, ref) == (date(2026, 10, 20), "Laptop")
    expense = ana.execute("SELECT count(*) FROM account_move_line l JOIN account_account a ON a.id = l.account_id"
                          " WHERE l.move_id = %s AND a.account_type = 'expense'", (m,)).fetchone()[0]
    assert expense == 0
    plan = ana.execute("SELECT id FROM account_installment_plan WHERE move_id = %s", (m,)).fetchone()[0]
    assert [d for _, d, _ in plan_lines(ana, plan)] == [
        date(2026, 11, 20), date(2026, 12, 20), date(2027, 1, 20), date(2027, 2, 20)]
    s = status(ana, card)
    assert (s["debt"], s["unbilled"], s["to_pay"]) == (Decimal("1000.00"), Decimal("1000.00"), 0)


# --- Aislamiento ------------------------------------------------------------------------------

def test_cada_uno_ve_solo_sus_tarjetas(new_user, as_user):
    ana = as_user(new_user("ana@correo.com"))
    ana.execute("SELECT setup_user('PE')")
    card = visa(ana)
    beto = as_user(new_user("beto@correo.com"))
    beto.execute("SELECT setup_user('PE')")
    assert beto.execute("SELECT count(*) FROM account_credit_card").fetchone()[0] == 0
    assert beto.execute("SELECT count(*) FROM credit_card_status()").fetchone()[0] == 0
    with pytest.raises(psycopg.errors.NoDataFound):
        beto.execute("SELECT post_card_opening(%s, 1::smallint, 100)", (card,))
