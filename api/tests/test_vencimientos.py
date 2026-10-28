"""Vencimientos (migración 0016): la fecha a mano, las partes de una compra en cuotas que vencen con la
fecha de pago de su ciclo, el cobro de lo que vence antes y la cuota con interés."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, commit_check, cur, move, role
from tests.test_tarjetas import ana, bcp, plan_lines, status, visa  # noqa: F401


def partner(c, name="Luis Pérez") -> int:
    return c.execute("INSERT INTO res_partner (name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]


def lend(c, who, amount, when, maturity=None) -> int:
    """Le presté desde el banco: Por cobrar (con la persona) contra el banco."""
    pen, amt = cur(c, "PEN"), Decimal(amount)
    m = move(c, [(role(c, "receivable"), amt, 0, pen, amt, who), (bcp_id(c), 0, amt, pen, -amt)], date=when)
    if maturity:
        c.execute("UPDATE account_move_line SET date_maturity = %s WHERE move_id = %s AND partner_id IS NOT NULL",
                  (maturity, m))
    return m


def bcp_id(c) -> int:
    row = c.execute("SELECT id FROM account_account WHERE name = 'Cuenta BCP'").fetchone()
    return row[0] if row else bcp(c)


def card_lend(c, card, who, each, n, when) -> tuple[int, int]:
    """Le presté la tarjeta en n cuotas: una parte de Por cobrar por cuota contra la tarjeta."""
    pen, each = cur(c, "PEN"), Decimal(each)
    total = each * n
    lines = [(role(c, "receivable"), each, 0, pen, each, who) for _ in range(n)] + [(card, 0, total, pen, -total)]
    m = move(c, lines, date=when)
    plan = c.execute("SELECT create_installment_plan(%s, %s)", (m, n)).fetchone()[0]
    c.execute("SELECT set_plan_maturities(%s)", (plan,))
    return m, plan


def residual(c, move_id) -> list[tuple]:
    return c.execute("SELECT maturity_closing, date_maturity, maturity_manual, amount_residual"
                     " FROM account_move_line_residual WHERE move_id = %s ORDER BY id", (move_id,)).fetchall()


def test_la_fecha_de_vencimiento_es_opcional_y_se_pone_despues(ana):
    luis = partner(ana)
    m = lend(ana, luis, "50", "2026-10-10")
    commit_check(ana)
    assert residual(ana, m) == [(None, None, None, Decimal("50.00"))]
    ana.execute("UPDATE account_move_line SET date_maturity = '2026-10-25' WHERE move_id = %s AND partner_id = %s",
                (m, luis))
    assert residual(ana, m)[0][1] == date(2026, 10, 25)


def test_prestar_la_tarjeta_en_cuotas_parte_la_deuda(ana):
    card, luis = visa(ana), partner(ana)
    m, plan = card_lend(ana, card, luis, "207", 6, "2026-10-26")
    commit_check(ana)
    assert [p for _, _, p in plan_lines(ana, plan)] == [Decimal("207.00")] * 6
    parts = residual(ana, m)
    assert [x[0] for x in parts] == [date(2026, 11, 20), date(2026, 12, 20), date(2027, 1, 20),
                                    date(2027, 2, 20), date(2027, 3, 20), date(2027, 4, 20)]
    assert all(x[1] is None for x in parts)           # vence con el pago del corte: aún no se sabe


def test_cada_parte_vence_con_la_fecha_de_pago_de_su_ciclo(ana):
    card, luis = visa(ana), partner(ana)
    m, _ = card_lend(ana, card, luis, "207", 3, "2026-10-26")
    ana.execute("SELECT set_card_due_date(%s, '2026-11-20', '2026-12-05')", (card,))
    parts = residual(ana, m)
    assert [x[1] for x in parts] == [date(2026, 12, 5), None, None]
    ana.execute("SELECT set_card_due_date(%s, '2026-11-20', '2026-12-07')", (card,))   # se corrige: también
    assert residual(ana, m)[0][1] == date(2026, 12, 7)


def test_una_fecha_puesta_a_mano_manda(ana):
    card, luis = visa(ana), partner(ana)
    m, _ = card_lend(ana, card, luis, "207", 3, "2026-10-26")
    ana.execute("SELECT set_card_due_date(%s, '2026-11-20', '2026-12-05')", (card,))
    first = ana.execute("SELECT min(id) FROM account_move_line WHERE move_id = %s AND partner_id IS NOT NULL", (m,)).fetchone()[0]
    ana.execute("UPDATE account_move_line SET date_maturity = '2026-11-30' WHERE id = %s", (first,))   # en cuotas sí se puede
    assert residual(ana, m)[0][1:3] == (date(2026, 11, 30), date(2026, 11, 30))


def test_va_una_parte_por_cuota(ana):
    card, luis = visa(ana), partner(ana)
    pen = cur(ana, "PEN")
    m = move(ana, [(role(ana, "receivable"), Decimal("1242"), 0, pen, Decimal("1242"), luis),
                   (card, 0, Decimal("1242"), pen, Decimal("-1242"))], date="2026-10-26")
    plan = ana.execute("SELECT create_installment_plan(%s, 6)", (m,)).fetchone()[0]
    with pytest.raises(psycopg.errors.CheckViolation):
        ana.execute("SELECT set_plan_maturities(%s)", (plan,))


def test_un_pago_cancela_primero_lo_que_vence_antes(ana):
    luis = partner(ana)
    viejo = lend(ana, luis, "100", "2026-10-01", maturity="2026-12-31")   # prestado antes, vence después
    nuevo = lend(ana, luis, "100", "2026-10-10", maturity="2026-10-20")
    pen = cur(ana, "PEN")
    pago = move(ana, [(bcp_id(ana), Decimal("100"), 0, pen, Decimal("100")),
                      (role(ana, "receivable"), 0, Decimal("100"), pen, Decimal("-100"), luis)], date="2026-10-25")
    commit_check(ana)
    ana.execute("SELECT reconcile_partner(%s, %s)", (luis, role(ana, "receivable")))
    assert residual(ana, nuevo)[0][3] == 0
    assert residual(ana, viejo)[0][3] == Decimal("100.00")
    assert pago


def test_las_partes_se_cobran_en_el_orden_de_sus_cuotas(ana):
    card, luis = visa(ana), partner(ana)
    m, _ = card_lend(ana, card, luis, "207", 3, "2026-10-26")
    pen = cur(ana, "PEN")
    move(ana, [(bcp_id(ana), Decimal("300"), 0, pen, Decimal("300")),
               (role(ana, "receivable"), 0, Decimal("300"), pen, Decimal("-300"), luis)], date="2026-10-27")
    commit_check(ana)
    ana.execute("SELECT reconcile_partner(%s, %s)", (luis, role(ana, "receivable")))
    assert [x[3] for x in residual(ana, m)] == [0, Decimal("114.00"), Decimal("207.00")]


def test_la_cuota_con_interes_es_la_del_cronograma(ana):
    """S/ 1,200 en 6 cuotas de S/ 207: el precio a Hogar, S/ 42 a Intereses, S/ 1,242 a la tarjeta."""
    card = visa(ana)
    pen = cur(ana, "PEN")
    m = move(ana, [(account(ana, "Hogar"), Decimal("1200"), 0, pen, Decimal("1200")),
                   (role(ana, "interest"), Decimal("42"), 0, pen, Decimal("42")),
                   (card, 0, Decimal("1242"), pen, Decimal("-1242"))], date="2026-10-26")
    plan = ana.execute("SELECT create_installment_plan(%s, 6)", (m,)).fetchone()[0]
    commit_check(ana)
    assert [p for _, _, p in plan_lines(ana, plan)] == [Decimal("207.00")] * 6
    s = status(ana, card)
    assert (s["debt"], s["unbilled"], s["to_pay"]) == (Decimal("1242.00"), Decimal("1242.00"), 0)
    nov = status(ana, card, today=date(2026, 11, 21))
    assert (nov["unbilled"], nov["to_pay"]) == (Decimal("1035.00"), Decimal("207.00"))
