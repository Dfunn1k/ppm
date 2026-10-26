"""Lógica de movimientos: registrar un gasto, un ingreso o una transferencia (con «Dividir»),
editarlos, confirmarlos o pasarlos a por confirmar, borrarlos, y la lista por mes.

Aquí se arman los apuntes (al Debe y al Haber) a partir de lo que escribe la persona; la base
revisa que cuadren, que cada uno vaya en la moneda de su cuenta y que nada futuro quede confirmado."""

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from app.accounts import AccountError, _translate
from app.db import user_transaction

CENT = Decimal("0.01")
KINDS = ("expense", "income", "transfer")


def _round(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


# --- Lo que entra -----------------------------------------------------------------------------

@dataclass(frozen=True)
class Split:
    category_id: int
    amount: Decimal              # en la moneda de la cuenta de dinero


@dataclass(frozen=True)
class MoveInput:
    kind: str                    # 'expense', 'income' o 'transfer'
    account_id: int              # de dónde sale (gasto, transferencia) o adónde entra (ingreso)
    amount: Decimal              # en la moneda de esa cuenta
    date: dt.date | None = None     # None = hoy, en la zona de la persona
    ref: str | None = None       # la nota; sin nota, el nombre de la categoría
    pending: bool = False        # por confirmar
    rate: Decimal | None = None  # soles por unidad, si la cuenta no es en moneda base; None = el del día
    splits: list[Split] = field(default_factory=list)   # gasto o ingreso: una o varias categorías
    to_account_id: int | None = None                     # transferencia: adónde entra
    to_amount: Decimal | None = None                     # transferencia entre monedas: lo que entró


@dataclass(frozen=True)
class _Acc:
    id: int
    name: str
    type: str
    currency_id: int | None
    currency: str | None
    role: str | None
    active: bool
    has_children: bool


def _accounts(conn: psycopg.Connection, ids: list[int]) -> dict[int, _Acc]:
    rows = conn.execute("""
        SELECT a.id, a.name, a.account_type, a.currency_id, trim(c.name), a.system_role, a.active,
               EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id)
          FROM account_account a LEFT JOIN res_currency c ON c.id = a.currency_id
         WHERE a.id = ANY(%s)""", (ids,)).fetchall()
    return {r[0]: _Acc(*r) for r in rows}


def _money_account(accs: dict[int, _Acc], acc_id: int, what: str) -> _Acc:
    a = accs.get(acc_id)
    if a is None or not a.active:
        raise AccountError(404, f"No encontramos la cuenta {what}")
    if a.type not in ("asset", "liability") or a.currency_id is None or a.role in ("opening", "custody"):
        raise AccountError(400, f"Elige una cuenta tuya {what}: efectivo o banco")
    return a


def _day_rate(conn: psycopg.Connection, acc: _Acc, on: dt.date) -> Decimal:
    """El tipo global de ese día (o el último anterior): compra para lo que tienes, venta para lo que debes."""
    try:
        with conn.transaction():
            return conn.execute("SELECT get_rate(%s, %s, rate_side(%s))", (acc.currency_id, on, acc.type)).fetchone()[0]
    except psycopg.errors.NoDataFound:
        raise AccountError(400, f"Falta el tipo de cambio de {acc.currency}: escríbelo") from None


def _rate(conn: psycopg.Connection, acc: _Acc, base_id: int, on: dt.date, rate: Decimal | None) -> Decimal:
    """El tipo que escribió la persona o, si no escribió ninguno, el del día."""
    if acc.currency_id == base_id:
        return Decimal(1)
    if rate is None:
        return _day_rate(conn, acc, on)
    if rate <= 0:
        raise AccountError(400, f"El tipo de cambio de {acc.currency} tiene que ser mayor que cero")
    return rate


def _cost(conn: psycopg.Connection, acc: _Acc, amount: Decimal, on: dt.date, move_id: int | None,
          rate: Decimal | None) -> Decimal:
    """Cuánto costó lo que sale de una cuenta en otra moneda: a su costo promedio, con lo confirmado
    hasta ese día (sin contar el movimiento que se está editando). Si se va todo, sale su valor exacto.
    Sin saldo para promediar, al tipo que se escribió o al del día."""
    qty, book = conn.execute("""
        SELECT coalesce(sum(l.amount_currency), 0), coalesce(sum(l.balance), 0)
          FROM account_move_line l JOIN account_move mv ON mv.id = l.move_id
         WHERE l.account_id = %s AND mv.state = 'posted' AND mv.date <= %s AND mv.id <> coalesce(%s, 0)""",
        (acc.id, on, move_id)).fetchone()
    if qty == 0 or (qty > 0) != (book > 0):
        return _round(amount * (rate if rate and rate > 0 else _day_rate(conn, acc, on)))
    if amount == abs(qty):
        return abs(book)
    return _round(amount * book / qty)


Line = tuple[int, Decimal, Decimal, int, Decimal]   # cuenta, debe, haber, moneda, monto con signo


def _build(conn: psycopg.Connection, m: MoveInput, on: dt.date,
           move_id: int | None = None) -> tuple[str, list[Line]]:
    """Los apuntes del movimiento y su glosa por defecto. Lanza AccountError si algo no cuadra."""
    if m.kind not in KINDS:
        raise AccountError(400, "Elige gasto, ingreso o transferencia")
    if m.amount <= 0:
        raise AccountError(400, "Escribe un monto mayor que cero")
    base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
    ids = [m.account_id, *(s.category_id for s in m.splits)] + ([m.to_account_id] if m.to_account_id else [])
    accs = _accounts(conn, ids)

    if m.kind == "transfer":
        src = _money_account(accs, m.account_id, "de donde sale")
        if m.to_account_id is None:
            raise AccountError(400, "Elige adónde entra")
        dst = _money_account(accs, m.to_account_id, "adonde entra")
        if src.id == dst.id:
            raise AccountError(400, "Sale y entra de la misma cuenta: elige otra")
        same = src.currency_id == dst.currency_id
        to_amount = m.amount if same else m.to_amount
        if to_amount is None or to_amount <= 0:
            raise AccountError(400, f"Escribe cuánto entró en {dst.currency}")
        # Lo que sale en otra moneda sale a su costo promedio; si entra en la base y no es igual a ese
        # costo, la diferencia es la realizada: «Ganancia por tipo de cambio» o «Costo del cambio».
        cost = m.amount if src.currency_id == base_id else _cost(conn, src, m.amount, on, move_id, m.rate)
        received = to_amount if dst.currency_id == base_id else cost
        lines = [(src.id, Decimal(0), cost, src.currency_id, -m.amount),
                 (dst.id, received, Decimal(0), dst.currency_id, to_amount)]
        diff = received - cost
        if diff:
            role = "fx_gain" if diff > 0 else "fx_loss"
            fx = conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0]
            lines.append((fx, Decimal(0), diff, base_id, -diff) if diff > 0 else (fx, -diff, Decimal(0), base_id, -diff))
        return f"Transferencia a {dst.name}", lines

    money = _money_account(accs, m.account_id, "de donde sale" if m.kind == "expense" else "adonde entra")
    if not m.splits:
        raise AccountError(400, "Elige en qué" if m.kind == "expense" else "Elige de qué es el ingreso")
    wanted = "expense" if m.kind == "expense" else "income"
    for s in m.splits:
        c = accs.get(s.category_id)
        if c is None or not c.active:
            raise AccountError(404, "No encontramos esa categoría")
        if c.type != wanted:
            raise AccountError(400, f"«{c.name}» no es una categoría de {'gasto' if wanted == 'expense' else 'ingreso'}")
        if c.has_children:
            raise AccountError(400, f"«{c.name}» agrupa otras: elige una de ellas")
        if s.amount <= 0:
            raise AccountError(400, "Cada parte necesita un monto mayor que cero")
    if sum((s.amount for s in m.splits), Decimal(0)) != m.amount:
        raise AccountError(400, "Las partes no suman el total")

    rate = _rate(conn, money, base_id, on, m.rate)
    total_base = _round(m.amount * rate)
    parts: list[Decimal] = []
    for s in m.splits[:-1]:
        parts.append(_round(s.amount * rate))
    parts.append(total_base - sum(parts, Decimal(0)))   # lo que falta, para que el total sea exacto
    if parts[-1] <= 0:
        raise AccountError(400, "Revisa las partes: con ese tipo de cambio no cuadran")

    out = m.kind == "expense"   # el gasto sale de la cuenta (Haber) y va a la categoría (Debe)
    lines: list[Line] = [(money.id, Decimal(0) if out else total_base, total_base if out else Decimal(0),
                          money.currency_id, -m.amount if out else m.amount)]  # type: ignore[list-item]
    for s, b in zip(m.splits, parts, strict=True):
        lines.append((s.category_id, b if out else Decimal(0), Decimal(0) if out else b, base_id, b if out else -b))
    return accs[m.splits[0].category_id].name, lines


