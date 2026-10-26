"""Lógica del Inicio (I1): lo que realmente tengo hoy, «para mayo» del mes, en qué se va la plata,
los avisos y los últimos movimientos. Todo se calcula; nada se guarda."""

from collections import defaultdict
from dataclasses import dataclass
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from app import accounts, moves
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
class Home:
    currency: str
    # Hoy, sin importar el mes elegido
    real_total: Decimal
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    overdue_pending: int         # por confirmar cuya fecha ya llegó
    # Del mes elegido
    month: str
    income_total: Decimal
    expense_total: Decimal
    saved: Decimal               # lo que entró − lo que salió (puede ser negativo)
    saved_percent: int | None    # qué parte de lo que entró; None si no entró nada
    top: list[TopCategory]       # las 3 categorías principales con más gasto
    recent: list[moves.MoveSummary]
    foreign: list[Foreign]


def home(user_id: int, ym: str) -> Home:
    o = accounts.overview(user_id)
    m = moves.month(user_id, ym)
    with user_transaction(user_id) as conn:
        overdue = conn.execute(
            "SELECT count(*) FROM account_move WHERE state = 'draft' AND date <= user_today()").fetchone()[0]
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

    spent = m.expense_total
    top = [TopCategory(i, n, ic, col, amt, _percent(amt, spent) or 0) for i, n, ic, col, amt in rows]
    saved = m.income_total - m.expense_total
    held: dict[str, Decimal] = defaultdict(Decimal)
    for a in o.have:
        if a.kind in ("cash", "bank"):
            for b in a.balances:
                held[b.currency] += b.amount
    foreign = [Foreign(r.currency, held[r.currency], r.buy, r.date, r.stale) for r in o.rates if held.get(r.currency)]
    return Home(o.currency, o.real_total, o.have_total, o.custody_total, o.owe_total, overdue,
                ym, m.income_total, m.expense_total, saved, _percent(max(saved, ZERO), m.income_total), top, recent,
                foreign)


def _percent(part: Decimal, whole: Decimal) -> int | None:
    if whole <= 0:
        return None
    return int((part * 100 / whole).quantize(Decimal(1), rounding=ROUND_HALF_UP))
