"""Préstamos de banco (C4): una cuenta de pasivo con su ficha (el banco) y su cuota de cada mes, una
recurrente por confirmar con capital, interés y seguro que corriges con la boleta. El capital baja lo
que debes; el interés y el seguro son gasto."""

from dataclasses import dataclass
import datetime as dt
from decimal import Decimal

import psycopg

from app import moves
from app.accounts import AccountError, _currency_id, _translate
from app.db import user_transaction

ZERO = Decimal("0.00")


def _parts_accounts(conn: psycopg.Connection) -> tuple[int, int]:
    """Las categorías del interés y del seguro: Gastos financieros › Intereses y › Seguros."""
    interest = conn.execute("SELECT system_account('interest')").fetchone()[0]
    row = conn.execute("""
        SELECT a.id FROM account_account a JOIN account_account p ON p.id = a.parent_id
         WHERE a.active AND a.name = 'Seguros' AND a.account_type = 'expense'
         ORDER BY (p.id = (SELECT parent_id FROM account_account WHERE id = %s)) DESC, a.id LIMIT 1""",
        (interest,)).fetchone()
    return interest, row[0] if row else interest


def _pay_account(conn: psycopg.Connection, account_id: int, currency_id: int) -> str:
    row = conn.execute("SELECT name, account_type, currency_id, active FROM account_account WHERE id = %s",
                       (account_id,)).fetchone()
    if row is None or not row[3] or row[1] != "asset" \
            or conn.execute("SELECT system_role FROM account_account WHERE id = %s", (account_id,)).fetchone()[0]:
        raise AccountError(404, "Elige la cuenta de donde pagas la cuota")
    if row[2] is not None and row[2] != currency_id:
        raise AccountError(400, f"«{row[0]}» es en otra moneda: la cuota se paga en la moneda del préstamo")
    return row[0]


def create(user_id: int, name: str, bank_id: int, currency: str, fresh: bool, amount: Decimal,
           pay_account_id: int, day: int, left: int, capital: Decimal, interest: Decimal,
           insurance: Decimal) -> int:
    """«Ya lo venía pagando»: la deuda de hoy entra como saldo inicial y tus cuentas no se mueven.
    «Recién me lo dieron»: entra a tu cuenta y nace la deuda (no es un ingreso)."""
    name = name.strip()
    if not name:
        raise AccountError(400, "Ponle un nombre")
    if amount <= 0:
        raise AccountError(400, "Escribe cuánto te dieron" if fresh else "Escribe cuánto debes hoy")
    if not 1 <= day <= 31:
        raise AccountError(400, "Elige el día de pago")
    if left < 1:
        raise AccountError(400, "Escribe cuántas cuotas faltan")
    if capital <= 0:
        raise AccountError(400, "Escribe el capital de la cuota")
    if interest < 0 or insurance < 0:
        raise AccountError(400, "El interés y el seguro no pueden ser negativos")
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM res_bank WHERE id = %s", (bank_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos ese banco")
        cur = _currency_id(conn, currency)
        _pay_account(conn, pay_account_id, cur)
        interest_acc, insurance_acc = _parts_accounts(conn)
        try:
            with conn.transaction():
                acc = conn.execute("INSERT INTO account_account (name, account_type, currency_id, icon)"
                                   " VALUES (%s, 'liability', %s, 'real_estate_agent') RETURNING id",
                                   (name, cur)).fetchone()[0]
                today = conn.execute("SELECT user_today()").fetchone()[0]
                if fresh:
                    rate = conn.execute("SELECT get_rate(%s, %s, 'sell')", (cur, today)).fetchone()[0]
                    book = moves._round(amount * rate)
                    move_id = conn.execute("INSERT INTO account_move (date, ref, state) VALUES (%s, %s, 'posted')"
                                           " RETURNING id", (today, f"Préstamo {name}")).fetchone()[0]
                    moves._write(conn, move_id, [(pay_account_id, book, ZERO, cur, amount, None),
                                                 (acc, ZERO, book, cur, -amount, None)])
                    conn.execute("SET CONSTRAINTS ALL DEFERRED")   # el molde de la cuota cuadra al final
                else:
                    conn.execute("SELECT set_opening_balance(%s, %s, %s, NULL)", (acc, amount, today))
                total = capital + interest + insurance
                rec = conn.execute("""
                    INSERT INTO account_recurring (name, currency_id, interval_type, month_day_mode, month_days,
                           date_start, end_type, max_count, amount_type, post_mode)
                    VALUES (%s, %s, 'month', 'days', %s, %s, 'count', %s, 'variable', 'draft') RETURNING id""",
                    (f"Cuota {name}", cur, [day], today + dt.timedelta(days=1), left)).fetchone()[0]
                lines = [(pay_account_id, -total), (acc, capital), (interest_acc, interest), (insurance_acc, insurance)]
                for a, amt in lines:
                    if amt:
                        conn.execute("INSERT INTO account_recurring_line (recurring_id, account_id, amount)"
                                     " VALUES (%s, %s, %s)", (rec, a, amt))
                conn.execute("INSERT INTO account_loan (account_id, bank_id, recurring_id) VALUES (%s, %s, %s)",
                             (acc, bank_id, rec))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                return acc
        except psycopg.Error as e:
            raise _translate(e) from None


