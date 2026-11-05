"""Pendientes (migración 0022): los avisos que calcula PPM (vista mail_notice), posponerlos y los
recordatorios propios (mail_activity). La vista mira el día de hoy de verdad: las fechas van
relativas a user_today()."""

from datetime import timedelta
from decimal import Decimal

import psycopg
import pytest

from tests.test_asientos import account, commit_check, cur, move, role
from tests.test_recurrentes import recurring
from tests.test_tarjetas import ana, bcp, visa  # noqa: F401
from tests.test_vencimientos import bcp_id, lend, partner


def today(c):
    return c.execute("SELECT user_today()").fetchone()[0]


def notices(c, kind=None) -> list[dict]:
    rows = c.execute("SELECT kind, notice_key, date, partner_id, account_id, amount, count, snooze_until"
                     " FROM mail_notice WHERE %s::text IS NULL OR kind = %s ORDER BY notice_key",
                     (kind, kind)).fetchall()
    return [dict(zip(["kind", "key", "date", "partner", "account", "amount", "count", "snooze"], r)) for r in rows]


def test_lo_que_vence_avisa_con_los_dias_de_anticipacion(ana):
    hoy, luis = today(ana), partner(ana)
    lend(ana, luis, "50", hoy - timedelta(days=20), maturity=hoy + timedelta(days=2))
    lend(ana, luis, "30", hoy - timedelta(days=10), maturity=hoy - timedelta(days=1))   # ya venció
    lend(ana, luis, "70", hoy - timedelta(days=5), maturity=hoy + timedelta(days=10))
    lend(ana, luis, "90", hoy - timedelta(days=5))                                       # sin vencimiento
    commit_check(ana)
    [n] = notices(ana, "maturity")
    assert (n["partner"], n["amount"], n["count"], n["date"]) == (luis, Decimal("80.00"), 2, hoy - timedelta(days=1))

    ana.execute("UPDATE res_users SET notice_days = 15")
    assert notices(ana, "maturity")[0]["amount"] == Decimal("150.00")


def test_lo_que_debo_avisa_en_negativo_y_desaparece_al_pagarlo(ana):
    hoy, sandra, pen, bank = today(ana), partner(ana, "Sandra"), cur(ana, "PEN"), bcp(ana)
    m = move(ana, [(bank, 40, 0, pen, 40), (role(ana, "payable"), 0, 40, pen, -40, sandra)],
             date=hoy - timedelta(days=3))
    ana.execute("UPDATE account_move_line SET date_maturity = %s WHERE move_id = %s AND partner_id IS NOT NULL",
                (hoy, m))
    commit_check(ana)
    assert [n["amount"] for n in notices(ana, "maturity")] == [Decimal("-40.00")]

    ana.execute("SET CONSTRAINTS ALL DEFERRED")
    paid = move(ana, [(role(ana, "payable"), 40, 0, pen, 40, sandra), (bank, 0, 40, pen, -40)], date=hoy)
    commit_check(ana)
    ana.execute("SELECT reconcile_partner(%s, %s)", (sandra, role(ana, "payable")))
    assert paid and notices(ana, "maturity") == []


def test_el_pago_de_tarjeta_avisa_antes_de_su_fecha(ana):
    card, hoy, bank = visa(ana), today(ana), bcp(ana)
    last = ana.execute("SELECT card_last_closing(%s, user_today())", (card,)).fetchone()[0]
    pen = cur(ana, "PEN")
    move(ana, [(account(ana, "Hogar"), 120, 0, pen, 120), (card, 0, 120, pen, -120)], date=last - timedelta(days=3))
    commit_check(ana)
    assert notices(ana, "card_due") == []                     # sin fecha de pago no hay aviso

    ana.execute("SELECT set_card_due_date(%s, %s, %s)", (card, last, hoy + timedelta(days=3)))
    [n] = notices(ana, "card_due")
    assert (n["key"], n["account"], n["amount"]) == (f"card_due/{card}/{last}", card, Decimal("120.00"))

    ana.execute("SET CONSTRAINTS ALL DEFERRED")
    move(ana, [(card, 120, 0, pen, 120), (bank, 0, 120, pen, -120)], date=hoy)
    commit_check(ana)
    assert notices(ana, "card_due") == []


