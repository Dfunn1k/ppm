"""Pendientes (rebanada 11): una bandeja con lo que espera algo de ti.

Es el buzón de la puerta: los avisos que calcula PPM (vista mail_notice) llegan solos y se van
cuando se resuelve lo que los causó; se pueden posponer hasta una fecha. Los recordatorios que
escribes tú (mail_activity) son post-its pegados a un movimiento, una persona, una cuenta o a nada:
de una vez, y al hacerlos quedan tachados con su fecha."""

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import Decimal

import psycopg

from app.accounts import AccountError
from app.db import user_transaction

@dataclass(frozen=True)
class Amount:
    currency: str
    amount: Decimal              # vencimientos: + te deben, − debes; recurrentes: + entra, − sale


@dataclass(frozen=True)
class Notice:
    """Un aviso que calcula PPM."""
    key: str                     # la llave para posponerlo
    kind: str                    # maturity, card_due, draft, suspense o recurring
    date: dt.date                # vence, se paga o llegó su día (el más antiguo si son varios)
    late: bool                   # la fecha ya pasó
    amounts: list[Amount] = field(default_factory=list)
    count: int = 1               # por confirmar y por clasificar: cuántos
    partner_id: int | None = None
    partner: str | None = None
    account_id: int | None = None
    account: str | None = None   # la tarjeta o la cuenta Por cobrar / Por pagar
    recurring_id: int | None = None
    occurrence: dt.date | None = None
    name: str | None = None      # la recurrente
    move_id: int | None = None   # si es uno solo, para abrirlo directo
    bank_charges: int = 0        # por confirmar: cuántos son cargos del banco
    snooze_until: dt.date | None = None


@dataclass(frozen=True)
class Activity:
    """Un recordatorio que escribiste."""
    id: int
    date: dt.date
    summary: str
    late: bool
    done_date: dt.date | None
    move_id: int | None
    move: str | None             # la referencia del movimiento
    partner_id: int | None
    partner: str | None
    account_id: int | None
    account: str | None


@dataclass(frozen=True)
class Inbox:
    today: dt.date
    notice_days: int
    notices: list[Notice]        # los que se ven, por fecha
    activities: list[Activity]   # tus recordatorios sin hacer, por fecha
    snoozed: list[Notice]        # los pospuestos, por la fecha en que vuelven
    late: int                    # cuántos ya pasaron su fecha (avisos y recordatorios)


def inbox(user_id: int) -> Inbox:
    with user_transaction(user_id) as conn:
        conn.execute("SELECT account_recurring_run()")   # lo automático que ya toca no debe avisar
        today, days = conn.execute("SELECT user_today(), notice_days FROM res_users").fetchone()
        notices = _notices(conn, today)
        activities = _activities(conn, today, "a.done_date IS NULL", ())
    shown = [n for n in notices if n.snooze_until is None]
    snoozed = sorted((n for n in notices if n.snooze_until is not None), key=lambda n: (n.snooze_until, n.key))
    late = sum(n.late for n in shown) + sum(a.late for a in activities)
    return Inbox(today, days, shown, activities, snoozed, late)


def _notices(conn: psycopg.Connection, today: dt.date) -> list[Notice]:
    rows = conn.execute("""
        SELECT n.notice_key, n.kind, n.date, trim(c.name), n.amount, n.count, n.partner_id, p.name,
               n.account_id, a.name, n.recurring_id, n.occurrence_date, r.name, n.snooze_until
          FROM mail_notice n
          LEFT JOIN res_currency c    ON c.id = n.currency_id
          LEFT JOIN res_partner p     ON p.id = n.partner_id
          LEFT JOIN account_account a ON a.id = n.account_id
          LEFT JOIN account_recurring r ON r.id = n.recurring_id
         ORDER BY n.date, n.notice_key, c.id""").fetchall()
    grouped: dict[str, list[tuple]] = defaultdict(list)   # card_due: una fila por moneda, la misma llave
    for row in rows:
        grouped[row[0]].append(row)

    single = {kind: _single(conn, kind) for kind in ("draft", "suspense")}
    bank_charges = conn.execute("""
        SELECT count(*) FROM account_move m JOIN account_recurring r ON r.id = m.recurring_id
         WHERE r.bank_charge AND m.state = 'draft' AND m.date <= user_today()""").fetchone()[0]
    out = []
    for key, group in grouped.items():
        (_, kind, date, _, _, count, partner_id, partner, account_id, account, rec_id, occurrence, name,
         snooze) = group[0]
        amounts = [Amount(cur, amount) for _, _, _, cur, amount, *_ in group if cur is not None]
        out.append(Notice(key, kind, date, date < today, amounts, count, partner_id, partner, account_id, account,
                          rec_id, occurrence, name, single.get(kind) if count == 1 else None,
                          bank_charges if kind == "draft" else 0, snooze))
    out.sort(key=lambda n: (n.date, n.key))
    return out


