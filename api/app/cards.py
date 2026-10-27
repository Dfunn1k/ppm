"""Lógica de tarjetas (C3, C5): el alta con lo que toca pagar, el detalle con su ciclo, lo por
facturar, la línea disponible, las cuotas que faltan y los movimientos agrupados por ciclo como en
el estado de cuenta; la fecha de pago de cada ciclo y las cuotas de antes de PPM.

Una tarjeta es una cuenta que se llena al revés: cada compra sube lo que le debes al banco. Los
montos de una tarjeta van en positivo cuando suben la deuda (una compra) y en negativo cuando la
bajan (un pago o una devolución)."""

from collections import defaultdict
from dataclasses import dataclass, field, replace
import datetime as dt
from decimal import Decimal

import psycopg

from app.accounts import (ZERO, AccountError, AccountRow, _balances, _ACCOUNTS_SQL, _bank, _currency_id,
                          _row, _today, _today_rates, _translate, card_briefs)
from app.db import user_transaction

PAST_CYCLES = 6   # cuántos ciclos ya cerrados se muestran, además del que toca pagar


@dataclass(frozen=True)
class CardStatus:
    currency: str
    total_debt: Decimal          # todo lo que debes, con las cuotas que faltan facturar
    unbilled: Decimal            # compras después del último corte + cuotas de cortes futuros
    to_pay: Decimal              # lo facturado; negativo = saldo a favor


@dataclass(frozen=True)
class Plan:
    id: int
    move_id: int
    name: str                    # la nota de la compra: 'Televisor'
    currency: str
    n_installments: int
    billed: int                  # cuántas cuotas ya se facturaron (corte hasta el último)
    principal: Decimal           # el total de la compra
    remaining: Decimal           # lo que falta facturar
    next_installment: Decimal | None   # la próxima cuota
    next_closing: dt.date | None       # en qué corte llega
    opening: bool                # cuotas de antes de PPM (no fue un gasto en PPM)


@dataclass(frozen=True)
class CycleItem:
    move_id: int
    date: dt.date
    ref: str
    posted: bool
    kind: str                    # 'charge' (compra o cargo), 'payment', 'refund', 'installment' u 'opening'
    currency: str
    amount: Decimal              # + sube la deuda, − la baja
    counterpart: str | None      # la categoría o cuenta del otro lado
    counterpart_icon: str | None
    counterpart_color: int | None
    sequence: int | None = None  # cuota: cuál…
    n_installments: int | None = None   # …de cuántas


@dataclass(frozen=True)
class CardStatusAmount:
    currency: str
    amount: Decimal


@dataclass(frozen=True)
class Cycle:
    closing_date: dt.date
    state: str                   # 'current' (cierra después), 'billed' (el que toca pagar) o 'past'
    date_due: dt.date | None
    charges: list[CardStatusAmount] = field(default_factory=list)   # compras y cuotas, por moneda
    items: list[CycleItem] = field(default_factory=list)


@dataclass(frozen=True)
class CardDetail:
    account: AccountRow
    bank_id: int | None
    bank_name: str | None
    brand: str | None
    last4: str | None
    closing_day: int
    credit_limit: Decimal
    limit_currency: str
    last_closing: dt.date
    next_closing: dt.date
    date_due: dt.date | None
    status: list[CardStatus]
    used: Decimal                # lo que ocupa de la línea, en su moneda (dólares al tipo de venta)
    available: Decimal
    plans: list[Plan]
    cycles: list[Cycle]


