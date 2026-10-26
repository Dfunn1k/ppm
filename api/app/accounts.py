"""Lógica de cuentas: la lista con sus totales, el detalle con sus movimientos, las altas con su
saldo inicial y las correcciones. No sabe nada de HTTP: recibe datos simples, devuelve dataclasses
con Decimal y lanza AccountError con un mensaje ya escrito para la persona."""

from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import psycopg

from app.db import user_transaction

ZERO = Decimal("0.00")


class AccountError(Exception):
    """Un pedido que no se puede cumplir; `status` dice por qué (400, 404 o 409)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Money:
    currency: str        # 'PEN'
    amount: Decimal      # en esa moneda
    base: Decimal        # su valor hoy en la moneda base: al tipo de hoy (compra si lo tienes, venta si lo debes)
    book: Decimal        # su valor en libros: a los tipos con que se registró


@dataclass(frozen=True)
class TodayRate:
    currency: str
    date: date           # el día del tipo: hoy o el último anterior
    buy: Decimal
    sell: Decimal
    stale: bool          # tiene más de 3 días


@dataclass(frozen=True)
class AccountRow:
    id: int
    name: str
    kind: str                    # 'cash', 'bank', 'receivable', 'payable', 'suspense' u 'other'
    currency: str | None         # None = multimoneda
    icon: str | None
    subtitle: str | None         # 'Ahorros en soles'
    balances: list[Money]
    base_total: Decimal          # suma de sus saldos en moneda base
    partners: int | None = None  # Por cobrar y Por pagar: con cuántas personas hay algo pendiente


@dataclass(frozen=True)
class CustodyRow:
    partner_id: int
    partner_name: str
    balances: list[Money]        # en positivo: lo que guardas de esa persona
    base_total: Decimal


@dataclass(frozen=True)
class Overview:
    currency: str                # moneda base
    real_total: Decimal          # lo que realmente tengo = tengo − guardo − debo
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    have: list[AccountRow]
    custody: list[CustodyRow]
    owe: list[AccountRow]
    rates: list[TodayRate] = field(default_factory=list)   # los tipos con que se valoró lo que no es base


@dataclass(frozen=True)
class BankInfo:
    bank_id: int
    bank_name: str
    acc_kind: str                # 'savings' o 'checking'
    acc_number: str | None
    cci: str | None


@dataclass(frozen=True)
class Opening:
    date: date
    amount: Decimal
    rate: Decimal | None         # solo si la cuenta no es en moneda base


@dataclass(frozen=True)
class Line:
    id: int
    move_id: int
    date: date
    ref: str
    posted: bool
    currency: str
    amount: Decimal
    running: Decimal | None      # saldo después de este movimiento (solo confirmados)
    counterpart: str | None      # la categoría o cuenta del otro lado; None si son varias
    counterpart_icon: str | None
    counterpart_color: int | None
    counterpart_role: str | None  # 'opening' para el saldo inicial, 'suspense' para Por clasificar


@dataclass(frozen=True)
class AccountDetail:
    account: AccountRow
    system_role: str | None
    bank: BankInfo | None
    opening: Opening | None
    lines: list[Line] = field(default_factory=list)


ROLE_KIND = {"receivable": "receivable", "payable": "payable", "suspense": "suspense"}
KIND_NAMES = {"savings": "Ahorros", "checking": "Corriente"}
CURRENCY_NAMES = {"PEN": "soles", "USD": "dólares", "EUR": "euros"}


def _today_rates(conn: psycopg.Connection) -> dict[str, TodayRate]:
    """El tipo de hoy (o el último anterior) de cada moneda que no es la base."""
    rows = conn.execute("""
        SELECT trim(c.name), r.name, r.rate_buy, r.rate_sell, user_today() - r.name > 3
          FROM res_currency c
          JOIN res_users u ON c.id <> u.currency_id
          JOIN LATERAL (SELECT name, rate_buy, rate_sell FROM res_currency_rate
                         WHERE currency_id = c.id AND name <= user_today()
                         ORDER BY name DESC LIMIT 1) r ON true""").fetchall()
    return {r[0]: TodayRate(*r) for r in rows}


def _today(amount: Decimal, book: Decimal, rate: TodayRate | None, owed: bool) -> Decimal:
    """Su valor hoy; sin ningún tipo cargado todavía, el de libros."""
    if rate is None:
        return book
    return (amount * (rate.sell if owed else rate.buy)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _balances(conn: psycopg.Connection, account_ids: list[int],
              rates: dict[str, TodayRate] | None = None) -> dict[int, list[Money]]:
    out: dict[int, list[Money]] = defaultdict(list)
    if not account_ids:
        return out
    rates = _today_rates(conn) if rates is None else rates
    for acc, cur, amount, book, owed in conn.execute(
        "SELECT b.account_id, trim(c.name), b.amount_currency, b.balance, a.account_type = 'liability'"
        "  FROM account_balance b JOIN res_currency c ON c.id = b.currency_id"
        "  JOIN account_account a ON a.id = b.account_id"
        " WHERE b.account_id = ANY(%s) ORDER BY c.name",
        (account_ids,),
    ):
        out[acc].append(Money(cur, amount, _today(amount, book, rates.get(cur), owed), book))
    return out


_ACCOUNTS_SQL = """
SELECT a.id, a.name, a.account_type, a.system_role, coalesce(a.icon, p.icon), trim(cur.name),
       b.acc_kind, bk.name
  FROM account_account a
  LEFT JOIN account_account p ON p.id = a.parent_id
  LEFT JOIN res_currency cur  ON cur.id = a.currency_id
  LEFT JOIN res_partner_bank b ON b.account_id = a.id
  LEFT JOIN res_bank bk        ON bk.id = b.bank_id