def _write(conn: psycopg.Connection, move_id: int, lines: list[Line]) -> None:
    for acc, debit, credit, cur, amount in lines:
        conn.execute(
            "INSERT INTO account_move_line (move_id, account_id, debit, credit, currency_id, amount_currency)"
            " VALUES (%s, %s, %s, %s, %s, %s)", (move_id, acc, debit, credit, cur, amount))
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")   # el cuadre, aquí y no al final


def _state(conn: psycopg.Connection, m: MoveInput) -> tuple[dt.date, str]:
    today = conn.execute("SELECT user_today()").fetchone()[0]
    on = m.date or today
    return on, "draft" if m.pending or on > today else "posted"


def create(user_id: int, m: MoveInput) -> int:
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                on, state = _state(conn, m)
                default_ref, lines = _build(conn, m, on)
                move_id = conn.execute(
                    "INSERT INTO account_move (date, ref, state) VALUES (%s, %s, %s) RETURNING id",
                    (on, (m.ref or "").strip() or default_ref, state)).fetchone()[0]
                _write(conn, move_id, lines)
                return move_id
        except psycopg.Error as e:
            raise _translate(e) from None


def update(user_id: int, move_id: int, m: MoveInput) -> None:
    """Editar: se cambia la cabecera y se reemplazan los apuntes (nadie audita; un historial
    limpio vale más que el rastro del error)."""
    with user_transaction(user_id) as conn:
        kind = _kind_of(conn, move_id)
        if kind not in KINDS:
            raise AccountError(400, "Este movimiento no se edita aquí: un saldo inicial se corrige desde su cuenta")
        try:
            with conn.transaction():
                on, state = _state(conn, m)
                default_ref, lines = _build(conn, m, on, move_id)
                conn.execute("DELETE FROM account_move_line WHERE move_id = %s", (move_id,))
                conn.execute("UPDATE account_move SET date = %s, ref = %s, state = %s WHERE id = %s",
                             (on, (m.ref or "").strip() or default_ref, state, move_id))
                _write(conn, move_id, lines)
        except psycopg.Error as e:
            raise _translate(e) from None


