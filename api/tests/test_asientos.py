"""Asientos, apuntes y altas de cuentas: las reglas que viven en la base."""

from decimal import Decimal

import psycopg
import pytest


@pytest.fixture
def ana(new_user, as_user):
    """Ana, configurada en Perú con dólares; la conexión trabaja como ella."""
    uid = new_user("ana@correo.com", "Ana")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")
    return c


def cur(c, code: str) -> int:
    return c.execute("SELECT id FROM res_currency WHERE name = %s", (code,)).fetchone()[0]


def account(c, name: str) -> int:
    return c.execute("SELECT id FROM account_account WHERE name = %s", (name,)).fetchone()[0]


def role(c, r: str) -> int:
    return c.execute("SELECT system_account(%s)", (r,)).fetchone()[0]


def bank(c, name: str) -> int:
    return c.execute("SELECT id FROM res_bank WHERE name = %s", (name,)).fetchone()[0]


def balance(c, account_id: int):
    return c.execute(
        "SELECT coalesce(sum(amount_currency), 0), coalesce(sum(balance), 0) FROM account_balance"
        " WHERE account_id = %s", (account_id,)).fetchone()


def move(c, lines, state="posted", date="2026-10-20"):
    """Escribe un asiento con sus apuntes: (cuenta, debe, haber, moneda, monto_en_moneda[, persona])."""
    m = c.execute("INSERT INTO account_move (date, ref, state) VALUES (%s, 'prueba', %s) RETURNING id",
                  (date, state)).fetchone()[0]
    for acc, debit, credit, currency, amount, *partner in lines:
        c.execute(
            "INSERT INTO account_move_line (move_id, account_id, partner_id, debit, credit, currency_id,"
            " amount_currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (m, acc, partner[0] if partner else None, debit, credit, currency, amount))
    return m


def commit_check(c):
    """El cuadre es diferido: se revisa al confirmar la transacción (aquí, en un savepoint final)."""
    c.execute("SET CONSTRAINTS ALL IMMEDIATE")


# --- Cuadre ---------------------------------------------------------------------------------

def test_un_asiento_cuadrado_se_acepta(ana):
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Restaurantes y delivery"), 35.50, 0, pen, 35.50),
               (account(ana, "Efectivo"), 0, 35.50, pen, -35.50)])
    commit_check(ana)
    assert balance(ana, account(ana, "Efectivo")) == (Decimal("-35.50"), Decimal("-35.50"))


def test_un_asiento_descuadrado_se_rechaza(ana):
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Restaurantes y delivery"), 35.50, 0, pen, 35.50),
               (account(ana, "Efectivo"), 0, 30.00, pen, -30.00)])
    with pytest.raises(psycopg.errors.CheckViolation, match="descuadrado"):
        commit_check(ana)


def test_un_borrador_puede_estar_incompleto_hasta_confirmarlo(ana):
    pen = cur(ana, "PEN")
    m = move(ana, [(account(ana, "Restaurantes y delivery"), 35.50, 0, pen, 35.50)], state="draft")
    commit_check(ana)
    ana.execute("SET CONSTRAINTS ALL DEFERRED")
    ana.execute("UPDATE account_move SET state = 'posted' WHERE id = %s", (m,))
    with pytest.raises(psycopg.errors.CheckViolation, match="descuadrado"):
        commit_check(ana)


def test_un_apunte_va_en_la_moneda_de_su_cuenta(ana):
    pen, usd = cur(ana, "PEN"), cur(ana, "USD")
    move(ana, [(account(ana, "Restaurantes y delivery"), 37.50, 0, pen, 37.50),
               (account(ana, "Efectivo"), 0, 37.50, usd, -10.00)])   # Efectivo es en soles
    with pytest.raises(psycopg.errors.CheckViolation, match="moneda de su cuenta"):
        commit_check(ana)


def test_en_moneda_base_el_monto_es_el_mismo(ana):
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Restaurantes y delivery"), 35.50, 0, pen, 30.00),
               (account(ana, "Efectivo"), 0, 35.50, pen, -35.50)])
    with pytest.raises(psycopg.errors.CheckViolation, match="moneda base"):
        commit_check(ana)


