"""Personas (C6): quién me debe, a quién debo y de quién guardo plata; cada deuda abierta con su
antigüedad; compensar lo que se deben y dar por perdido lo que te deben.

Es el cuaderno de fiados de la bodega: un solo cuaderno (las cuentas Por cobrar, Por pagar y Plata
que guardo de otros) y en cada anotación el nombre de la persona."""

from collections import defaultdict
from dataclasses import dataclass, field, replace
import datetime as dt
from decimal import Decimal
import re

import psycopg

from app.accounts import ZERO, AccountError, Money, _currency_id, _today, _today_rates, _translate
from app.db import user_transaction
from app.moves import _first, _pairs, owed, reconcile

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
    date_maturity: dt.date | None = None      # vence: el de a mano o la fecha de pago del ciclo de su corte
    maturity_manual: dt.date | None = None    # el puesto a mano
    maturity_closing: dt.date | None = None   # parte de una compra en cuotas: el corte de su cuota…
    part: int | None = None                   # …qué cuota es…
    parts: int | None = None                  # …de cuántas…
    interest: Decimal | None = None           # …el interés que el banco ya le cargó (dentro de amount)…
    billed: bool | None = None                # …y si ya se facturó (por cobrar) o no (por facturar)


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
        cuotas: dict[tuple[int, int], OpenItem] = {}
        # Una cuota de una compra en cuotas: su parte del capital y, ya facturada, su interés (otro
        # asiento) van juntos, como en el cronograma
        for _role, _interest, *item in conn.execute("""
            SELECT a.system_role, mv.installment_plan_id IS NOT NULL, r.id, p.move_id, pm.date, pm.ref,
                   trim(c.name), abs(r.amount_currency), abs(r.amount_residual), user_today() - pm.date,
                   r.date_maturity, r.maturity_manual, r.maturity_closing, pl.sequence, p.n_installments,
                   CASE WHEN mv.installment_plan_id IS NOT NULL THEN abs(r.amount_currency) END,
                   pl.closing_date <= user_today()
              FROM account_move_line_residual r
              JOIN account_move mv ON mv.id = r.move_id
              JOIN account_account a ON a.id = r.account_id
              JOIN res_currency c ON c.id = r.currency_id
              JOIN account_installment_plan p ON r.maturity_closing IS NOT NULL
                                             AND (p.move_id = r.move_id OR p.id = mv.installment_plan_id)
              JOIN account_move pm ON pm.id = p.move_id
              JOIN account_installment_plan_line pl ON pl.plan_id = p.id AND pl.closing_date = r.maturity_closing
             WHERE r.partner_id = %s AND r.amount_residual > 0 AND a.system_role = 'receivable'
             ORDER BY r.maturity_closing, mv.installment_plan_id IS NOT NULL, r.id""", (partner_id,)):
            key = (item[1], item[11])
            it = OpenItem(*item)
            if key in cuotas:
                was = cuotas[key]
                it = replace(was, amount=was.amount + it.amount, open=was.open + it.open,
                             interest=(was.interest or ZERO) + (it.interest or ZERO))
            cuotas[key] = it
        for role, *item in conn.execute("""
            SELECT a.system_role, r.id, r.move_id, r.date, r.ref, trim(c.name),
                   abs(r.amount_currency), abs(r.amount_residual), user_today() - r.date,
                   r.date_maturity, r.maturity_manual, r.maturity_closing, pl.sequence, p.n_installments
              FROM account_move_line_residual r
              JOIN account_move mv ON mv.id = r.move_id
              JOIN account_account a ON a.id = r.account_id
              JOIN res_currency c ON c.id = r.currency_id
              LEFT JOIN account_installment_plan p ON p.move_id = r.move_id AND r.maturity_closing IS NOT NULL
              LEFT JOIN account_installment_plan_line pl ON pl.plan_id = p.id AND pl.closing_date = r.maturity_closing
             WHERE r.partner_id = %s AND r.amount_residual <> 0
               AND NOT (r.maturity_closing IS NOT NULL AND a.system_role = 'receivable'
                        AND (p.id IS NOT NULL OR mv.installment_plan_id IS NOT NULL))
               AND ((a.system_role = 'receivable' AND r.amount_residual > 0)
                 OR (a.system_role = 'payable' AND r.amount_residual < 0))
             ORDER BY coalesce(r.date_maturity, r.maturity_closing, r.date), r.date, r.id""", (partner_id,)):
            items[role].append(OpenItem(*item))
        items["receivable"] += cuotas.values()
        items["receivable"].sort(key=lambda i: (i.date_maturity or i.maturity_closing or i.date, i.date, i.line_id))
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


# --- Saldo inicial con una persona --------------------------------------------------------------

