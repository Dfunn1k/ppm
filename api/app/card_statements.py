"""El estado de cuenta de una tarjeta, importado del PDF. Su foto (línea, utilizada, disponible,
facturado y saldo de cuotas por moneda) es lo que dice el banco y no se recalcula; sus fechas Del/Al
mandan sobre el día de corte para ese ciclo. Del «Detalle plan cuotas» sale el capital y el interés
de cada cuota tuya facturada. Entre cortes, la línea es la de la última foto más lo que pasó
después (estimada): las compras y cargos la ocupan, los pagos la liberan, una compra en cuotas
ocupa su precio y las cuotas que se facturan no la cambian. Lo que no es la moneda de la línea
cuenta al tipo del ciclo abierto: el de venta del día o el escrito a mano."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

import psycopg

from app import card_pdf
from app.accounts import ZERO, AccountError, TodayRate, _currency_id, _today_rates, _translate
from app.db import user_transaction

if TYPE_CHECKING:
    from app.cards import CardRate

MATCH_DAYS = 2   # un movimiento del banco y uno de PPM son el mismo si difieren hasta 2 días
PLAN_DAYS = 3    # una fila del «Detalle plan cuotas» es de una compra si su fecha difiere hasta 3 días
MAX_BYTES = 10 * 1024 * 1024


def _cents(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _card(conn: psycopg.Connection, card_id: int) -> tuple[int, str, str | None]:
    row = conn.execute("""
        SELECT cc.limit_currency_id, trim(c.name), cc.last4 FROM account_credit_card cc
          JOIN res_currency c ON c.id = cc.limit_currency_id WHERE cc.account_id = %s""", (card_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos esa tarjeta")
    return row


# --- El tipo de cambio ------------------------------------------------------------------------

def open_rates(conn: psycopg.Connection, card_id: int, last: dt.date,
               today: dict[str, TodayRate] | None = None) -> dict[str, CardRate]:
    """A cuánto cuentan en la línea las monedas que no son la suya, en el ciclo abierto: el tipo
    escrito a mano después del último corte o, si no, el de venta del día."""
    from app.cards import CardRate
    today = _today_rates(conn) if today is None else today
    out = {cur: CardRate(cur, r.sell, r.date, False) for cur, r in today.items()}
    for cur, rate, on in conn.execute(
            "SELECT trim(c.name), r.rate, r.rate_date FROM account_credit_card_rate r"
            "  JOIN res_currency c ON c.id = r.currency_id"
            " WHERE r.card_account_id = %s AND r.rate_date > %s", (card_id, last)):
        out[cur] = CardRate(cur, rate, on, True)
    return out


def set_rate(user_id: int, card_id: int, currency: str, rate: Decimal | None) -> None:
    """Escribir el tipo de cambio del ciclo abierto (o volver al del día con None)."""
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        cid = _currency_id(conn, currency)
        if rate is None:
            conn.execute("DELETE FROM account_credit_card_rate WHERE card_account_id = %s AND currency_id = %s",
                         (card_id, cid))
            return
        conn.execute("""
            INSERT INTO account_credit_card_rate (card_account_id, currency_id, rate, rate_date)
            VALUES (%s, %s, %s, user_today())
            ON CONFLICT (card_account_id, currency_id) DO UPDATE SET rate = EXCLUDED.rate, rate_date = EXCLUDED.rate_date""",
                     (card_id, cid, rate))


# --- La línea ---------------------------------------------------------------------------------

@dataclass(frozen=True)
class Line:
    used: Decimal
    matched: bool                # la foto del último corte, sin nada después: «Cuadrada con banco»
    statement: dt.date | None    # el corte de la foto de donde parte


def line(conn: psycopg.Connection, card_id: int, limit_cur: str, last: dt.date, debts: dict[str, Decimal],
         rates: dict[str, CardRate], book: dict[str, Decimal]) -> Line:
    """Lo que ocupa de la línea: la última foto del banco más lo de después. Sin estado de cuenta,
    toda la deuda (estimada)."""
    def to_limit(cur: str, amount: Decimal) -> Decimal:
        if cur == limit_cur:
            return amount
        if cur in rates:
            return _cents(amount * rates[cur].rate)
        return -book.get(cur, ZERO)

    st = conn.execute("""
        SELECT closing_date, bank_used FROM account_credit_card_statement
         WHERE card_account_id = %s AND closing_date <= user_today() ORDER BY closing_date DESC LIMIT 1""",
                      (card_id,)).fetchone()
    if st is None:
        return Line(sum((to_limit(c, d) for c, d in debts.items()), ZERO), False, None)
    closing, used = st
    after = conn.execute("""
        SELECT trim(c.name), sum(CASE WHEN p.id IS NULL THEN -l.amount_currency
                                      ELSE coalesce(p.price, p.principal) END)
          FROM account_move_line l
          JOIN account_move m ON m.id = l.move_id AND m.state = 'posted' AND m.date > %s AND m.date <= user_today()
          JOIN res_currency c ON c.id = l.currency_id
          LEFT JOIN account_installment_plan p ON p.move_id = m.id
         WHERE l.account_id = %s
         GROUP BY c.name""", (closing, card_id)).fetchall()
    for cur, amount in after:
        used += to_limit(cur, amount)
    return Line(used, not after and closing == last, closing)


# --- Importar el PDF --------------------------------------------------------------------------

def import_pdf(user_id: int, card_id: int, data: bytes, filename: str | None) -> dt.date:
    """Guarda el estado de cuenta (reemplaza el del mismo corte) y aplica lo que trae: las fechas
    del ciclo, la fecha de pago, la línea de crédito y el capital e interés de las cuotas. Devuelve
    su corte."""
    if len(data) > MAX_BYTES:
        raise AccountError(400, "Ese PDF pesa más de 10 MB")
    parsed = card_pdf.parse_pdf(data)
    with user_transaction(user_id) as conn:
        _, _, last4 = _card(conn, card_id)
        if last4 and parsed.last4 and last4 != parsed.last4:
            raise AccountError(400, f"Ese estado de cuenta es de la tarjeta •••• {parsed.last4}, no de esta (•••• {last4})")
        today = conn.execute("SELECT user_today()").fetchone()[0]
        if parsed.closing_date > today:
            raise AccountError(400, "Ese estado de cuenta cierra después de hoy")
        try:
            with conn.transaction():
                _save(conn, card_id, parsed, filename)
        except psycopg.Error as e:
            raise _translate(e) from None
    return parsed.closing_date


def _currency(conn: psycopg.Connection, code: str) -> int | None:
    try:
        return _currency_id(conn, code)
    except AccountError:
        return None


def _save(conn: psycopg.Connection, card_id: int, p: card_pdf.ParsedStatement, filename: str | None) -> None:
    key = (card_id, p.closing_date)
    conn.execute("DELETE FROM account_credit_card_statement WHERE card_account_id = %s AND closing_date = %s", key)
    conn.execute("""
        INSERT INTO account_credit_card_statement (card_account_id, closing_date, date_from, date_due, credit_limit,
                                                   bank_used, bank_available, filename, unread)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                 (*key, p.date_from, p.date_due, p.credit_limit, p.used, p.available, filename, p.unread))
    for c in p.currencies:
        cid = _currency(conn, c.currency)
        if cid is None:
            continue
        conn.execute("""
            INSERT INTO account_credit_card_statement_currency (card_account_id, closing_date, currency_id,
                                                                bank_subtotal, bank_billed, bank_installments)
            VALUES (%s, %s, %s, %s, %s, %s)""", (*key, cid, c.subtotal, c.billed, c.installments))
    for x in p.lines:
        cid = _currency(conn, x.currency)
        if cid is not None and x.amount:
            conn.execute("""
                INSERT INTO account_credit_card_statement_line (card_account_id, closing_date, date, name, amount,
                                                                currency_id, kind)
                VALUES (%s, %s, %s, %s, %s, %s, %s)""", (*key, x.date, x.name or "Movimiento", x.amount, cid, x.kind))

    # Las fechas del banco: el ciclo, la fecha de pago y la línea (si es el último estado de cuenta)
    conn.execute("SELECT realign_card_closings(%s)", (card_id,))
    if p.date_due is not None and p.date_due > p.closing_date:
        conn.execute("SELECT set_card_due_date(%s, %s, %s)", (*key, p.date_due))
    conn.execute("""
        UPDATE account_credit_card SET credit_limit = %s
         WHERE account_id = %s AND NOT EXISTS (SELECT 1 FROM account_credit_card_statement
                                                WHERE card_account_id = %s AND closing_date > %s)""",
                 (p.credit_limit, card_id, card_id, p.closing_date))
    conn.execute("SELECT post_installment_billing()")

    # El «Detalle plan cuotas»: cada fila, con su compra en PPM; si es tuya, la cuota se divide
    taken: set[int] = set()
    for x in p.installments:
        cid = _currency(conn, x.currency)
        if cid is None:
            continue
        plan = conn.execute("""
            SELECT pl.plan_id, p.expense_account_id IS NOT NULL
              FROM account_installment_plan p
              JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
              JOIN account_installment_plan_line pl ON pl.plan_id = p.id AND pl.sequence = %(seq)s
             WHERE p.card_account_id = %(card)s AND p.currency_id = %(cur)s AND p.n_installments = %(n)s
               AND pl.principal = %(total)s AND abs(m.date - %(date)s) <= %(days)s AND NOT (p.id = ANY(%(taken)s))
             ORDER BY coalesce(p.price, p.principal) = %(price)s DESC, abs(m.date - %(date)s), p.id
             LIMIT 1""", {"seq": x.sequence, "card": card_id, "cur": cid, "n": x.n_installments, "total": x.total,
                          "date": x.date, "days": PLAN_DAYS, "taken": list(taken), "price": x.price}).fetchone()
        plan_id, mine = plan if plan else (None, False)
        if plan_id is not None:
            taken.add(plan_id)
            # Una cuota facturada en un periodo cerrado no se divide: queda la foto y se avisa
            if mine and not conn.execute("""
                    SELECT 1 FROM account_move m JOIN res_users u ON u.id = m.user_id
                     WHERE m.installment_plan_id = %s AND m.installment_sequence = %s AND m.date <= u.lock_date""",
                                         (plan_id, x.sequence)).fetchone():
                conn.execute("SELECT set_installment_detail(%s, %s, %s, %s)",
                             (plan_id, x.sequence, x.capital, x.interest))
        conn.execute("""
            INSERT INTO account_credit_card_statement_installment (card_account_id, closing_date, date, name,
                   currency_id, price, sequence, n_installments, capital, interest, plan_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                     (*key, x.date, x.name, cid, x.price, x.sequence, x.n_installments, x.capital, x.interest, plan_id))


# --- La conciliación --------------------------------------------------------------------------

@dataclass(frozen=True)
class StatementLine:
    date: dt.date
    name: str
    amount: Decimal              # + cargo, − abono
    currency: str
    move_id: int | None = None   # su par en PPM
    payment: bool = False        # un pago (BBVA lo marca): no entra en el subtotal


@dataclass(frozen=True)
class Unmatched:
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class StatementCurrency:
    currency: str
    subtotal: Decimal            # compras y cuotas del ciclo según PPM (sin cargos del banco)
    bank_subtotal: Decimal | None
    bank_billed: Decimal | None
    bank_installments: Decimal | None
    read: Decimal                # la suma de los movimientos que se leyeron del PDF


@dataclass(frozen=True)
class StatementFee:
    name: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class StatementInstallment:
    date: dt.date
    name: str
    currency: str
    price: Decimal
    sequence: int
    n_installments: int
    capital: Decimal
    interest: Decimal
    move_id: int | None          # su compra en PPM
    mine: bool                   # tuya: la cuota se dividió en capital e interés
    id: int = 0                  # la fila del «Detalle plan cuotas»
    differs: InstallmentGuess | None = None   # sin par: una compra tuya que casi es, con otra cuota
    not_split: bool = False      # tuya, pero en un periodo cerrado: no se dividió en capital e interés


@dataclass(frozen=True)
class InstallmentGuess:
    """Una compra tuya que sería esta cuota del banco si no fuera por el monto de la cuota."""
    plan_id: int
    move_id: int
    ref: str
    each: Decimal                # la cuota en PPM


@dataclass(frozen=True)
class Reconciliation:
    closing_date: dt.date
    date_from: dt.date
    date_due: dt.date | None
    filename: str | None
    credit_limit: Decimal
    limit_currency: str
    used: Decimal                # foto: línea utilizada
    available: Decimal           # foto: crédito disponible
    currencies: list[StatementCurrency]
    fees: list[StatementFee]     # cargos del banco del estado de cuenta
    bank_charges: Decimal        # cargos del banco del ciclo en PPM (en la moneda de la línea)
    installments: list[StatementInstallment]
    explanations: list[str] = field(default_factory=list)
    lines: list[StatementLine] = field(default_factory=list)
    unmatched: list[Unmatched] = field(default_factory=list)   # de PPM, sin par en el banco
    unread: list[str] = field(default_factory=list)            # del PDF, no se pudieron leer


def _money(v: Decimal, symbol: str) -> str:
    return f"{symbol} {abs(v):,.2f}"


@dataclass(frozen=True)
class _Item:
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal
    currency: str
    closing: dt.date | None      # cuota: su corte
    payment: bool = False


def _match(bank: list[StatementLine], items: list[_Item]) -> tuple[list[StatementLine], list[_Item]]:
    """Empareja por monto exacto, moneda y fecha ±2 días (la cuota, por su compra o por su corte)."""
    free = list(items)
    out = []
    for b in sorted(bank, key=lambda x: x.date):
        best = None
        for i in free:
            if i.currency != b.currency or abs(i.amount) != abs(b.amount):
                continue
            gap = min(abs((i.date - b.date).days), abs((i.closing - b.date).days) if i.closing else 999)
            if gap <= MATCH_DAYS and (best is None or gap < best[0]):
                best = (gap, i)
        if best:
            free.remove(best[1])
            out.append(StatementLine(b.date, b.name, b.amount, b.currency, best[1].move_id, b.payment))
        else:
            out.append(b)
    return out, free


def reconciliation(user_id: int, card_id: int, closing: dt.date) -> Reconciliation:
    from app import cards
    with user_transaction(user_id) as conn:
        limit_cur_id, limit_cur, _ = _card(conn, card_id)
        st = conn.execute("""
            SELECT date_from, date_due, filename, credit_limit, bank_used, bank_available, unread
              FROM account_credit_card_statement WHERE card_account_id = %s AND closing_date = %s""",
                          (card_id, closing)).fetchone()
        if st is None:
            raise AccountError(404, "Ese corte no tiene estado de cuenta importado")
        date_from, date_due, filename, limit, used, available, unread = st
        last = conn.execute("SELECT card_last_closing(%s, user_today())", (card_id,)).fetchone()[0]
        nxt = conn.execute("SELECT card_closing_for(%s, %s + 1)", (card_id, last)).fetchone()[0]
        cycle = next((c for c in cards._cycles(conn, card_id, last, nxt, {}) if c.closing_date == closing), None)
        bank_cur = conn.execute("""
            SELECT trim(c.name), sc.bank_subtotal, sc.bank_billed, sc.bank_installments
              FROM account_credit_card_statement_currency sc JOIN res_currency c ON c.id = sc.currency_id
             WHERE sc.card_account_id = %s AND sc.closing_date = %s ORDER BY sc.currency_id <> %s, c.name""",
                                (card_id, closing, limit_cur_id)).fetchall()
        rows = conn.execute("""
            SELECT l.date, l.name, l.amount, trim(c.name), l.kind FROM account_credit_card_statement_line l
              JOIN res_currency c ON c.id = l.currency_id
             WHERE l.card_account_id = %s AND l.closing_date = %s ORDER BY l.date, l.id""", (card_id, closing)).fetchall()
        plans = []
        taken: set[int] = set()
        for r in conn.execute("""
            SELECT s.date, s.name, trim(c.name), s.price, s.sequence, s.n_installments, s.capital, s.interest,
                   p.move_id, coalesce(p.expense_account_id IS NOT NULL, false), s.id, s.currency_id,
                   s.rejected_plan_ids, s.plan_id,
                   p.expense_account_id IS NOT NULL AND pl.interest IS NULL AND s.interest > 0
              FROM account_credit_card_statement_installment s
              JOIN res_currency c ON c.id = s.currency_id
              LEFT JOIN account_installment_plan p ON p.id = s.plan_id
              LEFT JOIN account_installment_plan_line pl ON pl.plan_id = s.plan_id AND pl.sequence = s.sequence
             WHERE s.card_account_id = %s AND s.closing_date = %s ORDER BY s.id""", (card_id, closing)).fetchall():
            if r[13] is not None:
                taken.add(r[13])
            plans.append(r)
        out = []
        for r in plans:
            guess = None if r[13] is not None else _guess(conn, card_id, r, taken)
            if guess is not None:
                taken.add(guess.plan_id)
            out.append(StatementInstallment(*r[:10], r[10], guess, bool(r[14])))
        plans = out

    fees = [StatementFee(n, a, c) for _, n, a, c, k in rows if k == "fee"]
    bank_lines = [StatementLine(d, n, a, c, payment=k == "payment") for d, n, a, c, k in rows if k != "fee"]

    # Lo que dice PPM del ciclo: compras y cuotas (subtotal) y cargos del banco, por moneda
    subtotal: dict[str, Decimal] = defaultdict(lambda: ZERO)
    charges: dict[str, Decimal] = defaultdict(lambda: ZERO)
    items: list[_Item] = []
    for i in (cycle.items if cycle else []):
        if not i.posted or i.kind == "opening":
            continue
        if i.kind != "payment":
            (charges if i.bank else subtotal)[i.currency] += i.amount
        if not i.bank:
            items.append(_Item(i.move_id, i.date, i.ref, i.amount, i.currency,
                               closing if i.kind == "installment" else None, i.kind == "payment"))
    read: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for b in bank_lines:
        if not b.payment:
            read[b.currency] += b.amount
    currencies = [StatementCurrency(cur, _cents(subtotal[cur]), sub, billed, inst, read[cur])
                  for cur, sub, billed, inst in bank_cur]
    lines, free = _match(bank_lines, items)
    unmatched = [Unmatched(i.move_id, i.date, i.ref, i.amount, i.currency) for i in free]
    # Lo que explica una diferencia del subtotal: sin los pagos del banco (si los marca) ni los de PPM
    explain = _explain(currencies, [x for x in lines if not x.payment],
                       [Unmatched(i.move_id, i.date, i.ref, i.amount, i.currency) for i in free
                        if not (i.payment and any(b.payment for b in bank_lines))],
                       fees, charges, unread)
    # Las cuotas en un periodo cerrado (not_split) las explica la app, con el nombre en negrita y la cuota en pastilla
    return Reconciliation(closing, date_from, date_due, filename, limit, limit_cur, used, available, currencies,
                          fees, _cents(charges[limit_cur]), plans, explain, lines, unmatched, unread)


def _guess(conn: psycopg.Connection, card_id: int, r: tuple, taken: set[int]) -> InstallmentGuess | None:
    """Una cuota del banco sin par: la compra tuya en cuotas que lo sería salvo por el monto de la
    cuota (misma tarjeta, moneda y número de cuotas, fecha a 3 días o menos, sin cancelar)."""
    date, _name, _cur, price, seq, n, capital, interest, *_rest = r
    cur_id, rejected = r[11], r[12]
    row = conn.execute("""
        SELECT p.id, p.move_id, m.ref, pl.principal
          FROM account_installment_plan p
          JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
          JOIN account_installment_plan_line pl ON pl.plan_id = p.id AND pl.sequence = %(seq)s
         WHERE p.card_account_id = %(card)s AND p.currency_id = %(cur)s AND p.n_installments = %(n)s
           AND p.expense_account_id IS NOT NULL AND p.cancel_move_id IS NULL
           AND abs(m.date - %(date)s) <= %(days)s AND pl.principal <> %(total)s
           AND NOT (p.id = ANY(%(skip)s))
         ORDER BY coalesce(p.price, p.principal) = %(price)s DESC, abs(m.date - %(date)s), p.id
         LIMIT 1""", {"seq": seq, "card": card_id, "cur": cur_id, "n": n, "date": date, "days": PLAN_DAYS,
                      "total": capital + interest, "price": price, "skip": list(taken | set(rejected))}).fetchone()
    return InstallmentGuess(*row) if row else None


def use_bank_installment(user_id: int, card_id: int, closing: dt.date, row_id: int) -> None:
    """«Usar la del banco»: la compra pasa a la cuota del estado de cuenta y esta cuota se divide en
    capital e interés."""
    with user_transaction(user_id) as conn:
        _card(conn, card_id)
        r = conn.execute("""
            SELECT s.date, s.name, trim(c.name), s.price, s.sequence, s.n_installments, s.capital, s.interest,
                   NULL, false, s.id, s.currency_id, s.rejected_plan_ids, s.plan_id
              FROM account_credit_card_statement_installment s JOIN res_currency c ON c.id = s.currency_id
             WHERE s.id = %s AND s.card_account_id = %s AND s.closing_date = %s""", (row_id, card_id, closing)).fetchone()
        if r is None:
            raise AccountError(404, "No encontramos esa cuota del estado de cuenta")
        if r[13] is not None:
            raise AccountError(400, "Esa cuota ya cuadra con su compra")
        taken = {x for (x,) in conn.execute(
            "SELECT plan_id FROM account_credit_card_statement_installment WHERE card_account_id = %s"
            " AND closing_date = %s AND plan_id IS NOT NULL", (card_id, closing))}
        guess = _guess(conn, card_id, r, taken)
        if guess is None:
            raise AccountError(400, "No encontramos una compra tuya para esa cuota")
        try:
            with conn.transaction():
                conn.execute("SELECT set_installment_amount(%s, %s)", (guess.plan_id, r[6] + r[7]))
                conn.execute("SELECT set_installment_detail(%s, %s, %s, %s)", (guess.plan_id, r[4], r[6], r[7]))
                conn.execute("UPDATE account_credit_card_statement_installment SET plan_id = %s WHERE id = %s",
                             (guess.plan_id, row_id))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        except psycopg.Error as e:
            raise _translate(e) from None


def reject_installment_guess(user_id: int, card_id: int, closing: dt.date, row_id: int, plan_id: int) -> None:
    """«No es esta compra»: esa cuota del banco no se vuelve a proponer con esa compra."""
    with user_transaction(user_id) as conn:
        done = conn.execute("""
            UPDATE account_credit_card_statement_installment
               SET rejected_plan_ids = array_append(rejected_plan_ids, %s)
             WHERE id = %s AND card_account_id = %s AND closing_date = %s AND plan_id IS NULL
               AND NOT (%s = ANY(rejected_plan_ids))""", (plan_id, row_id, card_id, closing, plan_id)).rowcount
        if not done:
            raise AccountError(404, "No encontramos esa cuota del estado de cuenta")


def _explain(currencies: list[StatementCurrency], lines: list[StatementLine], unmatched: list[Unmatched],
             fees: list[StatementFee], charges: dict[str, Decimal], unread: list[str]) -> list[str]:
    """La lectura del PDF y de dónde sale cada diferencia del subtotal y de los cargos del banco."""
    sym = {"PEN": "S/", "USD": "US$"}
    out: list[str] = []
    for c in currencies:
        s = sym.get(c.currency, c.currency)
        if c.bank_subtotal is not None and c.read != c.bank_subtotal:
            out.append(f"Lectura en {s}: los movimientos leídos suman {_money(c.read, s)} y el subtotal del banco "
                       f"es {_money(c.bank_subtotal, s)}."
                       + (" Revisa las líneas que no se pudieron leer." if unread else ""))
    for c in currencies:
        if c.bank_subtotal is None:
            continue
        s = sym.get(c.currency, c.currency)
        gap = c.bank_subtotal - c.subtotal
        if gap == 0:
            out.append(f"Subtotal en {s}: cuadra al céntimo.")
            continue
        missing = sum((x.amount for x in lines if x.currency == c.currency and x.move_id is None), ZERO)
        extra = sum((x.amount for x in unmatched if x.currency == c.currency), ZERO)
        parts = []
        if missing:
            parts.append(f"{_money(missing, s)} de movimientos del banco que no están en PPM")
        if extra:
            parts.append(f"{_money(extra, s)} de movimientos de PPM que el banco no tiene en este ciclo")
        rest = gap - missing + extra
        if rest:
            parts.append(f"{_money(rest, s)} sin explicar: revisa montos o fechas")
        out.append(f"Subtotal en {s}: {'faltan' if gap > 0 else 'sobran'} {_money(gap, s)}"
                   + (f" ({'; '.join(parts)})." if parts else "."))
    bank_fees: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for f in fees:
        bank_fees[f.currency] += f.amount
    for cur in sorted(set(bank_fees) | {k for k, v in charges.items() if v}):
        s = sym.get(cur, cur)
        gap = bank_fees[cur] - charges[cur]
        if gap > 0:
            out.append(f"Cargos del banco en {s}: el banco cobró {_money(bank_fees[cur], s)} y en PPM hay "
                       f"{_money(charges[cur], s)}. Agrega el que falta en «Cargos del banco» de la tarjeta.")
        elif gap < 0:
            out.append(f"Cargos del banco en {s}: en PPM hay {_money(-gap, s)} que el banco no cobró este ciclo.")
    return out
