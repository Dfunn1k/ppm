"""Recurrentes (X1): el sueldo, el alquiler o Netflix se anotan una vez, con su regla, y PPM los
registra cada vez que toca (account_recurring_run). Una recurrente nace en Registrar con «Se repite»:
el mismo movimiento de siempre (gasto, ingreso o transferencia) se vuelve el molde.

Tres modos: automática (se confirma sola en su fecha), por confirmar (se crea para que corrijas el
monto; el extracto del banco también lo corrige) y solo avisarme (no crea nada: avisa en el Inicio).
«Solo esta vez» salta, mueve o cambia el monto de una fecha sin tocar las demás."""

from dataclasses import dataclass, field, replace
import datetime as dt
from decimal import Decimal

import psycopg

from app import moves
from app import tags as tags_
from app.accounts import AccountError, _translate
from app.db import user_transaction

MODES = ("auto", "draft", "reminder")
INTERVALS = ("day", "week", "month", "year")
END_TYPES = ("never", "date", "count")
ZERO = Decimal("0.00")


@dataclass(frozen=True)
class Rule:
    interval: str                        # 'day', 'week', 'month' o 'year'
    start: dt.date | None = None         # la primera fecha; None = hoy
    every: int = 1                       # cada N
    month_days: list[int] | None = None  # cada mes: días fijos (31 = el último); None = el día de start
    weekday: int | None = None           # cada mes: el n-ésimo día de la semana (1 = lunes)…
    nth: int | None = None               # …(1 a 4, o -1 = el último)
    end_type: str = "never"              # 'never', 'date' o 'count'
    date_end: dt.date | None = None
    max_count: int | None = None


# --- Crear y editar ---------------------------------------------------------------------------

def _template(conn: psycopg.Connection, m: moves.MoveInput, today: dt.date) -> tuple[str, int, list[tuple]]:
    """El molde de la recurrente a partir del movimiento: (nombre, moneda, [(cuenta, monto, persona)]) con
    + al debe y − al haber. La cuenta de dinero va primero, en su moneda; si lo paga (o lo cobra) otra
    persona, va primero lo que le debes (o te debe), en moneda base. Lo valida Registrar."""
    if m.kind not in ("expense", "income", "transfer"):
        raise AccountError(400, "Se repite un gasto, un ingreso o una transferencia")
    if m.installments is not None:
        raise AccountError(400, "Un gasto en cuotas no se repite")
    default_ref, _ = moves._build(conn, replace(m, date=today, pending=False), today)
    base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
    sign = -1 if m.kind == "expense" else 1
    if m.paid_by_partner_id is not None:   # gasto que paga o ingreso que cobra otra persona
        role = "payable" if m.kind == "expense" else "receivable"
        who = conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0]
        lines = [(who, sign * m.amount, m.paid_by_partner_id), *((s.category_id, -sign * s.amount, None) for s in m.splits)]
        return (m.ref or "").strip() or default_ref, base_id, lines
    accs = moves._accounts(conn, [x for x in [m.account_id, m.to_account_id] if x is not None])
    money = accs[m.account_id]  # type: ignore[index]
    currency = moves._use_currency(conn, m.currency, base_id)[0] if money.card else money.currency_id
    if m.kind == "transfer":
        dst = accs[m.to_account_id]  # type: ignore[index]
        if dst.currency_id is not None and dst.currency_id != currency:
            raise AccountError(400, "Un cambio de moneda no se repite: el tipo de cambio es de cada día")
        lines = [(money.id, -m.amount, None), (dst.id, m.amount, None)]
    else:
        # La parte de otra persona: en un gasto te la debe (Por cobrar), en un ingreso se la debes (Por pagar)
        person = conn.execute("SELECT system_account(%s)", ("receivable" if m.kind == "expense" else "payable",)).fetchone()[0]
        lines = [(money.id, sign * m.amount, None),
                 *((person, -sign * s.amount, s.partner_id) if s.partner_id is not None else (s.category_id, -sign * s.amount, None)
                   for s in m.splits)]
    return (m.ref or "").strip() or default_ref, currency, lines