@dataclass(frozen=True)
class Part:
    name: str                    # 'Capital', 'Interés' o 'Seguro'
    amount: Decimal


@dataclass(frozen=True)
class Installment:
    move_id: int | None          # None = todavía no se creó
    date: dt.date
    occurrence: dt.date
    posted: bool
    total: Decimal
    parts: list[Part]


@dataclass(frozen=True)
class Loan:
    account_id: int
    name: str
    bank: str
    currency: str
    debt: Decimal                # lo que debes hoy, solo capital
    start_debt: Decimal          # lo que debías al empezar en PPM (o te dieron)
    paid_count: int              # cuotas pagadas en PPM
    left_count: int              # cuotas que faltan
    recurring_id: int | None
    pay_account_id: int | None
    pay_account: str | None
    next: Installment | None     # la próxima: el borrador, o la que viene con los montos estimados
    paid: list[Installment]      # las pagadas, de la más nueva a la más vieja
    active: bool


def _parts(conn: psycopg.Connection, move_id: int, loan_acc: int, pay_acc: int) -> tuple[Decimal, list[Part]]:
    interest_acc, insurance_acc = _parts_accounts(conn)
    total, parts = ZERO, []
    for acc, amount, cur_ok in conn.execute("""
        SELECT l.account_id, l.amount_currency, l.currency_id FROM account_move_line l
         WHERE l.move_id = %s ORDER BY l.id""", (move_id,)):
        if acc == pay_acc:
            total = -amount
        elif acc == loan_acc:
            parts.append(Part("Capital", amount))
        elif acc == insurance_acc and insurance_acc != interest_acc:
            parts.append(Part("Seguro", amount))
        else:
            parts.append(Part("Interés", amount))
    return total, parts


def _template_parts(conn: psycopg.Connection, rec_id: int, loan_acc: int) -> tuple[int, Decimal, list[Part]]:
    interest_acc, insurance_acc = _parts_accounts(conn)
    pay, total, parts = 0, ZERO, []
    for i, (acc, amount) in enumerate(conn.execute(
            "SELECT account_id, amount FROM account_recurring_line WHERE recurring_id = %s ORDER BY id", (rec_id,))):
        if i == 0:
            pay, total = acc, -amount
        elif acc == loan_acc:
            parts.append(Part("Capital", amount))
        elif acc == insurance_acc and insurance_acc != interest_acc:
            parts.append(Part("Seguro", amount))
        else:
            parts.append(Part("Interés", amount))
    return pay, total, parts


