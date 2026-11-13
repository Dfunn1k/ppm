"""Correcciones de las cuotas (0025): el corte del banco que cae antes del día de la tarjeta, el
céntimo de las cuotas en dólares y el patrimonio con una compra en cuotas en dólares.

La regla que toda compra en cuotas tuya debe cumplir siempre, pase lo que pase (comprar, facturar,
dividir con el detalle del banco, realinear cortes o borrar): «Cuotas por venir» es exactamente la
suma de las cuotas que faltan facturar, en su moneda y en soles."""

from datetime import date
from decimal import Decimal

import pytest

from app import accounts, reports
from app.accounts import TodayRate
from app.db import act_as_user
from tests.test_asientos import account, commit_check, cur, move, role
from tests.test_tarjetas import plan_lines, visa


@pytest.fixture
def ana(conn, new_user, as_user):
    uid = new_user("ana@correo.com", "Ana")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")
    c.uid = uid   # type: ignore[attr-defined]
    return c


def en_cuotas(c, card, each, n, when, currency="PEN", rate="1", price=None) -> int:
    """Una compra tuya en cuotas, como la arma /moves: la tarjeta sube por todas las cuotas y del
    otro lado quedan «Cuotas por venir»; cada cuota irá a Hogar en su corte."""
    total = Decimal(each) * n
    base = (total * Decimal(rate)).quantize(Decimal("0.01"))
    cid = cur(c, currency)
    m = move(c, [(role(c, "installments"), base, 0, cid, total), (card, 0, base, cid, -total)], date=when)
    c.execute("SELECT create_installment_plan(%s, %s, %s, %s, %s)",
              (m, n, Decimal(each), Decimal(price) if price else None, account(c, "Hogar")))
    return c.execute("SELECT id FROM account_installment_plan WHERE move_id = %s", (m,)).fetchone()[0]


def facturar(c, today) -> int:
    return c.execute("SELECT post_installment_billing(%s)", (today,)).fetchone()[0]


def estado_de_cuenta(c, card, date_from, closing, available="1000", used="0") -> None:
    """Lo que deja la importación del PDF: la foto del ciclo con sus fechas Del y Al."""
    c.execute("INSERT INTO account_credit_card_statement (card_account_id, closing_date, date_from, credit_limit,"
              " bank_available, bank_used) VALUES (%s, %s, %s, 5000, %s, %s)",
              (card, closing, date_from, Decimal(available), Decimal(used)))
    c.execute("SELECT realign_card_closings(%s)", (card,))


def cortes(c, plan) -> list[date]:
    return [d for _, d, _ in plan_lines(c, plan)]


def asientos_de_cuota(c, plan) -> list[tuple[int, date]]:
    return c.execute("SELECT installment_sequence, date FROM account_move WHERE installment_plan_id = %s"
                     " ORDER BY installment_sequence", (plan,)).fetchall()