def set_pending(user_id: int, move_id: int, pending: bool) -> None:
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM account_move WHERE id = %s", (move_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos ese movimiento")
        try:
            with conn.transaction():
                conn.execute("UPDATE account_move SET state = %s WHERE id = %s",
                             ("draft" if pending else "posted", move_id))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        except psycopg.Error as e:
            raise _translate(e) from None


def delete(user_id: int, move_id: int) -> None:
    with user_transaction(user_id) as conn:
        kind = _kind_of(conn, move_id)
        if kind == "opening":
            raise AccountError(400, "Un saldo inicial se corrige desde su cuenta")
        conn.execute("DELETE FROM account_move WHERE id = %s", (move_id,))


# --- Lo que sale ------------------------------------------------------------------------------

@dataclass(frozen=True)
class Category:
    id: int
    name: str
    icon: str | None
    color: int | None            # el suyo o el de su principal


@dataclass(frozen=True)
class MoveSummary:
    id: int
    date: dt.date
    ref: str
    posted: bool
    kind: str                    # 'expense', 'income', 'transfer' u 'other'
    currency: str                # la de la cuenta de dinero (la de donde sale, en una transferencia)
    amount: Decimal              # en esa moneda, siempre positivo: el signo lo da el tipo
    base: Decimal                # en moneda base (lo que suma al total del día y del mes)
    account: str                 # la cuenta de dinero (o «A → B» en una transferencia)
    categories: list[Category]
    to_currency: str | None = None
    to_amount: Decimal | None = None
    fx: Decimal | None = None    # cambio de moneda: + ganancia, − costo del cambio (en moneda base)