def _loan_row(conn: psycopg.Connection, account_id: int) -> tuple:
    row = conn.execute("""
        SELECT a.id, a.name, b.name, trim(c.name), lo.recurring_id, a.active
          FROM account_loan lo
          JOIN account_account a ON a.id = lo.account_id
          JOIN res_bank b ON b.id = lo.bank_id
          JOIN res_currency c ON c.id = a.currency_id
         WHERE lo.account_id = %s""", (account_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos ese préstamo")
    return row


def detail(user_id: int, account_id: int) -> Loan:
    with user_transaction(user_id) as conn:
        conn.execute("SELECT account_recurring_run()")
        acc, name, bank, cur, rec, active = _loan_row(conn, account_id)
        debt = -(conn.execute("SELECT coalesce(sum(amount_currency), 0) FROM account_move_line l"
                              " JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'"
                              " WHERE l.account_id = %s", (acc,)).fetchone()[0])
        start = conn.execute("""
            SELECT coalesce(-sum(l.amount_currency), 0) FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
             WHERE l.account_id = %s AND l.amount_currency < 0""", (acc,)).fetchone()[0]
        pay_acc, pay_name, nxt, paid, left = None, None, None, [], 0
        if rec is not None:
            pay_acc, est_total, est_parts = _template_parts(conn, rec, acc)
            pay_name = conn.execute("SELECT name FROM account_account WHERE id = %s", (pay_acc,)).fetchone()[0]
            moves_ = conn.execute("SELECT id, date, recurring_date, state = 'posted' FROM account_move"
                                  " WHERE recurring_id = %s ORDER BY recurring_date DESC", (rec,)).fetchall()
            for mid, d, occ, posted in moves_:
                total, parts = _parts(conn, mid, acc, pay_acc)
                inst = Installment(mid, d, occ, posted, total, parts)
                if posted:
                    paid.append(inst)
                elif nxt is None or occ < nxt.occurrence:
                    nxt = inst
            r = conn.execute("SELECT state, max_count, generated_until FROM account_recurring WHERE id = %s",
                             (rec,)).fetchone()
            generated = len(moves_)
            left = max((r[1] or 0) - len(paid), 0)
            if nxt is None and r[0] == "active":
                occ = conn.execute("""
                    SELECT min(d.occurrence_date) FROM account_recurring_dates(%s, user_today() + 400) d
                     WHERE d.occurrence_date > %s""", (rec, r[2] or dt.date.min)).fetchone()[0]
                if occ is not None and generated < (r[1] or 0):
                    nxt = Installment(None, occ, occ, False, est_total, est_parts)
    return Loan(acc, name, bank, cur, debt, start, len(paid), left, rec, pay_acc, pay_name, nxt, paid, active)


def pay(user_id: int, account_id: int, on: dt.date | None, from_account_id: int, capital: Decimal,
        interest: Decimal, insurance: Decimal) -> int:
    """Pagar la cuota con los montos de la boleta: confirma la por confirmar o, si todavía no se creó,
    registra la próxima (ese día no se crea otra)."""
    if capital < 0 or interest < 0 or insurance < 0 or capital + interest + insurance <= 0:
        raise AccountError(400, "Escribe los montos de la cuota")
    with user_transaction(user_id) as conn:
        acc, name, _bank, _cur, rec, _active = _loan_row(conn, account_id)
        if rec is None:
            raise AccountError(400, "Ese préstamo ya no tiene cuota")
        cur = conn.execute("SELECT currency_id FROM account_account WHERE id = %s", (acc,)).fetchone()[0]
        base = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
        _pay_account(conn, from_account_id, cur)
        today = conn.execute("SELECT user_today()").fetchone()[0]
        on = on or today
        if on > today:
            raise AccountError(400, "Un pago no puede ser de una fecha que todavía no llega")
        interest_acc, insurance_acc = _parts_accounts(conn)
        rate = Decimal(1) if cur == base else conn.execute("SELECT get_rate(%s, %s, 'sell')", (cur, on)).fetchone()[0]
        total = capital + interest + insurance
        book = moves._round(total * rate)
        cap_b, int_b = moves._round(capital * rate), moves._round(interest * rate)
        ins_b = book - cap_b - int_b
        lines = [(from_account_id, ZERO, book, cur, -total, None)]
        if capital:
            lines.append((acc, cap_b, ZERO, cur, capital, None))
        if interest:
            lines.append((interest_acc, int_b, ZERO, base, int_b, None))
        if insurance:
            lines.append((insurance_acc, ins_b, ZERO, base, ins_b, None))
        try:
            with conn.transaction():
                draft = conn.execute("SELECT id FROM account_move WHERE recurring_id = %s AND state = 'draft'"
                                     " ORDER BY recurring_date LIMIT 1", (rec,)).fetchone()
                if draft:
                    move_id = draft[0]
                    conn.execute("DELETE FROM account_move_line WHERE move_id = %s", (move_id,))
                    conn.execute("UPDATE account_move SET date = %s WHERE id = %s", (on, move_id))
                else:
                    occ = conn.execute("""
                        SELECT min(d.occurrence_date) FROM account_recurring r,
                               account_recurring_dates(r.id, user_today() + 400) d
                         WHERE r.id = %s AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
                           AND NOT EXISTS (SELECT 1 FROM account_move m WHERE m.recurring_id = r.id
                                            AND m.recurring_date = d.occurrence_date)""", (rec,)).fetchone()[0]
                    if occ is None:
                        raise AccountError(400, "Ya pagaste todas las cuotas")
                    move_id = conn.execute(
                        "INSERT INTO account_move (date, ref, state, recurring_id, recurring_date)"
                        " VALUES (%s, %s, 'draft', %s, %s) RETURNING id", (on, f"Cuota {name}", rec, occ)).fetchone()[0]
                moves._write(conn, move_id, lines)
                conn.execute("UPDATE account_move SET state = 'posted' WHERE id = %s", (move_id,))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                # La que se pagó antes de su día cuenta como procesada; con la última, la cuota termina
                conn.execute("""
                    UPDATE account_recurring r SET generated_until = greatest(coalesce(r.generated_until,
                           '-infinity'), (SELECT max(recurring_date) FROM account_move WHERE recurring_id = r.id))
                     WHERE r.id = %s""", (rec,))
                conn.execute("""
                    UPDATE account_recurring r SET state = 'done'
                     WHERE r.id = %s AND (SELECT count(*) FROM account_move WHERE recurring_id = r.id) >= r.max_count""",
                             (rec,))
                return move_id
        except psycopg.Error as e:
            raise _translate(e) from None
