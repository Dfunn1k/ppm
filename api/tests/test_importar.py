"""Importar extractos y Por clasificar: la huella, el enlace, Por clasificar, clasificar, deshacer,
el control de saldo y los adjuntos (migración 0015)."""

from decimal import Decimal

import psycopg
import pytest

from app.db import act_as_user
from tests.test_asientos import account, balance, commit_check, cur, move, role


@pytest.fixture
def ana(new_user, as_user):
    """Ana, configurada en Perú con dólares; la conexión trabaja como ella."""
    uid = new_user("ana@correo.com", "Ana")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")
    return c


def bcp(c, name="Cuenta digital BCP", currency="PEN", opening="1000", date="2026-09-30") -> int:
    return c.execute("SELECT create_bank_account(%s, %s, 2::smallint, 'savings', NULL, NULL, %s, %s)",
                     (name, cur(c, currency), Decimal(opening), date)).fetchone()[0]


def statement(c, acc, name="movimientos-oct.xlsx", end=None) -> int:
    return c.execute("INSERT INTO account_bank_statement (account_id, name, date_from, date_to, balance_end_real)"
                     " VALUES (%s, %s, '2026-10-01', '2026-10-26', %s) RETURNING id",
                     (acc, name, end)).fetchone()[0]


def line(c, st, when, ref, amount, op=None, currency="PEN", nth=1) -> str:
    return c.execute("SELECT import_statement_line(%s, %s, %s, %s, %s, %s, %s::smallint)",
                     (st, when, ref, op, Decimal(amount), cur(c, currency), nth)).fetchone()[0]


def imported_move(c, ref) -> int:
    return c.execute("SELECT move_id FROM account_bank_statement_line WHERE payment_ref = %s"
                     " ORDER BY id DESC LIMIT 1", (ref,)).fetchone()[0]


def pending(c) -> int:
    """Cuántos movimientos hay en Por clasificar."""
    return c.execute("SELECT count(*) FROM account_move_line WHERE account_id = %s",
                     (role(c, "suspense"),)).fetchone()[0]


def bank_lines(c, st) -> int:
    return c.execute("SELECT count(*) FROM account_bank_statement_line WHERE statement_id = %s",
                     (st,)).fetchone()[0]


# --- Importar una línea -------------------------------------------------------------------------

def test_lo_nuevo_entra_confirmado_contra_por_clasificar(ana):
    acc = bcp(ana)
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40", op="06771621") == "created"
    commit_check(ana)
    m = imported_move(ana, "POS PLAZA VEA SURCO")
    state, ref = ana.execute("SELECT state, ref FROM account_move WHERE id = %s", (m,)).fetchone()
    assert (state, ref) == ("posted", "POS PLAZA VEA SURCO")      # la glosa empieza como la del banco
    assert balance(ana, acc) == (Decimal("813.60"), Decimal("813.60"))
    assert balance(ana, role(ana, "suspense")) == (Decimal("186.40"), Decimal("186.40"))
    op, created = ana.execute("SELECT operation_number, move_created FROM account_bank_statement_line"
                              " WHERE move_id = %s", (m,)).fetchone()
    assert (op, created) == ("06771621", True)                    # los ceros a la izquierda se quedan