def _rule_values(rule: Rule, today: dt.date) -> tuple:
    if rule.interval not in INTERVALS:
        raise AccountError(400, "Elige cada cuánto se repite")
    if rule.end_type not in END_TYPES:
        raise AccountError(400, "Elige hasta cuándo")
    start = rule.start or today
    mode = days = None
    if rule.interval == "month":
        if rule.weekday is not None or rule.nth is not None:
            if rule.weekday is None or rule.nth is None:
                raise AccountError(400, "Elige el día de la semana y cuál del mes")
            mode = "nth_weekday"
        else:
            mode, days = "days", sorted(set(rule.month_days or [start.day]))
    if rule.end_type == "date" and (rule.date_end is None or rule.date_end < start):
        raise AccountError(400, "La fecha de fin va después de la primera")
    if rule.end_type == "count" and not rule.max_count:
        raise AccountError(400, "Escribe cuántas veces")
    return (rule.interval, rule.every, mode, days, rule.weekday if mode == "nth_weekday" else None,
            rule.nth if mode == "nth_weekday" else None, start, rule.end_type,
            rule.date_end if rule.end_type == "date" else None, rule.max_count if rule.end_type == "count" else None)


def _save_lines(conn: psycopg.Connection, rec_id: int, lines: list[tuple]) -> None:
    conn.execute("DELETE FROM account_recurring_line WHERE recurring_id = %s", (rec_id,))
    for acc, amount, *rest in lines:
        conn.execute("INSERT INTO account_recurring_line (recurring_id, account_id, amount, partner_id) VALUES (%s, %s, %s, %s)",
                     (rec_id, acc, amount, rest[0] if rest else None))
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")


def _save_tags(conn: psycopg.Connection, rec_id: int, tag_ids: list[int] | None) -> None:
    """Las etiquetas de la recurrente: cada movimiento que genere nace con ellas (un trigger las copia)."""
    if tag_ids is None:
        return
    wanted = list(dict.fromkeys(tag_ids))
    if len(wanted) > tags_.MAX_PER_MOVE:
        raise AccountError(400, f"Hasta {tags_.MAX_PER_MOVE} etiquetas por movimiento")
    if wanted and conn.execute("SELECT count(*) FROM account_tag WHERE id = ANY(%s)", (wanted,)).fetchone()[0] != len(wanted):
        raise AccountError(404, "No encontramos esa etiqueta")
    conn.execute("DELETE FROM account_recurring_account_tag_rel WHERE recurring_id = %s", (rec_id,))
    for t in wanted:
        conn.execute("INSERT INTO account_recurring_account_tag_rel (recurring_id, account_tag_id) VALUES (%s, %s)", (rec_id, t))