def test_por_confirmar_y_por_clasificar_son_un_aviso_cada_uno(ana):
    hoy, pen = today(ana), cur(ana, "PEN")
    for days in (0, 2):
        move(ana, [(account(ana, "Hogar"), 10, 0, pen, 10), (bcp(ana) if days == 0 else bcp_id(ana), 0, 10, pen, -10)],
             state="draft", date=hoy - timedelta(days=days))
    move(ana, [(account(ana, "Hogar"), 10, 0, pen, 10), (bcp_id(ana), 0, 10, pen, -10)],
         state="draft", date=hoy + timedelta(days=5))        # todavía no llega
    for _ in range(3):
        move(ana, [(role(ana, "suspense"), 5, 0, pen, 5), (bcp_id(ana), 0, 5, pen, -5)], date=hoy)
    commit_check(ana)
    assert [(n["kind"], n["count"]) for n in notices(ana) if n["kind"] in ("draft", "suspense")] == \
        [("draft", 2), ("suspense", 3)]


def test_una_recurrente_en_modo_recordatorio_llega_a_la_bandeja(ana):
    hoy = today(ana)
    r = recurring(ana, "Alquiler", [(account(ana, "Servicios"), 1200), (bcp(ana), -1200)], days=(hoy.day,),
                  start=hoy.replace(day=1), post_mode="reminder")
    [n] = notices(ana, "recurring")
    assert (n["key"], n["amount"]) == (f"recurring/{r}/{hoy}", Decimal("1200.00"))


def test_posponer_esconde_el_aviso_hasta_su_fecha(ana):
    hoy, luis = today(ana), partner(ana)
    lend(ana, luis, "50", hoy - timedelta(days=20), maturity=hoy)
    commit_check(ana)
    key = notices(ana, "maturity")[0]["key"]
    ana.execute("INSERT INTO mail_notice_snooze (notice_key, snooze_until) VALUES (%s, %s)",
                (key, hoy + timedelta(days=4)))
    assert notices(ana, "maturity")[0]["snooze"] == hoy + timedelta(days=4)
    ana.execute("UPDATE mail_notice_snooze SET snooze_until = %s", (hoy,))   # ya llegó: vuelve
    assert notices(ana, "maturity")[0]["snooze"] is None


def test_un_recordatorio_cuelga_de_una_cosa_y_queda_suelto_si_se_borra(ana):
    hoy, luis, pen = today(ana), partner(ana), cur(ana, "PEN")
    m = move(ana, [(account(ana, "Hogar"), 10, 0, pen, 10), (bcp(ana), 0, 10, pen, -10)], date=hoy)
    commit_check(ana)
    a = ana.execute("INSERT INTO mail_activity (date_deadline, summary, move_id) VALUES (%s, 'Pedir la factura', %s)"
                    " RETURNING id", (hoy, m)).fetchone()[0]
    ana.execute("INSERT INTO mail_activity (date_deadline, summary) VALUES (%s, 'Renovar el SOAT')", (hoy,))
    ana.execute("DELETE FROM account_move WHERE id = %s", (m,))
    assert ana.execute("SELECT move_id, summary FROM mail_activity WHERE id = %s", (a,)).fetchone() == \
        (None, "Pedir la factura")
    ana.execute("UPDATE mail_activity SET done_date = %s WHERE id = %s", (hoy, a))

    for bad in [("Dos cosas", luis, bcp_id(ana)), ("  ", None, None)]:
        with pytest.raises(psycopg.errors.CheckViolation):
            with ana.transaction():
                ana.execute("INSERT INTO mail_activity (date_deadline, summary, partner_id, account_id)"
                            " VALUES (%s, %s, %s, %s)", (hoy, *bad))


def test_cada_uno_ve_solo_sus_recordatorios(new_user, as_user):
    ana_c = as_user(new_user("ana@correo.com", "Ana"))
    ana_c.execute("SELECT setup_user('PE', '{}')")
    ana_c.execute("INSERT INTO mail_activity (date_deadline, summary) VALUES (current_date, 'De Ana')")
    luis_c = as_user(new_user("luis@correo.com", "Luis"))
    luis_c.execute("SELECT setup_user('PE', '{}')")
    assert luis_c.execute("SELECT count(*) FROM mail_activity").fetchone()[0] == 0
    assert luis_c.execute("SELECT count(*) FROM mail_notice").fetchone()[0] == 0