def test_una_categoria_que_agrupa_no_recibe_movimientos(ana):
    pen = cur(ana, "PEN")
    with pytest.raises(psycopg.errors.CheckViolation, match="agrupa otras cuentas"):
        move(ana, [(account(ana, "Comida y bebida"), 10, 0, pen, 10)])


def test_lo_que_guardo_de_otros_exige_persona(ana):
    pen = cur(ana, "PEN")
    with pytest.raises(psycopg.errors.CheckViolation, match="necesita una persona"):
        move(ana, [(role(ana, "custody"), 0, 50, pen, -50)])


def test_con_movimientos_la_cuenta_no_cambia_de_moneda(ana):
    efectivo = account(ana, "Efectivo")
    ana.execute("SELECT post_opening_balance(%s, 100, '2026-10-01')", (efectivo,))
    with pytest.raises(psycopg.errors.CheckViolation, match="ya tiene movimientos"):
        ana.execute("UPDATE account_account SET currency_id = %s WHERE id = %s", (cur(ana, "USD"), efectivo))


# --- Saldos iniciales y altas ----------------------------------------------------------------

def test_saldo_inicial_en_soles(ana):
    efectivo = account(ana, "Efectivo")
    ana.execute("SELECT post_opening_balance(%s, 320, '2026-10-01')", (efectivo,))
    commit_check(ana)
    assert balance(ana, efectivo) == (Decimal("320.00"), Decimal("320.00"))
    assert balance(ana, role(ana, "opening")) == (Decimal("-320.00"), Decimal("-320.00"))


def test_cuenta_de_banco_en_dolares_con_tipo_de_cambio(ana):
    acc = ana.execute(
        "SELECT create_bank_account('Ahorros BBVA', %s, %s, 'savings', '0011-0123-0200456789',"
        " '01100101234567890123', 1520, '2026-10-01', 3.75)",
        (cur(ana, "USD"), bank(ana, "BBVA"))).fetchone()[0]
    commit_check(ana)
    assert balance(ana, acc) == (Decimal("1520.00"), Decimal("5700.00"))   # dólares y su valor en soles
    assert balance(ana, role(ana, "opening")) == (Decimal("-5700.00"), Decimal("-5700.00"))
    kind, number, cci = ana.execute(
        "SELECT acc_kind, acc_number, cci FROM res_partner_bank WHERE account_id = %s", (acc,)).fetchone()
    assert (kind, number, cci) == ("savings", "0011-0123-0200456789", "01100101234567890123")


def test_el_cci_tiene_que_ser_de_ese_banco(ana):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        ana.execute("SELECT create_bank_account('Cuenta BCP', %s, %s, 'savings', NULL,"
                    " '01100101234567890123')",   # empieza con 011: es de BBVA
                    (cur(ana, "PEN"), bank(ana, "BCP")))


def test_una_cuenta_en_dolares_pide_tipo_de_cambio(ana):
    with pytest.raises(psycopg.errors.CheckViolation, match="tipo de cambio"):
        ana.execute("SELECT create_cash_account('Sobre de dólares', %s, 200, '2026-10-01', 0)",
                    (cur(ana, "USD"),))


def test_saldo_cero_no_crea_asiento(ana):
    acc = ana.execute("SELECT create_cash_account('Alcancía', %s, 0)", (cur(ana, "PEN"),)).fetchone()[0]
    assert ana.execute("SELECT count(*) FROM account_move_line WHERE account_id = %s", (acc,)).fetchone()[0] == 0


def test_sobregiro_inicial_negativo(ana):
    acc = ana.execute("SELECT create_bank_account('Corriente BCP', %s, %s, 'checking', NULL, NULL, -150,"
                      " '2026-10-01')", (cur(ana, "PEN"), bank(ana, "BCP"))).fetchone()[0]
    commit_check(ana)
    assert balance(ana, acc) == (Decimal("-150.00"), Decimal("-150.00"))


