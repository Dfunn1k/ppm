"""Lógica de movimientos: registrar un gasto, un ingreso o una transferencia (con «Dividir»), lo que
se mueve con otra persona (prestar, cobrar, pagar, guardar y devolver su plata), un reembolso o un
asiento manual; editarlos, confirmarlos o pasarlos a por confirmar, borrarlos, y la lista por mes.

Aquí se arman los apuntes (al Debe y al Haber) a partir de lo que escribe la persona; la base
revisa que cuadren, que cada uno vaya en la moneda de su cuenta y que nada futuro quede confirmado.
Después de guardar, los pagos y las deudas de cada persona se concilian (de lo más antiguo a lo más
nuevo), como el cuaderno de fiados: «pagó 60, faltan 40»."""

from collections import defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from app.accounts import AccountError, _translate
from app.db import user_transaction

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
KINDS = ("expense", "income", "transfer")
# Con otra persona: la cuenta de sistema que usa y si la plata entra (True) o sale de tu cuenta
PERSON_KINDS = {
    "lend": ("receivable", False),        # le presté a alguien
    "borrow": ("payable", True),          # me prestaron
    "collect": ("receivable", True),      # me pagaron lo que me debían
    "repay": ("payable", False),          # pagué lo que debía
    "custody_in": ("custody", True),      # me dio para guardar
    "custody_out": ("custody", False),    # le devolví o usé su plata
}
INPUT_KINDS = (*KINDS, *PERSON_KINDS, "refund", "manual")
PERSON_ROLES = ("receivable", "payable", "custody")
RECONCILED_ROLES = ("receivable", "payable")
SYMBOLS = {"PEN": "S/", "USD": "US$", "EUR": "€"}