def cuadra_cuotas_por_venir(c) -> None:
    """«Cuotas por venir» = lo que falta facturar: por moneda en su monto y, en soles, la parte de la
    compra que aún no se llevaron las cuotas facturadas."""
    have = dict(((cid, (amt, bal)) for cid, amt, bal in c.execute(
        "SELECT l.currency_id, sum(l.amount_currency), sum(l.balance) FROM account_move_line l"
        "  JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'"
        " WHERE l.account_id = system_account('installments') GROUP BY l.currency_id").fetchall()))
    want: dict[int, list[Decimal]] = {}
    for cid, plan, rate, total in c.execute(
            "SELECT p.currency_id, p.id, installment_plan_rate(p.id), l.credit FROM account_installment_plan p"
            "  JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'"
            "  JOIN account_move_line l ON l.move_id = p.move_id AND l.account_id = p.card_account_id AND l.credit > 0"
            " WHERE p.expense_account_id IS NOT NULL").fetchall():
        unbilled = c.execute(
            "SELECT coalesce(sum(pl.principal), 0) FROM account_installment_plan_line pl WHERE pl.plan_id = %s"
            " AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = pl.plan_id"
            "                  AND x.installment_sequence = pl.sequence AND x.state = 'posted')", (plan,)).fetchone()[0]
        billed_base = c.execute(
            "SELECT coalesce(sum(l.credit), 0) FROM account_move_line l JOIN account_move x ON x.id = l.move_id"
            " WHERE x.installment_plan_id = %s AND x.state = 'posted'"
            "   AND l.account_id = system_account('installments')", (plan,)).fetchone()[0]
        w = want.setdefault(cid, [Decimal(0), Decimal(0)])
        w[0] += unbilled
        w[1] += total - billed_base
    for cid in set(have) | set(want):
        amt, bal = have.get(cid, (0, 0))
        assert (amt, bal) == tuple(want.get(cid, (0, 0))), f"moneda {cid}"
    # Y en soles nada queda suelto cuando todo se facturó
    assert all(want[cid][1] >= 0 for cid in want)


# --- El corte del banco -----------------------------------------------------------------------

def test_el_banco_corta_antes_del_dia_de_la_tarjeta(ana):
    """Corte el 20, pero en septiembre el banco cerró el 18: la cuota 1 va al 18 y no salta a octubre."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    assert facturar(ana, date(2026, 9, 25)) == 1
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    commit_check(ana)
    assert cortes(ana, plan) == [date(2026, 9, 18), date(2026, 10, 20), date(2026, 11, 20)]
    assert asientos_de_cuota(ana, plan) == [(1, date(2026, 9, 18))]   # en el pasado, no en octubre
    cuadra_cuotas_por_venir(ana)


def test_el_banco_corta_despues_del_dia_de_la_tarjeta(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    facturar(ana, date(2026, 9, 25))
    estado_de_cuenta(ana, card, "2026-08-23", "2026-09-22")
    assert cortes(ana, plan) == [date(2026, 9, 22), date(2026, 10, 20), date(2026, 11, 20)]
    assert asientos_de_cuota(ana, plan) == [(1, date(2026, 9, 22))]


def test_el_del_de_un_ciclo_cierra_el_anterior(ana):
    """Solo se importó octubre (Del 17 sep, Al 17 oct): septiembre cerró el 16, aunque no se importó."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    estado_de_cuenta(ana, card, "2026-09-17", "2026-10-17")
    assert cortes(ana, plan) == [date(2026, 9, 16), date(2026, 10, 17), date(2026, 11, 20)]


def test_cada_cuota_queda_en_un_corte_distinto(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "100.00", 6, "2026-08-25")
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    estado_de_cuenta(ana, card, "2026-09-19", "2026-10-19")
    estado_de_cuenta(ana, card, "2026-10-20", "2026-11-21")
    got = cortes(ana, plan)
    assert len(set(got)) == 6 and got == sorted(got)
    assert got[:4] == [date(2026, 9, 18), date(2026, 10, 19), date(2026, 11, 21), date(2026, 12, 20)]


def test_realinear_otra_vez_no_mueve_nada(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    before = cortes(ana, plan)
    ana.execute("SELECT realign_card_closings(%s)", (card,))
    assert cortes(ana, plan) == before


def test_una_compra_despues_del_corte_del_banco_va_al_siguiente(ana):
    """Compra el 19 sep; el banco cortó el 18: la cuota 1 no puede caer antes de la compra."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-09-19")
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    assert cortes(ana, plan) == [date(2026, 10, 20), date(2026, 11, 20), date(2026, 12, 20)]


def test_una_compra_antes_del_corte_del_banco_entra_en_ese_ciclo(ana):
    """Compra el 21 sep; el banco cortó el 22: la cuota 1 se factura el 22 sep, no en octubre."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-09-21")
    estado_de_cuenta(ana, card, "2026-08-23", "2026-09-22")
    assert cortes(ana, plan) == [date(2026, 9, 22), date(2026, 10, 20), date(2026, 11, 20)]