def test_plata_que_guardo_de_otros(ana):
    sandra = ana.execute("INSERT INTO res_partner (name) VALUES ('Sandra Machado') RETURNING id").fetchone()[0]
    ana.execute("SELECT post_custody_opening(%s, %s, 200, '2026-10-01')", (sandra, cur(ana, "PEN")))
    ana.execute("SELECT post_custody_opening(%s, %s, 50, '2026-10-01', 3.75)", (sandra, cur(ana, "USD")))
    commit_check(ana)
    rows = ana.execute(
        "SELECT c.name, l.partner_id, l.amount_currency, l.balance FROM account_move_line l"
        " JOIN res_currency c ON c.id = l.currency_id WHERE l.account_id = %s ORDER BY c.name",
        (role(ana, "custody"),)).fetchall()
    # Pasivo: lo que guardas va al Haber (negativo), en su moneda y con la persona
    assert [(n.strip(), p, a, b) for n, p, a, b in rows] == [
        ("PEN", sandra, Decimal("-200.00"), Decimal("-200.00")),
        ("USD", sandra, Decimal("-50.00"), Decimal("-187.50")),
    ]


def test_corregir_el_saldo_inicial_reemplaza_el_asiento(ana):
    efectivo = account(ana, "Efectivo")
    ana.execute("SELECT post_opening_balance(%s, 320, '2026-10-01')", (efectivo,))
    ana.execute("SELECT set_opening_balance(%s, 300, '2026-10-05')", (efectivo,))
    commit_check(ana)
    assert balance(ana, efectivo) == (Decimal("300.00"), Decimal("300.00"))
    assert ana.execute("SELECT count(*) FROM account_move").fetchone()[0] == 1


def test_saldo_despues_de_cada_movimiento(ana):
    pen = cur(ana, "PEN")
    efectivo = account(ana, "Efectivo")
    ana.execute("SELECT post_opening_balance(%s, 320, '2026-10-01')", (efectivo,))
    move(ana, [(account(ana, "Restaurantes y delivery"), 35.50, 0, pen, 35.50),
               (efectivo, 0, 35.50, pen, -35.50)], date="2026-10-02")
    commit_check(ana)
    rows = ana.execute("SELECT ref, amount_currency, running_amount_currency FROM account_move_line_running"
                       " WHERE account_id = %s ORDER BY date, move_id", (efectivo,)).fetchall()
    assert rows == [("Saldo inicial", Decimal("320.00"), Decimal("320.00")),
                    ("prueba", Decimal("-35.50"), Decimal("284.50"))]


# --- Aislamiento ----------------------------------------------------------------------------

def test_nadie_apunta_a_la_cuenta_de_otro(new_user, as_user):
    beto = new_user("beto@correo.com", "Beto")
    as_user(beto).execute("SELECT setup_user('PE')")
    c = as_user(beto)
    beto_efectivo = c.execute("SELECT id FROM account_account WHERE name = 'Efectivo'").fetchone()[0]

    ana = new_user("ana@correo.com", "Ana")
    c = as_user(ana)
    c.execute("SELECT setup_user('PE')")
    m = c.execute("INSERT INTO account_move (date, ref) VALUES ('2026-10-01', 'x') RETURNING id").fetchone()[0]
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        c.execute("INSERT INTO account_move_line (move_id, account_id, debit, currency_id, amount_currency)"
                  " VALUES (%s, %s, 10, (SELECT currency_id FROM res_users), 10)", (m, beto_efectivo))


def test_cada_uno_ve_solo_sus_asientos_y_saldos(new_user, as_user):
    ana = new_user("ana@correo.com", "Ana")
    c = as_user(ana)
    c.execute("SELECT setup_user('PE')")
    c.execute("SELECT create_cash_account('Billetera', (SELECT currency_id FROM res_users), 99)")

    beto = new_user("beto@correo.com", "Beto")
    c = as_user(beto)
    c.execute("SELECT setup_user('PE')")
    assert c.execute("SELECT count(*) FROM account_move").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM account_balance").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM res_partner_bank").fetchone()[0] == 0