@dataclass(frozen=True)
class Day:
    date: dt.date
    total: Decimal               # entradas − salidas confirmadas, en moneda base
    moves: list[MoveSummary]


@dataclass(frozen=True)
class Month:
    month: str                   # '2026-10'
    currency: str                # moneda base
    income_total: Decimal
    expense_total: Decimal
    pending_count: int
    days: list[Day]


@dataclass(frozen=True)
class SplitOut:
    category: Category
    amount: Decimal              # en la moneda de la cuenta de dinero


@dataclass(frozen=True)
class MoveDetail:
    summary: MoveSummary
    account_id: int | None
    to_account_id: int | None
    rate: Decimal | None         # el de la cuenta de dinero, si no es la base
    splits: list[SplitOut]
    cost: Decimal | None = None       # cambio de moneda con diferencia: lo que costó lo que salió…
    cost_rate: Decimal | None = None  # …y a qué costo promedio


_LINES_SQL = """
SELECT l.move_id, l.account_id, a.name, a.account_type, a.system_role,
       coalesce(a.icon, p.icon), coalesce(a.color, p.color), trim(c.name), l.amount_currency, l.balance
  FROM account_move_line l
  JOIN account_account a ON a.id = l.account_id
  LEFT JOIN account_account p ON p.id = a.parent_id
  JOIN res_currency c ON c.id = l.currency_id
 WHERE l.move_id = ANY(%s)
 ORDER BY l.move_id, l.id
"""


def _classify(head: tuple, lines: list[tuple]) -> tuple[MoveSummary, list[tuple]]:
    move_id, on, ref, state = head
    money = [x for x in lines if x[3] in ("asset", "liability")]
    cats = [x for x in lines if x[3] in ("income", "expense")]
    # Entre dos cuentas de dinero, la ganancia o el costo del cambio no la vuelven gasto ni ingreso
    fx = [x for x in cats if x[4] in ("fx_gain", "fx_loss")] if len(money) == 2 else []
    cats = [x for x in cats if x not in fx]
    opening = any(x[4] == "opening" for x in lines)
    categories = [Category(x[1], x[2], x[5], x[6]) for x in cats]
    if opening:
        kind = "opening"
    elif cats and len(money) == 1 and all(x[3] == "expense" for x in cats):
        kind = "expense"
    elif cats and len(money) == 1 and all(x[3] == "income" for x in cats):
        kind = "income"
    elif not cats and len(money) == 2:
        kind = "transfer"
    else:
        kind = "other"

    if kind == "transfer":
        src = next(x for x in money if x[8] < 0)
        dst = next(x for x in money if x[8] > 0)
        s = MoveSummary(move_id, on, ref, state == "posted", kind, src[7], -src[8], dst[9],
                        f"{src[2]} → {dst[2]}", [], dst[7], dst[8],
                        -sum((x[9] for x in fx), Decimal(0)) if fx else None)
    elif money:
        m = money[0]
        s = MoveSummary(move_id, on, ref, state == "posted", kind, m[7], abs(m[8]), abs(m[9]), m[2], categories)
    else:
        s = MoveSummary(move_id, on, ref, state == "posted", kind, lines[0][7], abs(lines[0][8]),
                        abs(lines[0][9]), lines[0][2], categories)
    return s, money