def test_las_cuotas_de_antes_de_ppm_empiezan_despues_del_ultimo_corte(ana):
    """Su asiento lleva la fecha del último corte (20 sep); con el banco cortando el 18, la primera
    cuota es la del siguiente corte, no la del 18."""
    card = visa(ana)
    m = ana.execute("SELECT post_card_installments_opening(%s, %s, 250, 3, 'Laptop', 1, '2026-09-25')",
                    (card, cur(ana, "PEN"))).fetchone()[0]
    plan = ana.execute("SELECT id FROM account_installment_plan WHERE move_id = %s", (m,)).fetchone()[0]
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    assert cortes(ana, plan) == [date(2026, 10, 20), date(2026, 11, 20), date(2026, 12, 20)]


def test_las_partes_de_otra_persona_siguen_a_su_cuota(ana):
    """Prestar la tarjeta en cuotas: cada parte por cobrar vence con el corte de su cuota."""
    card = visa(ana)
    pen = cur(ana, "PEN")
    luis = ana.execute("INSERT INTO res_partner (name) VALUES ('Luis') RETURNING id").fetchone()[0]
    rec = role(ana, "receivable")
    m = move(ana, [(rec, 100, 0, pen, 100, luis), (rec, 100, 0, pen, 100, luis), (rec, 100, 0, pen, 100, luis),
                   (card, 0, 300, pen, -300)], date="2026-08-25")
    plan = ana.execute("SELECT create_installment_plan(%s, 3)", (m,)).fetchone()[0]
    ana.execute("SELECT set_plan_maturities(%s)", (plan,))
    estado_de_cuenta(ana, card, "2026-08-19", "2026-09-18")
    parts = [d for (d,) in ana.execute("SELECT maturity_closing FROM account_move_line WHERE move_id = %s"
                                       " AND account_id = %s ORDER BY id", (m, rec)).fetchall()]
    assert parts == cortes(ana, plan) == [date(2026, 9, 18), date(2026, 10, 20), date(2026, 11, 20)]


# --- El céntimo -------------------------------------------------------------------------------