def _cents(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


def _card(conn: psycopg.Connection, card_id: int) -> tuple:
    row = conn.execute(
        "SELECT cc.bank_id, bk.name, cc.brand, cc.last4, cc.closing_day, cc.credit_limit, trim(c.name)"
        "  FROM account_credit_card cc JOIN account_account a ON a.id = cc.account_id"
        "  LEFT JOIN res_bank bk ON bk.id = cc.bank_id JOIN res_currency c ON c.id = cc.limit_currency_id"
        " WHERE cc.account_id = %s AND a.active", (card_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos esa tarjeta")
    return row


def _plans(conn: psycopg.Connection, card_id: int, last: dt.date) -> list[Plan]:
    """Las compras en cuotas que todavía tienen cuotas por facturar."""
    return [Plan(*r[:7], _cents(r[7]), *r[8:]) for r in conn.execute("""
        SELECT p.id, p.move_id, m.ref, trim(c.name), p.n_installments,
               count(*) FILTER (WHERE pl.closing_date <= %(last)s),
               p.principal,
               coalesce(sum(pl.principal) FILTER (WHERE pl.closing_date > %(last)s), 0),
               (array_agg(pl.principal ORDER BY pl.sequence) FILTER (WHERE pl.closing_date > %(last)s))[1],
               min(pl.closing_date) FILTER (WHERE pl.closing_date > %(last)s),
               EXISTS (SELECT 1 FROM account_move_line x WHERE x.move_id = p.move_id
                                                         AND x.account_id = system_account('opening'))
          FROM account_installment_plan p
          JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
          JOIN res_currency c ON c.id = p.currency_id
          JOIN account_installment_plan_line pl ON pl.plan_id = p.id
         WHERE p.card_account_id = %(card)s
         GROUP BY p.id, m.ref, c.name, m.date
        HAVING max(pl.closing_date) > %(last)s
         ORDER BY m.date, p.id""", {"card": card_id, "last": last})]


def _cycles(conn: psycopg.Connection, card_id: int, last: dt.date, nxt: dt.date,
            due: dict[dt.date, dt.date]) -> list[Cycle]:
    """Los movimientos de la tarjeta agrupados por el corte en que se facturan, como en el estado de
    cuenta: cada compra en su ciclo y, de una compra en cuotas, cada cuota en el suyo."""
    oldest = conn.execute("SELECT (%s::date - make_interval(months => %s))::date", (last, PAST_CYCLES)).fetchone()[0]
    items: dict[dt.date, list[CycleItem]] = defaultdict(list)
    for closing, *item in conn.execute("""
        SELECT card_closing_for(%(card)s, m.date), m.id, m.date, m.ref, m.state = 'posted',
               CASE WHEN o.role = 'opening' THEN 'opening'
                    WHEN l.credit > 0 THEN 'charge'
                    WHEN o.type IN ('income', 'expense') THEN 'refund'
                    ELSE 'payment' END,
               trim(c.name), -l.amount_currency, o.name, o.icon, o.color
          FROM account_move_line l
          JOIN account_move m ON m.id = l.move_id
          JOIN res_currency c ON c.id = l.currency_id
          CROSS JOIN LATERAL (
            SELECT CASE WHEN count(*) = 1 THEN min(a.name) END AS name,
                   CASE WHEN count(*) = 1 THEN min(coalesce(a.icon, pa.icon)) END AS icon,
                   CASE WHEN count(*) = 1 THEN min(coalesce(a.color, pa.color)) END AS color,
                   min(a.system_role) AS role, min(a.account_type) AS type
              FROM account_move_line x
              JOIN account_account a ON a.id = x.account_id
              LEFT JOIN account_account pa ON pa.id = a.parent_id
             WHERE x.move_id = l.move_id AND x.id <> l.id) o
         WHERE l.account_id = %(card)s
           AND NOT EXISTS (SELECT 1 FROM account_installment_plan p WHERE p.move_id = m.id)
           AND m.date > %(oldest)s
         ORDER BY m.date DESC, m.id DESC""", {"card": card_id, "oldest": oldest}):
        items[closing].append(CycleItem(*item))
    for closing, *item in conn.execute("""
        SELECT pl.closing_date, m.id, m.date, m.ref, true,
               CASE WHEN o.role = 'opening' THEN 'opening' ELSE 'installment' END,
               trim(c.name), pl.principal, o.name, o.icon, o.color, pl.sequence, p.n_installments
          FROM account_installment_plan_line pl
          JOIN account_installment_plan p ON p.id = pl.plan_id
          JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
          JOIN res_currency c ON c.id = p.currency_id
          CROSS JOIN LATERAL (
            SELECT CASE WHEN count(*) = 1 THEN min(a.name) END AS name,
                   CASE WHEN count(*) = 1 THEN min(coalesce(a.icon, pa.icon)) END AS icon,
                   CASE WHEN count(*) = 1 THEN min(coalesce(a.color, pa.color)) END AS color,
                   min(a.system_role) AS role
              FROM account_move_line x
              JOIN account_account a ON a.id = x.account_id
              LEFT JOIN account_account pa ON pa.id = a.parent_id
             WHERE x.move_id = m.id AND x.account_id <> p.card_account_id) o
         WHERE p.card_account_id = %(card)s AND pl.closing_date > %(oldest)s AND pl.closing_date <= %(next)s
         ORDER BY pl.closing_date DESC, m.date DESC""", {"card": card_id, "oldest": oldest, "next": nxt}):
        items[closing].append(CycleItem(*item))

    cycles = []
    for closing in sorted(items, reverse=True):
        rows = sorted(items[closing], key=lambda i: (i.date, i.move_id), reverse=True)
        charges: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for i in rows:
            if i.amount > 0 and i.posted:
                charges[i.currency] += i.amount
        state = "current" if closing > last else "billed" if closing == last else "past"
        cycles.append(Cycle(closing, state, due.get(closing),
                            [CardStatusAmount(c, a) for c, a in sorted(charges.items())], rows))
    return cycles


def detail(user_id: int, card_id: int) -> CardDetail:
    with user_transaction(user_id) as conn:
        bank_id, bank_name, brand, last4, closing_day, limit, limit_cur = _card(conn, card_id)
        r = conn.execute(_ACCOUNTS_SQL + " WHERE a.id = %s", (card_id,)).fetchone()
        rates = _today_rates(conn)
        balances = _balances(conn, [card_id], rates).get(card_id, [])
        account = _row(r, balances)
        brief = card_briefs(conn).get(card_id)
        rows = conn.execute(
            "SELECT trim(c.name), s.total_debt, s.unbilled, s.to_pay, s.last_closing, s.next_closing, s.date_due"
            "  FROM credit_card_status() s JOIN res_currency c ON c.id = s.currency_id"
            " WHERE s.account_id = %s ORDER BY c.id <> (SELECT currency_id FROM res_users), c.name",
            (card_id,)).fetchall()
        last, nxt, date_due = rows[0][4], rows[0][5], rows[0][6]
        status = [CardStatus(cur, _cents(debt), _cents(unbilled), _cents(to_pay))
                  for cur, debt, unbilled, to_pay, *_ in rows]
        # La línea se ocupa con toda la deuda: lo que no es su moneda, al tipo de venta de hoy
        book = {m.currency: m.book for m in balances}
        used = sum((s.total_debt if s.currency == limit_cur
                    else _today(s.total_debt, -book.get(s.currency, ZERO), rates.get(s.currency), True)
                    for s in status), ZERO)
        due = dict(conn.execute("SELECT closing_date, date_due FROM account_credit_card_cycle"
                                " WHERE card_account_id = %s", (card_id,)).fetchall())
        plans = _plans(conn, card_id, last)
        cycles = _cycles(conn, card_id, last, nxt, due)
    return CardDetail(replace(account, card=brief), bank_id, bank_name, brand, last4, closing_day, limit, limit_cur,
                      last, nxt, date_due, status, used, limit - used, plans, cycles)


# --- Alta y cambios ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OpeningAmount:
    currency: str
    amount: Decimal              # lo que toca pagar en esa moneda
    rate: Decimal | None = None  # si no es la base; None = el de venta del día


def _sell_rate(conn: psycopg.Connection, currency_id: int, rate: Decimal | None, code: str) -> Decimal:
    if rate is not None:
        return rate
    try:
        with conn.transaction():
            return conn.execute("SELECT get_rate(%s, user_today(), 'sell')", (currency_id,)).fetchone()[0]
    except psycopg.errors.NoDataFound:
        raise AccountError(400, f"Falta el tipo de cambio de {code}: escríbelo") from None


def _post_openings(conn: psycopg.Connection, card_id: int, openings: list[OpeningAmount]) -> None:
    base = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
    seen = set()
    for o in openings:
        if o.amount < 0:
            raise AccountError(400, "Lo que toca pagar no puede ser negativo")
        cid = _currency_id(conn, o.currency)
        if cid in seen:
            raise AccountError(400, "Escribe cada moneda una sola vez")
        seen.add(cid)
        if o.amount == 0:
            continue
        rate = Decimal(1) if cid == base else _sell_rate(conn, cid, o.rate, o.currency.upper())
        conn.execute("SELECT post_card_opening(%s, %s, %s, %s)", (card_id, cid, o.amount, rate))


def create(user_id: int, name: str, closing_day: int, credit_limit: Decimal, bank_id: int | None,
           brand: str | None, last4: str | None, openings: list[OpeningAmount], date_due: dt.date | None) -> int:
    """La tarjeta con lo que tocaba pagar en su último estado de cuenta (por moneda) y, si se sabe,
    hasta cuándo. Lo comprado después del corte se registra como gastos; las cuotas que faltan, con
    «Cuotas de antes de PPM»."""
    with user_transaction(user_id) as conn:
        if bank_id is not None:
            _bank(conn, bank_id)
        try:
            with conn.transaction():
                card = conn.execute("SELECT create_credit_card(%s, %s, %s, %s, %s, %s)",
                                    (name, closing_day, credit_limit, bank_id, brand, last4)).fetchone()[0]
                _post_openings(conn, card, openings)
                if date_due is not None:
                    conn.execute("SELECT set_card_due_date(%s, card_last_closing(%s, user_today()), %s)",
                                 (card, card, date_due))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")   # el cuadre, aquí y no al final
                return card
        except psycopg.Error as e:
            raise _translate(e) from None


def update(user_id: int, card_id: int, name: str | None, closing_day: int | None, credit_limit: Decimal | None,
           bank_id: int | None, brand: str | None, last4: str | None, clear: set[str]) -> None:
    """Renombrar y editar corte, línea y datos. `clear` dice qué datos opcionales se borran."""
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        if bank_id is not None:
            _bank(conn, bank_id)
        try:
            with conn.transaction():
                if name is not None:
                    conn.execute("UPDATE account_account SET name = %s WHERE id = %s", (name.strip(), card_id))
                conn.execute("""
                    UPDATE account_credit_card
                       SET closing_day  = coalesce(%s, closing_day),
                           credit_limit = coalesce(%s, credit_limit),
                           bank_id = CASE WHEN %s THEN NULL ELSE coalesce(%s, bank_id) END,
                           brand   = CASE WHEN %s THEN NULL ELSE coalesce(%s, brand) END,
                           last4   = CASE WHEN %s THEN NULL ELSE coalesce(%s, last4) END
                     WHERE account_id = %s""",
                             (closing_day, credit_limit, "bank_id" in clear, bank_id, "brand" in clear, brand,
                              "last4" in clear, last4, card_id))
        except psycopg.Error as e:
            raise _translate(e) from None


def set_opening(user_id: int, card_id: int, currency: str, amount: Decimal, rate: Decimal | None) -> None:
    """Corrige lo que tocaba pagar al empezar, en una moneda: reemplaza ese saldo inicial (las
    cuotas de antes de PPM no se tocan)."""
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        try:
            with conn.transaction():
                cid = _currency_id(conn, currency)
                conn.execute("""
                    DELETE FROM account_move m
                     WHERE EXISTS (SELECT 1 FROM account_move_line l
                                    WHERE l.move_id = m.id AND l.account_id = %s AND l.currency_id = %s)
                       AND EXISTS (SELECT 1 FROM account_move_line l
                                    WHERE l.move_id = m.id AND l.account_id = system_account('opening'))
                       AND NOT EXISTS (SELECT 1 FROM account_installment_plan p WHERE p.move_id = m.id)""",
                             (card_id, cid))
                _post_openings(conn, card_id, [OpeningAmount(currency, amount, rate)])
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        except psycopg.Error as e:
            raise _translate(e) from None


def set_due_date(user_id: int, card_id: int, closing_date: dt.date, date_due: dt.date | None) -> None:
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        try:
            with conn.transaction():
                conn.execute("SELECT set_card_due_date(%s, %s, %s)", (card_id, closing_date, date_due))
        except psycopg.Error as e:
            raise _translate(e) from None


def add_installments(user_id: int, card_id: int, currency: str, each: Decimal, n: int, ref: str,
                     rate: Decimal | None) -> int:
    """Cuotas de antes de PPM: las que faltan facturar de una compra vieja, sin la del último estado
    de cuenta. No son gasto de este mes; se facturan desde el próximo corte."""
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        try:
            with conn.transaction():
                base = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
                cid = _currency_id(conn, currency)
                r = Decimal(1) if cid == base else _sell_rate(conn, cid, rate, currency.upper())
                move = conn.execute("SELECT post_card_installments_opening(%s, %s, %s, %s, %s, %s)",
                                    (card_id, cid, each, n, ref.strip(), r)).fetchone()[0]
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                return move
        except psycopg.Error as e:
            raise _translate(e) from None
