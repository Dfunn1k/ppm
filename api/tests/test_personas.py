"""Personas: la conciliación de deudas y la cuenta de Deudas incobrables (migración 0010)."""

from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import commit_check, cur, move, role


@pytest.fixture
def ana(new_user, as_user):
    """Ana, configurada en Perú con dólares; la conexión trabaja como ella."""
    uid = new_user("ana@correo.com", "Ana")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")
    return c


def person(c, name: str) -> int:
    return c.execute("INSERT INTO res_partner (name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]


def bcp(c) -> int:
    return c.execute("SELECT create_cash_account('Cuenta BCP', %s)", (cur(c, "PEN"),)).fetchone()[0]


def lend(c, cash, who, amount, date):
    """Le prestas: Debe Por cobrar (persona) / Haber tu cuenta. Devuelve el apunte de la deuda."""
    pen = cur(c, "PEN")
    m = move(c, [(role(c, "receivable"), amount, 0, pen, amount, who), (cash, 0, amount, pen, -amount)], date=date)
    return line_of(c, m, role(c, "receivable"))


def collect(c, cash, who, amount, date, state="posted"):
    """Te paga: Debe tu cuenta / Haber Por cobrar (persona). Devuelve el apunte del cobro."""
    pen = cur(c, "PEN")
    m = move(c, [(cash, amount, 0, pen, amount), (role(c, "receivable"), 0, amount, pen, -amount, who)],
             state=state, date=date)
    return line_of(c, m, role(c, "receivable"))


def line_of(c, move_id, account_id) -> int:
    return c.execute("SELECT id FROM account_move_line WHERE move_id = %s AND account_id = %s",
                     (move_id, account_id)).fetchone()[0]


def residual(c, line_id) -> Decimal:
    return c.execute("SELECT amount_residual FROM account_move_line_residual WHERE id = %s",
                     (line_id,)).fetchone()[0]


def reconcile(c, who, account_role="receivable") -> int:
    return c.execute("SELECT reconcile_partner(%s, %s)", (who, role(c, account_role))).fetchone()[0]


# --- Deudas incobrables -----------------------------------------------------------------------

def test_deudas_incobrables_es_cuenta_de_sistema(ana):
    name, parent, kind = ana.execute(
        "SELECT a.name, p.name, a.account_type FROM account_account a"
        " JOIN account_account p ON p.id = a.parent_id WHERE a.id = system_account('bad_debt')").fetchone()
    assert (name, parent, kind) == ("Deudas incobrables", "Gastos financieros", "expense")


def test_deudas_incobrables_no_se_archiva(ana):
    with pytest.raises(psycopg.errors.RaiseException, match="la usa la app"):
        ana.execute("UPDATE account_account SET active = false WHERE id = system_account('bad_debt')")


# --- Conciliación -----------------------------------------------------------------------------

def test_un_cobro_cancela_la_deuda_mas_antigua_primero(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("100.00"), "2026-10-10")
    cine = lend(ana, cash, sandra, Decimal("50.00"), "2026-10-12")
    pago = collect(ana, cash, sandra, Decimal("120.00"), "2026-10-15")
    commit_check(ana)

    assert reconcile(ana, sandra) == 2
    assert residual(ana, cena) == 0
    assert residual(ana, cine) == Decimal("30.00")
    assert residual(ana, pago) == 0


def test_un_pago_parcial_deja_lo_que_falta(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("100.00"), "2026-10-10")
    collect(ana, cash, sandra, Decimal("60.00"), "2026-10-15")
    reconcile(ana, sandra)
    assert residual(ana, cena) == Decimal("40.00")


def test_conciliar_dos_veces_no_duplica(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("100.00"), "2026-10-10")
    collect(ana, cash, sandra, Decimal("60.00"), "2026-10-15")
    reconcile(ana, sandra)
    assert reconcile(ana, sandra) == 0
    assert residual(ana, cena) == Decimal("40.00")


def test_lo_que_debo_se_concilia_igual(ana):
    cash, sandra, pen = bcp(ana), person(ana, "Sandra"), cur(ana, "PEN")
    payable = role(ana, "payable")
    cine = line_of(ana, move(ana, [(cash, 50, 0, pen, 50), (payable, 0, 50, pen, -50, sandra)],
                             date="2026-10-20"), payable)
    pago = line_of(ana, move(ana, [(payable, 50, 0, pen, 50, sandra), (cash, 0, 50, pen, -50)],
                             date="2026-10-22"), payable)
    reconcile(ana, sandra, "payable")
    assert residual(ana, cine) == 0 and residual(ana, pago) == 0


def test_no_se_mezclan_monedas(ana):
    cash, sandra, usd = bcp(ana), person(ana, "Sandra"), cur(ana, "USD")
    receivable = role(ana, "receivable")
    deuda = line_of(ana, move(ana, [(receivable, Decimal("375.00"), 0, usd, Decimal("100.00"), sandra),
                                    (cash, 0, Decimal("375.00"), cur(ana, "PEN"), Decimal("-375.00"))],
                              date="2026-10-10"), receivable)
    collect(ana, cash, sandra, Decimal("375.00"), "2026-10-15")
    assert reconcile(ana, sandra) == 0
    assert residual(ana, deuda) == Decimal("100.00")


def test_no_se_concilia_mas_de_lo_que_falta(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, sandra, Decimal("60.00"), "2026-10-15")
    with pytest.raises(psycopg.errors.CheckViolation, match="supera lo que falta"):
        ana.execute("INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)"
                    " VALUES (%s, %s, 50)", (cena, pago))


def test_no_se_concilia_con_otra_persona(ana):
    cash, sandra, luis = bcp(ana), person(ana, "Sandra"), person(ana, "Luis")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, luis, Decimal("40.00"), "2026-10-15")
    with pytest.raises(psycopg.errors.CheckViolation, match="misma cuenta, persona y moneda"):
        ana.execute("INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)"
                    " VALUES (%s, %s, 40)", (cena, pago))