def _round(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def fmt(currency: str, amount: Decimal) -> str:
    """Un monto como lo lee la persona: «S/ 1,234.50»."""
    return f"{SYMBOLS.get(currency, currency)} {amount:,.2f}"


# --- Lo que entra -----------------------------------------------------------------------------

@dataclass(frozen=True)
class Split:
    category_id: int | None      # una categoría…
    amount: Decimal              # en la moneda de la cuenta de dinero
    partner_id: int | None = None   # …o la parte de otra persona (gasto dividido): te la debe


@dataclass(frozen=True)
class ManualLine:
    account_id: int
    debit: Decimal               # «Entra a», en moneda base
    credit: Decimal              # «Sale de», en moneda base
    partner_id: int | None = None


@dataclass(frozen=True)
class MoveInput:
    kind: str                    # uno de INPUT_KINDS
    account_id: int | None       # la cuenta de dinero: de dónde sale o adónde entra
    amount: Decimal              # en la moneda de esa cuenta
    date: dt.date | None = None     # None = hoy, en la zona de la persona
    ref: str | None = None       # la nota; sin nota, una glosa que arma la app
    pending: bool = False        # por confirmar
    rate: Decimal | None = None  # soles por unidad, si la cuenta no es en moneda base; None = el del día
    splits: list[Split] = field(default_factory=list)   # gasto, ingreso o reembolso: categorías (y personas)
    to_account_id: int | None = None                     # transferencia: adónde entra
    to_amount: Decimal | None = None                     # transferencia entre monedas: lo que entró
    partner_id: int | None = None                        # con otra persona: con quién
    debt_line_id: int | None = None                      # cobrar o pagar: qué deuda cancela primero
    paid_by_partner_id: int | None = None                # gasto que pagó otra persona: le debes tu parte
    lines: list[ManualLine] = field(default_factory=list)   # asiento manual


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
    partner_required: bool


def _accounts(conn: psycopg.Connection, ids: list[int]) -> dict[int, _Acc]:
    rows = conn.execute("""
        SELECT a.id, a.name, a.account_type, a.currency_id, trim(c.name), a.system_role, a.active,
               EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id), a.partner_required
          FROM account_account a LEFT JOIN res_currency c ON c.id = a.currency_id
         WHERE a.id = ANY(%s)""", (ids,)).fetchall()
    return {r[0]: _Acc(*r) for r in rows}


def _money_account(accs: dict[int, _Acc], acc_id: int | None, what: str) -> _Acc:
    a = accs.get(acc_id) if acc_id is not None else None
    if acc_id is None:
        raise AccountError(400, f"Elige la cuenta {what}")
    if a is None or not a.active:
        raise AccountError(404, f"No encontramos la cuenta {what}")
    if a.type not in ("asset", "liability") or a.currency_id is None or a.role in ("opening", "custody"):
        raise AccountError(400, f"Elige una cuenta tuya {what}: efectivo o banco")
    return a


def _partner(conn: psycopg.Connection, partner_id: int | None, what: str = "con quién") -> str:
    if partner_id is None:
        raise AccountError(400, f"Elige {what}")
    row = conn.execute("SELECT name FROM res_partner WHERE id = %s AND active", (partner_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos a esa persona")
    return row[0]


def _first(name: str) -> str:
    return name.split()[0] if name.split() else name


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


def owed(conn: psycopg.Connection, role: str, partner_id: int, currency_id: int,
         move_id: int | None = None) -> Decimal:
    """Lo confirmado con esa persona en esa cuenta y moneda, en positivo: lo que te debe (Por cobrar),
    lo que le debes (Por pagar) o lo que guardas suyo. Sin contar el movimiento que se está editando."""
    s = conn.execute("""
        SELECT coalesce(sum(l.amount_currency), 0)
          FROM account_move_line l JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
         WHERE l.account_id = system_account(%s) AND l.partner_id = %s AND l.currency_id = %s
           AND m.id <> coalesce(%s, 0)""", (role, partner_id, currency_id, move_id)).fetchone()[0]
    return s if role == "receivable" else -s


Line = tuple[int, Decimal, Decimal, int, Decimal, int | None]   # cuenta, debe, haber, moneda, monto con signo, persona


def _side(acc: int, base: Decimal, cur: int, amount: Decimal, partner: int | None, into: bool) -> Line:
    """Un apunte: si la plata entra a esa cuenta va al Debe; si sale, al Haber."""
    if into:
        return (acc, base, Decimal(0), cur, amount, partner)
    return (acc, Decimal(0), base, cur, -amount, partner)


def _limit_message(kind: str, name: str, currency: str, have: Decimal) -> str:
    n = _first(name)
    if kind == "collect":
        if have <= 0:
            return f"{n} no te debe nada en {currency}"
        return (f"{n} te debe {fmt(currency, have)}. Escribe hasta {fmt(currency, have)}; si te dio de más, "
                "registra el resto como «Me prestaron» o «Me dio para guardar»")
    if kind == "repay":
        if have <= 0:
            return f"No le debes nada a {n} en {currency}"
        return (f"Le debes {fmt(currency, have)} a {n}. Escribe hasta {fmt(currency, have)}; si le diste de más, "
                "registra el resto como «Le presté a alguien»")
    if have <= 0:
        return f"No guardas plata de {n} en {currency}"
    return f"Guardas {fmt(currency, have)} de {n}. Escribe hasta {fmt(currency, have)}"


def _build_person(conn: psycopg.Connection, m: MoveInput, on: dt.date, base_id: int,
                  move_id: int | None) -> tuple[str, list[Line]]:
    role, into = PERSON_KINDS[m.kind]
    name = _partner(conn, m.partner_id, "a quién" if m.kind in ("lend", "repay", "custody_out") else "quién")
    money = _money_account(_accounts(conn, [m.account_id] if m.account_id else []), m.account_id,
                           "adonde entra" if into else "de donde sale")
    # Un cobro, un pago o una devolución no pueden pasar de lo que hay (no queda un «me deben» negativo)
    if m.kind in ("collect", "repay", "custody_out"):
        have = owed(conn, role, m.partner_id, money.currency_id, move_id)  # type: ignore[arg-type]
        if m.amount > have:
            raise AccountError(400, _limit_message(m.kind, name, money.currency or "", have))
    base = _round(m.amount * _rate(conn, money, base_id, on, m.rate))
    person = conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0]
    n = _first(name)
    ref = {"lend": f"Préstamo a {n}", "borrow": f"Préstamo de {n}", "collect": f"{n} me pagó",
           "repay": f"Pago a {n}", "custody_in": f"Plata de {n} para guardar",
           "custody_out": f"Devolución a {n}"}[m.kind]
    return ref, [_side(money.id, base, money.currency_id, m.amount, None, into),  # type: ignore[arg-type]
                 _side(person, base, money.currency_id, m.amount, m.partner_id, not into)]  # type: ignore[arg-type]


def _build_manual(conn: psycopg.Connection, m: MoveInput, base_id: int) -> tuple[str, list[Line]]:
    if len(m.lines) < 2:
        raise AccountError(400, "Un asiento manual necesita al menos dos líneas")
    accs = _accounts(conn, [x.account_id for x in m.lines])
    base = conn.execute("SELECT trim(name) FROM res_currency WHERE id = %s", (base_id,)).fetchone()[0]
    lines: list[Line] = []
    for x in m.lines:
        a = accs.get(x.account_id)
        if a is None or not a.active:
            raise AccountError(404, "No encontramos una de las cuentas")
        if a.has_children:
            raise AccountError(400, f"«{a.name}» agrupa otras: elige una de ellas")
        if a.role == "opening":
            raise AccountError(400, "Un saldo inicial se corrige desde su cuenta")
        if a.currency_id is not None and a.currency_id != base_id:
            raise AccountError(400, f"El asiento manual va en {base}: «{a.name}» es en {a.currency}")
        if (x.debit > 0) == (x.credit > 0) or x.debit < 0 or x.credit < 0:
            raise AccountError(400, "Cada línea va en «Entra a» o en «Sale de», con un monto mayor que cero")
        if a.partner_required and x.partner_id is None:
            raise AccountError(400, f"«{a.name}» necesita con quién")
        if x.partner_id is not None:
            _partner(conn, x.partner_id)
        lines.append((a.id, x.debit, x.credit, base_id, x.debit - x.credit, x.partner_id))
    diff = sum((x.debit - x.credit for x in m.lines), Decimal(0))
    if diff:
        where = "Sale de" if diff > 0 else "Entra a"
        raise AccountError(400, f"Falta {fmt(base, abs(diff))} en «{where}» para que cuadre")
    return "Asiento manual", lines


def _build(conn: psycopg.Connection, m: MoveInput, on: dt.date,
           move_id: int | None = None) -> tuple[str, list[Line]]:
    """Los apuntes del movimiento y su glosa por defecto. Lanza AccountError si algo no cuadra."""
    if m.kind not in INPUT_KINDS:
        raise AccountError(400, "Elige qué tipo de movimiento es")
    base_id = conn.execute("SELECT currency_id FROM res_users").fetchone()[0]
    if m.kind == "manual":
        return _build_manual(conn, m, base_id)
    if m.amount <= 0:
        raise AccountError(400, "Escribe un monto mayor que cero")
    if m.kind in PERSON_KINDS:
        return _build_person(conn, m, on, base_id, move_id)

    ids = [x for x in [m.account_id, m.to_account_id, *(s.category_id for s in m.splits)] if x is not None]
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
        lines: list[Line] = [(src.id, Decimal(0), cost, src.currency_id, -m.amount, None),  # type: ignore[list-item]
                             (dst.id, received, Decimal(0), dst.currency_id, to_amount, None)]  # type: ignore[list-item]
        diff = received - cost
        if diff:
            role = "fx_gain" if diff > 0 else "fx_loss"
            fx = conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0]
            lines.append((fx, Decimal(0), diff, base_id, -diff, None) if diff > 0
                         else (fx, -diff, Decimal(0), base_id, -diff, None))
        return f"Transferencia a {dst.name}", lines

    # Gasto, ingreso o reembolso. El reembolso es plata que vuelve a tu cuenta desde la categoría
    # de un gasto (como una nota de crédito): la categoría baja y no cuenta como ingreso.
    paid_by = m.paid_by_partner_id if m.kind == "expense" else None
    if m.paid_by_partner_id is not None and m.kind != "expense":
        raise AccountError(400, "Solo un gasto lo puede pagar otra persona")
    if paid_by is not None:
        payer = _partner(conn, paid_by, "quién pagó")
        cur_id = base_id
        rate = Decimal(1)
    else:
        what = "adonde entra" if m.kind in ("income", "refund") else "de donde sale"
        money = _money_account(accs, m.account_id, what)
        cur_id = money.currency_id  # type: ignore[assignment]
        rate = _rate(conn, money, base_id, on, m.rate)
    if not m.splits:
        raise AccountError(400, "Elige de qué es el ingreso" if m.kind == "income" else "Elige en qué")
    wanted = "income" if m.kind == "income" else "expense"
    for s in m.splits:
        if s.partner_id is not None:
            if m.kind != "expense" or s.category_id is not None:
                raise AccountError(400, "La parte de otra persona va solo en un gasto, sin categoría")
            if paid_by is not None:
                raise AccountError(400, "Si pagó otra persona, divide solo en categorías")
            _partner(conn, s.partner_id)
        else:
            c = accs.get(s.category_id) if s.category_id is not None else None
            if c is None or not c.active:
                raise AccountError(404, "No encontramos esa categoría")
            if c.type != wanted:
                raise AccountError(400, f"«{c.name}» no es una categoría de {'gasto' if wanted == 'expense' else 'ingreso'}")
            if c.has_children:
                raise AccountError(400, f"«{c.name}» agrupa otras: elige una de ellas")
        if s.amount <= 0:
            raise AccountError(400, "Cada parte necesita un monto mayor que cero")
    own = [s for s in m.splits if s.partner_id is None]
    if not own:
        raise AccountError(400, "Al dividir, al menos una parte es tuya: elige su categoría")
    if sum((s.amount for s in m.splits), Decimal(0)) != m.amount:
        raise AccountError(400, "Las partes no suman el total")

    total_base = _round(m.amount * rate)
    parts: list[Decimal] = [_round(s.amount * rate) for s in m.splits[:-1]]
    parts.append(total_base - sum(parts, Decimal(0)))   # lo que falta, para que el total sea exacto
    if parts[-1] <= 0:
        raise AccountError(400, "Revisa las partes: con ese tipo de cambio no cuadran")

    out = m.kind == "expense"   # el gasto sale de la cuenta (Haber) y va a la categoría (Debe)
    if paid_by is not None:
        payable = conn.execute("SELECT system_account('payable')").fetchone()[0]
        lines = [_side(payable, total_base, base_id, m.amount, paid_by, False)]
    else:
        lines = [_side(money.id, total_base, cur_id, m.amount, None, not out)]
    receivable = None
    for s, b in zip(m.splits, parts, strict=True):
        if s.partner_id is not None:
            receivable = receivable or conn.execute("SELECT system_account('receivable')").fetchone()[0]
            lines.append(_side(receivable, b, cur_id, s.amount, s.partner_id, True))
        else:
            lines.append(_side(s.category_id, b, base_id, b, None, out))  # type: ignore[arg-type]
    ref = accs[own[0].category_id].name  # type: ignore[index]
    if paid_by is not None:
        ref = f"{ref} (pagó {_first(payer)})"
    return ref, lines


def _write(conn: psycopg.Connection, move_id: int, lines: list[Line]) -> None:
    for acc, debit, credit, cur, amount, partner in lines:
        conn.execute(
            "INSERT INTO account_move_line (move_id, account_id, partner_id, debit, credit, currency_id,"
            " amount_currency) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (move_id, acc, partner, debit, credit, cur, amount))
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")   # el cuadre, aquí y no al final


def _state(conn: psycopg.Connection, m: MoveInput) -> tuple[dt.date, str]:
    today = conn.execute("SELECT user_today()").fetchone()[0]
    on = m.date or today
    return on, "draft" if m.pending or on > today else "posted"


# --- Conciliación -----------------------------------------------------------------------------

def _pairs(conn: psycopg.Connection, move_id: int) -> set[tuple[int, int]]:
    """Las (persona, cuenta) de Por cobrar y Por pagar que toca un movimiento."""
    return {(r[0], r[1]) for r in conn.execute("""
        SELECT l.partner_id, l.account_id FROM account_move_line l
          JOIN account_account a ON a.id = l.account_id
         WHERE l.move_id = %s AND l.partner_id IS NOT NULL AND a.system_role = ANY(%s)""",
                                               (move_id, list(RECONCILED_ROLES)))}


def reconcile(conn: psycopg.Connection, pairs: set[tuple[int, int]]) -> None:
    for partner, account in sorted(pairs):
        conn.execute("SELECT reconcile_partner(%s, %s)", (partner, account))


def _settle_first(conn: psycopg.Connection, move_id: int, debt_line_id: int) -> None:
    """«Elegir otra deuda»: el cobro o el pago cancela primero la deuda que eligió la persona."""
    mine = conn.execute("""
        SELECT r.id, r.account_id, r.partner_id, r.currency_id, r.amount_residual
          FROM account_move_line_residual r WHERE r.move_id = %s""", (move_id,)).fetchone()
    debt = conn.execute("""
        SELECT id, account_id, partner_id, currency_id, amount_residual
          FROM account_move_line_residual WHERE id = %s""", (debt_line_id,)).fetchone()
    if mine is None:
        return   # por confirmar: se concilia al confirmarlo
    if debt is None or debt[1:4] != mine[1:4] or debt[0] == mine[0] or (debt[4] > 0) == (mine[4] > 0) or not debt[4]:
        raise AccountError(400, "Esa deuda no es de esta persona o ya está pagada")
    amount = min(abs(debt[4]), abs(mine[4]))
    d, c = (debt[0], mine[0]) if debt[4] > 0 else (mine[0], debt[0])
    conn.execute("INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)"
                 " VALUES (%s, %s, %s)", (d, c, amount))


# --- Guardar ----------------------------------------------------------------------------------

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
                if m.debt_line_id is not None and m.kind in ("collect", "repay"):
                    _settle_first(conn, move_id, m.debt_line_id)
                reconcile(conn, _pairs(conn, move_id))
                return move_id
        except psycopg.Error as e:
            raise _translate(e) from None


NOT_EDITABLE = {"opening": "Un saldo inicial no se edita aquí: corrígelo desde su cuenta o, si es con una persona, bórralo y vuelve a anotarlo",
                "offset": "Una compensación no se edita: bórrala y vuelve a compensar",
                "write_off": "Una deuda dada por perdida no se edita: bórrala si te equivocaste"}


def update(user_id: int, move_id: int, m: MoveInput) -> None:
    """Editar: se cambia la cabecera y se reemplazan los apuntes (nadie audita; un historial
    limpio vale más que el rastro del error). Después se vuelve a conciliar."""
    with user_transaction(user_id) as conn:
        kind = _kind_of(conn, move_id)
        if kind in NOT_EDITABLE:
            raise AccountError(400, NOT_EDITABLE[kind])
        try:
            with conn.transaction():
                before = _pairs(conn, move_id)
                on, state = _state(conn, m)
                default_ref, lines = _build(conn, m, on, move_id)
                conn.execute("DELETE FROM account_move_line WHERE move_id = %s", (move_id,))
                conn.execute("UPDATE account_move SET date = %s, ref = %s, state = %s WHERE id = %s",
                             (on, (m.ref or "").strip() or default_ref, state, move_id))
                _write(conn, move_id, lines)
                if m.debt_line_id is not None and m.kind in ("collect", "repay"):
                    _settle_first(conn, move_id, m.debt_line_id)
                reconcile(conn, before | _pairs(conn, move_id))
        except psycopg.Error as e:
            raise _translate(e) from None


def set_pending(user_id: int, move_id: int, pending: bool) -> None:
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM account_move WHERE id = %s", (move_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos ese movimiento")
        try:
            with conn.transaction():
                if not pending and _kind_of(conn, move_id) in ("collect", "repay", "custody_out"):
                    _check_limit_on_post(conn, move_id)
                conn.execute("UPDATE account_move SET state = %s WHERE id = %s",
                             ("draft" if pending else "posted", move_id))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                reconcile(conn, _pairs(conn, move_id))
        except psycopg.Error as e:
            raise _translate(e) from None


def _check_limit_on_post(conn: psycopg.Connection, move_id: int) -> None:
    """Al confirmar un cobro, un pago o una devolución, tampoco puede pasar de lo que hay."""
    row = conn.execute("""
        SELECT a.system_role, l.partner_id, l.currency_id, abs(l.amount_currency), p.name, trim(c.name)
          FROM account_move_line l JOIN account_account a ON a.id = l.account_id
          JOIN res_partner p ON p.id = l.partner_id JOIN res_currency c ON c.id = l.currency_id
         WHERE l.move_id = %s AND a.system_role = ANY(%s)""", (move_id, list(PERSON_ROLES))).fetchone()
    role, partner, cur_id, amount, name, cur = row
    kind = {"receivable": "collect", "payable": "repay", "custody": "custody_out"}[role]
    have = owed(conn, role, partner, cur_id, move_id)
    if amount > have:
        raise AccountError(400, _limit_message(kind, name, cur, have))


def delete(user_id: int, move_id: int) -> None:
    with user_transaction(user_id) as conn:
        kind = _kind_of(conn, move_id)
        if kind == "opening" and not _pairs(conn, move_id):
            raise AccountError(400, "Un saldo inicial se corrige desde su cuenta")
        pairs = _pairs(conn, move_id)
        conn.execute("DELETE FROM account_move WHERE id = %s", (move_id,))
        reconcile(conn, pairs)


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
    kind: str                    # 'expense', 'income', 'transfer', 'lend', 'borrow', 'collect', 'repay',
                                 # 'custody_in', 'custody_out', 'refund', 'offset', 'write_off' u 'other'
    currency: str                # la de la cuenta de dinero (la de donde sale, en una transferencia)
    amount: Decimal              # en esa moneda, siempre positivo: el signo lo da el tipo
    base: Decimal                # en moneda base (en un gasto, ingreso o reembolso: lo que va a categorías)
    account: str                 # la cuenta de dinero (o «A → B» en una transferencia)
    categories: list[Category]
    to_currency: str | None = None
    to_amount: Decimal | None = None
    fx: Decimal | None = None    # cambio de moneda: + ganancia, − costo del cambio (en moneda base)
    partner_id: int | None = None   # con quién, si es con otra persona
    partner: str | None = None


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
    expense_total: Decimal       # gastos − reembolsos + deudas dadas por perdidas
    pending_count: int
    days: list[Day]


@dataclass(frozen=True)
class SplitOut:
    category: Category | None    # una categoría…
    amount: Decimal              # en la moneda de la cuenta de dinero
    partner_id: int | None = None   # …o la parte de otra persona
    partner: str | None = None


@dataclass(frozen=True)
class LineOut:
    account_id: int
    account: str
    debit: Decimal               # «Entra a», en moneda base
    credit: Decimal              # «Sale de»
    currency: str
    amount: Decimal              # en la moneda del apunte, con signo
    partner_id: int | None = None
    partner: str | None = None


@dataclass(frozen=True)
class Settled:
    """Una deuda que este movimiento cancela (o un pago que la cancela)."""
    line_id: int
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal


@dataclass(frozen=True)
class MoveDetail:
    summary: MoveSummary
    account_id: int | None
    to_account_id: int | None
    rate: Decimal | None         # el de la cuenta de dinero, si no es la base
    splits: list[SplitOut]
    cost: Decimal | None = None       # cambio de moneda con diferencia: lo que costó lo que salió…
    cost_rate: Decimal | None = None  # …y a qué costo promedio
    partner_id: int | None = None
    paid_by_partner_id: int | None = None
    settled: list[Settled] = field(default_factory=list)
    lines: list[LineOut] = field(default_factory=list)   # todos los apuntes (para el asiento manual)


_LINES_SQL = """
SELECT l.move_id, l.account_id, a.name, a.account_type, a.system_role,
       coalesce(a.icon, p.icon), coalesce(a.color, p.color), trim(c.name), l.amount_currency, l.balance,
       l.partner_id, rp.name, l.id, l.debit, l.credit
  FROM account_move_line l
  JOIN account_account a ON a.id = l.account_id
  LEFT JOIN account_account p ON p.id = a.parent_id
  JOIN res_currency c ON c.id = l.currency_id
  LEFT JOIN res_partner rp ON rp.id = l.partner_id
 WHERE l.move_id = ANY(%s)
 ORDER BY l.move_id, l.id
"""
# Columnas: 0 asiento, 1 cuenta, 2 nombre, 3 tipo, 4 rol, 5 ícono, 6 color, 7 moneda, 8 monto, 9 balance,
#           10 persona, 11 nombre de la persona, 12 apunte, 13 debe, 14 haber

PERSON_KIND_BY = {("receivable", True): "lend", ("receivable", False): "collect",
                  ("payable", False): "borrow", ("payable", True): "repay",
                  ("custody", False): "custody_in", ("custody", True): "custody_out"}


def _kind(lines: list[tuple]) -> tuple[str, list[tuple], list[tuple], list[tuple], list[tuple]]:
    """Qué tipo de movimiento es, y sus apuntes repartidos: dinero, personas, categorías y cambio."""
    money = [x for x in lines if x[3] in ("asset", "liability")]
    persons = [x for x in money if x[4] in PERSON_ROLES]
    cash = [x for x in money if x[4] not in PERSON_ROLES]
    cats = [x for x in lines if x[3] in ("income", "expense")]
    # Entre dos cuentas de dinero, la ganancia o el costo del cambio no la vuelven gasto ni ingreso
    fx = [x for x in cats if x[4] in ("fx_gain", "fx_loss")] if len(cash) == 2 and not persons else []
    cats = [x for x in cats if x not in fx]
    expense = bool(cats) and all(x[3] == "expense" for x in cats)
    if any(x[4] == "opening" for x in lines):
        kind = "opening"
    elif expense and len(cash) == 1 and cash[0][8] < 0 and all(x[4] == "receivable" and x[8] > 0 for x in persons):
        kind = "expense"
    elif expense and not cash and len(persons) == 1 and persons[0][4] == "payable" and persons[0][8] < 0:
        kind = "expense"                                   # lo pagó otra persona
    elif expense and len(cash) == 1 and cash[0][8] > 0 and not persons and all(x[9] < 0 for x in cats):
        kind = "refund"
    elif (len(cats) == 1 and cats[0][4] == "bad_debt" and not cash and persons
          and all(x[4] == "receivable" and x[8] < 0 for x in persons)):
        kind = "write_off"
    elif cats and all(x[3] == "income" for x in cats) and len(cash) == 1 and not persons:
        kind = "income"
    elif not cats and len(cash) == 2 and not persons:
        kind = "transfer"
    elif not cats and len(cash) == 1 and len(persons) == 1 and (cash[0][8] > 0) != (persons[0][8] > 0):
        kind = PERSON_KIND_BY[(persons[0][4], persons[0][8] > 0)]
    elif (not cats and not cash and len(persons) == 2 and {x[4] for x in persons} == {"receivable", "payable"}
          and persons[0][10] == persons[1][10]):
        kind = "offset"
    else:
        kind = "other"
    return kind, cash, persons, cats, fx


def _classify(head: tuple, lines: list[tuple]) -> tuple[MoveSummary, list[tuple]]:
    move_id, on, ref, state = head
    posted = state == "posted"
    kind, cash, persons, cats, fx = _kind(lines)
    categories = [Category(x[1], x[2], x[5], x[6]) for x in cats]
    who = persons[0] if persons else None
    pid, pname = (who[10], who[11]) if who else (None, None)
    cat_base = sum((abs(x[9]) for x in cats), Decimal(0))

    if kind == "transfer":
        src = next(x for x in cash if x[8] < 0)
        dst = next(x for x in cash if x[8] > 0)
        s = MoveSummary(move_id, on, ref, posted, kind, src[7], -src[8], dst[9],
                        f"{src[2]} → {dst[2]}", [], dst[7], dst[8],
                        -sum((x[9] for x in fx), Decimal(0)) if fx else None)
    elif kind in ("expense", "income", "refund") and cash:
        m = cash[0]
        s = MoveSummary(move_id, on, ref, posted, kind, m[7], abs(m[8]), cat_base, m[2], categories,
                        partner_id=pid, partner=pname)
    elif kind == "expense":   # lo pagó otra persona: no sale de tus cuentas
        s = MoveSummary(move_id, on, ref, posted, kind, who[7], abs(who[8]), cat_base,  # type: ignore[index]
                        f"Pagó {_first(pname or '')}", categories, partner_id=pid, partner=pname)
    elif kind == "write_off":
        s = MoveSummary(move_id, on, ref, posted, kind, who[7], sum((abs(x[8]) for x in persons), Decimal(0)),  # type: ignore[index]
                        cat_base, pname or "", categories, partner_id=pid, partner=pname)
    elif kind in PERSON_KINDS:
        m = cash[0]
        s = MoveSummary(move_id, on, ref, posted, kind, m[7], abs(m[8]), abs(m[9]), m[2], [],
                        partner_id=pid, partner=pname)
    elif kind == "opening" and persons:   # saldo inicial con una persona: ya te debía o ya le debías
        s = MoveSummary(move_id, on, ref, posted, kind, who[7], abs(who[8]), abs(who[9]), pname or "", [],  # type: ignore[index]
                        partner_id=pid, partner=pname)
    elif kind == "offset":
        r = next(x for x in persons if x[4] == "receivable")
        s = MoveSummary(move_id, on, ref, posted, kind, r[7], abs(r[8]), abs(r[9]), pname or "", [],
                        partner_id=pid, partner=pname)
    elif cash:
        m = cash[0]
        s = MoveSummary(move_id, on, ref, posted, kind, m[7], abs(m[8]), abs(m[9]), m[2], categories,
                        partner_id=pid, partner=pname)
    else:
        s = MoveSummary(move_id, on, ref, posted, kind, lines[0][7], abs(lines[0][8]),
                        abs(lines[0][9]), lines[0][2], categories, partner_id=pid, partner=pname)
    return s, cash


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


def signed(s: MoveSummary) -> Decimal:
    """Cuánto entra (+) o sale (−) de lo que realmente tienes en el mes, en moneda base."""
    if s.kind in ("income", "refund"):
        return s.base
    if s.kind in ("expense", "write_off"):
        return -s.base
    return s.fx or Decimal(0)


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
            [s.ref, s.account, s.partner or "", f"{s.amount:.2f}", *(c.name for c in s.categories)]).lower()]

    posted = [s for s in found if s.posted]
    # La ganancia o el costo de un cambio de moneda también entra o sale en el mes
    gains = sum((s.fx for s in posted if s.fx and s.fx > 0), ZERO)
    losses = -sum((s.fx for s in posted if s.fx and s.fx < 0), ZERO)

    days: dict[dt.date, list[MoveSummary]] = defaultdict(list)
    for s in found:
        days[s.date].append(s)
    return Month(
        ym, base,
        sum((s.base for s in posted if s.kind == "income"), ZERO) + gains,
        sum((s.base for s in posted if s.kind in ("expense", "write_off")), ZERO)
        - sum((s.base for s in posted if s.kind == "refund"), ZERO) + losses,
        sum(1 for s in found if not s.posted),
        [Day(d, sum((signed(s) for s in ms if s.posted), ZERO), ms) for d, ms in days.items()],
    )