def test_con_numero_de_operacion_no_se_importa_dos_veces(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-23", "POS PLAZA VEA SURCO", "-186.40", op="06771621")
    otro = statement(ana, acc, "movimientos-oct-2.xlsx")
    assert line(ana, otro, "2026-10-23", "POS PLAZA VEA", "-186.40", op="06771621") == "duplicate"
    assert bank_lines(ana, otro) == 0
    assert pending(ana) == 1


def test_dos_cafes_iguales_el_mismo_dia_no_son_uno_repetido(ana):
    acc = bcp(ana)
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-06", "POS STARBUCKS", "-12.90", nth=1) == "created"
    assert line(ana, st, "2026-10-06", "POS STARBUCKS", "-12.90", nth=2) == "created"
    otro = statement(ana, acc, "otra-vez.csv")
    assert line(ana, otro, "2026-10-06", "POS STARBUCKS", "-12.90", nth=1) == "duplicate"
    assert line(ana, otro, "2026-10-06", "POS STARBUCKS", "-12.900", nth=2) == "duplicate"
    commit_check(ana)
    assert pending(ana) == 2


def test_lo_que_anotaste_a_mano_se_enlaza(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    hand = move(ana, [(account(ana, "Supermercado y mercado"), 186.40, 0, pen, 186.40),
                      (acc, 0, 186.40, pen, -186.40)], date="2026-10-21")
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40") == "matched"
    commit_check(ana)
    m, created = ana.execute("SELECT move_id, move_created FROM account_bank_statement_line"
                             " WHERE statement_id = %s", (st,)).fetchone()
    assert (m, created) == (hand, False)
    assert pending(ana) == 0
    assert balance(ana, acc) == (Decimal("813.60"), Decimal("813.60"))


def test_a_mas_de_3_dias_no_se_enlaza(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Supermercado y mercado"), 186.40, 0, pen, 186.40),
               (acc, 0, 186.40, pen, -186.40)], date="2026-10-19")
    assert line(ana, statement(ana, acc), "2026-10-23", "POS PLAZA VEA SURCO", "-186.40") == "created"


def test_un_movimiento_se_enlaza_una_sola_vez(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Cafés y bares"), 12.90, 0, pen, 12.90), (acc, 0, 12.90, pen, -12.90)],
         date="2026-10-06")
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-06", "POS STARBUCKS", "-12.90", nth=1) == "matched"
    assert line(ana, st, "2026-10-06", "POS STARBUCKS", "-12.90", nth=2) == "created"


def test_un_borrador_que_llega_del_banco_se_confirma(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    draft = move(ana, [(account(ana, "Servicios"), 89, 0, pen, 89), (acc, 0, 89, pen, -89)],
                 state="draft", date="2026-10-15")
    assert line(ana, statement(ana, acc), "2026-10-15", "PAGO LUZ DEL SUR", "-89.00") == "matched"
    commit_check(ana)
    assert ana.execute("SELECT state FROM account_move WHERE id = %s", (draft,)).fetchone()[0] == "posted"


def test_la_otra_mitad_de_una_transferencia_se_enlaza(ana):
    bcp_acc, ibk = bcp(ana), bcp(ana, "Interbank Sueldo", opening="0")
    line(ana, statement(ana, bcp_acc), "2026-10-20", "TRANSF. A INTERBANK", "-1000")
    ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "TRANSF. A INTERBANK"), ibk))
    st = statement(ana, ibk, "interbank-oct.csv")
    assert line(ana, st, "2026-10-21", "TRANSF. DE BCP", "1000") == "matched"
    commit_check(ana)
    assert balance(ana, ibk) == (Decimal("1000.00"), Decimal("1000.00"))
    assert pending(ana) == 0


def test_en_un_periodo_cerrado_o_en_el_futuro_no_entra(ana):
    acc = bcp(ana)
    st = statement(ana, acc)
    ana.execute("UPDATE res_users SET lock_date = '2026-10-10'")
    assert line(ana, st, "2026-10-10", "COMISION", "-9") == "locked"
    assert line(ana, st, "2099-01-01", "DEL FUTURO", "-9") == "future"
    assert bank_lines(ana, st) == 0
    assert pending(ana) == 0


def test_una_linea_en_otra_moneda_que_la_cuenta_se_rechaza(ana):
    st = statement(ana, bcp(ana))
    with pytest.raises(psycopg.errors.CheckViolation):
        line(ana, st, "2026-10-23", "POS", "-10", currency="USD")


def test_borrar_un_movimiento_importado_lo_deja_volver(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-23", "POS PLAZA VEA SURCO", "-186.40", op="06771621")
    ana.execute("DELETE FROM account_move WHERE id = %s", (imported_move(ana, "POS PLAZA VEA SURCO"),))
    assert line(ana, statement(ana, acc, "otra-vez.xlsx"), "2026-10-23", "POS PLAZA VEA SURCO",
                "-186.40", op="06771621") == "created"


# --- Clasificar ---------------------------------------------------------------------------------

def test_clasificar_en_una_categoria(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-23", "POS PLAZA VEA SURCO", "-186.40")
    super_ = account(ana, "Supermercado y mercado")
    ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "POS PLAZA VEA SURCO"), super_))
    commit_check(ana)
    assert pending(ana) == 0
    assert balance(ana, super_) == (Decimal("186.40"), Decimal("186.40"))


def test_una_entrada_en_una_categoria_de_gasto_es_un_reembolso(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-23", "DEVOLUCION SAGA", "50")
    ropa = account(ana, "Ropa y calzado")
    ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "DEVOLUCION SAGA"), ropa))
    commit_check(ana)
    assert balance(ana, ropa) == (Decimal("-50.00"), Decimal("-50.00"))


