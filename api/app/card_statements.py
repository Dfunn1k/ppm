"""El estado de cuenta de una tarjeta: la foto de cada ciclo cerrado (lo que debías por moneda, el
tipo de cambio y la línea usada al corte, que no se recalculan), el tipo de cambio del ciclo abierto
(el de venta del día o el escrito a mano) y la conciliación con los totales y los movimientos que
dice el banco. El «saldo de compras en cuotas según banco» reemplaza el cálculo de cuotas de la
línea hasta el siguiente estado de cuenta."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

import psycopg

from app.accounts import ZERO, AccountError, TodayRate, _currency_id, _today_rates, _translate
from app.db import user_transaction

if TYPE_CHECKING:
    from app.cards import CardRate

MATCH_DAYS = 2   # un movimiento del banco y uno de PPM son el mismo si difieren hasta 2 días


def _cents(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _limit_currency(conn: psycopg.Connection, card_id: int) -> tuple[int, Decimal]:
    row = conn.execute("SELECT limit_currency_id, credit_limit FROM account_credit_card WHERE account_id = %s",
                       (card_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos esa tarjeta")
    return row[0], row[1]


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
        _limit_currency(conn, card_id)
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


def _closing_rate(conn: psycopg.Connection, card_id: int, currency_id: int, closing: dt.date,
                  previous: dt.date) -> tuple[Decimal | None, dt.date | None]:
    """El tipo con que se cuenta un ciclo que cerró: el escrito a mano en ese ciclo o el de venta del corte."""
    row = conn.execute("""
        SELECT rate, rate_date FROM account_credit_card_rate
         WHERE card_account_id = %s AND currency_id = %s AND rate_date > %s AND rate_date <= %s""",
                       (card_id, currency_id, previous, closing)).fetchone()
    if row:
        return row[0], row[1]
    row = conn.execute("""
        SELECT rate_sell, name FROM res_currency_rate WHERE currency_id = %s AND name <= %s
         ORDER BY name DESC LIMIT 1""", (currency_id, closing)).fetchone()
    return (row[0], row[1]) if row else (None, None)


# --- La foto del ciclo cerrado ----------------------------------------------------------------

def _previous(conn: psycopg.Connection, card_id: int, closing: dt.date) -> dt.date:
    return conn.execute("SELECT card_last_closing(%s, %s - 1)", (card_id, closing)).fetchone()[0]


def snapshot(conn: psycopg.Connection, card_id: int, closing: dt.date, refresh: bool = False) -> None:
    """La foto de un ciclo cerrado: se toma una vez (al verlo por primera vez) y no se recalcula con
    el tipo de otro día. Al guardar la conciliación se vuelve a tomar, con lo registrado hasta ahí."""
    if not refresh and conn.execute("SELECT 1 FROM account_credit_card_statement"
                                    " WHERE card_account_id = %s AND closing_date = %s",
                                    (card_id, closing)).fetchone():
        return
    limit_cur, limit = _limit_currency(conn, card_id)
    previous = _previous(conn, card_id, closing)
    used = installments = ZERO
    rows = []
    for cid, debt, unbilled in conn.execute(
            "SELECT currency_id, total_debt, unbilled FROM credit_card_status(%s) WHERE account_id = %s",
            (closing, card_id)).fetchall():
        rate, on = (None, None) if cid == limit_cur else _closing_rate(conn, card_id, cid, closing, previous)
        factor = Decimal(1) if cid == limit_cur else rate or ZERO
        used += _cents(debt * factor)
        installments += _cents(unbilled * factor)
        rows.append((cid, _cents(debt), rate, on))
    conn.execute("""
        INSERT INTO account_credit_card_statement (card_account_id, closing_date, credit_limit, used, installments)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (card_account_id, closing_date) DO UPDATE
           SET credit_limit = EXCLUDED.credit_limit, used = EXCLUDED.used,
               installments = EXCLUDED.installments, write_date = now()""",
                 (card_id, closing, limit, used, installments))
    for cid, debt, rate, on in rows:
        conn.execute("""
            INSERT INTO account_credit_card_statement_currency (card_account_id, closing_date, currency_id, debt,
                                                                rate, rate_date)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (card_account_id, closing_date, currency_id) DO UPDATE
               SET debt = EXCLUDED.debt, rate = EXCLUDED.rate, rate_date = EXCLUDED.rate_date""",
                     (card_id, closing, cid, debt, rate, on))


def _ppm_installments(conn: psycopg.Connection, card_id: int, closing: dt.date) -> Decimal:
    """Las cuotas por facturar al corte según PPM, en la moneda de la línea (al tipo de la foto)."""
    limit_cur, _ = _limit_currency(conn, card_id)
    total = ZERO
    for cid, unbilled, rate in conn.execute("""
            SELECT s.currency_id, s.unbilled, sc.rate FROM credit_card_status(%s) s
              LEFT JOIN account_credit_card_statement_currency sc
                     ON sc.card_account_id = s.account_id AND sc.closing_date = %s AND sc.currency_id = s.currency_id
             WHERE s.account_id = %s""", (closing, closing, card_id)).fetchall():
        total += _cents(unbilled * (Decimal(1) if cid == limit_cur else rate or ZERO))
    return total


def installments_delta(conn: psycopg.Connection, card_id: int, closing: dt.date) -> Decimal | None:
    """Cuánto cambia la línea usada si las cuotas son las del banco: su saldo menos el de PPM al corte.
    None si ese estado de cuenta no tiene el saldo del banco (la línea queda «estimada»)."""
    bank = conn.execute("SELECT bank_installments FROM account_credit_card_statement"
                        " WHERE card_account_id = %s AND closing_date = %s", (card_id, closing)).fetchone()
    if bank is None or bank[0] is None:
        return None
    return bank[0] - _ppm_installments(conn, card_id, closing)


# --- La conciliación --------------------------------------------------------------------------

@dataclass(frozen=True)
class StatementLine:
    date: dt.date
    name: str
    amount: Decimal              # + cargo, − abono
    currency: str
    move_id: int | None = None   # su par en PPM


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
    debt: Decimal                # lo que debías al corte (foto)
    rate: Decimal | None         # a cuánto se contó en la línea (foto); None = la moneda de la línea
    rate_date: dt.date | None
    subtotal: Decimal            # compras y cuotas del ciclo según PPM (sin cargos del banco)
    bank_subtotal: Decimal | None


@dataclass(frozen=True)
class Reconciliation:
    closing_date: dt.date
    previous_closing: dt.date
    credit_limit: Decimal
    limit_currency: str
    currencies: list[StatementCurrency]
    bank_charges: Decimal        # cargos del banco del ciclo en PPM (en la moneda de la línea)
    billed: Decimal              # total facturado según PPM: subtotal + cargos del banco
    bank_billed: Decimal | None
    installments: Decimal        # cuotas por facturar al corte según PPM
    bank_installments: Decimal | None
    available: Decimal           # línea disponible hoy según PPM (con el saldo de cuotas del banco, si está)
    bank_available: Decimal | None
    used_at_closing: Decimal     # foto: la línea usada al corte
    explanations: list[str] = field(default_factory=list)
    lines: list[StatementLine] = field(default_factory=list)
    unmatched: list[Unmatched] = field(default_factory=list)   # de PPM, sin par en el banco


def _check_closing(conn: psycopg.Connection, card_id: int, closing: dt.date) -> None:
    ok = conn.execute("SELECT card_closing_for(%s, %s) = %s AND %s <= card_last_closing(%s, user_today())",
                      (card_id, closing, closing, closing, card_id)).fetchone()[0]
    if not ok:
        raise AccountError(400, "Esa fecha no es un corte que ya cerró")


def _money(v: Decimal, symbol: str) -> str:
    return f"{symbol} {abs(v):,.2f}"


def _match(bank: list[StatementLine], items: list) -> tuple[list[StatementLine], list]:
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
            out.append(StatementLine(b.date, b.name, b.amount, b.currency, best[1].move_id))
        else:
            out.append(b)
    return out, free


@dataclass(frozen=True)
class _Item:
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal
    currency: str
    closing: dt.date | None      # cuota: su corte


def reconciliation(user_id: int, card_id: int, closing: dt.date) -> Reconciliation:
    from app import cards
    with user_transaction(user_id) as conn:
        limit_cur_id, _ = _limit_currency(conn, card_id)
        _check_closing(conn, card_id, closing)
        snapshot(conn, card_id, closing)
        d = cards._card(conn, card_id)
        limit_cur = d[6]
        previous = _previous(conn, card_id, closing)
        last = conn.execute("SELECT card_last_closing(%s, user_today())", (card_id,)).fetchone()[0]
        nxt = conn.execute("SELECT card_closing_for(%s, %s + 1)", (card_id, last)).fetchone()[0]
        cycle = next((c for c in cards._cycles(conn, card_id, last, nxt, {}) if c.closing_date == closing), None)
        st = conn.execute("""
            SELECT credit_limit, used, bank_billed, bank_available, bank_installments
              FROM account_credit_card_statement WHERE card_account_id = %s AND closing_date = %s""",
                          (card_id, closing)).fetchone()
        snap = {cur: (debt, rate, on, bank) for cur, debt, rate, on, bank in conn.execute("""
            SELECT trim(c.name), sc.debt, sc.rate, sc.rate_date, sc.bank_subtotal
              FROM account_credit_card_statement_currency sc JOIN res_currency c ON c.id = sc.currency_id
             WHERE sc.card_account_id = %s AND sc.closing_date = %s ORDER BY sc.currency_id <> %s, c.name""",
                                                                         (card_id, closing, limit_cur_id))}
        bank_lines = [StatementLine(*r) for r in conn.execute("""
            SELECT l.date, l.name, l.amount, trim(c.name) FROM account_credit_card_statement_line l
              JOIN res_currency c ON c.id = l.currency_id
             WHERE l.card_account_id = %s AND l.closing_date = %s ORDER BY l.date, l.id""", (card_id, closing))]
        installments = _ppm_installments(conn, card_id, closing)
    detail = cards.detail(user_id, card_id)
    available = detail.available                          # la de hoy, con el saldo de cuotas del banco si está

    # Lo que dice PPM del ciclo: compras y cuotas (subtotal) y cargos del banco, por moneda
    subtotal: dict[str, Decimal] = defaultdict(lambda: ZERO)
    charges: dict[str, Decimal] = defaultdict(lambda: ZERO)
    items: list[_Item] = []
    for i in (cycle.items if cycle else []):
        if not i.posted or i.kind in ("opening", "payment"):
            if i.posted and i.kind == "payment":
                items.append(_Item(i.move_id, i.date, i.ref, i.amount, i.currency, None))
            continue
        (charges if i.bank else subtotal)[i.currency] += i.amount
        items.append(_Item(i.move_id, i.date, i.ref, i.amount, i.currency,
                           closing if i.kind == "installment" else None))
    currencies = [StatementCurrency(cur, debt, rate, on, _cents(subtotal[cur]), bank)
                  for cur, (debt, rate, on, bank) in snap.items()]
    for cur in subtotal:
        if cur not in snap:
            currencies.append(StatementCurrency(cur, ZERO, None, None, _cents(subtotal[cur]), None))
    billed = _cents(subtotal[limit_cur] + charges[limit_cur])
    lines, free = _match(bank_lines, items)
    unmatched = [Unmatched(i.move_id, i.date, i.ref, i.amount, i.currency) for i in free]

    explain = _explain(limit_cur, currencies, lines, unmatched, billed, st[2], installments, st[4], available,
                       st[3], detail)
    return Reconciliation(closing, previous, st[0], limit_cur, currencies, _cents(charges[limit_cur]), billed, st[2],
                          installments, st[4], available, st[3], st[1], explain, lines, unmatched)


def _explain(limit_cur: str, currencies: list[StatementCurrency], lines: list[StatementLine],
             unmatched: list[Unmatched], billed: Decimal, bank_billed: Decimal | None, installments: Decimal,
             bank_installments: Decimal | None, available: Decimal, bank_available: Decimal | None,
             detail) -> list[str]:
    """De dónde sale cada diferencia: movimientos sin par, cargos del banco, cuotas y tipo de cambio."""
    sym = {"PEN": "S/", "USD": "US$"}
    out: list[str] = []
    gap_main = ZERO
    for c in currencies:
        if c.bank_subtotal is None:
            continue
        s = sym.get(c.currency, c.currency)
        gap = c.bank_subtotal - c.subtotal
        if c.currency == limit_cur:
            gap_main = gap
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
        if rest and lines:
            parts.append(f"{_money(rest, s)} sin explicar: revisa montos o fechas")
        out.append(f"Subtotal en {s}: {'faltan' if gap > 0 else 'sobran'} {_money(gap, s)}"
                   + (f" ({'; '.join(parts)})." if parts else ". Pega los movimientos del estado de cuenta para ver cuáles."))
    s = sym.get(limit_cur, limit_cur)
    if bank_billed is not None:
        gap = bank_billed - billed
        fees = gap - gap_main
        if gap == 0:
            out.append("Total facturado: cuadra al céntimo.")
        elif fees > 0:
            out.append(f"Total facturado: faltan {_money(gap, s)}; {_money(fees, s)} son cargos del banco "
                       "(desgravamen, comisiones) que no están en PPM.")
        elif fees < 0:
            out.append(f"Total facturado: {_money(fees, s)} de cargos del banco en PPM que el banco no cobró este ciclo.")
        else:
            out.append(f"Total facturado: la diferencia de {_money(gap, s)} es la del subtotal.")
    if bank_installments is not None:
        gap = bank_installments - installments
        if gap == 0:
            out.append("Saldo de cuotas: cuadra.")
        else:
            out.append(f"Saldo de cuotas: el banco dice {_money(gap, s)} {'más' if gap > 0 else 'menos'}"
                       f"{' (el interés que ya devengó)' if gap > 0 else ''}. La línea usa el saldo del banco hasta el próximo estado de cuenta.")
    if bank_available is not None:
        gap = bank_available - available
        foreign = [(c, r) for c in detail.status if c.currency != limit_cur and c.total_debt
                   for r in detail.rates if r.currency == c.currency]
        if gap == 0:
            out.append("Línea disponible: cuadra al céntimo.")
        elif foreign:
            st, r = foreign[0]
            bank_rate = r.rate + gap / st.total_debt * -1
            out.append(f"Línea disponible: {_money(gap, s)} de diferencia. Si es por el tipo de cambio de tus "
                       f"{sym.get(st.currency, st.currency)} {st.total_debt:,.2f}, el banco los cuenta a "
                       f"{bank_rate.quantize(Decimal('0.001'))} (PPM a {r.rate.quantize(Decimal('0.001'))}); si no, "
                       "son movimientos de después del corte que aún no registras o redondeo.")
        else:
            out.append(f"Línea disponible: {_money(gap, s)} de diferencia: movimientos de después del corte que "
                       "aún no registras o redondeo.")
    return out


@dataclass(frozen=True)
class StatementInput:
    subtotals: dict[str, Decimal | None]
    billed: Decimal | None
    available: Decimal | None
    installments: Decimal | None
    lines: list[StatementLine] | None   # None = no cambian


def save(user_id: int, card_id: int, closing: dt.date, s: StatementInput) -> None:
    """Lo que dice el banco del ciclo. Vuelve a tomar la foto con lo registrado hasta ahora."""
    with user_transaction(user_id) as conn:
        _limit_currency(conn, card_id)
        _check_closing(conn, card_id, closing)
        try:
            with conn.transaction():
                snapshot(conn, card_id, closing, refresh=True)
                conn.execute("""
                    UPDATE account_credit_card_statement
                       SET bank_billed = %s, bank_available = %s, bank_installments = %s, write_date = now()
                     WHERE card_account_id = %s AND closing_date = %s""",
                             (s.billed, s.available, s.installments, card_id, closing))
                for cur, amount in s.subtotals.items():
                    cid = _currency_id(conn, cur)
                    conn.execute("""
                        INSERT INTO account_credit_card_statement_currency (card_account_id, closing_date, currency_id,
                                                                            debt, bank_subtotal)
                        VALUES (%s, %s, %s, 0, %s)
                        ON CONFLICT (card_account_id, closing_date, currency_id) DO UPDATE
                           SET bank_subtotal = EXCLUDED.bank_subtotal""", (card_id, closing, cid, amount))
                if s.lines is not None:
                    conn.execute("DELETE FROM account_credit_card_statement_line"
                                 " WHERE card_account_id = %s AND closing_date = %s", (card_id, closing))
                    for x in s.lines:
                        conn.execute("""
                            INSERT INTO account_credit_card_statement_line
                                   (card_account_id, closing_date, date, name, amount, currency_id)
                            VALUES (%s, %s, %s, %s, %s, %s)""",
                                     (card_id, closing, x.date, x.name.strip() or "Movimiento", x.amount,
                                      _currency_id(conn, x.currency)))
        except psycopg.Error as e:
            raise _translate(e) from None