def test_lo_por_confirmar_no_cancela_deudas(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, sandra, Decimal("40.00"), "2026-10-15", state="draft")
    assert reconcile(ana, sandra) == 0
    with pytest.raises(psycopg.errors.CheckViolation, match="confirmados"):
        ana.execute("INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)"
                    " VALUES (%s, %s, 40)", (cena, pago))


def test_pasar_a_por_confirmar_deshace_la_conciliacion(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, sandra, Decimal("40.00"), "2026-10-15")
    reconcile(ana, sandra)
    ana.execute("UPDATE account_move SET state = 'draft' WHERE id = (SELECT move_id FROM account_move_line"
                " WHERE id = %s)", (pago,))
    assert residual(ana, cena) == Decimal("40.00")
    assert ana.execute("SELECT count(*) FROM account_partial_reconcile").fetchone()[0] == 0


def test_borrar_el_cobro_devuelve_la_deuda(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, sandra, Decimal("40.00"), "2026-10-15")
    reconcile(ana, sandra)
    ana.execute("DELETE FROM account_move WHERE id = (SELECT move_id FROM account_move_line WHERE id = %s)",
                (pago,))
    assert residual(ana, cena) == Decimal("40.00")


def test_cambiar_el_monto_deshace_la_conciliacion(ana):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    cena = lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    pago = collect(ana, cash, sandra, Decimal("40.00"), "2026-10-15")
    reconcile(ana, sandra)
    ana.execute("UPDATE account_move_line SET credit = 30, amount_currency = -30 WHERE id = %s", (pago,))
    assert residual(ana, cena) == Decimal("40.00")


def test_saldo_por_persona(ana):
    cash, sandra, pen = bcp(ana), person(ana, "Sandra"), cur(ana, "PEN")
    lend(ana, cash, sandra, Decimal("39.00"), "2026-10-18")
    move(ana, [(cash, 50, 0, pen, 50), (role(ana, "payable"), 0, 50, pen, -50, sandra)], date="2026-10-20")
    rows = dict(ana.execute("SELECT system_role, amount_currency FROM res_partner_balance"
                            " WHERE partner_id = %s", (sandra,)).fetchall())
    assert rows == {"receivable": Decimal("39.00"), "payable": Decimal("-50.00")}


def test_nadie_ve_las_conciliaciones_de_otro(ana, new_user, as_user):
    cash, sandra = bcp(ana), person(ana, "Sandra")
    lend(ana, cash, sandra, Decimal("40.00"), "2026-10-10")
    collect(ana, cash, sandra, Decimal("40.00"), "2026-10-15")
    reconcile(ana, sandra)
    luis = as_user(new_user("luis@correo.com", "Luis"))
    assert luis.execute("SELECT count(*) FROM account_partial_reconcile").fetchone()[0] == 0
    assert luis.execute("SELECT count(*) FROM account_move_line_residual").fetchone()[0] == 0
