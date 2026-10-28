"""Recurrentes y préstamos de banco (migración 0017): las fechas de la regla, generar sin duplicar,
los modos (automática, por confirmar, recordatorio), «solo esta vez», el periodo cerrado, el
flujo futuro, el fin de una recurrencia, la ficha del préstamo y el enlace con lo importado."""

from datetime import date
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, bank, commit_check, cur
from tests.test_importar import ana, bcp, line, statement  # noqa: F401


def recurring(c, name, lines, *, interval="month", days=(5,), start="2026-08-01", post_mode=None,
              amount_type="fixed", end_type="never", max_count=None, date_end=None, every=1,
              mode=None, weekday=None, nth=None, lead=0) -> int:
    """Una plantilla con su regla y sus líneas: (cuenta, monto) con + al debe y − al haber."""
    month_mode = mode or ("days" if interval == "month" else None)
    r = c.execute("""
        INSERT INTO account_recurring (name, currency_id, interval_type, interval_count, month_day_mode,
                                       month_days, weekday, nth, date_start, end_type, max_count, date_end,
                                       amount_type, post_mode, lead_days)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (name, cur(c, "PEN"), interval, every, month_mode,
         list(days) if month_mode == "days" else None, weekday, nth, start, end_type, max_count, date_end,
         amount_type, post_mode, lead)).fetchone()[0]
    for acc, amount in lines:
        c.execute("INSERT INTO account_recurring_line (recurring_id, account_id, amount) VALUES (%s, %s, %s)",
                  (r, acc, Decimal(amount)))
    return r


def dates(c, r, until) -> list[date]:
    return [d for (d,) in c.execute("SELECT occurrence_date FROM account_recurring_dates(%s, %s)", (r, until))]


def run(c, today) -> int:
    return c.execute("SELECT account_recurring_run(%s)", (today,)).fetchone()[0]


def generated(c, r) -> list[tuple]:
    """(fecha, fecha original, estado, total al debe) de cada asiento de la recurrencia."""
    return c.execute("""
        SELECT m.date, m.recurring_date, m.state, sum(l.debit)
          FROM account_move m JOIN account_move_line l ON l.move_id = m.id
         WHERE m.recurring_id = %s GROUP BY m.id ORDER BY m.recurring_date""", (r,)).fetchall()


def d(s: str) -> date:
    return date.fromisoformat(s)


# --- Las fechas de la regla -----------------------------------------------------------------------

def test_el_31_es_el_ultimo_dia_de_cada_mes(ana):
    r = recurring(ana, "Ahorro", [(account(ana, "Servicios"), 10), (bcp(ana), -10)], days=(15, 31),
                  start="2027-01-01")
    assert dates(ana, r, "2027-03-31") == [d("2027-01-15"), d("2027-01-31"), d("2027-02-15"), d("2027-02-28"),
                                           d("2027-03-15"), d("2027-03-31")]


def test_el_segundo_martes_y_el_ultimo_viernes(ana):
    acc = bcp(ana)
    martes = recurring(ana, "Club", [(account(ana, "Servicios"), 10), (acc, -10)], mode="nth_weekday",
                       weekday=2, nth=2, start="2026-10-01")
    assert dates(ana, martes, "2026-12-31") == [d("2026-10-13"), d("2026-11-10"), d("2026-12-08")]
    viernes = recurring(ana, "Junta", [(account(ana, "Servicios"), 10), (acc, -10)], mode="nth_weekday",
                        weekday=5, nth=-1, start="2026-10-01")
    assert dates(ana, viernes, "2026-12-31") == [d("2026-10-30"), d("2026-11-27"), d("2026-12-25")]


def test_cada_dos_semanas_y_con_un_numero_de_veces(ana):
    r = recurring(ana, "Clases", [(account(ana, "Servicios"), 10), (bcp(ana), -10)], interval="week",
                  every=2, start="2026-10-01", end_type="count", max_count=3)
    assert dates(ana, r, "2027-12-31") == [d("2026-10-01"), d("2026-10-15"), d("2026-10-29")]


def test_no_empieza_antes_de_su_fecha(ana):
    r = recurring(ana, "Gym", [(account(ana, "Servicios"), 10), (bcp(ana), -10)], days=(5,), start="2026-08-10")
    assert dates(ana, r, "2026-10-31")[0] == d("2026-09-05")


def test_una_plantilla_que_no_cuadra_se_rechaza(ana):
    recurring(ana, "Mal", [(account(ana, "Servicios"), 10), (bcp(ana), -9)])
    with pytest.raises(psycopg.errors.CheckViolation, match="no cuadra"):
        commit_check(ana)


# --- Generar --------------------------------------------------------------------------------------

def test_una_automatica_se_confirma_y_nunca_se_duplica(ana):
    acc = bcp(ana)
    r = recurring(ana, "Netflix", [(account(ana, "Software y apps"), "44.90"), (acc, "-44.90")])
    assert run(ana, "2026-10-20") == 3
    assert generated(ana, r) == [(d("2026-08-05"), d("2026-08-05"), "posted", Decimal("44.90")),
                                 (d("2026-09-05"), d("2026-09-05"), "posted", Decimal("44.90")),
                                 (d("2026-10-05"), d("2026-10-05"), "posted", Decimal("44.90"))]
    assert run(ana, "2026-10-20") == 0
    commit_check(ana)
    assert ana.execute("SELECT generated_until FROM account_recurring WHERE id = %s", (r,)).fetchone()[0] \
        == d("2026-10-05")


def test_con_dias_de_anticipo_nace_por_confirmar_y_se_confirma_al_llegar(ana):
    r = recurring(ana, "Alquiler", [(account(ana, "Servicios"), 1200), (bcp(ana), -1200)], days=(25,),
                  start="2026-10-01", lead=7)
    assert run(ana, "2026-10-20") == 1
    assert generated(ana, r)[0][2] == "draft"            # el 25 todavía no llega
    run(ana, "2026-10-25")
    assert generated(ana, r)[0][2] == "posted"


def test_una_de_monto_variable_queda_por_confirmar(ana):
    r = recurring(ana, "Luz del Sur", [(account(ana, "Servicios"), 120), (bcp(ana), -120)], days=(12,),
                  start="2026-10-01", amount_type="variable")
    run(ana, "2026-10-20")
    assert generated(ana, r) == [(d("2026-10-12"), d("2026-10-12"), "draft", Decimal("120.00"))]


def test_solo_esta_vez_saltar_mover_y_cambiar_el_monto(ana):
    r = recurring(ana, "Luz del Sur", [(account(ana, "Servicios"), 120), (bcp(ana), -120)], days=(12,),
                  start="2026-07-01")
    ana.execute("INSERT INTO account_recurring_exception (recurring_id, occurrence_date, action) VALUES"
                " (%s, '2026-07-12', 'skip')", (r,))
    ana.execute("INSERT INTO account_recurring_exception (recurring_id, occurrence_date, action, new_date) VALUES"
                " (%s, '2026-08-12', 'modify', '2026-08-16')", (r,))
    ana.execute("INSERT INTO account_recurring_exception (recurring_id, occurrence_date, action, new_total) VALUES"
                " (%s, '2026-09-12', 'modify', 140)", (r,))
    run(ana, "2026-09-30")
    assert generated(ana, r) == [(d("2026-08-16"), d("2026-08-12"), "posted", Decimal("120.00")),
                                 (d("2026-09-12"), d("2026-09-12"), "posted", Decimal("140.00"))]


def test_en_un_periodo_cerrado_va_al_primer_dia_abierto_por_confirmar(ana):
    r = recurring(ana, "Netflix", [(account(ana, "Software y apps"), "44.90"), (bcp(ana), "-44.90")],
                  start="2026-09-01")
    ana.execute("UPDATE res_users SET lock_date = '2026-09-30' WHERE id = current_user_id()")
    run(ana, "2026-10-20")
    assert generated(ana, r) == [(d("2026-10-01"), d("2026-09-05"), "draft", Decimal("44.90")),
                                 (d("2026-10-05"), d("2026-10-05"), "posted", Decimal("44.90"))]


def test_con_fin_queda_terminada(ana):
    r = recurring(ana, "Curso", [(account(ana, "Servicios"), 100), (bcp(ana), -100)], start="2026-08-01",
                  end_type="count", max_count=2)
    run(ana, "2026-10-20")
    assert len(generated(ana, r)) == 2
    assert ana.execute("SELECT state FROM account_recurring WHERE id = %s", (r,)).fetchone()[0] == "done"


def test_una_pausada_no_genera(ana):
    r = recurring(ana, "Gym", [(account(ana, "Servicios"), 100), (bcp(ana), -100)], start="2026-08-01")
    ana.execute("UPDATE account_recurring SET state = 'paused' WHERE id = %s", (r,))
    assert run(ana, "2026-10-20") == 0


# --- Recordatorios y flujo futuro -----------------------------------------------------------------

def test_un_recordatorio_no_crea_asientos_y_se_ve_hasta_atenderlo(ana):
    r = recurring(ana, "Alquiler", [(account(ana, "Servicios"), 1200), (bcp(ana), -1200)], days=(1,),
                  start="2026-10-01", post_mode="reminder")
    assert run(ana, "2026-10-20") == 0
    pending = ana.execute("SELECT occurrence_date FROM account_recurring_reminder WHERE recurring_id = %s",
                          (r,)).fetchall()
    assert pending[0] == (d("2026-10-01"),)
    ana.execute("UPDATE account_recurring SET generated_until = '2026-10-01' WHERE id = %s", (r,))
    assert (d("2026-10-01"),) not in ana.execute(
        "SELECT occurrence_date FROM account_recurring_reminder WHERE recurring_id = %s", (r,)).fetchall()


def test_el_flujo_futuro_muestra_lo_que_viene(ana):
    acc = bcp(ana)
    r = recurring(ana, "Netflix", [(account(ana, "Software y apps"), "44.90"), (acc, "-44.90")],
                  start="2026-11-01")
    rows = ana.execute("SELECT date, account_id, amount FROM account_recurring_forecast('2026-12-31')"
                       " WHERE recurring_id = %s", (r,)).fetchall()
    assert [(x[0], x[2]) for x in rows if x[1] == acc] == [(d("2026-11-05"), Decimal("-44.90")),
                                                           (d("2026-12-05"), Decimal("-44.90"))]


# --- Préstamo de banco ----------------------------------------------------------------------------

def test_un_prestamo_es_una_deuda_con_su_banco_y_su_cuota(ana):
    pen = cur(ana, "PEN")
    loan = ana.execute("INSERT INTO account_account (name, account_type, currency_id) VALUES"
                       " ('Préstamo vehicular', 'liability', %s) RETURNING id", (pen,)).fetchone()[0]
    cuota = recurring(ana, "Cuota préstamo vehicular",
                      [(account(ana, "Intereses"), "610"), (loan, "1050"), (bcp(ana), "-1660")], days=(15,),
                      start="2026-10-01", amount_type="variable", end_type="count", max_count=36)
    ana.execute("INSERT INTO account_loan (account_id, bank_id, recurring_id) VALUES (%s, %s, %s)",
                (loan, bank(ana, "BCP"), cuota))
    run(ana, "2026-10-20")
    assert generated(ana, cuota) == [(d("2026-10-15"), d("2026-10-15"), "draft", Decimal("1660.00"))]
    commit_check(ana)


def test_un_prestamo_solo_puede_ser_una_deuda(ana):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        ana.execute("INSERT INTO account_loan (account_id, bank_id) VALUES (%s, %s)", (bcp(ana), bank(ana, "BCP")))


# --- Importar -------------------------------------------------------------------------------------

def test_lo_importado_confirma_el_borrador_variable_con_el_monto_del_banco(ana):
    acc = bcp(ana)
    r = recurring(ana, "Luz del Sur", [(account(ana, "Servicios"), 120), (acc, -120)], days=(12,),
                  start="2026-10-01", amount_type="variable")
    run(ana, "2026-10-20")
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-13", "LUZ DEL SUR", "-131.40") == "matched"
    assert generated(ana, r) == [(d("2026-10-13"), d("2026-10-12"), "posted", Decimal("131.40"))]
    commit_check(ana)


def test_un_borrador_de_tres_lineas_no_se_toca(ana):
    pen = cur(ana, "PEN")
    loan = ana.execute("INSERT INTO account_account (name, account_type, currency_id) VALUES"
                       " ('Préstamo', 'liability', %s) RETURNING id", (pen,)).fetchone()[0]
    acc = bcp(ana)
    r = recurring(ana, "Cuota", [(account(ana, "Intereses"), "600"), (loan, "1000"), (acc, "-1600")],
                  days=(15,), start="2026-10-01", amount_type="variable")
    run(ana, "2026-10-20")
    st = statement(ana, acc)
    assert line(ana, st, "2026-10-15", "PAGO PRESTAMO", "-1610") == "created"
    assert generated(ana, r)[0][2] == "draft"