def summaries(conn: psycopg.Connection, heads: list[tuple]) -> list[MoveSummary]:
    """Los resúmenes de varios asientos (id, fecha, glosa, estado) con una sola consulta de apuntes."""
    by_move: dict[int, list[tuple]] = defaultdict(list)
    for row in conn.execute(_LINES_SQL, ([h[0] for h in heads],)):
        by_move[row[0]].append(row)
    return [_classify(h, by_move[h[0]])[0] for h in heads if by_move[h[0]]]


def _kind_of(conn: psycopg.Connection, move_id: int) -> str:
    head = conn.execute("SELECT id, date, ref, state FROM account_move WHERE id = %s", (move_id,)).fetchone()
    if head is None:
        raise AccountError(404, "No encontramos ese movimiento")
    lines = conn.execute(_LINES_SQL, ([move_id],)).fetchall()
    return _classify(head, lines)[0].kind if lines else "other"


def month(user_id: int, ym: str, account_id: int | None = None, category_id: int | None = None,
          kind: str | None = None, q: str | None = None, pending_only: bool = False) -> Month:
    try:
        first = dt.date.fromisoformat(f"{ym}-01")
    except ValueError:
        raise AccountError(400, "El mes va como 2026-10") from None
    nxt = dt.date(first.year + first.month // 12, first.month % 12 + 1, 1)
    with user_transaction(user_id) as conn:
        base = conn.execute(
            "SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id").fetchone()[0]
        heads = conn.execute("""
            SELECT m.id, m.date, m.ref, m.state FROM account_move m
             WHERE m.date >= %s AND m.date < %s
               AND (%s::bigint IS NULL OR EXISTS (SELECT 1 FROM account_move_line l
                                                   WHERE l.move_id = m.id AND l.account_id = %s))
               AND (%s::bigint IS NULL OR EXISTS (SELECT 1 FROM account_move_line l
                                                    JOIN account_account a ON a.id = l.account_id
                                                   WHERE l.move_id = m.id AND (a.id = %s OR a.parent_id = %s)))
             ORDER BY m.date DESC, m.id DESC""",
                             (first, nxt, account_id, account_id, category_id, category_id, category_id)).fetchall()
        found = [s for s in summaries(conn, heads) if s.kind != "opening"]
    if kind:
        found = [s for s in found if s.kind == kind]
    if pending_only:
        found = [s for s in found if not s.posted]
    if q and q.strip():
        needle = q.strip().lower()
        found = [s for s in found if needle in " ".join(
            [s.ref, s.account, f"{s.amount:.2f}", *(c.name for c in s.categories)]).lower()]

    def signed(s: MoveSummary) -> Decimal:
        return s.base if s.kind == "income" else -s.base if s.kind == "expense" else s.fx or Decimal(0)

    # La ganancia o el costo de un cambio de moneda también entra o sale en el mes
    gains = sum((s.fx for s in found if s.posted and s.fx and s.fx > 0), Decimal("0.00"))
    losses = -sum((s.fx for s in found if s.posted and s.fx and s.fx < 0), Decimal("0.00"))

    days: dict[dt.date, list[MoveSummary]] = defaultdict(list)
    for s in found:
        days[s.date].append(s)
    return Month(
        ym, base,
        sum((s.base for s in found if s.posted and s.kind == "income"), Decimal("0.00")) + gains,
        sum((s.base for s in found if s.posted and s.kind == "expense"), Decimal("0.00")) + losses,
        sum(1 for s in found if not s.posted),
        [Day(d, sum((signed(s) for s in ms if s.posted), Decimal("0.00")), ms) for d, ms in days.items()],
    )


def detail(user_id: int, move_id: int) -> MoveDetail:
    with user_transaction(user_id) as conn:
        head = conn.execute("SELECT id, date, ref, state FROM account_move WHERE id = %s", (move_id,)).fetchone()
        if head is None:
            raise AccountError(404, "No encontramos ese movimiento")
        lines = conn.execute(_LINES_SQL, ([move_id],)).fetchall()
        base = conn.execute("SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id").fetchone()[0]
    summary, money = _classify(head, lines)
    if summary.kind == "transfer":
        src = next(x for x in money if x[8] < 0)
        dst = next(x for x in money if x[8] > 0)
        rate = None if base in (src[7], dst[7]) else _round6(abs(src[9] / src[8]))
        if summary.fx is None:
            return MoveDetail(summary, src[1], dst[1], rate, [])
        return MoveDetail(summary, src[1], dst[1], rate, [], abs(src[9]), _round6(abs(src[9] / src[8])))
    m = money[0] if money else None
    rate = None
    if m is not None and m[7] != base and m[8]:
        rate = _round6(abs(m[9] / m[8]))
    cats = [x for x in lines if x[3] in ("income", "expense")]
    splits: list[SplitOut] = []
    if m is not None and cats:
        amounts = [abs(x[9]) if rate is None else _round(abs(x[9]) / rate) for x in cats]
        amounts[-1] = abs(m[8]) - sum(amounts[:-1], Decimal(0))   # que sumen exacto el total
        splits = [SplitOut(Category(x[1], x[2], x[5], x[6]), a) for x, a in zip(cats, amounts, strict=True)]
    return MoveDetail(summary, m[1] if m else None, None, rate, splits)


def _round6(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CategoryGroup:
    id: int | None
    name: str
    color: int | None
    children: list[Category]


@dataclass(frozen=True)
class Categories:
    groups: list[CategoryGroup]
    frequent: list[Category]     # las 4 más usadas en los últimos 90 días


def categories(user_id: int, kind: str) -> Categories:
    """Las categorías que se pueden elegir al registrar: las hojas, agrupadas por su principal.
    Las de ingreso, sueltas, van en un solo grupo «Ingresos». Las del tipo de cambio las pone la app."""
    if kind not in ("expense", "income"):
        raise AccountError(400, "Pide las de gasto o las de ingreso")
    with user_transaction(user_id) as conn:
        rows = conn.execute("""
            SELECT a.id, a.name, coalesce(a.icon, p.icon), coalesce(a.color, p.color), a.parent_id,
                   EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id AND k.active)
              FROM account_account a LEFT JOIN account_account p ON p.id = a.parent_id
             WHERE a.active AND a.account_type = %s
               AND a.system_role IS DISTINCT FROM 'fx_gain' AND a.system_role IS DISTINCT FROM 'fx_loss'
             ORDER BY a.id""", (kind,)).fetchall()
        frequent_ids = [r[0] for r in conn.execute("""
            SELECT l.account_id FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id
              JOIN account_account a ON a.id = l.account_id
             WHERE a.account_type = %s AND m.date >= user_today() - 90
             GROUP BY l.account_id ORDER BY count(*) DESC, max(m.date) DESC LIMIT 4""", (kind,))]

    by_id = {r[0]: r for r in rows}
    leaves = {r[0]: Category(r[0], r[1], r[2], r[3]) for r in rows if not r[5]}
    groups: list[CategoryGroup] = []
    loose: list[Category] = []
    for r in rows:
        if r[4] is None and r[5]:   # una principal con hijas
            groups.append(CategoryGroup(r[0], r[1], r[3], [leaves[x[0]] for x in rows if x[4] == r[0] and x[0] in leaves]))
        elif r[4] is None:
            loose.append(leaves[r[0]])
        elif r[4] not in by_id:      # hija de una principal archivada
            loose.append(leaves[r[0]])
    if loose:
        groups.append(CategoryGroup(None, "Ingresos" if kind == "income" else "Otras", loose[0].color, loose))
    return Categories(groups, [leaves[i] for i in frequent_ids if i in leaves])
