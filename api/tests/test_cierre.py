"""Rebanada 13 · Cierre de periodo (0028): con lock_date nada con fecha hasta ese día se crea, se
cambia ni se borra; cerrar exige no tener nada por confirmar ni por clasificar, y solo días pasados.
Una prueba por cada camino que escribe en fechas pasadas."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, commit_check, cur, move, role
from tests.test_cancelar_cuotas import cancelar, televisor
from tests.test_cuotas_correcciones import ana, en_cuotas, estado_de_cuenta  # noqa: F401
from tests.test_tarjetas import visa

CIERRE = "2026-09-30"
CERRADO = "El periodo está cerrado hasta el 30/09/2026"


def gasto(c, when, amount="50", state="posted") -> int:
    c.execute("SET CONSTRAINTS ALL DEFERRED")
    pen = cur(c, "PEN")
    bank = c.execute("SELECT create_cash_account('Caja', %s, 1000, '2026-01-01')", (pen,)).fetchone()[0] \
        if not hasattr(c, "caja") else c.caja
    c.caja = bank   # type: ignore[attr-defined]
    return move(c, [(account(c, "Hogar"), Decimal(amount), 0, pen, Decimal(amount)),
                    (bank, 0, Decimal(amount), pen, -Decimal(amount))], state=state, date=when)


def cerrar(c, on=CIERRE) -> None:
    commit_check(c)
    c.execute("UPDATE res_users SET lock_date = %s", (on,))


def falla(c, sql, params=(), match=CERRADO):
    with pytest.raises(psycopg.errors.CheckViolation, match=match), c.transaction():
        c.execute(sql, params)
        c.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_lo_cerrado_no_se_crea_cambia_ni_borra(ana):
    m = gasto(ana, "2026-09-10")
    cerrar(ana)
    falla(ana, "UPDATE account_move_line SET debit = 60 WHERE move_id = %s AND debit > 0", (m,))
    falla(ana, "UPDATE account_move SET date = '2026-10-05' WHERE id = %s", (m,))
    falla(ana, "UPDATE account_move SET state = 'draft' WHERE id = %s", (m,))
    falla(ana, "DELETE FROM account_move WHERE id = %s", (m,))
    with pytest.raises(psycopg.errors.CheckViolation, match=CERRADO), ana.transaction():
        gasto(ana, "2026-09-30")


def test_despues_del_cierre_todo_sigue_libre(ana):
    gasto(ana, "2026-09-10")
    cerrar(ana)
    m = gasto(ana, "2026-10-01")
    ana.execute("UPDATE account_move SET date = '2026-10-02' WHERE id = %s", (m,))
    falla(ana, "UPDATE account_move SET date = '2026-09-29' WHERE id = %s", (m,))   # no se mete en lo cerrado
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))


def test_no_se_cierra_con_algo_por_confirmar(ana):
    gasto(ana, "2026-09-10", state="draft")
    falla(ana, "UPDATE res_users SET lock_date = %s", (CIERRE,), match="Hay 1 por confirmar hasta el 30/09/2026")
    ana.execute("UPDATE res_users SET lock_date = '2026-09-09'")             # antes del borrador, sí


def test_no_se_cierra_con_algo_por_clasificar(ana):
    pen = cur(ana, "PEN")
    bank = ana.execute("SELECT create_cash_account('Caja', %s, 1000, '2026-01-01')", (pen,)).fetchone()[0]
    move(ana, [(role(ana, "suspense"), 20, 0, pen, 20), (bank, 0, 20, pen, -20)], date="2026-09-12")
    commit_check(ana)
    falla(ana, "UPDATE res_users SET lock_date = %s", (CIERRE,), match="Hay 1 por clasificar")


def test_solo_dias_que_ya_pasaron(ana):
    falla(ana, "UPDATE res_users SET lock_date = '2030-01-01'", match="Solo se cierran días que ya pasaron")


def test_reabrir_siempre_se_puede(ana):
    m = gasto(ana, "2026-09-10")
    cerrar(ana)
    gasto(ana, "2026-10-01", state="draft")                                   # un borrador después: no importa
    ana.execute("UPDATE res_users SET lock_date = '2026-08-31'")             # mover atrás reabre septiembre
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    ana.execute("UPDATE res_users SET lock_date = NULL")


def test_los_vencimientos_no_cambian_saldos(ana):
    pen = cur(ana, "PEN")
    luis = ana.execute("INSERT INTO res_partner (name) VALUES ('Luis') RETURNING id").fetchone()[0]
    bank = ana.execute("SELECT create_cash_account('Caja', %s, 1000, '2026-01-01')", (pen,)).fetchone()[0]
    m = move(ana, [(role(ana, "receivable"), 100, 0, pen, 100, luis), (bank, 0, 100, pen, -100)], date="2026-09-05")
    cerrar(ana)
    ana.execute("UPDATE account_move_line SET date_maturity = '2026-12-31' WHERE move_id = %s AND partner_id IS NOT NULL", (m,))


def test_borrar_a_alguien_con_un_periodo_cerrado(conn, new_user, as_user):
    uid = new_user("bea@correo.com", "Bea")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{}')")
    gasto(c, "2026-09-10")
    cerrar(c)
    c.execute("RESET ROLE")
    c.execute("DELETE FROM res_users WHERE id = %s", (uid,))


# --- Tarjetas y cuotas en un periodo cerrado --------------------------------------------------

def test_realinear_no_mueve_una_cuota_cerrada(ana):
    """Corte el 20; la cuota del 20 sep se facturó y septiembre se cerró. El estado de cuenta dice
    que el banco cortó el 18: el calendario cambia, el asiento cerrado se queda."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    ana.execute("SELECT post_installment_billing('2026-09-25')")
    cerrar(ana)
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    assert ana.execute("SELECT date FROM account_move WHERE installment_plan_id = %s", (plan,)).fetchone()[0] \
        == date(2026, 9, 20)


def test_la_cuota_de_un_corte_cerrado_queda_por_confirmar(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    cerrar(ana)
    ana.execute("SELECT post_installment_billing('2026-09-25')")
    assert ana.execute("SELECT date, state FROM account_move WHERE installment_plan_id = %s", (plan,)).fetchone() \
        == (date(2026, 10, 1), "draft")


def test_no_se_divide_ni_se_ajusta_una_cuota_cerrada(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    ana.execute("SELECT post_installment_billing('2026-09-25')")
    cerrar(ana)
    falla(ana, "SELECT set_installment_detail(%s, 1, 180, 20)", (plan,))
    falla(ana, "SELECT set_installment_amount(%s, 210)", (plan,))


def test_no_se_cancela_en_un_dia_cerrado(ana):
    _, plan = televisor(ana)
    cerrar(ana)
    with pytest.raises(psycopg.errors.CheckViolation), ana.transaction():
        cancelar(ana, plan, "returned", when="2026-09-30")


def test_alta_de_tarjeta_con_su_ultimo_corte_cerrado(ana):
    cerrar(ana)
    card = visa(ana)
    falla(ana, "SELECT post_card_opening(%s, %s, 300, 1, '2026-09-20')", (card, cur(ana, "PEN")))
    falla(ana, "SELECT post_card_installments_opening(%s, %s, 100, 3, 'Laptop', 1, '2026-09-25')", (card, cur(ana, "PEN")))