def test_por_cobrar_pide_la_persona(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-22", "YAPE A JUAN PER", "-50", op="004512")
    m = imported_move(ana, "YAPE A JUAN PER")
    with pytest.raises(psycopg.errors.CheckViolation):
        ana.execute("SELECT classify_move(%s, %s)", (m, role(ana, "receivable")))


def test_le_preste_a_juan(ana):
    acc = bcp(ana)
    juan = ana.execute("INSERT INTO res_partner (name) VALUES ('Juan Pérez') RETURNING id").fetchone()[0]
    line(ana, statement(ana, acc), "2026-10-22", "YAPE A JUAN PER", "-50", op="004512")
    ana.execute("SELECT classify_move(%s, %s, %s)", (imported_move(ana, "YAPE A JUAN PER"), role(ana, "receivable"), juan))
    commit_check(ana)
    debe = ana.execute("SELECT amount_currency FROM res_partner_balance WHERE partner_id = %s", (juan,)).fetchone()[0]
    assert debe == Decimal("50.00")


def test_a_una_cuenta_en_otra_moneda_no_se_clasifica(ana):
    acc = bcp(ana)
    usd = bcp(ana, "Ahorros BBVA", currency="USD", opening="0")
    line(ana, statement(ana, acc), "2026-10-20", "COMPRA DOLARES", "-375")
    with pytest.raises(psycopg.errors.CheckViolation):
        ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "COMPRA DOLARES"), usd))


def test_solo_se_clasifica_lo_que_esta_por_clasificar(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    m = move(ana, [(account(ana, "Cafés y bares"), 10, 0, pen, 10), (acc, 0, 10, pen, -10)])
    with pytest.raises(psycopg.errors.NoDataFound):
        ana.execute("SELECT classify_move(%s, %s)", (m, account(ana, "Hogar")))


def test_no_se_clasifica_en_por_clasificar_ni_en_saldos_iniciales(ana):
    acc = bcp(ana)
    line(ana, statement(ana, acc), "2026-10-20", "RARO", "-5")
    with pytest.raises(psycopg.errors.CheckViolation):
        ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "RARO"), role(ana, "opening")))


def test_dolares_clasificados_en_una_categoria_pasan_a_soles(ana, conn):
    conn.execute("RESET ROLE")
    conn.execute("INSERT INTO res_currency_rate (currency_id, name, rate_buy, rate_sell)"
                 " VALUES (%s, '2000-01-03', 3.5, 3.6)", (cur(conn, "USD"),))
    uid = conn.execute("SELECT id FROM res_users WHERE login = 'ana@correo.com'").fetchone()[0]
    act_as_user(conn, uid)
    usd = bcp(conn, "Ahorros BBVA", currency="USD", opening="0", date="2000-01-01")
    line(conn, statement(conn, usd, "bbva.csv"), "2000-01-04", "AMAZON", "-10", currency="USD")
    hogar = account(conn, "Hogar")
    conn.execute("SELECT classify_move(%s, %s)", (imported_move(conn, "AMAZON"), hogar))
    commit_check(conn)
    assert balance(conn, hogar) == (Decimal("35.00"), Decimal("35.00"))   # a la compra: es lo que tienes


# --- Deshacer -----------------------------------------------------------------------------------

def test_deshacer_borra_solo_lo_que_sigue_por_clasificar(ana):
    acc = bcp(ana)
    pen = cur(ana, "PEN")
    hand = move(ana, [(account(ana, "Servicios"), 89, 0, pen, 89), (acc, 0, 89, pen, -89)], date="2026-10-15")
    st = statement(ana, acc)
    line(ana, st, "2026-10-15", "PAGO LUZ", "-89")                      # se enlaza
    line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40")       # se clasifica
    line(ana, st, "2026-10-22", "YAPE A JUAN PER", "-50")               # sigue por clasificar
    clasificado = imported_move(ana, "POS PLAZA VEA SURCO")
    ana.execute("SELECT classify_move(%s, %s)", (clasificado, account(ana, "Supermercado y mercado")))
    assert ana.execute("SELECT undo_bank_statement(%s)", (st,)).fetchone()[0] == 1
    commit_check(ana)
    quedan = {r[0] for r in ana.execute("SELECT id FROM account_move WHERE id IN (%s, %s)", (hand, clasificado))}
    assert quedan == {hand, clasificado}
    assert pending(ana) == 0
    assert ana.execute("SELECT count(*) FROM account_bank_statement").fetchone()[0] == 0
    assert ana.execute("SELECT count(*) FROM account_bank_statement_line").fetchone()[0] == 0