def create(user_id: int, m: moves.MoveInput, rule: Rule, mode: str, bank_charge: bool = False) -> int:
    if mode not in MODES:
        raise AccountError(400, "Elige cómo se registra")
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                today = conn.execute("SELECT user_today()").fetchone()[0]
                name, currency, lines = _template(conn, m, today)
                rec_id = conn.execute("""
                    INSERT INTO account_recurring (name, currency_id, interval_type, interval_count,
                           month_day_mode, month_days, weekday, nth, date_start, end_type, date_end, max_count,
                           amount_type, post_mode, bank_charge)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                    (name, currency, *_rule_values(rule, today),
                     "variable" if mode == "draft" else "fixed", mode, bank_charge)).fetchone()[0]
                _save_lines(conn, rec_id, lines)
                _save_tags(conn, rec_id, m.tag_ids)
                conn.execute("SELECT account_recurring_run()")
                return rec_id
        except psycopg.Error as e:
            raise _translate(e) from None


# Los cargos del banco de una tarjeta: su nombre, su categoría (en Gastos financieros) y su regla
CHARGE_KINDS = {
    "insurance": ("Seguro de desgravamen", "Seguros"),        # cada corte
    "membership": ("Membresía anual", "Comisiones bancarias"),  # cada año, en su fecha
    "other": (None, "Comisiones bancarias"),                    # cada corte
}


def create_bank_charge(user_id: int, card_id: int, kind: str, amount: Decimal, on: dt.date | None = None,
                       name: str | None = None) -> int:
    """Un cargo del banco que se repite: el desgravamen el día de cada corte, la membresía cada año.
    Nace por confirmar y cada vez sugiere el monto del último que confirmaste."""
    if kind not in CHARGE_KINDS:
        raise AccountError(400, "Elige qué cargo es")
    default, category = CHARGE_KINDS[kind]
    name = " ".join((name or "").split()) or default
    if not name:
        raise AccountError(400, "Escribe cómo se llama el cargo")
    if kind == "membership" and on is None:
        raise AccountError(400, "Elige cuándo te la cobran")
    with user_transaction(user_id) as conn:
        card = conn.execute("SELECT closing_day, card_closing_for(account_id, user_today())"
                            "  FROM account_credit_card WHERE account_id = %s", (card_id,)).fetchone()
        if card is None:
            raise AccountError(404, "No encontramos esa tarjeta")
        cat = conn.execute("""
            SELECT a.id FROM account_account a JOIN account_account g ON g.id = a.parent_id
             WHERE a.name = %s AND g.name = 'Gastos financieros' AND a.active""", (category,)).fetchone()
        if cat is None:
            raise AccountError(404, f"No encontramos la categoría «{category}» en Gastos financieros")
    rule = (Rule("year", on) if kind == "membership"
            else Rule("month", card[1], month_days=[card[0]]))
    m = moves.MoveInput(kind="expense", account_id=card_id, amount=amount, ref=name,
                        splits=[moves.Split(cat[0], amount)])
    return create(user_id, m, rule, "draft", bank_charge=True)


def update(user_id: int, rec_id: int, m: moves.MoveInput, rule: Rule, mode: str) -> None:
    """Cambia el monto, la regla o el modo desde la próxima fecha: lo ya registrado no cambia."""
    if mode not in MODES:
        raise AccountError(400, "Elige cómo se registra")
    with user_transaction(user_id) as conn:
        _own(conn, rec_id, loan_ok=False)
        try:
            with conn.transaction():
                today = conn.execute("SELECT user_today()").fetchone()[0]
                name, currency, lines = _template(conn, m, today)
                conn.execute("""
                    UPDATE account_recurring SET name = %s, currency_id = %s, interval_type = %s,
                           interval_count = %s, month_day_mode = %s, month_days = %s, weekday = %s, nth = %s,
                           date_start = %s, end_type = %s, date_end = %s, max_count = %s, amount_type = %s,
                           post_mode = %s
                     WHERE id = %s""",
                    (name, currency, *_rule_values(rule, today), "variable" if mode == "draft" else "fixed",
                     mode, rec_id))
                _save_lines(conn, rec_id, lines)
                _save_tags(conn, rec_id, m.tag_ids)
                conn.execute("SELECT account_recurring_run()")
        except psycopg.Error as e:
            raise _translate(e) from None


def _own(conn: psycopg.Connection, rec_id: int, loan_ok: bool = True) -> str:
    row = conn.execute("SELECT state, EXISTS (SELECT 1 FROM account_loan WHERE recurring_id = r.id)"
                       " FROM account_recurring r WHERE id = %s", (rec_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos esa recurrente")
    if row[1] and not loan_ok:
        raise AccountError(400, "La cuota de un préstamo se cambia desde el préstamo")
    return row[0]


def set_state(user_id: int, rec_id: int, action: str) -> None:
    """Pausar, reanudar o terminar. Al reanudar, las fechas de la pausa no vuelven."""
    with user_transaction(user_id) as conn:
        state = _own(conn, rec_id)
        if state == "done":
            raise AccountError(400, "Esa recurrente ya terminó")
        if action == "pause":
            conn.execute("UPDATE account_recurring SET state = 'paused' WHERE id = %s", (rec_id,))
        elif action == "resume":
            conn.execute("""
                UPDATE account_recurring SET state = 'active',
                       generated_until = greatest(coalesce(generated_until, '-infinity'), user_today() - 1)
                 WHERE id = %s""", (rec_id,))
            conn.execute("SELECT account_recurring_run()")
        elif action == "end":
            conn.execute("UPDATE account_recurring SET state = 'done' WHERE id = %s", (rec_id,))
        else:
            raise AccountError(400, "No sé qué hacer con esa recurrente")


# --- Solo esta vez ----------------------------------------------------------------------------

def _pending_occurrence(conn: psycopg.Connection, rec_id: int, occurrence: dt.date) -> None:
    ok = conn.execute("""
        SELECT 1 FROM account_recurring r, account_recurring_dates(r.id, %s) d
         WHERE r.id = %s AND d.occurrence_date = %s
           AND d.occurrence_date > coalesce(r.generated_until, '-infinity')""",
        (occurrence, rec_id, occurrence)).fetchone()
    if ok is None:
        raise AccountError(400, "Esa fecha no está entre las próximas: si ya se registró, cámbiala en Movimientos")


def set_occurrence(user_id: int, rec_id: int, occurrence: dt.date, skip: bool, new_date: dt.date | None,
                   new_total: Decimal | None) -> None:
    with user_transaction(user_id) as conn:
        _own(conn, rec_id)
        _pending_occurrence(conn, rec_id, occurrence)
        if not skip and new_date is None and new_total is None:
            raise AccountError(400, "Elige otra fecha, otro monto o saltarla")
        conn.execute("""
            INSERT INTO account_recurring_exception (recurring_id, occurrence_date, action, new_date, new_total)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (recurring_id, occurrence_date) DO UPDATE
               SET action = EXCLUDED.action, new_date = EXCLUDED.new_date, new_total = EXCLUDED.new_total""",
            (rec_id, occurrence, "skip" if skip else "modify", None if skip else new_date,
             None if skip else new_total))
        conn.execute("SELECT account_recurring_run()")


def reset_occurrence(user_id: int, rec_id: int, occurrence: dt.date) -> None:
    """«Dejarlo como siempre»."""
    with user_transaction(user_id) as conn:
        _own(conn, rec_id)
        conn.execute("DELETE FROM account_recurring_exception WHERE recurring_id = %s AND occurrence_date = %s",
                     (rec_id, occurrence))


def reminder_done(user_id: int, rec_id: int, occurrence: dt.date) -> None:
    """«Ya lo hice» (o lo registraste desde el aviso): el aviso de esa fecha, y los anteriores, se van."""
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT post_mode FROM account_recurring WHERE id = %s", (rec_id,)).fetchone()
        if row is None:
            raise AccountError(404, "No encontramos esa recurrente")
        if row[0] != "reminder":
            raise AccountError(400, "Esa recurrente no es un recordatorio")
        conn.execute("UPDATE account_recurring SET generated_until = greatest(coalesce(generated_until,"
                     " '-infinity'), %s) WHERE id = %s", (occurrence, rec_id))


# --- Generar ----------------------------------------------------------------------------------

def run(user_id: int) -> int:
    """Registra lo que ya toca: las recurrentes, las cuotas ya facturadas y las partes de lo repartido.
    Se llama al abrir la app (GET /me) y antes de mostrar recurrentes: sin programador nocturno, para que
    ppm_admin siga sin ver a nadie; lo atrasado sale con su fecha."""
    with user_transaction(user_id) as conn:
        return conn.execute("SELECT account_recurring_run() + post_installment_billing() + post_deferrals()").fetchone()[0]


# --- Ver --------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Next:
    date: dt.date                # cuándo, ya movida si se movió
    occurrence: dt.date          # la fecha de la regla: la identifica
    amount: Decimal              # en la cuenta de dinero: + entra, − sale
    skipped: bool
    moved: bool
    changed: bool                # otro monto esta vez


@dataclass(frozen=True)
class Share:
    partner_id: int
    name: str
    amount: Decimal              # cada vez, en la moneda de la recurrente
    owes_me: bool                # True: te debe su parte (o tu parte, si cobró él); False: le debes


@dataclass(frozen=True)
class Row:
    id: int
    name: str
    kind: str                    # 'expense', 'income' o 'transfer'
    mode: str                    # 'auto', 'draft' o 'reminder'
    state: str                   # 'active', 'paused' o 'done'
    currency: str
    amount: Decimal              # en la cuenta de dinero: + entra, − sale
    account_id: int
    account: str
    to_account: str | None       # transferencia: adónde
    category: moves.Category | None   # la primera categoría (ícono y color de la fila)
    next: Next | None
    loan_account_id: int | None  # la cuota de un préstamo
    paid_by_partner_id: int | None = None   # la paga (o la cobra) otra persona: no toca tus cuentas
    paid_by: str | None = None
    shares: list[Share] = field(default_factory=list)   # compartida: lo que se deben con cada persona


@dataclass(frozen=True)
class Overview:
    currency: str                # moneda base
    incoming: Decimal            # próximos 30 días, en moneda base
    outgoing: Decimal
    rows: list[Row]


_ROWS_SQL = """
SELECT r.id, r.name, r.post_mode, r.state, trim(c.name), r.generated_until, lo.account_id,
       array_agg(l.account_id ORDER BY l.id), array_agg(l.amount ORDER BY l.id),
       array_agg(a.account_type ORDER BY l.id), array_agg(a.name ORDER BY l.id),
       array_agg(coalesce(a.icon, p.icon) ORDER BY l.id), array_agg(coalesce(a.color, p.color) ORDER BY l.id),
       array_agg(a.system_role ORDER BY l.id), array_agg(l.partner_id ORDER BY l.id), array_agg(rp.name ORDER BY l.id)
  FROM account_recurring r
  JOIN res_currency c ON c.id = r.currency_id
  JOIN account_recurring_line l ON l.recurring_id = r.id
  JOIN account_account a ON a.id = l.account_id
  LEFT JOIN account_account p ON p.id = a.parent_id
  LEFT JOIN res_partner rp ON rp.id = l.partner_id
  LEFT JOIN account_loan lo ON lo.recurring_id = r.id
"""


def _next_dates(conn: psycopg.Connection, rec_id: int, money_amount: Decimal, limit: int,
                with_skipped: bool) -> list[Next]:
    total = conn.execute("SELECT sum(amount) FROM account_recurring_line WHERE recurring_id = %s AND amount > 0",
                         (rec_id,)).fetchone()[0]
    rows = conn.execute("""
        SELECT d.occurrence_date, e.action, e.new_date, e.new_total
          FROM account_recurring r
         CROSS JOIN LATERAL account_recurring_dates(r.id, user_today() + 800) d
          LEFT JOIN account_recurring_exception e ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
         WHERE r.id = %s AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
         ORDER BY d.occurrence_date LIMIT %s""", (rec_id, limit + 24)).fetchall()
    out = []
    for occ, action, new_date, new_total in rows:
        if action == "skip" and not with_skipped:
            continue
        amount = moves._round(money_amount * new_total / total) if new_total else money_amount
        out.append(Next(new_date or occ, occ, amount, action == "skip", new_date is not None and new_date != occ,
                        new_total is not None))
        if len(out) == limit:
            break
    return out


def _row(conn: psycopg.Connection, r: tuple) -> Row:
    rid, name, mode, state, cur, _until, loan, accs, amounts, types, names, icons, colors, roles, partners, pnames = r
    money = 0
    person = [i for i in range(len(accs)) if roles[i] in moves.RECONCILED_ROLES and partners[i] is not None]
    payer = money if money in person else None
    shares = [Share(partners[i], pnames[i], abs(amounts[i]), amounts[i] > 0) for i in person]
    cats = [i for i, t in enumerate(types) if t in ("income", "expense")]
    others = [i for i in range(len(accs)) if i != money and types[i] in ("asset", "liability") and i not in person]
    kind = "transfer" if not cats else "income" if types[cats[0]] == "income" else "expense"
    first = cats[0] if cats else None
    category = moves.Category(accs[first], names[first], icons[first], colors[first]) if first is not None else None
    nxt = _next_dates(conn, rid, amounts[money], 1, False) if state == "active" else []
    return Row(rid, name, kind, mode, state, cur, amounts[money], accs[money], names[money],
               names[others[0]] if kind == "transfer" and others else None, category,
               nxt[0] if nxt else None, loan, partners[payer] if payer is not None else None,
               pnames[payer] if payer is not None else None, shares)


def overview(user_id: int) -> Overview:
    with user_transaction(user_id) as conn:
        conn.execute("SELECT account_recurring_run()")
        base = conn.execute("SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id"
                            ).fetchone()[0]
        rows = [_row(conn, r) for r in conn.execute(
            _ROWS_SQL + " WHERE r.state <> 'done' GROUP BY r.id, c.name, lo.account_id ORDER BY r.id").fetchall()]
        # Lo que entra y sale de tus cuentas en 30 días (las transferencias entre tus cuentas no cuentan)
        flows = conn.execute("""
            SELECT f.recurring_id, f.amount * CASE WHEN f.currency_id = u.currency_id THEN 1
                   ELSE get_rate(f.currency_id, user_today(), rate_side(a.account_type)) END
              FROM account_recurring_forecast(user_today() + 30) f
              JOIN account_account a ON a.id = f.account_id
              JOIN res_users u ON u.id = current_user_id()
             WHERE a.account_type IN ('income', 'expense')""").fetchall()
    incoming = -sum((Decimal(a) for _, a in flows if a < 0), ZERO)
    outgoing = sum((Decimal(a) for _, a in flows if a > 0), ZERO)
    active = sorted([r for r in rows if r.next], key=lambda r: (r.next.date, r.id))  # type: ignore[union-attr]
    rest = [r for r in rows if not r.next]
    return Overview(base, moves._round(incoming), moves._round(outgoing), active + rest)


@dataclass(frozen=True)
class Done:
    move_id: int
    date: dt.date
    occurrence: dt.date
    posted: bool
    amount: Decimal              # en la cuenta de dinero
    from_bank: bool              # enlazada con el extracto del banco


@dataclass(frozen=True)
class Detail:
    row: Row
    rule: Rule
    categories: list[moves.Category]
    splits: list[Decimal]        # el monto de cada categoría, en la moneda de la cuenta de dinero
    next: list[Next]
    done: list[Done]
    pending_reminder: dt.date | None   # recordatorio: la fecha que espera
    tags: list[tags_.TagRef] = field(default_factory=list)


def detail(user_id: int, rec_id: int) -> Detail:
    with user_transaction(user_id) as conn:
        conn.execute("SELECT account_recurring_run()")
        r = conn.execute(_ROWS_SQL + " WHERE r.id = %s GROUP BY r.id, c.name, lo.account_id", (rec_id,)).fetchone()
        if r is None:
            raise AccountError(404, "No encontramos esa recurrente")
        row = _row(conn, r)
        rule = conn.execute("""
            SELECT interval_type, date_start, interval_count, month_days, weekday, nth, end_type, date_end, max_count
              FROM account_recurring WHERE id = %s""", (rec_id,)).fetchone()
        nxt = _next_dates(conn, rec_id, row.amount, 6, True) if row.state != "done" else []
        done = [Done(mid, d, occ, st == "posted", amt, bank)
                for mid, d, occ, st, amt, bank in conn.execute("""
            SELECT m.id, m.date, m.recurring_date, m.state,
                   (SELECT l.amount_currency FROM account_move_line l WHERE l.move_id = m.id AND l.account_id = %s
                     ORDER BY l.id LIMIT 1),
                   EXISTS (SELECT 1 FROM account_bank_statement_line sl WHERE sl.move_id = m.id)
              FROM account_move m WHERE m.recurring_id = %s
             ORDER BY m.recurring_date DESC LIMIT 24""", (row.account_id, rec_id)).fetchall()]
        reminder = conn.execute("SELECT min(occurrence_date) FROM account_recurring_reminder WHERE recurring_id = %s",
                                (rec_id,)).fetchone()[0]
        tag_list = [tags_.TagRef(*t) for t in conn.execute("""
            SELECT t.id, t.name, t.color FROM account_recurring_account_tag_rel r JOIN account_tag t ON t.id = r.account_tag_id
             WHERE r.recurring_id = %s ORDER BY lower(t.name)""", (rec_id,))]
    accs, amounts, types, names, icons, colors = r[7], r[8], r[9], r[10], r[11], r[12]  # el resto: personas
    cats = [i for i, t in enumerate(types) if t in ("income", "expense")]
    return Detail(row, Rule(*rule), [moves.Category(accs[i], names[i], icons[i], colors[i]) for i in cats],
                  [abs(amounts[i]) for i in cats], nxt, done, reminder, tag_list)


@dataclass(frozen=True)
class Reminder:
    recurring_id: int
    name: str
    occurrence: dt.date
    date: dt.date
    amount: Decimal              # en la cuenta de dinero: + entra, − sale
    currency: str
    late: bool                   # ya pasó su día


@dataclass(frozen=True)
class Pending:
    reminders: list[Reminder]
    drafts_due: int              # recurrentes por confirmar que ya llegaron a su día…
    bank_charges: int = 0        # …de ellas, cargos del banco
    bank_charge_move_id: int | None = None   # el primero, para abrirlo


def pending(user_id: int) -> Pending:
    """Lo que el Inicio avisa: los recordatorios de hoy (y los atrasados) y lo por confirmar que ya llegó."""
    with user_transaction(user_id) as conn:
        conn.execute("SELECT account_recurring_run()")
        rows = conn.execute("""
            SELECT v.recurring_id, v.name, v.occurrence_date, v.date,
                   (SELECT l.amount FROM account_recurring_line l WHERE l.recurring_id = v.recurring_id
                     ORDER BY l.id LIMIT 1),
                   trim(c.name), v.date < user_today()
              FROM account_recurring_reminder v
              JOIN account_recurring r ON r.id = v.recurring_id
              JOIN res_currency c ON c.id = r.currency_id
             WHERE v.date <= user_today()
             ORDER BY v.date, v.recurring_id""").fetchall()
        drafts = conn.execute("SELECT count(*) FROM account_move WHERE recurring_id IS NOT NULL AND state = 'draft'"
                              " AND date <= user_today()").fetchone()[0]
        bank, first = conn.execute("""
            SELECT count(*), min(m.id) FROM account_move m JOIN account_recurring r ON r.id = m.recurring_id
             WHERE r.bank_charge AND m.state = 'draft' AND m.date <= user_today()""").fetchone()
    return Pending([Reminder(*x) for x in rows], drafts, bank, first)