def detail(user_id: int, move_id: int) -> MoveDetail:
    with user_transaction(user_id) as conn:
        head = conn.execute("SELECT id, date, ref, state FROM account_move WHERE id = %s", (move_id,)).fetchone()
        if head is None:
            raise AccountError(404, "No encontramos ese movimiento")
        lines = conn.execute(_LINES_SQL, ([move_id],)).fetchall()
        base = conn.execute("SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id").fetchone()[0]
        settled = [Settled(*r) for r in conn.execute("""
            SELECT o.id, o.move_id, m.date, m.ref, r.amount
              FROM account_move_line l
              JOIN account_partial_reconcile r ON l.id IN (r.debit_move_line_id, r.credit_move_line_id)
              JOIN account_move_line o ON o.id = CASE WHEN r.debit_move_line_id = l.id
                                                      THEN r.credit_move_line_id ELSE r.debit_move_line_id END
              JOIN account_move m ON m.id = o.move_id
             WHERE l.move_id = %s ORDER BY m.date, o.id""", (move_id,))]
    summary, cash = _classify(head, lines)
    all_lines = [LineOut(x[1], x[2], x[13], x[14], x[7], x[8], x[10], x[11]) for x in lines]
    kind, _cash, persons, cats, _fx = _kind(lines)
    pid = persons[0][10] if persons else None

    if kind == "transfer":
        src = next(x for x in cash if x[8] < 0)
        dst = next(x for x in cash if x[8] > 0)
        rate = None if base in (src[7], dst[7]) else _round6(abs(src[9] / src[8]))
        if summary.fx is None:
            return MoveDetail(summary, src[1], dst[1], rate, [], lines=all_lines)
        return MoveDetail(summary, src[1], dst[1], rate, [], abs(src[9]), _round6(abs(src[9] / src[8])),
                          lines=all_lines)

    if kind in ("expense", "income", "refund"):
        paid_by = None if cash else pid
        m = cash[0] if cash else persons[0]
        rate = _round6(abs(m[9] / m[8])) if m[7] != base and m[8] else None
        parts = [x for x in lines if x[3] in ("income", "expense") or (x[4] == "receivable" and cash)]
        amounts = [abs(x[8]) if x[3] not in ("income", "expense") else
                   abs(x[9]) if rate is None else _round(abs(x[9]) / rate) for x in parts]
        amounts[-1] = abs(m[8]) - sum(amounts[:-1], Decimal(0))   # que sumen exacto el total
        splits = [SplitOut(Category(x[1], x[2], x[5], x[6]), a) if x[3] in ("income", "expense")
                  else SplitOut(None, a, x[10], x[11]) for x, a in zip(parts, amounts, strict=True)]
        return MoveDetail(summary, cash[0][1] if cash else None, None, rate, splits,
                          paid_by_partner_id=paid_by, lines=all_lines)

    m = cash[0] if cash else None
    rate = _round6(abs(m[9] / m[8])) if m is not None and m[7] != base and m[8] else None
    splits = [SplitOut(Category(x[1], x[2], x[5], x[6]), abs(x[9])) for x in cats]
    return MoveDetail(summary, m[1] if m else None, None, rate, splits, partner_id=pid,
                      settled=settled, lines=all_lines)


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
    Las de ingreso, sueltas, van en un solo grupo «Ingresos». Las del tipo de cambio y la de deudas
    incobrables las pone la app."""
    if kind not in ("expense", "income"):
        raise AccountError(400, "Pide las de gasto o las de ingreso")
    with user_transaction(user_id) as conn:
        rows = conn.execute("""
            SELECT a.id, a.name, coalesce(a.icon, p.icon), coalesce(a.color, p.color), a.parent_id,
                   EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id AND k.active)
              FROM account_account a LEFT JOIN account_account p ON p.id = a.parent_id
             WHERE a.active AND a.account_type = %s
               AND a.system_role IS DISTINCT FROM 'fx_gain' AND a.system_role IS DISTINCT FROM 'fx_loss'
               AND a.system_role IS DISTINCT FROM 'bad_debt'
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


@dataclass(frozen=True)
class ManualAccount:
    id: int
    name: str
    type: str                    # 'asset', 'liability', 'equity', 'income' o 'expense'
    role: str | None
    partner_required: bool       # pide con quién
    icon: str | None
    color: int | None


def manual_accounts(user_id: int) -> list[ManualAccount]:
    """Las cuentas que se pueden usar en un asiento manual: las hojas activas en moneda base o
    multimoneda, menos «Saldos iniciales»."""
    with user_transaction(user_id) as conn:
        return [ManualAccount(*r) for r in conn.execute("""
            SELECT a.id, a.name, a.account_type, a.system_role, a.partner_required,
                   coalesce(a.icon, p.icon), coalesce(a.color, p.color)
              FROM account_account a
              JOIN res_users u ON u.id = a.user_id
              LEFT JOIN account_account p ON p.id = a.parent_id
             WHERE a.active AND (a.currency_id IS NULL OR a.currency_id = u.currency_id)
               AND a.system_role IS DISTINCT FROM 'opening'
               AND NOT EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id AND k.active)
             ORDER BY array_position(ARRAY['asset', 'liability', 'expense', 'income', 'equity'], a.account_type),
                      coalesce(p.name, a.name), a.name""")]
