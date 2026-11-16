"""Reportes (X2): Gastos, Ingresos, Flujo, Patrimonio y Personas. Todo se calcula de los apuntes
(account_move_line), nada se guarda. Los montos van en moneda base.

Qué entra: solo lo confirmado; las categorías de gasto e ingreso. Las transferencias y el pago de la
tarjeta no tocan categorías, así que no aparecen; lo que está en Por clasificar tampoco (se dice
cuánto es). Un reembolso abona la categoría del gasto: resta, y se informa como «reembolsado». Una
cuota cuenta en el mes en que se factura, porque ahí nace su gasto.

Periodo: 'AAAA-MM' (un mes) o 'AAAA' (un año). Se compara con el periodo anterior: el mes anterior
completo, o el año anterior en el mismo tramo (enero a hoy, si el año está en curso)."""

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import Decimal
import re

import psycopg

from app import accounts, partners, tags
from app.accounts import ZERO, AccountError
from app.db import user_transaction


@dataclass(frozen=True)
class Period:
    start: dt.date
    end: dt.date                 # exclusivo
    prev_start: dt.date
    prev_end: dt.date
    year: bool


def _add_months(d: dt.date, n: int) -> dt.date:
    m = d.month - 1 + n
    return dt.date(d.year + m // 12, m % 12 + 1, 1)


def _period(conn: psycopg.Connection, period: str) -> Period:
    today = conn.execute("SELECT user_today()").fetchone()[0]
    if re.fullmatch(r"\d{4}-\d{2}", period):
        start = dt.date(int(period[:4]), int(period[5:]), 1)
        return Period(start, _add_months(start, 1), _add_months(start, -1), start, False)
    if re.fullmatch(r"\d{4}", period):
        y = int(period)
        start, end = dt.date(y, 1, 1), dt.date(y + 1, 1, 1)
        if start <= today < end:     # el año en curso se compara con el mismo tramo del anterior
            end = today + dt.timedelta(days=1)
        try:
            prev_end = end.replace(year=end.year - 1)
        except ValueError:           # 29 de febrero
            prev_end = dt.date(end.year - 1, 3, 1)
        return Period(start, end, dt.date(y - 1, 1, 1), prev_end, True)
    raise AccountError(400, "El periodo es un mes (2026-10) o un año (2026)")


# --- Gastos e ingresos ----------------------------------------------------------------------------

@dataclass(frozen=True)
class CategoryLine:
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal
    previous: Decimal
    refunded: Decimal = ZERO     # lo que volvió (reembolsos) dentro de amount


@dataclass(frozen=True)
class GroupLine:
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal
    previous: Decimal
    children: list[CategoryLine] = field(default_factory=list)   # vacío si el grupo es una categoría suelta


@dataclass(frozen=True)
class MonthAmounts:
    month: str                   # 'AAAA-MM'
    total: Decimal
    groups: list[Decimal]        # en el orden de `groups`


@dataclass(frozen=True)
class Unclassified:
    count: int
    amount: Decimal


@dataclass(frozen=True)
class CategoryReport:
    kind: str                    # 'expense' o 'income'
    period: str
    start: dt.date
    end: dt.date                 # el último día que cuenta
    total: Decimal
    previous: Decimal
    groups: list[GroupLine]      # de mayor a menor
    months: list[MonthAmounts]   # solo en un año: los 12 meses (los que no llegan, en cero)
    unclassified: Unclassified


def categories(user_id: int, kind: str, period: str) -> CategoryReport:
    if kind not in ("expense", "income"):
        raise AccountError(400, "El reporte es de gastos o de ingresos")
    sign = Decimal(1) if kind == "expense" else Decimal(-1)
    with user_transaction(user_id) as conn:
        p = _period(conn, period)
        rows = conn.execute("""
            SELECT a.id, coalesce(a.parent_id, a.id),
                   coalesce(sum(l.balance) FILTER (WHERE m.date >= %(s)s AND m.date < %(e)s), 0),
                   coalesce(sum(l.balance) FILTER (WHERE m.date >= %(ps)s AND m.date < %(pe)s), 0),
                   coalesce(sum(l.credit) FILTER (WHERE m.date >= %(s)s AND m.date < %(e)s), 0)
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type = %(k)s
             WHERE (m.date >= %(s)s AND m.date < %(e)s) OR (m.date >= %(ps)s AND m.date < %(pe)s)
             GROUP BY a.id""", {"s": p.start, "e": p.end, "ps": p.prev_start, "pe": p.prev_end, "k": kind}).fetchall()
        ids = {r[0] for r in rows} | {r[1] for r in rows}
        info = {r[0]: r[1:] for r in conn.execute("""
            SELECT a.id, a.name, coalesce(a.icon, pa.icon), coalesce(a.color, pa.color)
              FROM account_account a LEFT JOIN account_account pa ON pa.id = a.parent_id
             WHERE a.id = ANY(%s)""", (list(ids),))}
        by_month = conn.execute("""
            SELECT to_char(m.date, 'YYYY-MM'), coalesce(a.parent_id, a.id), sum(l.balance)
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type = %s
             WHERE m.date >= %s AND m.date < %s
             GROUP BY 1, 2""", (kind, p.start, p.end)).fetchall() if p.year else []
        side = ">" if kind == "expense" else "<"
        unc = conn.execute(f"""
            SELECT count(DISTINCT l.move_id), coalesce(abs(sum(l.balance)), 0)
              FROM account_move_line l JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
             WHERE l.account_id = system_account('suspense') AND l.balance {side} 0
               AND m.date >= %s AND m.date < %s""", (p.start, p.end)).fetchone()

    children: dict[int, list[CategoryLine]] = defaultdict(list)
    own: dict[int, tuple[Decimal, Decimal]] = {}
    for acc, group, cur, prev, credit in rows:
        if acc == group:
            own[group] = (cur * sign, prev * sign)
        else:
            name, icon, color = info[acc]
            children[group].append(CategoryLine(acc, name, icon, color, cur * sign, prev * sign,
                                                credit if kind == "expense" else ZERO))
    groups = []
    for g in {*children, *own}:
        name, icon, color = info[g]
        kids = sorted(children.get(g, []), key=lambda k: (-k.amount, k.name))
        mine = own.get(g, (ZERO, ZERO))
        if kids and (mine[0] or mine[1]):   # una principal con movimientos propios (de antes de tener hijas)
            kids.append(CategoryLine(g, name, icon, color, mine[0], mine[1]))
        amount = sum((k.amount for k in kids), ZERO) if kids else mine[0]
        previous = sum((k.previous for k in kids), ZERO) if kids else mine[1]
        if amount or previous:
            # Lo que en este periodo quedó en cero (solo tuvo movimientos el periodo anterior) no se lista:
            # un «S/ 0.00 · −100 %» no dice nada. Sí cuenta en lo anterior del grupo y del total.
            kids = [k for k in kids if k.amount or k.refunded]
            groups.append(GroupLine(g, name, icon, color, amount, previous, kids))
    groups.sort(key=lambda g: (-g.amount, g.name))
    every = groups
    groups = [g for g in every if g.amount or any(k.refunded for k in g.children)]
    months = []
    if p.year:
        cells = {(m, g): v * sign for m, g, v in by_month}
        for i in range(12):
            key = f"{p.start.year}-{i + 1:02d}"
            months.append(MonthAmounts(key, sum((cells.get((key, g.id), ZERO) for g in every), ZERO),
                                       [cells.get((key, g.id), ZERO) for g in groups]))
    return CategoryReport(kind, period, p.start, p.end - dt.timedelta(days=1),
                          sum((g.amount for g in groups), ZERO), sum((g.previous for g in every), ZERO),
                          groups, months, Unclassified(unc[0], unc[1]))


# --- Flujo ----------------------------------------------------------------------------------------

@dataclass(frozen=True)
class FlowNode:
    id: int | None               # None: «Guardaste» o «De tus ahorros»
    name: str
    icon: str | None
    color: int | None
    amount: Decimal


@dataclass(frozen=True)
class SavingMonth:
    month: str
    income: Decimal
    expense: Decimal
    percent: int | None          # lo que no salió, sobre lo que entró; None si no entró nada


@dataclass(frozen=True)
class FlowReport:
    period: str
    income: Decimal
    expense: Decimal
    saved: Decimal               # puede ser negativo: salió más de lo que entró
    sources: list[FlowNode]      # lo que entró, por categoría (y «De tus ahorros» si salió más)
    uses: list[FlowNode]         # a dónde fue, por grupo de gasto (y «Guardaste» si sobró)
    savings: list[SavingMonth]   # 12 meses: los del año, o los que terminan en el mes elegido


def flow(user_id: int, period: str) -> FlowReport:
    inc = categories(user_id, "income", period)
    exp = categories(user_id, "expense", period)
    node = lambda g: FlowNode(g.id, g.name, g.icon, g.color, g.amount)   # noqa: E731
    sources = [node(g) for g in inc.groups if g.amount > 0]
    uses = [node(g) for g in exp.groups if g.amount > 0]
    saved = inc.total - exp.total
    if saved > 0:
        uses.append(FlowNode(None, "Guardaste", None, None, saved))
    elif saved < 0:
        sources.append(FlowNode(None, "De tus ahorros", None, None, -saved))
    with user_transaction(user_id) as conn:
        p = _period(conn, period)
        first = p.start if p.year else _add_months(p.start, -11)
        last = _add_months(first, 12)
        rows = {r[0]: (r[1], r[2]) for r in conn.execute("""
            SELECT to_char(m.date, 'YYYY-MM'),
                   coalesce(-sum(l.balance) FILTER (WHERE a.account_type = 'income'), 0),
                   coalesce(sum(l.balance) FILTER (WHERE a.account_type = 'expense'), 0)
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type IN ('income', 'expense')
             WHERE m.date >= %s AND m.date < %s
             GROUP BY 1""", (first, last))}
    savings = []
    for i in range(12):
        key = _add_months(first, i).strftime("%Y-%m")
        i_, e_ = rows.get(key, (ZERO, ZERO))
        savings.append(SavingMonth(key, i_, e_, round((i_ - e_) * 100 / i_) if i_ > 0 else None))
    return FlowReport(period, inc.total, exp.total, saved, sources, uses, savings)


# --- Patrimonio -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class NetPoint:
    date: dt.date                # el cierre del mes (o hoy, el mes en curso)
    amount: Decimal              # lo que realmente tenías, al tipo de ese día


@dataclass(frozen=True)
class Part:
    key: str                     # 'bank', 'foreign', 'receivable', 'cash', 'other'
    amount: Decimal


@dataclass(frozen=True)
class ForeignGain:
    currency: str
    amount: Decimal              # lo que tienes en esa moneda (efectivo y bancos)
    book: Decimal                # lo que te costó, en moneda base
    today: Decimal               # lo que vale hoy
    rate: Decimal                # el tipo de compra de hoy (o el último)


@dataclass(frozen=True)
class NetWorthReport:
    currency: str
    today: Decimal               # lo que realmente tengo hoy (como en el Inicio)
    months: list[NetPoint]       # 12 cierres, el último es hoy
    have: list[Part]             # cómo está repartido lo que tengo
    owe: Decimal                 # lo que debo, guardo de otros incluido (positivo)
    foreign: list[ForeignGain]   # diferencia de cambio no realizada, por moneda
    realized: Decimal            # lo ganado (o perdido) este año al cambiar moneda


def month_values(conn: psycopg.Connection, dates: list[dt.date]) -> dict[dt.date, Decimal]:
    """Lo que realmente tenía al cierre de cada fecha: cada saldo al tipo de ese día (lo que tengo a la
    compra, lo que debo a la venta)."""
    return dict(conn.execute("""
        SELECT d.d, coalesce(sum(CASE WHEN b.currency_id = u.currency_id THEN b.bal
                                      ELSE coalesce(round(b.amt * r.rate, 2), b.bal) END), 0)
          FROM unnest(%s::date[]) AS d(d)
          CROSS JOIN res_users u
          LEFT JOIN LATERAL (
            SELECT l.account_id, l.currency_id, sum(l.amount_currency) AS amt, sum(l.balance) AS bal,
                   a.system_role IS NOT DISTINCT FROM 'installments' AS deferred
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted' AND m.date <= d.d
              JOIN account_account a ON a.id = l.account_id AND a.account_type IN ('asset', 'liability')
             GROUP BY l.account_id, l.currency_id, a.system_role) b ON true
          LEFT JOIN LATERAL (
            -- «Cuotas por venir» va a la venta, como la tarjeta que la compensa
            SELECT CASE WHEN b.amt > 0 AND NOT b.deferred THEN rate_buy ELSE rate_sell END AS rate
              FROM res_currency_rate WHERE currency_id = b.currency_id AND name <= d.d
             ORDER BY name DESC LIMIT 1) r ON true
         GROUP BY d.d""", (dates,)).fetchall())


def net_worth(user_id: int) -> NetWorthReport:
    o = accounts.overview(user_id)
    with user_transaction(user_id) as conn:
        today = conn.execute("SELECT user_today()").fetchone()[0]
        month0 = today.replace(day=1)
        dates = [_add_months(month0, i - 10) - dt.timedelta(days=1) for i in range(11)] + [today]
        values = month_values(conn, dates[:-1])
        realized = conn.execute("""
            SELECT coalesce(-sum(l.balance), 0) FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.system_role IN ('fx_gain', 'fx_loss')
             WHERE m.date >= %s AND m.date <= %s""", (today.replace(month=1, day=1), today)).fetchone()[0]
    months = [NetPoint(d, values.get(d, ZERO)) for d in dates[:-1]] + [NetPoint(today, o.real_total)]

    parts: dict[str, Decimal] = defaultdict(Decimal)
    held: dict[str, list[Decimal]] = {}
    for a in o.have:
        for m in a.balances:
            if a.kind in ("cash", "bank") and m.currency != o.currency:
                parts["foreign"] += m.base
                h = held.setdefault(m.currency, [ZERO, ZERO, ZERO])
                h[0] += m.amount
                h[1] += m.book
                h[2] += m.base
            elif a.kind in ("cash", "bank", "receivable"):
                parts[a.kind] += m.base
            else:
                parts["other"] += m.base
    rates = {r.currency: r.buy for r in o.rates}
    foreign = [ForeignGain(cur, h[0], h[1], h[2], rates.get(cur, ZERO)) for cur, h in sorted(held.items()) if h[0]]
    have = [Part(k, parts[k]) for k in ("bank", "foreign", "receivable", "cash", "other") if parts.get(k)]
    return NetWorthReport(o.currency, o.real_total, months, have, o.owe_total + o.custody_total, foreign, realized)


# --- Personas -------------------------------------------------------------------------------------

AGES = ((0, 30), (31, 60), (61, 90), (91, None))


@dataclass(frozen=True)
class Debtor:
    partner_id: int
    name: str
    amount: Decimal              # lo que te debe, en moneda base
    oldest_days: int             # la deuda abierta más antigua
    overdue: bool                # alguna ya pasó su vencimiento
    next_due: dt.date | None     # el vencimiento más próximo que no pasó


@dataclass(frozen=True)
class Creditor:
    partner_id: int
    name: str
    amount: Decimal              # lo que le debes, en moneda base
    oldest_days: int


@dataclass(frozen=True)
class PeopleReport:
    currency: str
    owes_me: Decimal
    i_owe: Decimal
    keep: Decimal
    ages: list[Decimal]          # lo que te deben por antigüedad: 0–30, 31–60, 61–90, +90 días
    debtors: list[Debtor]        # de lo más antiguo a lo más nuevo
    creditors: list[Creditor]


def people(user_id: int) -> PeopleReport:
    o = partners.overview(user_id)
    with user_transaction(user_id) as conn:
        today = conn.execute("SELECT user_today()").fetchone()[0]
        rates = {r.currency: r for r in accounts._today_rates(conn).values()}
    base = lambda cur, v, owed: v if cur == o.currency else (   # noqa: E731
        (v * (rates[cur].sell if owed else rates[cur].buy)).quantize(Decimal("0.01")) if cur in rates else v)
    ages = [ZERO] * len(AGES)
    debtors, creditors = [], []
    for row in o.people:
        if not row.owes_me and not row.i_owe:
            continue
        d = partners.detail(user_id, row.id)
        if d.owes_me:
            total = ZERO
            for it in d.owes_me:
                v = base(it.currency, it.open, False)
                total += v
                ages[next(i for i, (lo, hi) in enumerate(AGES) if it.days >= lo and (hi is None or it.days <= hi))] += v
            dues = [it.date_maturity for it in d.owes_me if it.date_maturity]
            debtors.append(Debtor(row.id, row.name, total, max(it.days for it in d.owes_me),
                                  any(x < today for x in dues), min((x for x in dues if x >= today), default=None)))
        if d.i_owe:
            creditors.append(Creditor(row.id, row.name, sum((base(it.currency, it.open, True) for it in d.i_owe), ZERO),
                                      max(it.days for it in d.i_owe)))
    debtors.sort(key=lambda x: (-x.oldest_days, x.name))
    creditors.sort(key=lambda x: (-x.oldest_days, x.name))
    return PeopleReport(o.currency, o.owes_me_total, o.i_owe_total, o.keep_total, ages, debtors, creditors)


# --- El índice ------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Summary:
    """La cifra de cada reporte para las tarjetas del índice, del mes elegido."""
    month: str
    currency: str
    expense: Decimal
    expense_previous: Decimal
    expense_groups: list[FlowNode]   # para la dona chica
    income: Decimal
    income_previous: Decimal
    saved: Decimal
    saved_percent: int | None
    net_worth: Decimal
    net_worth_year_ago: Decimal
    net_worth_months: list[Decimal]  # 12 cierres, para la línea chica
    owes_me: Decimal
    owed_over_90: Decimal            # lo que te deben hace más de 90 días
    tagged: Decimal = ZERO           # lo gastado con alguna etiqueta
    top_tag: str | None = None       # la etiqueta con más gasto del mes
    top_tag_color: int | None = None


def summary(user_id: int, month: str) -> Summary:
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise AccountError(400, "El mes va como 2026-10")
    exp = categories(user_id, "expense", month)
    inc = categories(user_id, "income", month)
    nw = net_worth(user_id)
    pp = people(user_id)
    tg = tags.report(user_id, month)
    top = tg.tags[0] if tg.tags and tg.tags[0].amount > 0 else None
    saved = inc.total - exp.total
    return Summary(month, nw.currency, exp.total, exp.previous,
                   [FlowNode(g.id, g.name, g.icon, g.color, g.amount) for g in exp.groups if g.amount > 0],
                   inc.total, inc.previous, saved, round(saved * 100 / inc.total) if inc.total > 0 else None,
                   nw.today, nw.months[0].amount, [m.amount for m in nw.months], pp.owes_me, pp.ages[-1],
                   tg.total, top.name if top else None, top.color if top else None)
