"""Cancelar las cuotas que faltan (0026): «Lo devolví» y «Pagué lo que faltaba». Las cuotas ya
facturadas no cambian, «Cuotas por venir» siempre cuadra y borrar la cancelación la deshace.

El televisor del boceto: S/ 1,200 en 6 cuotas de S/ 215.00 (S/ 90 de interés), comprado el 25 ago
con corte 20: las cuotas del 20 sep y 20 oct ya se facturaron y faltan 4, S/ 860.00."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, commit_check, cur, move, role
from tests.test_cuotas_correcciones import ana, asientos_de_cuota, cuadra_cuotas_por_venir, en_cuotas  # noqa: F401
from tests.test_tarjetas import plan_lines, visa

CANCELA = "2026-11-10"


def televisor(c):
    card = visa(c)
    plan = en_cuotas(c, card, "215.00", 6, "2026-08-25", price="1200.00")
    return card, plan


def cancelar(c, plan, kind, charged=None, when=CANCELA) -> int:
    c.execute("SET CONSTRAINTS ALL DEFERRED")   # el cuadre se revisa al final, como en la API
    m = c.execute("SELECT cancel_installment_plan(%s, %s, %s, %s)", (plan, kind, when, charged)).fetchone()[0]
    commit_check(c)
    return m


def saldo(c, acc) -> tuple[Decimal, Decimal]:
    return c.execute("SELECT coalesce(sum(amount_currency), 0), coalesce(sum(balance), 0) FROM account_move_line l"
                     " JOIN account_move m ON m.id = l.move_id AND m.state = 'posted' WHERE l.account_id = %s",
                     (acc,)).fetchone()


def lineas(c, m) -> list[tuple]:
    return c.execute("SELECT a.name, l.debit, l.credit, l.amount_currency FROM account_move_line l"
                     " JOIN account_account a ON a.id = l.account_id WHERE l.move_id = %s ORDER BY l.id", (m,)).fetchall()


def test_lo_devolvi(ana):
    card, plan = televisor(ana)
    m = cancelar(ana, plan, "returned")
    assert [s for s, *_ in plan_lines(ana, plan)] == [1, 2]                    # quedan las facturadas
    assert [s for s, _ in asientos_de_cuota(ana, plan)] == [1, 2]
    assert saldo(ana, card) == (Decimal("-430.00"), Decimal("-430.00"))      # debe solo lo facturado
    assert saldo(ana, role(ana, "installments")) == (0, 0)
    assert lineas(ana, m) == [("Cuotas por venir", 0, Decimal("860.00"), Decimal("-860.00")),
                              ("Visa BBVA", Decimal("860.00"), 0, Decimal("860.00"))]
    assert ana.execute("SELECT cancel_kind FROM account_installment_plan WHERE id = %s", (plan,)).fetchone()[0] == "returned"
    cuadra_cuotas_por_venir(ana)


def test_pague_lo_que_faltaba(ana):
    """El banco cobró S/ 800 (el capital que faltaba): es gasto de Hogar ese día y la tarjeta deja de
    deber los S/ 60 de interés."""
    card, plan = televisor(ana)
    m = cancelar(ana, plan, "prepaid", "800.00")
    assert lineas(ana, m) == [("Cuotas por venir", 0, Decimal("860.00"), Decimal("-860.00")),
                              ("Hogar", Decimal("800.00"), 0, Decimal("800.00")),
                              ("Visa BBVA", Decimal("60.00"), 0, Decimal("60.00"))]
    assert saldo(ana, card) == (Decimal("-1230.00"), Decimal("-1230.00"))    # 430 facturado + 800 cobrado
    assert ana.execute("SELECT date FROM account_move WHERE id = %s", (m,)).fetchone()[0] == date(2026, 11, 10)
    cuadra_cuotas_por_venir(ana)


def test_pagar_justo_lo_que_faltaba_no_toca_la_tarjeta(ana):
    _, plan = televisor(ana)
    m = cancelar(ana, plan, "prepaid", "860.00")
    assert [n for n, *_ in lineas(ana, m)] == ["Cuotas por venir", "Hogar"]
    cuadra_cuotas_por_venir(ana)


def test_el_banco_no_cobra_mas_de_lo_que_faltaba(ana):
    _, plan = televisor(ana)
    with pytest.raises(psycopg.errors.CheckViolation, match="hasta 860"), ana.transaction():
        cancelar(ana, plan, "prepaid", "900.00")
    with pytest.raises(psycopg.errors.CheckViolation, match="hasta 860"), ana.transaction():
        cancelar(ana, plan, "prepaid", None)


def test_el_estado_de_la_tarjeta_despues_de_cancelar(ana):
    card, plan = televisor(ana)
    hoy = date(2026, 11, 12)
    s = ana.execute("SELECT total_debt, unbilled, to_pay FROM credit_card_status(%s) WHERE account_id = %s"
                    " AND currency_id = %s", (hoy, card, cur(ana, "PEN"))).fetchone()
    assert s == (Decimal("1290.00"), Decimal("860.00"), Decimal("430.00"))
    cancelar(ana, plan, "prepaid", "800.00")
    s = ana.execute("SELECT total_debt, unbilled, to_pay FROM credit_card_status(%s) WHERE account_id = %s"
                    " AND currency_id = %s", (hoy, card, cur(ana, "PEN"))).fetchone()
    assert s == (Decimal("1230.00"), 0, Decimal("1230.00"))                 # los 800 ya los cobró el banco


def test_borrar_la_cancelacion_la_deshace(ana):
    card, plan = televisor(ana)
    m = cancelar(ana, plan, "returned")
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    commit_check(ana)
    assert [(s, d) for s, d, _ in plan_lines(ana, plan)] == [
        (1, date(2026, 9, 20)), (2, date(2026, 10, 20)), (3, date(2026, 11, 20)), (4, date(2026, 12, 20)),
        (5, date(2027, 1, 20)), (6, date(2027, 2, 20))]
    assert ana.execute("SELECT cancel_kind, canceled_lines FROM account_installment_plan WHERE id = %s",
                       (plan,)).fetchone() == (None, None)
    assert saldo(ana, role(ana, "installments")) == (Decimal("860.00"), Decimal("860.00"))
    cuadra_cuotas_por_venir(ana)
    cancelar(ana, plan, "returned")                                          # se puede volver a cancelar


def test_deshacer_toma_los_cortes_del_banco(ana):
    """Si mientras estaba cancelada llegó un estado de cuenta, las cuotas vuelven con sus cortes."""
    card, plan = televisor(ana)
    m = cancelar(ana, plan, "returned")
    ana.execute("INSERT INTO account_credit_card_statement (card_account_id, closing_date, date_from, credit_limit,"
                " bank_available, bank_used) VALUES (%s, '2026-11-18', '2026-10-21', 5000, 4000, 1000)", (card,))
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    assert [d for _, d, _ in plan_lines(ana, plan)][2:4] == [date(2026, 11, 18), date(2026, 12, 20)]


def test_borrar_la_compra_se_lleva_la_cancelacion(ana):
    _, plan = televisor(ana)
    m = cancelar(ana, plan, "returned")
    purchase = ana.execute("SELECT move_id FROM account_installment_plan WHERE id = %s", (plan,)).fetchone()[0]
    ana.execute("DELETE FROM account_move WHERE id = %s", (purchase,))
    commit_check(ana)
    assert ana.execute("SELECT count(*) FROM account_move WHERE id = %s", (m,)).fetchone()[0] == 0
    assert saldo(ana, role(ana, "installments")) == (0, 0)


def test_no_antes_de_una_cuota_ya_facturada(ana):
    _, plan = televisor(ana)
    with pytest.raises(psycopg.errors.CheckViolation, match="20/10/2026"):
        cancelar(ana, plan, "returned", when="2026-10-15")


def test_no_en_el_futuro(ana):
    _, plan = televisor(ana)
    with pytest.raises(psycopg.errors.CheckViolation, match="futura"):
        cancelar(ana, plan, "returned", when="2027-01-01")


def test_una_sola_vez(ana):
    _, plan = televisor(ana)
    cancelar(ana, plan, "returned")
    with pytest.raises(psycopg.errors.CheckViolation, match="ya se cancelaron"):
        cancelar(ana, plan, "returned")


def test_sin_cuotas_por_facturar_no_hay_que_cancelar(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "100.00", 2, "2026-08-25")
    with pytest.raises(psycopg.errors.CheckViolation, match="No quedan"):
        cancelar(ana, plan, "returned")


def test_solo_compras_tuyas(ana):
    """Las cuotas de antes de PPM y prestar la tarjeta no tienen categoría propia: todavía no."""
    card = visa(ana)
    m = ana.execute("SELECT post_card_installments_opening(%s, %s, 250, 3, 'Laptop', 1, '2026-11-12')",
                    (card, cur(ana, "PEN"))).fetchone()[0]
    plan = ana.execute("SELECT id FROM account_installment_plan WHERE move_id = %s", (m,)).fetchone()[0]
    with pytest.raises(psycopg.errors.CheckViolation, match="compra tuya"):
        cancelar(ana, plan, "returned")


def test_en_dolares_no_queda_nada_suelto(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "87.35", 3, "2026-09-25", currency="USD", rate="3.451")
    m = cancelar(ana, plan, "returned")
    assert saldo(ana, role(ana, "installments")) == (0, 0)
    assert lineas(ana, m)[0][2:] == (Decimal("602.89"), Decimal("-174.70"))   # 904.33 − 301.44
    cuadra_cuotas_por_venir(ana)


def test_en_dolares_pagado_por_adelantado(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "87.35", 3, "2026-09-25", currency="USD", rate="3.451", price="250.00")
    m = cancelar(ana, plan, "prepaid", "166.67")
    rows = lineas(ana, m)
    assert rows[1] == ("Hogar", Decimal("575.18"), 0, Decimal("575.18"))     # 166.67 × 3.451
    assert rows[2] == ("Visa BBVA", Decimal("27.71"), 0, Decimal("8.03"))     # 602.89 − 575.18
    cuadra_cuotas_por_venir(ana)


# --- Usar la cuota del banco (0027) -----------------------------------------------------------

def test_usar_la_cuota_del_banco_reescribe_la_compra_y_lo_facturado(ana):
    """Zapatillas sin cuota escrita: 3 × 100. El banco cobra 112.40: la tarjeta sube 37.20 y la cuota
    ya facturada pasa a 112.40."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "100.00", 3, "2026-09-25")
    ana.execute("UPDATE account_installment_plan SET installment_amount = NULL WHERE id = %s", (plan,))
    ana.execute("SELECT post_installment_billing('2026-10-21')")
    ana.execute("SELECT set_installment_amount(%s, 112.40)", (plan,))
    commit_check(ana)
    assert saldo(ana, card) == (Decimal("-337.20"), Decimal("-337.20"))
    assert [p for *_, p in plan_lines(ana, plan)] == [Decimal("112.40")] * 3
    assert ana.execute("SELECT principal, installment_amount, price FROM account_installment_plan WHERE id = %s",
                       (plan,)).fetchone() == (Decimal("337.20"), Decimal("112.40"), Decimal("300.00"))
    billed = ana.execute("SELECT sum(l.debit) FROM account_move_line l JOIN account_move m ON m.id = l.move_id"
                         " WHERE m.installment_plan_id = %s", (plan,)).fetchone()[0]
    assert billed == Decimal("112.40")
    cuadra_cuotas_por_venir(ana)


def test_usar_la_cuota_del_banco_en_dolares_cuadra(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "80.00", 3, "2026-05-25", currency="USD", rate="3.451")
    ana.execute("SELECT post_installment_billing('2026-08-25')")
    ana.execute("SELECT set_installment_amount(%s, 87.35)", (plan,))
    commit_check(ana)
    assert saldo(ana, role(ana, "installments")) == (0, 0)
    cuadra_cuotas_por_venir(ana)


def test_no_se_ajusta_una_compra_cancelada(ana):
    _, plan = televisor(ana)
    cancelar(ana, plan, "returned")
    with pytest.raises(psycopg.errors.CheckViolation, match="se cancelaron"):
        ana.execute("SELECT set_installment_amount(%s, 220)", (plan,))


def test_la_cuota_no_puede_quedar_debajo_del_precio(ana):
    _, plan = televisor(ana)
    with pytest.raises(psycopg.errors.CheckViolation, match="no llegan a lo que costó"):
        ana.execute("SELECT set_installment_amount(%s, 150)", (plan,))