"""


def _row(r: tuple, balances: list[Money]) -> AccountRow:
    acc_id, name, _type, role, icon, currency, acc_kind, bank_name = r
    if role in ROLE_KIND:
        kind = ROLE_KIND[role]
    elif acc_kind:
        kind = "bank"
    elif _type == "asset":
        kind = "cash"
    else:
        kind = "other"
    subtitle = None
    if kind == "bank":
        subtitle = f"{KIND_NAMES[acc_kind]} en {CURRENCY_NAMES.get(currency or '', currency)} · {bank_name}"
    elif kind == "cash" and currency and currency != "PEN":
        subtitle = f"En {CURRENCY_NAMES.get(currency, currency)}"
    return AccountRow(acc_id, name, kind, currency, icon or ("account_balance" if kind == "bank" else "payments"),
                      subtitle, balances, sum((m.base for m in balances), ZERO))


def overview(user_id: int) -> Overview:
    with user_transaction(user_id) as conn:
        base = conn.execute(
            "SELECT trim(c.name) FROM res_users u JOIN res_currency c ON c.id = u.currency_id").fetchone()[0]
        rows = conn.execute(
            _ACCOUNTS_SQL + " WHERE a.active AND a.account_type IN ('asset', 'liability')"
            " AND a.system_role IS DISTINCT FROM 'custody' ORDER BY a.account_type, a.id").fetchall()
        rates = _today_rates(conn)
        balances = _balances(conn, [r[0] for r in rows], rates)
        accounts = [_row(r, balances.get(r[0], [])) for r in rows]
        # Las de sistema (Por cobrar, Por pagar, Por clasificar) solo aparecen si tienen algo
        accounts = [a for a in accounts if a.kind in ("cash", "bank", "other") or any(m.amount for m in a.balances)]
        counts = dict(conn.execute(
            "SELECT account_id, count(DISTINCT partner_id) FROM res_partner_balance"
            " WHERE amount_currency <> 0 GROUP BY account_id").fetchall())
        accounts = [replace(a, partners=counts.get(a.id, 0)) if a.kind in ("receivable", "payable") else a
                    for a in accounts]

        custody: dict[int, list[Money]] = defaultdict(list)
        names: dict[int, str] = {}
        for pid, pname, cur, amount, bal in conn.execute("""
            SELECT p.id, p.name, trim(c.name), -sum(l.amount_currency), -sum(l.balance)
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN res_partner p  ON p.id = l.partner_id
              JOIN res_currency c ON c.id = l.currency_id
             WHERE l.account_id = system_account('custody')
             GROUP BY p.id, p.name, c.name
            HAVING sum(l.amount_currency) <> 0
             ORDER BY p.name, c.name"""):
            names[pid] = pname
            custody[pid].append(Money(cur, amount, _today(amount, bal, rates.get(cur), False), bal))

    have = [a for a in accounts if a.kind in ("cash", "bank", "receivable", "suspense")]   # activos
    owe = [a for a in accounts if a.kind in ("payable", "other")]                         # pasivos
    keep = [CustodyRow(pid, names[pid], ms, sum((m.base for m in ms), ZERO)) for pid, ms in custody.items()]
    have_total = sum((a.base_total for a in have), ZERO)
    owe_total = -sum((a.base_total for a in owe), ZERO)
    custody_total = sum((c.base_total for c in keep), ZERO)
    used = {m.currency for a in [*have, *owe] for m in a.balances} | {m.currency for c in keep for m in c.balances}
    return Overview(base, have_total - custody_total - owe_total, have_total, custody_total, owe_total,
                    have, keep, owe, [r for cur, r in sorted(rates.items()) if cur in used])


def detail(user_id: int, account_id: int, limit: int = 200) -> AccountDetail:
    with user_transaction(user_id) as conn:
        r = conn.execute(_ACCOUNTS_SQL + " WHERE a.id = %s AND a.account_type IN ('asset', 'liability')",
                         (account_id,)).fetchone()
        if r is None:
            raise AccountError(404, "No encontramos esa cuenta")
        row = _row(r, _balances(conn, [account_id]).get(account_id, []))
        role = r[3]

        bank = None
        b = conn.execute(
            "SELECT b.bank_id, bk.name, b.acc_kind, b.acc_number, b.cci FROM res_partner_bank b"
            " JOIN res_bank bk ON bk.id = b.bank_id WHERE b.account_id = %s", (account_id,)).fetchone()
        if b:
            bank = BankInfo(*b)

        opening = None
        o = conn.execute("""
            SELECT m.date, l.amount_currency, CASE WHEN l.currency_id = u.currency_id THEN NULL
                                                   ELSE round(abs(l.balance / l.amount_currency), 6) END
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id
              JOIN res_users u    ON u.id = l.user_id
             WHERE l.account_id = %s AND l.partner_id IS NULL
               AND EXISTS (SELECT 1 FROM account_move_line x
                            WHERE x.move_id = l.move_id AND x.account_id = system_account('opening'))
             ORDER BY m.date LIMIT 1""", (account_id,)).fetchone()
        if o:
            sign = -1 if r[2] == "liability" else 1
            opening = Opening(o[0], o[1] * sign, o[2])

        lines = [
            Line(lid, mid, d, ref, state == "posted", cur, amount, running,
                 cname if n == 1 else None, cicon if n == 1 else None, ccolor if n == 1 else None,
                 crole if n == 1 else None)
            for lid, mid, d, ref, state, cur, amount, running, n, cname, cicon, ccolor, crole in conn.execute("""
                SELECT r.id, r.move_id, r.date, r.ref, r.state, trim(c.name), r.amount_currency,
                       r.running_amount_currency, o.n, o.name, o.icon, o.color, o.role
                  FROM account_move_line_running r
                  JOIN res_currency c ON c.id = r.currency_id
                  CROSS JOIN LATERAL (
                    SELECT count(*) AS n, min(a.name) AS name, min(coalesce(a.icon, p.icon)) AS icon,
                           min(coalesce(a.color, p.color)) AS color, min(a.system_role) AS role
                      FROM account_move_line x
                      JOIN account_account a ON a.id = x.account_id
                      LEFT JOIN account_account p ON p.id = a.parent_id
                     WHERE x.move_id = r.move_id AND x.id <> r.id) o
                 WHERE r.account_id = %s
                 ORDER BY r.date DESC, r.move_id DESC, r.id DESC
                 LIMIT %s""", (account_id, limit))
        ]
    return AccountDetail(row, role, bank, opening, lines)


# --- Altas y correcciones ---------------------------------------------------------------------

def _currency_id(conn: psycopg.Connection, code: str) -> int:
    """La moneda tiene que ser una de las que usa la persona (la base o las del paso 2)."""
    row = conn.execute(
        "SELECT c.id FROM res_users_currency uc JOIN res_currency c ON c.id = uc.currency_id"
        " WHERE c.name = %s", (code.upper(),)).fetchone()
    if row is None:
        raise AccountError(400, f"No usas {code.upper()}. Agrégala primero a tus monedas.")
    return row[0]


def _translate(e: psycopg.Error, bank_name: str | None = None, cci_code: str | None = None) -> AccountError:
    """Los errores de la base, en palabras de la persona."""
    constraint = getattr(e.diag, "constraint_name", None) or ""
    if isinstance(e, psycopg.errors.UniqueViolation) and "name" in constraint:
        return AccountError(409, "Ya tienes una cuenta con ese nombre en esa moneda")
    if constraint == "res_partner_bank_bank_id_cci_bank_fkey":
        return AccountError(400, f"Ese CCI no es de {bank_name}: los de {bank_name} empiezan con {cci_code}")
    if constraint == "res_partner_bank_cci_check":
        return AccountError(400, "El CCI tiene 20 dígitos, sin letras")
    if constraint == "res_partner_bank_acc_number_check":
        return AccountError(400, "El número de cuenta lleva solo dígitos y guiones")
    if isinstance(e, psycopg.errors.CheckViolation | psycopg.errors.RaiseException):
        return AccountError(400, e.diag.message_primary or "No se pudo guardar")
    if isinstance(e, psycopg.errors.NoDataFound):
        return AccountError(400, e.diag.message_primary or "Falta el tipo de cambio")
    if isinstance(e, psycopg.errors.ForeignKeyViolation):
        return AccountError(404, "No encontramos lo que elegiste")
    raise e


def _bank(conn: psycopg.Connection, bank_id: int) -> tuple[str, str | None]:
    row = conn.execute("SELECT name, cci_code FROM res_bank WHERE id = %s", (bank_id,)).fetchone()
    if row is None:
        raise AccountError(404, "No encontramos ese banco")
    return row


def create_cash(user_id: int, name: str, currency: str, amount: Decimal, on: date | None,
                rate: Decimal | None) -> int:
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                acc = conn.execute(
                    "SELECT create_cash_account(%s, %s, %s, coalesce(%s, user_today()), %s)",
                    (name, _currency_id(conn, currency), amount, on, rate)).fetchone()[0]
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")   # el cuadre, aquí y no al final
                return acc
        except psycopg.Error as e:
            raise _translate(e) from None


def create_bank(user_id: int, name: str, currency: str, bank_id: int, acc_kind: str, acc_number: str | None,
                cci: str | None, amount: Decimal, on: date | None, rate: Decimal | None) -> int:
    with user_transaction(user_id) as conn:
        bank_name, cci_code = _bank(conn, bank_id)
        try:
            with conn.transaction():
                acc = conn.execute(
                    "SELECT create_bank_account(%s, %s, %s, %s, %s, %s, %s, coalesce(%s, user_today()), %s)",
                    (name, _currency_id(conn, currency), bank_id, acc_kind, acc_number, cci, amount, on,
                     rate)).fetchone()[0]
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")   # el cuadre, aquí y no al final
                return acc
        except psycopg.Error as e:
            raise _translate(e, bank_name, cci_code) from None


def add_custody(user_id: int, partner_id: int, currency: str, amount: Decimal, on: date | None,
                rate: Decimal | None) -> None:
    if amount <= 0:
        raise AccountError(400, "Escribe cuánto te dio para guardar")
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM res_partner WHERE id = %s AND active", (partner_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos a esa persona")
        try:
            with conn.transaction():
                conn.execute("SELECT post_custody_opening(%s, %s, %s, coalesce(%s, user_today()), %s)",
                             (partner_id, _currency_id(conn, currency), amount, on, rate))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        except psycopg.Error as e:
            raise _translate(e) from None


def set_opening(user_id: int, account_id: int, amount: Decimal, on: date | None, rate: Decimal | None) -> None:
    """Corrige el saldo inicial (o lo pone, si no tenía): el paso 3 lo usa con el Efectivo."""
    with user_transaction(user_id) as conn:
        kind = conn.execute("SELECT account_type FROM account_account WHERE id = %s AND active",
                            (account_id,)).fetchone()
        if kind is None:
            raise AccountError(404, "No encontramos esa cuenta")
        try:
            with conn.transaction():
                conn.execute("SELECT set_opening_balance(%s, %s, coalesce(%s, user_today()), %s)",
                             (account_id, amount, on, rate))
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
        except psycopg.Error as e:
            raise _translate(e) from None


def update(user_id: int, account_id: int, name: str | None, bank_id: int | None, acc_kind: str | None,
           acc_number: str | None, cci: str | None, clear: set[str]) -> None:
    """Renombrar y editar los datos del banco. `clear` dice qué campos opcionales se borran."""
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM account_account WHERE id = %s", (account_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos esa cuenta")
        current = conn.execute("SELECT bank_id FROM res_partner_bank WHERE account_id = %s", (account_id,)).fetchone()
        bank_name, cci_code = _bank(conn, bank_id or current[0]) if current else (None, None)
        try:
            with conn.transaction():
                if name is not None:
                    conn.execute("UPDATE account_account SET name = %s WHERE id = %s", (name.strip(), account_id))
                if current and (bank_id or acc_kind or acc_number or cci or clear):
                    conn.execute("""
                        UPDATE res_partner_bank
                           SET bank_id    = coalesce(%s, bank_id),
                               acc_kind   = coalesce(%s, acc_kind),
                               acc_number = CASE WHEN %s THEN NULL ELSE coalesce(%s, acc_number) END,
                               cci        = CASE WHEN %s THEN NULL ELSE coalesce(%s, cci) END
                         WHERE account_id = %s""",
                                 (bank_id, acc_kind, "acc_number" in clear, acc_number, "cci" in clear, cci,
                                  account_id))
                elif not current and (bank_id or acc_kind or acc_number or cci):
                    raise AccountError(400, "Esta cuenta no es de banco")
        except psycopg.Error as e:
            raise _translate(e, bank_name, cci_code) from None


def archive(user_id: int, account_id: int) -> None:
    """Archivar esconde la cuenta; solo con saldo cero, para que los totales no mientan."""
    with user_transaction(user_id) as conn:
        if conn.execute("SELECT 1 FROM account_account WHERE id = %s", (account_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos esa cuenta")
        if conn.execute("SELECT 1 FROM account_balance WHERE account_id = %s AND amount_currency <> 0",
                        (account_id,)).fetchone():
            raise AccountError(400, "Para archivarla, su saldo tiene que estar en cero")
        try:
            with conn.transaction():
                conn.execute("UPDATE account_account SET active = false WHERE id = %s", (account_id,))
        except psycopg.Error as e:
            raise _translate(e) from None


# --- Personas para elegir (la lista completa, con lo que se deben, está en app/partners.py) ------

@dataclass(frozen=True)
class Partner:
    id: int
    name: str


def partners(user_id: int) -> list[Partner]:
    with user_transaction(user_id) as conn:
        return [Partner(*r) for r in conn.execute("SELECT id, name FROM res_partner WHERE active ORDER BY name")]