def test_las_cuotas_en_dolares_no_dejan_centimos(ana):
    """3 × US$ 87.35 a 3.451 = S/ 904.33, pero cada cuota redondeada da 301.44: la última lleva 301.45."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "87.35", 3, "2026-05-25", currency="USD", rate="3.451")
    assert facturar(ana, date(2026, 8, 25)) == 3
    commit_check(ana)
    base = [b for (b,) in ana.execute(
        "SELECT l.credit FROM account_move_line l JOIN account_move m ON m.id = l.move_id"
        " WHERE m.installment_plan_id = %s AND l.account_id = system_account('installments')"
        " ORDER BY m.installment_sequence", (plan,)).fetchall()]
    assert base == [Decimal("301.44"), Decimal("301.44"), Decimal("301.45")]
    left = ana.execute("SELECT coalesce(sum(balance), 0), coalesce(sum(amount_currency), 0) FROM account_move_line"
                       " WHERE account_id = system_account('installments')").fetchone()
    assert left == (0, 0)
    cuadra_cuotas_por_venir(ana)


def test_la_ultima_cuota_con_interes_tambien_cuadra(ana):
    """Con el detalle del banco la cuota se divide, pero lo que sale de «Cuotas por venir» no cambia."""
    card = visa(ana)
    plan = en_cuotas(ana, card, "87.35", 3, "2026-05-25", currency="USD", rate="3.451", price="250.00")
    facturar(ana, date(2026, 8, 25))
    ana.execute("SELECT set_installment_detail(%s, 3, 83.35, 4.00)", (plan,))
    commit_check(ana)
    expense, interest = ana.execute(
        "SELECT sum(l.debit) FILTER (WHERE l.account_id = %s), sum(l.debit) FILTER (WHERE l.account_id = system_account('interest'))"
        "  FROM account_move_line l JOIN account_move m ON m.id = l.move_id"
        " WHERE m.installment_plan_id = %s AND m.installment_sequence = 3", (account(ana, "Hogar"), plan)).fetchone()
    assert (expense, interest) == (Decimal("287.65"), Decimal("13.80"))   # 301.45 = 287.65 + 4.00 × 3.451
    cuadra_cuotas_por_venir(ana)


# --- La regla en todo el ciclo de vida --------------------------------------------------------

def test_cuotas_por_venir_cuadra_en_todo_el_recorrido(ana):
    card = visa(ana)
    tv = en_cuotas(ana, card, "200.00", 6, "2026-03-25")
    usd = en_cuotas(ana, card, "33.33", 4, "2026-04-02", currency="USD", rate="3.7777")
    cuadra_cuotas_por_venir(ana)                                       # recién comprado
    facturar(ana, date(2026, 5, 21))
    cuadra_cuotas_por_venir(ana)                                       # dos cortes facturados
    ana.execute("SELECT set_installment_detail(%s, 1, 180, 20)", (tv,))
    cuadra_cuotas_por_venir(ana)                                       # con el detalle del banco
    estado_de_cuenta(ana, card, "2026-03-19", "2026-04-18")
    estado_de_cuenta(ana, card, "2026-04-19", "2026-05-17")
    cuadra_cuotas_por_venir(ana)                                       # cortes realineados
    facturar(ana, date(2026, 11, 1))
    cuadra_cuotas_por_venir(ana)                                       # todo facturado
    ana.execute("DELETE FROM account_move WHERE id = (SELECT move_id FROM account_installment_plan WHERE id = %s)",
                (usd,))
    commit_check(ana)
    cuadra_cuotas_por_venir(ana)                                       # una compra borrada


def test_facturar_dos_veces_no_duplica(ana):
    card = visa(ana)
    plan = en_cuotas(ana, card, "200.00", 3, "2026-08-25")
    assert facturar(ana, date(2026, 10, 21)) == 2
    assert facturar(ana, date(2026, 10, 21)) == 0
    assert len(asientos_de_cuota(ana, plan)) == 2


# --- El patrimonio ----------------------------------------------------------------------------

def test_una_compra_en_cuotas_en_dolares_no_cambia_lo_que_tengo_hoy(ana):
    card = visa(ana)
    en_cuotas(ana, card, "100.00", 3, "2026-08-25", currency="USD", rate="3.45")
    rate = TodayRate("USD", date(2026, 8, 25), Decimal("3.43"), Decimal("3.45"), False)
    ids = [card, ana.execute("SELECT system_account('installments')").fetchone()[0]]
    total = sum(m.base for ms in accounts._balances(ana, ids, {"USD": rate}).values() for m in ms)
    assert total == 0


def test_una_compra_en_cuotas_en_dolares_no_cambia_el_patrimonio_del_mes(ana, conn):
    usd = cur(ana, "USD")
    conn.execute("RESET ROLE")
    conn.execute("INSERT INTO res_currency_rate (currency_id, name, rate_buy, rate_sell, source)"
                 " VALUES (%s, '2026-08-31', 3.43, 3.45, 'manual')"
                 " ON CONFLICT (currency_id, name) DO UPDATE SET rate_buy = 3.43, rate_sell = 3.45", (usd,))
    act_as_user(conn, ana.uid)
    card = visa(ana)
    before = reports.month_values(ana, [date(2026, 8, 31)])[date(2026, 8, 31)]
    en_cuotas(ana, card, "100.00", 3, "2026-08-25", currency="USD", rate="3.45")
    assert reports.month_values(ana, [date(2026, 8, 31)])[date(2026, 8, 31)] == before
