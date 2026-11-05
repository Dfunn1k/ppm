"""Lógica del Inicio (I1): lo que realmente tengo hoy, «para mayo» del mes, en qué se va la plata,
los avisos y los últimos movimientos. Todo se calcula; nada se guarda.

Inicio a tu medida (Más › Inicio): qué cuentas de dinero se ven y en qué orden, y con qué cuenta
arranca el + del Inicio."""

from collections import defaultdict
from dataclasses import dataclass
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from app import accounts, moves
from app.accounts import AccountError
from app.db import user_transaction

ZERO = Decimal("0.00")


@dataclass(frozen=True)
class TopCategory:
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal              # lo gastado en el mes, en moneda base
    share: int                   # % del gasto del mes


@dataclass(frozen=True)
class Foreign:
    """La plata que tienes en otra moneda y el tipo con que cuenta hoy («Tus US$ 1,520.00 cuentan a 3.443»)."""
    currency: str
    amount: Decimal
    rate: Decimal                # compra
    rate_date: dt.date
    stale: bool                  # el tipo tiene más de 3 días


@dataclass(frozen=True)
class HomeAccount:
    """Una cuenta de dinero en el Inicio, con su saldo."""
    id: int
    name: str
    icon: str | None
    currency: str
    amount: Decimal              # en su moneda
    base: Decimal                # en moneda base, al tipo de hoy


@dataclass(frozen=True)
class SetupAccount:
    """Una cuenta de dinero en Más › Inicio."""
    id: int
    name: str
    icon: str | None
    subtitle: str | None
    amount: Decimal
    currency: str
    shown: bool


@dataclass(frozen=True)
class Setup:
    accounts: list[SetupAccount]  # efectivo y bancos, en el orden del Inicio
    account_id: int | None        # la cuenta del + del Inicio; None = elegirla cada vez


@dataclass(frozen=True)
class Home:
    currency: str
    # Hoy, sin importar el mes elegido
    real_total: Decimal
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    overdue_pending: int         # por confirmar cuya fecha ya llegó
    unclassified: int            # traídos del banco, falta decir en qué fueron
    # Del mes elegido
    month: str
    income_total: Decimal
    expense_total: Decimal
    saved: Decimal               # lo que entró − lo que salió (puede ser negativo)
    saved_percent: int | None    # qué parte de lo que entró; None si no entró nada
    top: list[TopCategory]       # las 3 categorías principales con más gasto
    recent: list[moves.MoveSummary]
    foreign: list[Foreign]
    accounts: list[HomeAccount]  # las cuentas de dinero que se ven, en su orden


def home(user_id: int, ym: str) -> Home:
    o = accounts.overview(user_id)
    m = moves.month(user_id, ym)
    with user_transaction(user_id) as conn:
        overdue = conn.execute(
            "SELECT count(*) FROM account_move WHERE state = 'draft' AND date <= user_today()").fetchone()[0]
        unclassified = conn.execute("SELECT count(DISTINCT move_id) FROM account_move_line"
                                    " WHERE account_id = system_account('suspense')").fetchone()[0]
        # El gasto del mes por categoría principal (la hija suma a su principal)
        rows = conn.execute("""
            SELECT r.id, r.name, r.icon, r.color, sum(l.balance)
              FROM account_move_line l
              JOIN account_move mv ON mv.id = l.move_id AND mv.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type = 'expense'
              JOIN account_account r ON r.id = coalesce(a.parent_id, a.id)
             WHERE mv.date >= %s::date AND mv.date < (%s::date + interval '1 month')
             GROUP BY r.id, r.name, r.icon, r.color
            HAVING sum(l.balance) > 0
             ORDER BY sum(l.balance) DESC, r.name
             LIMIT 3""", (f"{ym}-01", f"{ym}-01")).fetchall()
        heads = conn.execute(
            "SELECT id, date, ref, state FROM account_move WHERE date <= user_today()"
            " ORDER BY date DESC, id DESC LIMIT 12").fetchall()
        recent = [s for s in moves.summaries(conn, heads) if s.kind != "opening"][:3]
        money = _ordered(conn, o.have)

    spent = m.expense_total
    top = [TopCategory(i, n, ic, col, amt, _percent(amt, spent) or 0) for i, n, ic, col, amt in rows]
    saved = m.income_total - m.expense_total
    held: dict[str, Decimal] = defaultdict(Decimal)
    for a in o.have:
        if a.kind in ("cash", "bank"):
            for b in a.balances:
                held[b.currency] += b.amount
    foreign = [Foreign(r.currency, held[r.currency], r.buy, r.date, r.stale) for r in o.rates if held.get(r.currency)]
    shown = [HomeAccount(a.id, a.name, a.icon, a.currency or o.currency, a.balances[0].amount if a.balances else ZERO,
                         a.base_total) for a, hidden in money if not hidden]
    return Home(o.currency, o.real_total, o.have_total, o.custody_total, o.owe_total, overdue, unclassified,
                ym, m.income_total, m.expense_total, saved, _percent(max(saved, ZERO), m.income_total), top, recent,
                foreign, shown)


def _ordered(conn: psycopg.Connection, have: list[accounts.AccountRow]) -> list[tuple[accounts.AccountRow, bool]]:
    """Efectivo y bancos en el orden del Inicio (las sin lugar, al final por antigüedad), y si se esconden."""
    cash = [a for a in have if a.kind in ("cash", "bank")]
    flags = {r[0]: (r[1], r[2]) for r in conn.execute(
        "SELECT id, home_hidden, home_sequence FROM account_account WHERE id = ANY(%s)", ([a.id for a in cash],))}
    cash.sort(key=lambda a: (flags[a.id][1] is None, flags[a.id][1] or 0, a.id))
    return [(a, flags[a.id][0]) for a in cash]


def setup(user_id: int) -> Setup:
    o = accounts.overview(user_id)
    with user_transaction(user_id) as conn:
        money = _ordered(conn, o.have)
        account_id = conn.execute("SELECT a.id FROM res_users u JOIN account_account a"
                                  " ON a.id = u.home_account_id AND a.active").fetchone()
    return Setup([SetupAccount(a.id, a.name, a.icon, a.subtitle, a.balances[0].amount if a.balances else ZERO,
                               a.currency or o.currency, not hidden) for a, hidden in money],
                 account_id[0] if account_id else None)


def save_setup(user_id: int, order: list[int], hidden: list[int], account_id: int | None) -> Setup:
    """Guarda todo Más › Inicio de una vez: el orden de las cuentas, cuáles se esconden y la del +."""
    o = accounts.overview(user_id)
    cash = {a.id for a in o.have if a.kind in ("cash", "bank")}
    if set(order) != cash or len(order) != len(cash) or not set(hidden) <= cash:
        raise AccountError(400, "La lista de cuentas cambió: vuelve a abrir Más › Inicio")
    if account_id is not None and account_id not in {a.id for a in o.have if a.kind in ("cash", "bank", "card")}:
        raise AccountError(400, "Elige una cuenta de dinero o una tarjeta")
    with user_transaction(user_id) as conn:
        conn.execute("""
            UPDATE account_account a SET home_sequence = o.n, home_hidden = a.id = ANY(%s)
              FROM unnest(%s::bigint[]) WITH ORDINALITY AS o(id, n)
             WHERE a.id = o.id""", (hidden, order))
        conn.execute("UPDATE res_users SET home_account_id = %s", (account_id,))
    return setup(user_id)


def _percent(part: Decimal, whole: Decimal) -> int | None:
    if whole <= 0:
        return None
    return int((part * 100 / whole).quantize(Decimal(1), rounding=ROUND_HALF_UP))
