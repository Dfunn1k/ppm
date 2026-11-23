"""Presupuesto por sobres (decisiones D1–D10 del 21-nov-2026).

Una capa encima de la partida doble que no toca ningún asiento. Cada sol de la plata del presupuesto
(P: lo que tienes en las cuentas de dentro menos lo que debes en ellas) está en un sobre o en Por
asignar. Se guarda solo lo que decide la persona (cuánto pone en cada sobre); lo gastado sale de los
asientos con la regla de la frontera (budget_activity en la base) y Por asignar es el residuo:

    Por asignar = P − lo disponible en los sobres − lo ya asignado a meses que vienen

Como no se guarda, no puede descuadrarse: es la misma idea que un saldo, que sale de sus apuntes.

Cada mes, lo disponible de un sobre es lo que traía del mes anterior (si quedó en rojo, cero: D3)
más lo asignado en el mes más lo que movieron los asientos (un gasto resta, un reembolso suma).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict, deque
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from app.accounts import AccountError, _balances, _translate
from app.db import user_transaction

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
AGE_OUTFLOWS = 10          # la edad del dinero promedia los últimos 10 gastos (D9, como YNAB)
AVERAGE_MONTHS = 3         # el promedio que sugiere cuánto asignar (D7)


# --- Fechas ---------------------------------------------------------------------------------------

def parse_month(value: str) -> dt.date:
    """«2026-11» → el 1 de noviembre de 2026."""
    try:
        y, m = value.split("-")
        return dt.date(int(y), int(m), 1)
    except ValueError:
        raise AccountError(400, "El mes va como 2026-11") from None


def add_months(d: dt.date, n: int) -> dt.date:
    k = d.year * 12 + d.month - 1 + n
    return dt.date(k // 12, k % 12 + 1, 1)


def month_end(d: dt.date) -> dt.date:
    return add_months(d, 1) - dt.timedelta(days=1)


def _months(first: dt.date, last: dt.date) -> list[dt.date]:
    out, k = [], first
    while k <= last:
        out.append(k)
        k = add_months(k, 1)
    return out


# --- Lo que devuelve ------------------------------------------------------------------------------

@dataclass(frozen=True)
class PostMonth:
    """Un sobre en un mes."""
    id: int
    kind: str                    # 'expense' (un grupo de gasto) o 'saving' (de ahorro)
    name: str
    icon: str | None
    color: int | None
    role: str | None             # 'patrimony' = Construir patrimonio
    active: bool
    carried: Decimal             # lo que traía del mes anterior (un rojo no pasa: D3)
    assigned: Decimal            # lo asignado en el mes (lo que entró menos lo que salió a otro lado)
    activity: Decimal            # lo que movieron los asientos: − gastado, + devuelto
    available: Decimal           # carried + assigned + activity
    average: Decimal             # lo que gastó por mes, en promedio, en los 3 meses anteriores


@dataclass(frozen=True)
class Unclassified:
    """Por clasificar: lo que salió de P sin categoría todavía. A la vista, como un sobre sin plata."""
    activity: Decimal
    available: Decimal


@dataclass(frozen=True)
class Plata:
    """De dónde sale P, al cierre del mes, en la moneda base y en libros (D4)."""
    accounts: Decimal            # efectivo, bancos y lo demás que tienes dentro
    cards: Decimal               # lo que debes en las tarjetas (negativo)
    installments: Decimal        # las cuotas por venir de esas tarjetas (compensan su deuda)
    owed: Decimal                # lo que debes a otros o guardas de ellos (negativo)
    total: Decimal
    if_exchanged: Decimal | None  # «Si cambiaras hoy»: la diferencia no realizada (solo el mes de hoy)


@dataclass(frozen=True)
class AgeOfMoney:
    days: int | None             # None si todavía no hay gastos
    outflows: int                # cuántos gastos promedia (hasta 10)


@dataclass(frozen=True)
class BudgetMonth:
    started: bool
    start: dt.date | None
    month: dt.date
    to_assign: Decimal           # Por asignar: verde si sobra, rojo si asignaste de más
    future: Decimal              # lo ya asignado a meses que vienen
    plata: Plata
    posts: list[PostMonth]
    unclassified: Unclassified
    age: AgeOfMoney


@dataclass(frozen=True)
class BudgetMove:
    id: int
    month: dt.date
    from_post_id: int | None     # None = Por asignar
    to_post_id: int | None
    amount: Decimal
    source: str


@dataclass(frozen=True)
class BudgetLine:
    """Un movimiento que tocó un sobre en el mes: lo gastado resta, lo devuelto suma."""
    move_id: int
    date: dt.date
    amount: Decimal
    label: str                   # la categoría (o la cuenta de fuera) que lo llevó a este sobre
    icon: str | None
    color: int | None
    account: str | None          # la cuenta de dentro con que se pagó o cobró


@dataclass(frozen=True)
class ScopeRow:
    """Cómo entra hoy una cuenta de dinero al presupuesto (D6) y, si está fuera, de qué sobre sale lo
    que se le pasa (D10)."""
    account_id: int
    name: str
    on_budget: bool
    default: bool                # así va su tipo si nadie dijo nada
    since: dt.date | None        # desde cuándo vale lo de hoy (None = desde siempre)
    post_id: int | None          # el sobre de ahorro (solo fuera); None = Construir patrimonio


# --- La edad del dinero (D9) ------------------------------------------------------------------

def age_of_money(flows: list[tuple[dt.date, Decimal]], as_of: dt.date) -> AgeOfMoney:
    """Primero en entrar, primero en salir: cada sol que sale de P se toma de lo que llegó antes, y la
    edad de un gasto es el promedio (pesado por monto) de los días que esa plata esperó. Se promedian
    los últimos 10 gastos. Lo que se gasta sin plata (la tarjeta cuando P ya está en cero) tiene edad
    cero, y lo que llega después primero cubre ese hueco."""
    lots: deque[list] = deque()            # [fecha, monto que queda]
    hole = ZERO                            # lo gastado sin plata que todavía no se cubre
    ages: list[Decimal] = []
    for date, amount in flows:
        if date > as_of or amount == 0:
            continue
        if amount > 0:
            cover = min(hole, amount)
            hole -= cover
            if amount > cover:
                lots.append([date, amount - cover])
            continue
        need, weighted = -amount, ZERO
        total = need
        while need > 0 and lots:
            lot = lots[0]
            take = min(need, lot[1])
            weighted += take * (date - lot[0]).days
            lot[1] -= take
            need -= take
            if lot[1] == 0:
                lots.popleft()
        hole += need                       # lo que no alcanzó: edad cero
        ages.append(weighted / total)
    last = ages[-AGE_OUTFLOWS:]
    if not last:
        return AgeOfMoney(None, 0)
    days = (sum(last, Decimal(0)) / len(last)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return AgeOfMoney(int(days), len(last))


# --- El mes ---------------------------------------------------------------------------------------

def _today(conn: psycopg.Connection) -> dt.date:
    return conn.execute("SELECT user_today()").fetchone()[0]


def _user(conn: psycopg.Connection) -> dt.date | None:
    """Desde qué mes presupuesta. El cierre de periodo no toca el presupuesto: es una capa aparte."""
    return conn.execute("SELECT budget_start FROM res_users WHERE id = current_user_id()").fetchone()[0]


def _posts(conn: psycopg.Connection) -> list[tuple]:
    """Los sobres, en el orden de Reportes: los de gasto por el orden de sus grupos, luego los de ahorro
    (Construir patrimonio primero)."""
    return conn.execute("""
        SELECT p.id, p.kind, coalesce(p.name, a.name), coalesce(p.icon, a.icon), coalesce(p.color, a.color),
               p.system_role, p.active AND coalesce(a.active, true)
          FROM account_budget_post p
          LEFT JOIN account_account a ON a.id = p.account_id
         ORDER BY p.kind, (p.system_role IS NULL), coalesce(a.id, p.id)""").fetchall()


def _activity(conn: psycopg.Connection, first: dt.date, last: dt.date) -> dict[tuple[str, int | None, dt.date], Decimal]:
    """Lo que movieron los asientos, por sobre (o Por clasificar) y por mes."""
    out: dict[tuple[str, int | None, dt.date], Decimal] = defaultdict(lambda: ZERO)
    for bucket, post_id, month, amount in conn.execute("""
        SELECT bucket, post_id, date_trunc('month', date)::date, sum(amount)
          FROM budget_activity(%s, %s) WHERE bucket <> 'unassigned'
         GROUP BY 1, 2, 3""", (first, last)):
        out[(bucket, post_id, month)] += amount
    return out


def _assigned(conn: psycopg.Connection) -> dict[tuple[int, dt.date], Decimal]:
    out: dict[tuple[int, dt.date], Decimal] = defaultdict(lambda: ZERO)
    for post_id, month, amount in conn.execute("""
        SELECT to_post_id, month, sum(amount) FROM account_budget_move WHERE to_post_id IS NOT NULL GROUP BY 1, 2
        UNION ALL
        SELECT from_post_id, month, -sum(amount) FROM account_budget_move WHERE from_post_id IS NOT NULL GROUP BY 1, 2"""):
        out[(post_id, month)] += amount
    return out


def _plata(conn: psycopg.Connection, at: dt.date, today: bool) -> Plata:
    """P al cierre del día `at`: los saldos de las cuentas que ese día están dentro."""
    rows = conn.execute("""
        SELECT a.id, a.account_type, a.system_role,
               EXISTS (SELECT 1 FROM account_credit_card c WHERE c.account_id = a.id), sum(l.balance)
          FROM account_move_line l
          JOIN account_move m    ON m.id = l.move_id
          JOIN account_account a ON a.id = l.account_id
         WHERE m.state = 'posted' AND m.date <= %s AND (budget_scope(a.id, %s)).on_budget
         GROUP BY a.id""", (at, at)).fetchall()
    accounts = cards = installments = owed = ZERO
    for _id, typ, role, card, balance in rows:
        if role == "installments":
            installments += balance
        elif card:
            cards += balance
        elif typ == "asset":
            accounts += balance
        else:
            owed += balance
    total = accounts + cards + installments + owed
    fx = None
    if today:
        # La diferencia no realizada de lo que hay dentro hoy: no entra a Por asignar hasta que se realiza (D4)
        ids = [r[0] for r in rows]
        fx = sum((m.base - m.book for ms in _balances(conn, ids).values() for m in ms), ZERO)
    return Plata(accounts, cards, installments, owed, total, fx)


def month_view(user_id: int, month: dt.date | None = None) -> BudgetMonth:
    with user_transaction(user_id) as conn:
        return _month_view(conn, month)


def _month_view(conn: psycopg.Connection, month: dt.date | None) -> BudgetMonth:
    start = _user(conn)
    today = _today(conn)
    this_month = today.replace(day=1)
    month = month or this_month
    end = month_end(month)
    flows = [(d, a) for d, a in conn.execute(
        "SELECT date, amount FROM budget_flows(%s) ORDER BY date, move_id NULLS FIRST", (end,))]
    age = age_of_money(flows, min(end, today) if month <= this_month else end)
    plata = _plata(conn, end, month == this_month)
    if start is None or month < start:
        return BudgetMonth(start is not None, start, month, ZERO, ZERO, plata, [], Unclassified(ZERO, ZERO), age)

    activity = _activity(conn, start, end)
    avg_first = add_months(month, -AVERAGE_MONTHS)
    averages = _activity(conn, avg_first, month - dt.timedelta(days=1))
    assigned = _assigned(conn)
    months = _months(start, month)

    posts: list[PostMonth] = []
    total_available = ZERO
    for pid, kind, name, icon, color, role, active in _posts(conn):
        available = carried = ZERO
        for k in months:
            carried = max(available, ZERO) if k > start else ZERO          # el rojo no pasa (D3)
            available = carried + assigned[(pid, k)] + activity[("post", pid, k)]
        spent = -sum((averages[("post", pid, k)] for k in _months(avg_first, add_months(month, -1))), ZERO)
        average = max((spent / AVERAGE_MONTHS).quantize(CENT, rounding=ROUND_HALF_UP), ZERO)
        if not active and available == 0 and activity[("post", pid, month)] == 0 and assigned[(pid, month)] == 0:
            continue                                                        # archivado y en cero: no se muestra
        posts.append(PostMonth(pid, kind, name, icon, color, role, active, carried, assigned[(pid, month)],
                               activity[("post", pid, month)], available, average))
        total_available += available

    un_available = ZERO
    for k in months:
        un_available = (max(un_available, ZERO) if k > start else ZERO) + activity[("suspense", None, k)]
    unclassified = Unclassified(activity[("suspense", None, month)], un_available)

    future = sum((a for (_pid, k), a in assigned.items() if k > month), ZERO)
    to_assign = plata.total - total_available - un_available - future
    return BudgetMonth(True, start, month, to_assign, future, plata, posts, unclassified, age)


# --- Empezar ----------------------------------------------------------------------------------

def start(user_id: int, month: dt.date, savings: list[str]) -> BudgetMonth:
    """Empezar el presupuesto desde un mes (D7): lo de antes no cuenta. Nace «Construir patrimonio» y,
    si los pide, otros sobres de ahorro (como «Fondo de emergencia»)."""
    with user_transaction(user_id) as conn:
        if _user(conn) is not None:
            raise AccountError(409, "Tu presupuesto ya empezó")
        if month > _today(conn).replace(day=1):
            raise AccountError(400, "Empieza en este mes o en uno que ya pasó")
        try:
            with conn.transaction():
                conn.execute("UPDATE res_users SET budget_start = %s WHERE id = current_user_id()", (month,))
                conn.execute("""
                    INSERT INTO account_budget_post (kind, name, icon, color, system_role)
                    VALUES ('saving', 'Construir patrimonio', 'foundation', 10, 'patrimony')
                    ON CONFLICT (user_id, system_role) DO NOTHING""")
                for name in dict.fromkeys(n.strip() for n in savings if n.strip()):
                    _insert_saving(conn, name, "savings", 3)
        except psycopg.Error as e:
            raise _translate(e) from None
        return _month_view(conn, month)


def move_start(user_id: int, month: dt.date) -> BudgetMonth:
    """Cambiar el mes en que empezó. No se puede si deja fuera algo que ya asignaste."""
    with user_transaction(user_id) as conn:
        if _user(conn) is None:
            raise AccountError(400, "Tu presupuesto todavía no empieza")
        if month > _today(conn).replace(day=1):
            raise AccountError(400, "Empieza en este mes o en uno que ya pasó")
        if conn.execute("SELECT EXISTS (SELECT 1 FROM account_budget_move WHERE month < %s)", (month,)).fetchone()[0]:
            raise AccountError(400, "Ya asignaste plata antes de ese mes: deshazlo primero")
        conn.execute("UPDATE res_users SET budget_start = %s WHERE id = current_user_id()", (month,))
        return _month_view(conn, month)


# --- Asignar y mover ------------------------------------------------------------------------------

def _post(conn: psycopg.Connection, post_id: int) -> tuple:
    row = conn.execute("""
        SELECT p.id, p.kind, coalesce(p.name, a.name), p.active AND coalesce(a.active, true)
          FROM account_budget_post p LEFT JOIN account_account a ON a.id = p.account_id
         WHERE p.id = %s""", (post_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos ese sobre")
    return row


def assign(user_id: int, month: dt.date, from_post_id: int | None, to_post_id: int | None,
           amount: Decimal, source: str = "manual") -> BudgetMonth:
    """Asignar (de Por asignar a un sobre), mover (de un sobre a otro) o devolver (a Por asignar).
    Un sobre no puede dar más de lo que tiene; Por asignar sí: queda en rojo, a la vista, hasta que
    lo arregles (como YNAB)."""
    if amount <= 0:
        raise AccountError(400, "Escribe un monto mayor que cero")
    if amount != amount.quantize(CENT):
        raise AccountError(400, "El monto va con dos decimales como máximo")
    if from_post_id == to_post_id:
        raise AccountError(400, "Elige de dónde sale y a dónde va")
    with user_transaction(user_id) as conn:
        start_month = _user(conn)
        if start_month is None:
            raise AccountError(400, "Tu presupuesto todavía no empieza")
        if to_post_id is not None and not _post(conn, to_post_id)[3]:
            raise AccountError(400, "Ese sobre está archivado")
        if from_post_id is not None:
            name = _post(conn, from_post_id)[2]
            if month >= start_month:
                view = _month_view(conn, month)
                have = next((p.available for p in view.posts if p.id == from_post_id), ZERO)
                if amount > have:
                    raise AccountError(400, f"{name} tiene {have:,.2f} disponible")
        try:
            with conn.transaction():
                conn.execute("""
                    INSERT INTO account_budget_move (month, from_post_id, to_post_id, amount, source)
                    VALUES (%s, %s, %s, %s, %s)""", (month, from_post_id, to_post_id, amount, source))
        except psycopg.Error as e:
            raise _translate(e) from None
        return _month_view(conn, month)


def undo(user_id: int, move_id: int) -> BudgetMonth:
    """Deshacer una asignación, salvo que deje en rojo un sobre que dio la plata a otro y ya la gastó."""
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT month, to_post_id, amount FROM account_budget_move WHERE id = %s",
                           (move_id,)).fetchone()
        if row is None:
            raise AccountError(404, "No encontramos esa asignación")
        month, to_post, amount = row
        try:
            with conn.transaction():
                conn.execute("DELETE FROM account_budget_move WHERE id = %s", (move_id,))
                if to_post is not None:
                    view = _month_view(conn, month)
                    left = next((p for p in view.posts if p.id == to_post), None)
                    if left is not None and left.available < 0 and left.available + amount >= 0:
                        raise AccountError(400, f"{left.name} ya gastó esa plata: deshacerlo lo deja en rojo")
        except psycopg.Error as e:
            raise _translate(e) from None
        return _month_view(conn, month)


def moves(user_id: int, month: dt.date) -> list[BudgetMove]:
    with user_transaction(user_id) as conn:
        return [BudgetMove(*r) for r in conn.execute("""
            SELECT id, month, from_post_id, to_post_id, amount, source FROM account_budget_move
             WHERE month = %s ORDER BY id""", (month,))]


def undo_month(user_id: int, month: dt.date) -> BudgetMonth:
    """Deshacer todo lo asignado, movido y cubierto en un mes: esa plata vuelve a Por asignar. Los
    movimientos no cambian; lo que se traiga al mes siguiente sí puede cambiar."""
    with user_transaction(user_id) as conn:
        if _user(conn) is None:
            raise AccountError(400, "Tu presupuesto todavía no empieza")
        conn.execute("DELETE FROM account_budget_move WHERE user_id = current_user_id() AND month = %s", (month,))
        return _month_view(conn, month)


def delete_post(user_id: int, post_id: int) -> None:
    """Eliminar un sobre de ahorro que creaste. Lo que tenía vuelve a Por asignar: cada asignación
    o movimiento suyo pasa a tener Por asignar de ese lado (las que eran solo entre él y Por asignar
    se van). Las cuentas que salían de él pasan a Construir patrimonio (la llave las deja en NULL)."""
    with user_transaction(user_id) as conn:
        _pid, kind, name, _active = _post(conn, post_id)
        role = conn.execute("SELECT system_role FROM account_budget_post WHERE id = %s", (post_id,)).fetchone()[0]
        if kind != "saving":
            raise AccountError(400, "Este sobre es un grupo de gasto: se elimina con su categoría")
        if role is not None:
            raise AccountError(400, f"{name} lo usa la app: no se elimina")
        with conn.transaction():
            conn.execute("""DELETE FROM account_budget_move
                             WHERE (from_post_id = %(p)s AND to_post_id IS NULL)
                                OR (to_post_id = %(p)s AND from_post_id IS NULL)""", {"p": post_id})
            conn.execute("UPDATE account_budget_move SET from_post_id = NULL WHERE from_post_id = %s", (post_id,))
            conn.execute("UPDATE account_budget_move SET to_post_id = NULL WHERE to_post_id = %s", (post_id,))
            conn.execute("DELETE FROM account_budget_post WHERE id = %s", (post_id,))


def reset(user_id: int) -> BudgetMonth:
    """Borrar el presupuesto: lo asignado en todos los meses, los sobres de ahorro que creaste, qué
    cuentas estaban dentro y el mes en que empezó. Los movimientos, cuentas y categorías no cambian;
    los sobres de gasto y Construir patrimonio siguen ahí, vacíos, para cuando vuelvas a empezar."""
    with user_transaction(user_id) as conn:
        with conn.transaction():
            # Con RLS ya solo se ven las filas tuyas; el filtro lo dice también aquí, por si acaso
            conn.execute("DELETE FROM account_budget_move WHERE user_id = current_user_id()")
            conn.execute("DELETE FROM account_budget_scope WHERE user_id = current_user_id()")
            conn.execute("DELETE FROM account_budget_post WHERE user_id = current_user_id()"
                         " AND kind = 'saving' AND system_role IS NULL")
            conn.execute("UPDATE res_users SET budget_start = NULL WHERE id = current_user_id()")
        return _month_view(conn, None)


def post_lines(user_id: int, post_id: int, month: dt.date) -> list[BudgetLine]:
    """Los movimientos del mes que tocaron un sobre, del más nuevo al más viejo. Salen de la misma regla
    de la frontera que el disponible (budget_activity), así que suman lo mismo que «Gastaste»."""
    with user_transaction(user_id) as conn:
        _post(conn, post_id)
        return [BudgetLine(*r) for r in conn.execute("""
            WITH x AS (
              SELECT move_id, date, sum(amount) AS amount FROM budget_activity(%(first)s, %(last)s)
               WHERE bucket = 'post' AND post_id = %(post)s GROUP BY move_id, date
            ), root AS (SELECT account_id FROM account_budget_post WHERE id = %(post)s)
            SELECT x.move_id, x.date, x.amount, coalesce(c.name, m.ref, ''), c.icon, c.color, k.name
              FROM x JOIN account_move m ON m.id = x.move_id
              LEFT JOIN LATERAL (
                SELECT a.name, coalesce(a.icon, g.icon) AS icon, coalesce(a.color, g.color) AS color
                  FROM account_move_line l JOIN account_account a ON a.id = l.account_id
                  LEFT JOIN account_account g ON g.id = a.parent_id
                 WHERE l.move_id = x.move_id AND NOT (budget_scope(a.id, x.date)).on_budget
                   AND a.system_role IS DISTINCT FROM 'suspense'
                   AND ((SELECT account_id FROM root) IS NULL
                        OR coalesce(a.parent_id, a.id) = (SELECT account_id FROM root)
                        OR a.system_role = 'prepaid')
                 ORDER BY abs(l.balance) DESC, l.id LIMIT 1) c ON true
              LEFT JOIN LATERAL (
                SELECT a.name FROM account_move_line l JOIN account_account a ON a.id = l.account_id
                 WHERE l.move_id = x.move_id AND (budget_scope(a.id, x.date)).on_budget
                 ORDER BY abs(l.balance) DESC, l.id LIMIT 1) k ON true
             ORDER BY x.date DESC, x.move_id DESC""",
            {"first": month, "last": month_end(month), "post": post_id})]


# --- Los sobres de ahorro (D10) -------------------------------------------------------------

def _insert_saving(conn: psycopg.Connection, name: str, icon: str, color: int) -> int:
    try:
        with conn.transaction():
            return conn.execute("INSERT INTO account_budget_post (kind, name, icon, color) VALUES ('saving', %s, %s, %s)"
                                " RETURNING id", (name, icon, color)).fetchone()[0]
    except psycopg.errors.UniqueViolation:
        raise AccountError(409, "Ya tienes un sobre con ese nombre") from None


def create_saving(user_id: int, name: str, icon: str, color: int) -> int:
    name = name.strip()
    if not name:
        raise AccountError(400, "Ponle un nombre")
    with user_transaction(user_id) as conn:
        if _user(conn) is None:
            raise AccountError(400, "Tu presupuesto todavía no empieza")
        return _insert_saving(conn, name, icon, color)


def update_post(user_id: int, post_id: int, name: str | None, icon: str | None, color: int | None,
                active: bool | None) -> None:
    """Un sobre de ahorro se renombra, cambia de ícono o color, o se archiva. Los de gasto son sus
    grupos: se cambian en Categorías. Construir patrimonio no se archiva, como las cuentas de sistema."""
    with user_transaction(user_id) as conn:
        _pid, kind, current, _active = _post(conn, post_id)
        role = conn.execute("SELECT system_role FROM account_budget_post WHERE id = %s", (post_id,)).fetchone()[0]
        if kind != "saving":
            raise AccountError(400, "Este sobre es un grupo de gasto: cámbialo en Categorías")
        if name is not None and not name.strip():
            raise AccountError(400, "Ponle un nombre")
        if active is False:
            if role is not None:
                raise AccountError(400, f"{current} lo usa la app: no se archiva")
            if conn.execute("""SELECT EXISTS (SELECT 1 FROM account_account a
                                WHERE (budget_scope(a.id, user_today())).post_id = %s)""", (post_id,)).fetchone()[0]:
                raise AccountError(400, f"Hay cuentas que salen de {current}: elige otro sobre para ellas primero")
            view = _month_view(conn, None)
            left = next((p.available for p in view.posts if p.id == post_id), ZERO)
            ahead = conn.execute("SELECT EXISTS (SELECT 1 FROM account_budget_move"
                                 " WHERE month > %s AND %s IN (from_post_id, to_post_id))",
                                 (view.month, post_id)).fetchone()[0]
            if left != 0 or ahead:
                raise AccountError(400, f"{current} todavía tiene plata: muévela a otro sobre primero")
        try:
            with conn.transaction():
                conn.execute("""
                    UPDATE account_budget_post SET name = coalesce(%s, name), icon = coalesce(%s, icon),
                           color = coalesce(%s, color), active = coalesce(%s, active)
                     WHERE id = %s""", (name.strip() if name else None, icon, color, active, post_id))
        except psycopg.errors.UniqueViolation:
            raise AccountError(409, "Ya tienes un sobre con ese nombre") from None


# --- Qué cuentas son del presupuesto (D6) -----------------------------------------------------

def scopes(user_id: int) -> list[ScopeRow]:
    """Las cuentas de dinero tuyas, con cómo entran hoy."""
    with user_transaction(user_id) as conn:
        return [ScopeRow(*r) for r in conn.execute("""
            SELECT a.id, a.name, (budget_scope(a.id, user_today())).on_budget, budget_default_in(a.id),
                   (SELECT max(x.date_from) FROM account_budget_scope x
                     WHERE x.account_id = a.id AND x.date_from <= user_today()),
                   (budget_scope(a.id, user_today())).post_id
              FROM account_account a
             WHERE a.account_type IN ('asset', 'liability') AND a.system_role IS NULL AND a.active
             ORDER BY a.account_type, a.id""")]


def set_scope(user_id: int, account_id: int, on_budget: bool, since: dt.date | None, post_id: int | None) -> ScopeRow:
    """Meter o sacar una cuenta del presupuesto desde un día (hoy si no dice), y si queda fuera, de qué
    sobre de ahorro sale lo que se le pasa. Lo de antes de ese día no cambia."""
    if on_budget and post_id is not None:
        raise AccountError(400, "Solo una cuenta fuera del presupuesto sale de un sobre de ahorro")
    with user_transaction(user_id) as conn:
        since = since or _today(conn)
        try:
            with conn.transaction():
                conn.execute("""
                    INSERT INTO account_budget_scope (account_id, date_from, on_budget, post_id) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (account_id, date_from) DO UPDATE SET on_budget = EXCLUDED.on_budget,
                                                                     post_id = EXCLUDED.post_id""",
                             (account_id, since, on_budget, post_id))
        except psycopg.errors.ForeignKeyViolation:
            raise AccountError(404, "No encontramos esa cuenta o ese sobre") from None
        except psycopg.Error as e:
            raise _translate(e) from None
    return next(s for s in scopes(user_id) if s.account_id == account_id)
