"""Personas (C6): quién me debe, a quién debo y de quién guardo plata; cada deuda abierta con su
antigüedad; compensar lo que se deben y dar por perdido lo que te deben.

Es el cuaderno de fiados de la bodega: un solo cuaderno (las cuentas Por cobrar, Por pagar y Plata
que guardo de otros) y en cada anotación el nombre de la persona."""

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import Decimal
import re

import psycopg

from app.accounts import ZERO, AccountError, Money, _today, _today_rates, _translate
from app.db import user_transaction
from app.moves import _first, owed, reconcile

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class PartnerRow:
    id: int
    name: str
    phone: str | None
    email: str | None
    owes_me: list[Money]         # lo que te debe, en positivo, por moneda
    i_owe: list[Money]           # lo que le debes, en positivo
    keep: list[Money]            # lo que guardas suyo, en positivo
    net: Decimal                 # lo que te debe − lo que le debes, en moneda base (al tipo de hoy)
    last_date: dt.date | None    # el último movimiento con esa persona


@dataclass(frozen=True)
class PartnersOverview:
    currency: str                # moneda base
    owes_me_total: Decimal
    i_owe_total: Decimal
    keep_total: Decimal
    people: list[PartnerRow]     # primero las que tienen algo pendiente, luego por nombre


@dataclass(frozen=True)
class OpenItem:
    """Una deuda abierta: lo que era y lo que falta."""
    line_id: int
    move_id: int
    date: dt.date
    ref: str
    currency: str
    amount: Decimal              # lo que era, en positivo
    open: Decimal                # lo que falta, en positivo
    days: int                    # cuántos días tiene


@dataclass(frozen=True)
class PartnerDetail:
    partner: PartnerRow
    owes_me: list[OpenItem] = field(default_factory=list)   # lo que te debe, deuda por deuda
    i_owe: list[OpenItem] = field(default_factory=list)     # lo que le debes
    keep_since: dt.date | None = None                       # desde cuándo guardas su plata


_BALANCES_SQL = """
SELECT b.partner_id, b.system_role, trim(c.name), b.amount_currency, b.balance
  FROM res_partner_balance b JOIN res_currency c ON c.id = b.currency_id
 WHERE b.amount_currency <> 0 AND (%s::bigint IS NULL OR b.partner_id = %s)
 ORDER BY c.name
"""


def _rows(conn: psycopg.Connection, partner_id: int | None = None) -> list[PartnerRow]:
    rates = _today_rates(conn)
    money: dict[tuple[int, str], list[Money]] = defaultdict(list)
    for pid, role, cur, amount, book in conn.execute(_BALANCES_SQL, (partner_id, partner_id)):
        sign = 1 if role == "receivable" else -1   # en positivo lo que te deben, lo que debes y lo que guardas
        a, b = sign * amount, sign * book
        money[(pid, role)].append(Money(cur, a, _today(a, b, rates.get(cur), role != "receivable"), b))
    rows = []
    for pid, name, phone, email, last in conn.execute("""
        SELECT p.id, p.name, p.phone, p.email,
               (SELECT max(m.date) FROM account_move_line l JOIN account_move m ON m.id = l.move_id
                 WHERE l.partner_id = p.id AND m.state = 'posted')
          FROM res_partner p WHERE p.active AND (%s::bigint IS NULL OR p.id = %s)""", (partner_id, partner_id)):
        owes, owe = money[(pid, "receivable")], money[(pid, "payable")]
        net = sum((m.base for m in owes), ZERO) - sum((m.base for m in owe), ZERO)
        rows.append(PartnerRow(pid, name, phone, email, owes, owe, money[(pid, "custody")], net, last))
    return rows


def _pending(r: PartnerRow) -> bool:
    return bool(r.owes_me or r.i_owe or r.keep)


def overview(user_id: int) -> PartnersOverview:
    with user_transaction(user_id) as conn:
        base = conn.execute(
            "SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id").fetchone()[0]
        rows = _rows(conn)
    rows.sort(key=lambda r: (not _pending(r), r.name.lower()))
    return PartnersOverview(
        base,
        sum((m.base for r in rows for m in r.owes_me), ZERO),
        sum((m.base for r in rows for m in r.i_owe), ZERO),
        sum((m.base for r in rows for m in r.keep), ZERO),
        rows)


def detail(user_id: int, partner_id: int) -> PartnerDetail:
    with user_transaction(user_id) as conn:
        rows = _rows(conn, partner_id)
        if not rows:
            raise AccountError(404, "No encontramos a esa persona")
        items: dict[str, list[OpenItem]] = defaultdict(list)
        for role, *item in conn.execute("""
            SELECT a.system_role, r.id, r.move_id, r.date, r.ref, trim(c.name),
                   abs(r.amount_currency), abs(r.amount_residual), user_today() - r.date
              FROM account_move_line_residual r
              JOIN account_account a ON a.id = r.account_id
              JOIN res_currency c ON c.id = r.currency_id
             WHERE r.partner_id = %s AND r.amount_residual <> 0
               AND ((a.system_role = 'receivable' AND r.amount_residual > 0)
                 OR (a.system_role = 'payable' AND r.amount_residual < 0))
             ORDER BY r.date, r.id""", (partner_id,)):
            items[role].append(OpenItem(*item))
        since = conn.execute("""
            SELECT min(m.date) FROM account_move_line l JOIN account_move m ON m.id = l.move_id
             WHERE l.partner_id = %s AND l.account_id = system_account('custody') AND m.state = 'posted'""",
                             (partner_id,)).fetchone()[0]
    p = rows[0]
    return PartnerDetail(p, items["receivable"], items["payable"], since if p.keep else None)