def _opening_args(conn: psycopg.Connection, partner_id: int, side: str, currency: str, amount: Decimal,
                  on: dt.date | None, rate: Decimal | None) -> tuple[str, int, dt.date, Decimal]:
    """Lo que piden «Ya me debía» y «Ya le debía»: el rol, la moneda, la fecha y el tipo de cambio."""
    if side not in ("owes_me", "i_owe"):
        raise AccountError(400, "Elige si te debía o si le debías")
    if amount <= 0:
        raise AccountError(400, "Escribe un monto mayor que cero")
    role = "receivable" if side == "owes_me" else "payable"
    _name(conn, partner_id)
    cur_id = _currency_id(conn, currency)
    today = conn.execute("SELECT user_today()").fetchone()[0]
    on = on or today
    if on > today:
        raise AccountError(400, "Un saldo inicial es de hoy o de antes: elige otra fecha")
    base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
    if cur_id == base_id:
        rate = Decimal(1)
    elif rate is None:
        try:
            with conn.transaction():
                rate = conn.execute("SELECT get_rate(%s, %s, %s)",
                                    (cur_id, on, "buy" if role == "receivable" else "sell")).fetchone()[0]
        except psycopg.errors.NoDataFound:
            raise AccountError(400, f"Falta el tipo de cambio de {currency.upper()}: escríbelo") from None
    return role, cur_id, on, rate  # type: ignore[return-value]


def add_opening(user_id: int, partner_id: int, side: str, currency: str, amount: Decimal,
                on: dt.date | None = None, rate: Decimal | None = None, ref: str | None = None) -> int:
    """«Ya me debía» o «Ya le debía»: lo que había con esa persona antes de empezar a usar PPM.
    Va contra Saldos iniciales y no mueve tus cuentas; queda como una deuda abierta con su fecha."""
    with user_transaction(user_id) as conn:
        role, cur_id, on, rate = _opening_args(conn, partner_id, side, currency, amount, on, rate)
        try:
            with conn.transaction():
                move_id = conn.execute("SELECT post_partner_opening(%s, %s, %s, %s, %s, %s, %s)",
                                       (role, partner_id, cur_id, amount, on, rate, ref)).fetchone()[0]
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                reconcile(conn, {(partner_id, conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0])})
                return move_id
        except psycopg.Error as e:
            raise _translate(e) from None


def update_opening(user_id: int, move_id: int, partner_id: int, side: str, currency: str, amount: Decimal,
                   on: dt.date | None = None, rate: Decimal | None = None, ref: str | None = None) -> None:
    """Corregir lo que había con una persona antes de PPM, en el mismo movimiento (sus adjuntos y su
    nota se quedan). Los cobros o pagos que ya tenía se vuelven a conciliar; no puede quedar debajo
    de lo ya cobrado o pagado."""
    with user_transaction(user_id) as conn:
        found = conn.execute("""
            SELECT 1 FROM account_move_line l JOIN account_account a ON a.id = l.account_id
             WHERE l.move_id = %s AND a.system_role IN ('receivable', 'payable') AND l.partner_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM account_move_line o JOIN account_account oa ON oa.id = o.account_id
                            WHERE o.move_id = l.move_id AND oa.system_role = 'opening')""", (move_id,)).fetchone()
        if found is None:
            raise AccountError(404, "Ese movimiento no es lo que había con una persona antes de PPM")
        role, cur_id, on, rate = _opening_args(conn, partner_id, side, currency, amount, on, rate)
        before = _pairs(conn, move_id)
        try:
            with conn.transaction():
                # Se arma de nuevo con la misma función y sus apuntes pasan al movimiento de siempre
                fresh = conn.execute("SELECT post_partner_opening(%s, %s, %s, %s, %s, %s, %s)",
                                     (role, partner_id, cur_id, amount, on, rate, ref)).fetchone()[0]
                conn.execute("DELETE FROM account_move_line WHERE move_id = %s", (move_id,))
                conn.execute("UPDATE account_move_line SET move_id = %s WHERE move_id = %s", (move_id, fresh))
                conn.execute("UPDATE account_move m SET date = f.date, ref = f.ref FROM account_move f"
                             " WHERE m.id = %s AND f.id = %s", (move_id, fresh))
                conn.execute("DELETE FROM account_move WHERE id = %s", (fresh,))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                after = _pairs(conn, move_id)
                reconcile(conn, before | after)
                for partner, account in before | after:
                    left = conn.execute("""
                        SELECT a.system_role, l.currency_id, coalesce(sum(l.amount_currency), 0)
                          FROM account_move_line l JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
                          JOIN account_account a ON a.id = l.account_id
                         WHERE l.partner_id = %s AND l.account_id = %s
                         GROUP BY a.system_role, l.currency_id""", (partner, account)).fetchall()
                    for r, _cur, total in left:
                        if (r == "receivable" and total < 0) or (r == "payable" and total > 0):
                            raise AccountError(400, "Ya hay cobros o pagos de más para ese monto: "
                                                    "no puede ser menor que lo ya cobrado o pagado")
        except psycopg.Error as e:
            raise _translate(e) from None


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