def test_tras_deshacer_reimportar_no_duplica(ana):
    acc = bcp(ana)
    st = statement(ana, acc)
    line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40", op="06771621")
    ana.execute("SELECT classify_move(%s, %s)", (imported_move(ana, "POS PLAZA VEA SURCO"),
                                                 account(ana, "Supermercado y mercado")))
    ana.execute("SELECT undo_bank_statement(%s)", (st,))
    otra = statement(ana, acc, "otra-vez.xlsx")
    assert line(ana, otra, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40", op="06771621") == "matched"


# --- Control de saldo ---------------------------------------------------------------------------

def test_el_saldo_cuadra_o_dice_cuanto_falta(ana):
    acc = bcp(ana)
    st = statement(ana, acc, end=Decimal("813.60"))
    line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40")
    falta = statement(ana, acc, "mal.csv", end=Decimal("804.60"))
    rows = dict(ana.execute("SELECT id, difference FROM account_bank_statement_check").fetchall())
    assert rows == {st: Decimal("0.00"), falta: Decimal("-9.00")}


def test_una_cuenta_con_extractos_no_se_borra(ana):
    acc = ana.execute("INSERT INTO account_account (name, account_type, currency_id)"
                      " VALUES ('Sin saldo', 'asset', %s) RETURNING id", (cur(ana, "PEN"),)).fetchone()[0]
    statement(ana, acc)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        ana.execute("DELETE FROM account_account WHERE id = %s", (acc,))


# --- Adjuntos -----------------------------------------------------------------------------------

SHA = "ab" + "1" * 38


def attach(c, model, res_id) -> int:
    return c.execute("INSERT INTO ir_attachment (res_model, res_id, name, mimetype, file_size, checksum,"
                     " store_fname) VALUES (%s, %s, 'movimientos-oct.xlsx', 'application/vnd.ms-excel',"
                     " 2048, %s, %s) RETURNING id", (model, res_id, SHA, f"ab/{SHA}")).fetchone()[0]


def test_el_archivo_queda_con_su_extracto_y_se_va_con_el(ana):
    st = statement(ana, bcp(ana))
    attach(ana, "account.bank.statement", st)
    ana.execute("SELECT undo_bank_statement(%s)", (st,))
    assert ana.execute("SELECT count(*) FROM ir_attachment").fetchone()[0] == 0


def test_borrar_el_movimiento_borra_sus_adjuntos(ana):
    pen = cur(ana, "PEN")
    m = move(ana, [(account(ana, "Cafés y bares"), 10, 0, pen, 10), (account(ana, "Efectivo"), 0, 10, pen, -10)])
    attach(ana, "account.move", m)
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    assert ana.execute("SELECT count(*) FROM ir_attachment").fetchone()[0] == 0


def test_no_se_adjunta_a_algo_que_no_existe(ana):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        attach(ana, "account.bank.statement", 999999)


# --- Aislamiento --------------------------------------------------------------------------------

def test_cada_uno_ve_solo_sus_extractos(new_user, as_user):
    ana = as_user(new_user("ana@correo.com"))
    ana.execute("SELECT setup_user('PE')")
    st = statement(ana, bcp(ana))
    line(ana, st, "2026-10-23", "POS PLAZA VEA SURCO", "-186.40")
    attach(ana, "account.bank.statement", st)
    beto = as_user(new_user("beto@correo.com"))
    beto.execute("SELECT setup_user('PE')")
    for t in ("account_bank_statement", "account_bank_statement_line", "ir_attachment"):
        assert beto.execute(f"SELECT count(*) FROM {t}").fetchone()[0] == 0
    with pytest.raises(psycopg.errors.NoDataFound):
        line(beto, st, "2026-10-24", "AJENO", "-1")


def test_nadie_adjunta_al_extracto_de_otro(new_user, as_user):
    ana = as_user(new_user("ana@correo.com"))
    ana.execute("SELECT setup_user('PE')")
    st = statement(ana, bcp(ana))
    beto = as_user(new_user("beto@correo.com"))
    beto.execute("SELECT setup_user('PE')")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        attach(beto, "account.bank.statement", st)