# --- Altas y cambios --------------------------------------------------------------------------

def _clean(name: str, phone: str | None, email: str | None) -> tuple[str, str | None, str | None]:
    name = " ".join(name.split())
    if not name:
        raise AccountError(400, "Escribe cómo se llama")
    phone = " ".join((phone or "").split()) or None
    email = (email or "").strip().lower() or None
    if email and not EMAIL.match(email):
        raise AccountError(400, "Ese correo no parece válido")
    return name, phone, email


def create(user_id: int, name: str, phone: str | None = None, email: str | None = None) -> int:
    name, phone, email = _clean(name, phone, email)
    with user_transaction(user_id) as conn:
        return conn.execute("INSERT INTO res_partner (name, phone, email) VALUES (%s, %s, %s) RETURNING id",
                            (name, phone, email)).fetchone()[0]


def update(user_id: int, partner_id: int, name: str, phone: str | None, email: str | None) -> None:
    name, phone, email = _clean(name, phone, email)
    with user_transaction(user_id) as conn:
        if conn.execute("UPDATE res_partner SET name = %s, phone = %s, email = %s WHERE id = %s AND active"
                        " RETURNING id", (name, phone, email, partner_id)).fetchone() is None:
            raise AccountError(404, "No encontramos a esa persona")


# --- Compensar y dar por perdido --------------------------------------------------------------

def _currencies(conn: psycopg.Connection, partner_id: int) -> list[tuple[int, str]]:
    return conn.execute("""
        SELECT DISTINCT b.currency_id, trim(c.name) FROM res_partner_balance b
          JOIN res_currency c ON c.id = b.currency_id
         WHERE b.partner_id = %s AND b.amount_currency <> 0 ORDER BY 2""", (partner_id,)).fetchall()


def _name(conn: psycopg.Connection, partner_id: int) -> str:
    row = conn.execute("SELECT name FROM res_partner WHERE id = %s AND active", (partner_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos a esa persona")
    return row[0]


def offset(user_id: int, partner_id: int) -> int:
    """Compensar (CON-06): si te debe y le debes, se cancela lo menor de cada lado, moneda por moneda.
    No se mueve plata de tus cuentas: Debe Por pagar / Haber Por cobrar."""
    with user_transaction(user_id) as conn:
        name = _name(conn, partner_id)
        base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
        receivable, payable = (conn.execute("SELECT system_account(%s)", (r,)).fetchone()[0]
                               for r in ("receivable", "payable"))
        lines = []
        for cur_id, _cur in _currencies(conn, partner_id):
            amount = min(owed(conn, "receivable", partner_id, cur_id), owed(conn, "payable", partner_id, cur_id))
            if amount <= 0:
                continue
            base = amount if cur_id == base_id else conn.execute(
                "SELECT round(%s * get_rate(%s, user_today(), 'buy'), 2)", (amount, cur_id)).fetchone()[0]
            lines += [(payable, base, Decimal(0), cur_id, amount), (receivable, Decimal(0), base, cur_id, -amount)]
        if not lines:
            raise AccountError(400, f"Para compensar, {_first(name)} tiene que deberte y tú deberle, en la misma moneda")
        return _post(conn, f"Compensación con {_first(name)}", partner_id, lines)


def write_off(user_id: int, partner_id: int) -> int:
    """Dar por perdido (CON-05): lo que te debe pasa a Deudas incobrables, un gasto de hoy, por su
    valor en libros. Debe Deudas incobrables / Haber Por cobrar."""
    with user_transaction(user_id) as conn:
        name = _name(conn, partner_id)
        base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
        receivable, bad_debt = (conn.execute("SELECT system_account(%s)", (r,)).fetchone()[0]
                                for r in ("receivable", "bad_debt"))
        lines = []
        for cur_id, amount, book in conn.execute("""
            SELECT currency_id, amount_currency, balance FROM res_partner_balance
             WHERE partner_id = %s AND system_role = 'receivable' AND amount_currency > 0""", (partner_id,)):
            lines += [(bad_debt, book, Decimal(0), base_id, book), (receivable, Decimal(0), book, cur_id, -amount)]
        if not lines:
            raise AccountError(400, f"{_first(name)} no te debe nada")
        return _post(conn, f"Deuda de {_first(name)} dada por perdida", partner_id, lines)


def _post(conn: psycopg.Connection, ref: str, partner_id: int, lines: list[tuple]) -> int:
    try:
        with conn.transaction():
            move_id = conn.execute(
                "INSERT INTO account_move (date, ref, state) VALUES (user_today(), %s, 'posted') RETURNING id",
                (ref,)).fetchone()[0]
            for acc, debit, credit, cur, amount in lines:
                role = conn.execute("SELECT system_role FROM account_account WHERE id = %s", (acc,)).fetchone()[0]
                conn.execute(
                    "INSERT INTO account_move_line (move_id, account_id, partner_id, debit, credit, currency_id,"
                    " amount_currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (move_id, acc, partner_id if role in ("receivable", "payable") else None,
                     debit, credit, cur, amount))
            conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
            reconcile(conn, {(partner_id, acc) for acc, *_ in lines
                             if conn.execute("SELECT system_role FROM account_account WHERE id = %s",
                                             (acc,)).fetchone()[0] in ("receivable", "payable")})
            return move_id
    except psycopg.Error as e:
        raise _translate(e) from None