def _single(conn: psycopg.Connection, kind: str) -> int | None:
    """El movimiento, cuando el aviso es de uno solo."""
    if kind == "draft":
        row = conn.execute("SELECT min(id) FROM account_move WHERE state = 'draft' AND date <= user_today()").fetchone()
    else:
        row = conn.execute("SELECT min(move_id) FROM account_move_line"
                           " WHERE account_id = system_account('suspense')").fetchone()
    return row[0]


def _activities(conn: psycopg.Connection, today: dt.date, where: str, params: tuple) -> list[Activity]:
    rows = conn.execute(f"""
        SELECT a.id, a.date_deadline, a.summary, a.done_date, a.move_id, m.ref, a.partner_id, p.name,
               a.account_id, acc.name
          FROM mail_activity a
          LEFT JOIN account_move m      ON m.id = a.move_id
          LEFT JOIN res_partner p       ON p.id = a.partner_id
          LEFT JOIN account_account acc ON acc.id = a.account_id
         WHERE {where}
         ORDER BY a.done_date IS NOT NULL, a.done_date DESC, a.date_deadline, a.id""", params).fetchall()
    return [Activity(i, d, s, done is None and d < today, done, *rest) for i, d, s, done, *rest in rows]


# --- Posponer ---------------------------------------------------------------------------------

def snooze(user_id: int, key: str, until: dt.date) -> None:
    """«Recuérdamelo el …»: se esconde hasta esa fecha y vuelve si sigue sin resolverse."""
    with user_transaction(user_id) as conn:
        if until <= conn.execute("SELECT user_today()").fetchone()[0]:
            raise AccountError(400, "Pospónlo para un día después de hoy")
        if conn.execute("SELECT 1 FROM mail_notice WHERE notice_key = %s", (key,)).fetchone() is None:
            raise AccountError(404, "Ese aviso ya no está: quizá ya se resolvió")
        conn.execute("""
            INSERT INTO mail_notice_snooze (notice_key, snooze_until) VALUES (%s, %s)
            ON CONFLICT (user_id, notice_key) DO UPDATE SET snooze_until = excluded.snooze_until""", (key, until))
        conn.execute("DELETE FROM mail_notice_snooze WHERE snooze_until <= user_today()")   # los que ya volvieron


def unsnooze(user_id: int, key: str) -> None:
    """Que vuelva ya a la bandeja."""
    with user_transaction(user_id) as conn:
        conn.execute("DELETE FROM mail_notice_snooze WHERE notice_key = %s", (key,))


# --- Recordatorios propios --------------------------------------------------------------------

def activities_of(user_id: int, move_id: int | None, partner_id: int | None, account_id: int | None) -> list[Activity]:
    """Los recordatorios de un movimiento, una persona o una cuenta: los pendientes y los hechos."""
    with user_transaction(user_id) as conn:
        today = conn.execute("SELECT user_today()").fetchone()[0]
        return _activities(conn, today, "a.move_id IS NOT DISTINCT FROM %s AND a.partner_id IS NOT DISTINCT FROM %s"
                                        " AND a.account_id IS NOT DISTINCT FROM %s", (move_id, partner_id, account_id))


def create_activity(user_id: int, date: dt.date, summary: str, move_id: int | None, partner_id: int | None,
                    account_id: int | None) -> int:
    if sum(x is not None for x in (move_id, partner_id, account_id)) > 1:
        raise AccountError(400, "Un recordatorio va con un movimiento, una persona o una cuenta, no con varios")
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                return conn.execute(
                    "INSERT INTO mail_activity (date_deadline, summary, move_id, partner_id, account_id)"
                    " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (date, summary.strip(), move_id, partner_id, account_id)).fetchone()[0]
        except psycopg.errors.ForeignKeyViolation:
            raise AccountError(404, "No encontramos a qué pegarle el recordatorio") from None


def update_activity(user_id: int, activity_id: int, date: dt.date, summary: str) -> None:
    """Cambiar el texto o la fecha (posponerlo es cambiarle la fecha)."""
    _write(user_id, activity_id, "UPDATE mail_activity SET date_deadline = %s, summary = %s WHERE id = %s",
           (date, summary.strip(), activity_id))


def set_done(user_id: int, activity_id: int, done: bool) -> None:
    """Hecho: sale de la bandeja y queda con su fecha; deshacerlo lo devuelve."""
    _write(user_id, activity_id,
           "UPDATE mail_activity SET done_date = CASE WHEN %s THEN user_today() END WHERE id = %s",
           (done, activity_id))


def delete_activity(user_id: int, activity_id: int) -> None:
    _write(user_id, activity_id, "DELETE FROM mail_activity WHERE id = %s", (activity_id,))


def _write(user_id: int, activity_id: int, sql: str, params: tuple) -> None:
    with user_transaction(user_id) as conn:
        if conn.execute(sql, params).rowcount == 0:
            raise AccountError(404, "No encontramos ese recordatorio")
