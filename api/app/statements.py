"""Lógica de Importar extracto (C7) y Por clasificar (M3).

El extracto es la bandeja de entrada del correo: todo llega y nada se pierde. Cada línea del banco
se descarta si ya se importó, se enlaza si ya existe en PPM o entra confirmada a Por clasificar.
Antes de importar se muestra qué pasaría (la importación se hace y se deshace) y si el saldo cuadra
con el del banco. Clasificar es mover cada correo a su carpeta: una categoría, otra cuenta tuya o
una persona. Por ahora solo se importa a cuentas de banco."""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
import datetime as dt
from decimal import Decimal

import psycopg

from app import filestore, moves
from app.accounts import AccountError, _translate
from app.db import user_transaction
from app.statement_file import FileError, Mapping, Row, chronological, end_balance, find_header, guess, headers, parse, read_table

MAX_BYTES = 5 * 1024 * 1024
MIMETYPES = {".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             ".xls": "application/vnd.ms-excel", ".csv": "text/csv"}
PROBLEMS = {"locked": "cae en un periodo cerrado", "future": "tiene fecha futura"}


@dataclass(frozen=True)
class PreviewRow:
    date: dt.date
    payment_ref: str
    amount: Decimal


@dataclass(frozen=True)
class Problem:
    row: int                         # la fila en el archivo, como se ve en Excel
    reason: str


@dataclass(frozen=True)
class Counts:
    new: int                         # entran a Por clasificar
    matched: int                     # ya estaban en PPM: se enlazan
    duplicate: int                   # ya se importaron: se saltan
    zero: int                        # sin monto: se omiten
    problems: int                    # no entran


@dataclass(frozen=True)
class Check:
    """El saldo del banco contra el que tendrá PPM a la fecha del último movimiento."""
    source: str | None               # 'file' (columna de saldo), 'typed' (escrito al importar) o None
    bank: Decimal | None
    book: Decimal                    # el de PPM a esa fecha, ya con lo importado
    difference: Decimal | None       # banco − PPM: positivo = falta algo en PPM


@dataclass(frozen=True)
class Result:
    """Lo que encontró el archivo: la vista previa (nada guardado) o lo que se importó."""
    file_name: str
    currency: str
    headers: list[str]
    mapping: Mapping
    remembered: bool                 # el mapeo es el de la última vez con esta cuenta
    total_rows: int
    date_from: dt.date | None
    date_to: dt.date | None
    counts: Counts
    check: Check
    sample: list[PreviewRow] = field(default_factory=list)   # cómo se leen las primeras filas
    problems: list[Problem] = field(default_factory=list)
    statement_id: int | None = None  # al importar


@dataclass(frozen=True)
class StatementRow:
    id: int
    name: str
    date_from: dt.date | None
    date_to: dt.date | None
    create_date: dt.datetime
    lines: int
    balance_end: Decimal | None
    difference: Decimal | None


@dataclass(frozen=True)
class StatementDetail:
    statement: StatementRow
    account_id: int
    account: str
    currency: str
    book: Decimal | None             # el saldo de PPM a la fecha del extracto
    pending: int                     # entraron nuevos y siguen por clasificar
    classified: int                  # entraron nuevos y ya tienen su lugar
    matched: int                     # ya estaban en PPM: se enlazaron
    has_file: bool


@dataclass(frozen=True)
class Unclassified:
    move_id: int
    date: dt.date
    ref: str                         # la glosa (empieza como la descripción del banco)
    payment_ref: str | None          # lo que dice el banco
    operation_number: str | None
    account_id: int
    account: str
    currency: str
    amount: Decimal                  # con signo: lo que sale, en negativo
    posted: bool


# --- La cuenta y el mapeo -----------------------------------------------------------------------

def _bank_account(conn: psycopg.Connection, account_id: int) -> tuple[str, str]:
    """Nombre y moneda de una cuenta de banco activa; solo a ellas se importa por ahora."""
    row = conn.execute("""
        SELECT a.name, trim(c.name) FROM account_account a
          JOIN res_partner_bank b ON b.account_id = a.id
          JOIN res_currency c ON c.id = a.currency_id
         WHERE a.id = %s AND a.active""", (account_id,)).fetchone()
    if row is None:
        if conn.execute("SELECT 1 FROM account_account WHERE id = %s", (account_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos esa cuenta")
        raise AccountError(400, "Por ahora el extracto se importa solo a cuentas de banco")
    return row


def _template(conn: psycopg.Connection, account_id: int) -> Mapping | None:
    head = conn.execute("SELECT header_row, date_format, decimal_separator FROM account_import_template"
                        " WHERE account_id = %s", (account_id,)).fetchone()
    if head is None:
        return None
    cols = dict(conn.execute("SELECT field, column_name FROM account_import_template_column"
                             " WHERE account_id = %s", (account_id,)).fetchall())
    return Mapping(head[0], head[1], head[2], cols)


def _save_template(conn: psycopg.Connection, account_id: int, m: Mapping) -> None:
    conn.execute("""
        INSERT INTO account_import_template (account_id, header_row, date_format, decimal_separator)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (account_id) DO UPDATE SET header_row = EXCLUDED.header_row,
               date_format = EXCLUDED.date_format, decimal_separator = EXCLUDED.decimal_separator""",
                 (account_id, m.header_row, m.date_format, m.decimal_separator))
    conn.execute("DELETE FROM account_import_template_column WHERE account_id = %s", (account_id,))
    for f, col in m.columns.items():
        conn.execute("INSERT INTO account_import_template_column (account_id, field, column_name)"
                     " VALUES (%s, %s, %s)", (account_id, f, col))


def _mapping(conn: psycopg.Connection, account_id: int, table: list, given: Mapping | None) -> tuple[Mapping, bool]:
    """El mapeo que se usa: el que mandó la persona, el de la última vez (si calza con el archivo)
    o el que se adivina por los encabezados."""
    if given is not None:
        return given, False
    saved = _template(conn, account_id)
    if saved is not None:
        try:
            names = headers(table, saved.header_row)
            if all(c in names for c in saved.columns.values()):
                return saved, True
        except FileError:
            pass
    row = find_header(table)
    return Mapping(row, "DD/MM/YYYY", ".", guess(headers(table, row))), False


# --- Importar -----------------------------------------------------------------------------------

def _run(conn: psycopg.Connection, account_id: int, name: str, rows: list[Row],
         balance_end: Decimal | None) -> tuple[int, Counter, list[Problem], Check, dt.date | None, dt.date | None]:
    good = chronological(rows)
    dates = sorted(r.date for r in good)   # type: ignore[type-var]
    file_balance = end_balance(rows)
    bank, source = (file_balance, "file") if file_balance is not None else \
                   (balance_end, "typed") if balance_end is not None else (None, None)
    first, last = (dates[0], dates[-1]) if dates else (None, None)
    st = conn.execute("INSERT INTO account_bank_statement (account_id, name, date_from, date_to, balance_end_real)"
                      " VALUES (%s, %s, %s, %s, %s) RETURNING id", (account_id, name, first, last, bank)).fetchone()[0]
    currency_id = conn.execute("SELECT currency_id FROM account_account WHERE id = %s", (account_id,)).fetchone()[0]

    counts: Counter = Counter()
    problems = [Problem(r.n, r.problem) for r in rows if r.problem]
    seen: Counter = Counter()
    for r in good:
        key = (r.date, r.amount, r.payment_ref)
        seen[key] += 1
        how = conn.execute("SELECT import_statement_line(%s, %s, %s, %s, %s, %s, %s::smallint)",
                           (st, r.date, r.payment_ref, r.operation_number, r.amount, currency_id, seen[key])).fetchone()[0]
        if how in PROBLEMS:
            problems.append(Problem(r.n, PROBLEMS[how]))
        else:
            counts[how] += 1
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")

    book = Decimal("0.00")
    if last is not None:
        book = conn.execute("""
            SELECT coalesce(sum(l.amount_currency), 0) FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted' AND m.date <= %s
             WHERE l.account_id = %s""", (last, account_id)).fetchone()[0]
    check = Check(source, bank, book, None if bank is None else bank - book)
    problems.sort(key=lambda p: p.row)
    return st, counts, problems, check, first, last


def _read(name: str, content: bytes, conn: psycopg.Connection, account_id: int,
          given: Mapping | None) -> tuple[list, Mapping, bool, list[str]]:
    if len(content) > MAX_BYTES:
        raise AccountError(400, "El archivo pesa más de 5 MB: descarga un rango de fechas más corto")
    try:
        table = read_table(name, content)
        mapping, remembered = _mapping(conn, account_id, table, given)
        return table, mapping, remembered, headers(table, mapping.header_row)
    except FileError as e:
        raise AccountError(400, str(e)) from None


class _Preview(Exception):
    """Para deshacer la importación de prueba y salir con su resultado."""

    def __init__(self, result: Result) -> None:
        self.result = result


def run(user_id: int, account_id: int, name: str, content: bytes, given: Mapping | None,
        balance_end: Decimal | None, save: bool) -> Result:
    """Lee el archivo y lo importa. Con save=False es la vista previa: se importa y se deshace,
    para decir qué pasaría sin guardar nada."""
    name = (name or "extracto").strip()[:120] or "extracto"
    with user_transaction(user_id) as conn:
        _acc_name, currency = _bank_account(conn, account_id)
        table, mapping, remembered, names = _read(name, content, conn, account_id, given)
        try:
            rows = parse(table, mapping, currency)
        except FileError as e:
            if given is not None:
                raise AccountError(400, str(e)) from None
            rows = []                                    # lo adivinado no calza: que la persona elija
        sample = [PreviewRow(r.date, r.payment_ref, r.amount) for r in rows    # type: ignore[arg-type]
                  if r.problem is None and not r.zero][:3]
        try:
            with conn.transaction():
                st, counts, problems, check, first, last = _run(conn, account_id, name, rows, balance_end)
                result = Result(name, currency, names, mapping, remembered, len(rows), first, last,
                                Counts(counts["created"], counts["matched"], counts["duplicate"],
                                       sum(1 for r in rows if r.zero), len(problems)),
                                check, sample, problems, st if save else None)
                if not save:
                    raise _Preview(result)
                if not counts["created"] and not counts["matched"]:
                    raise AccountError(400, "No hay nada nuevo que importar en ese archivo")
                _save_template(conn, account_id, mapping)
                stored = filestore.save(user_id, content)
                ext = name[name.rfind("."):].lower() if "." in name else ""
                conn.execute("""
                    INSERT INTO ir_attachment (res_model, res_id, name, mimetype, file_size, checksum, store_fname)
                    VALUES ('account.bank.statement', %s, %s, %s, %s, %s, %s)""",
                             (st, name, MIMETYPES.get(ext, "application/octet-stream"), stored.file_size,
                              stored.checksum, stored.store_fname))
                return result
        except _Preview as p:
            return p.result
        except psycopg.Error as e:
            raise _translate(e) from None


# --- Extractos anteriores, deshacer y el archivo ------------------------------------------------

_STATEMENTS_SQL = """
SELECT s.id, s.name, s.date_from, s.date_to, s.create_date,
       (SELECT count(*) FROM account_bank_statement_line l WHERE l.statement_id = s.id),
       s.balance_end_real, ch.difference
  FROM account_bank_statement s
  LEFT JOIN account_bank_statement_check ch ON ch.id = s.id
"""


def statements(user_id: int, account_id: int) -> list[StatementRow]:
    with user_transaction(user_id) as conn:
        _bank_account(conn, account_id)
        return [StatementRow(*r) for r in conn.execute(
            _STATEMENTS_SQL + " WHERE s.account_id = %s ORDER BY s.date_to DESC NULLS LAST, s.id DESC", (account_id,))]


def statement(user_id: int, statement_id: int) -> StatementDetail:
    with user_transaction(user_id) as conn:
        r = conn.execute(_STATEMENTS_SQL + " WHERE s.id = %s", (statement_id,)).fetchone()
        if r is None:
            raise AccountError(404, "No encontramos ese extracto")
        acc_id, acc, cur, book = conn.execute("""
            SELECT a.id, a.name, trim(c.name), ch.balance_book
              FROM account_bank_statement s JOIN account_account a ON a.id = s.account_id
              JOIN res_currency c ON c.id = a.currency_id
              LEFT JOIN account_bank_statement_check ch ON ch.id = s.id
             WHERE s.id = %s""", (statement_id,)).fetchone()
        pending, classified, matched = conn.execute("""
            SELECT count(*) FILTER (WHERE l.move_created AND p.pending),
                   count(*) FILTER (WHERE l.move_created AND NOT p.pending),
                   count(*) FILTER (WHERE NOT l.move_created)
              FROM account_bank_statement_line l
             CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM account_move_line x WHERE x.move_id = l.move_id
                                                   AND x.account_id = system_account('suspense')) AS pending) p
             WHERE l.statement_id = %s""", (statement_id,)).fetchone()
        has_file = conn.execute("SELECT 1 FROM ir_attachment WHERE res_model = 'account.bank.statement'"
                                " AND res_id = %s", (statement_id,)).fetchone() is not None
    return StatementDetail(StatementRow(*r), acc_id, acc, cur, book, pending, classified, matched, has_file)


def undo(user_id: int, statement_id: int) -> int:
    """Deshacer: borra lo que el extracto creó y sigue por clasificar, y el extracto con su archivo."""
    with user_transaction(user_id) as conn:
        try:
            n = conn.execute("SELECT undo_bank_statement(%s)", (statement_id,)).fetchone()[0]
        except psycopg.errors.NoDataFound:
            raise AccountError(404, "No encontramos ese extracto") from None
        except psycopg.errors.CheckViolation as e:   # p. ej. el periodo está cerrado
            raise AccountError(400, e.diag.message_primary or "No se pudo deshacer") from None
    collect(user_id)
    return n


def collect(user_id: int) -> int:
    """Borra del almacén los archivos de la persona que ya ninguna ficha usa."""
    with user_transaction(user_id) as conn:
        in_use = {r[0] for r in conn.execute("SELECT store_fname FROM ir_attachment")}
    return filestore.collect(user_id, in_use)


def statement_file(user_id: int, statement_id: int) -> tuple[str, str, bytes]:
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT name, mimetype, store_fname FROM ir_attachment"
                           " WHERE res_model = 'account.bank.statement' AND res_id = %s"
                           " ORDER BY id DESC LIMIT 1", (statement_id,)).fetchone()
    content = filestore.read(user_id, row[2]) if row else None
    if content is None:
        raise AccountError(404, "No encontramos el archivo de ese extracto")
    return row[0], row[1], content   # type: ignore[index]


# --- Por clasificar -----------------------------------------------------------------------------

def unclassified(user_id: int, account_id: int | None = None) -> list[Unclassified]:
    with user_transaction(user_id) as conn:
        return [Unclassified(*r) for r in conn.execute("""
            SELECT m.id, m.date, m.ref, sl.payment_ref, sl.operation_number, a.id, a.name, trim(c.name),
                   l.amount_currency, m.state = 'posted'
              FROM account_move m
              JOIN account_move_line s ON s.move_id = m.id AND s.account_id = system_account('suspense')
              JOIN LATERAL (SELECT * FROM account_move_line x WHERE x.move_id = m.id AND x.id <> s.id
                             ORDER BY x.id LIMIT 1) l ON true
              JOIN account_account a ON a.id = l.account_id
              JOIN res_currency c ON c.id = l.currency_id
              LEFT JOIN LATERAL (SELECT payment_ref, operation_number FROM account_bank_statement_line b
                                  WHERE b.move_id = m.id ORDER BY b.id LIMIT 1) sl ON true
             WHERE %s::bigint IS NULL OR a.id = %s
             ORDER BY m.date DESC, m.id DESC""", (account_id, account_id))]


def classify(user_id: int, move_ids: list[int], account_id: int | None, role: str | None,
             partner_id: int | None) -> None:
    """Pasa uno o varios movimientos de Por clasificar a una categoría, otra cuenta tuya o una persona.
    Con una persona: obligatoria en Por cobrar, Por pagar y Plata que guardo de otros; un cobro, un
    pago o una devolución no pasa de lo que se debe. Después se concilia la deuda."""
    if (account_id is None) == (role is None):
        raise AccountError(400, "Elige en qué fue: una categoría, una cuenta o una persona")
    if role is not None and partner_id is None:
        raise AccountError(400, "Elige con quién")
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                if role is not None:
                    account_id = conn.execute("SELECT system_account(%s)", (role,)).fetchone()[0]
                    if account_id is None:
                        raise AccountError(400, "No encontramos esa cuenta")
                else:
                    acc = conn.execute("SELECT partner_required FROM account_account WHERE id = %s",
                                       (account_id,)).fetchone()
                    if acc is None:
                        raise AccountError(404, "No encontramos esa cuenta")
                    if acc[0]:
                        raise AccountError(400, "Con una persona, elige con quién y qué fue")
                if partner_id is not None:
                    moves._partner(conn, partner_id)
                for move_id in dict.fromkeys(move_ids):
                    try:
                        with conn.transaction():
                            conn.execute("SELECT classify_move(%s, %s, %s)", (move_id, account_id, partner_id))
                    except psycopg.errors.NoDataFound:
                        raise AccountError(404, "Ese movimiento ya no está por clasificar") from None
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
                if role is not None:
                    _check_owed(conn, role, partner_id, account_id, move_ids)  # type: ignore[arg-type]
                    moves.reconcile(conn, {(partner_id, account_id)} if role in moves.RECONCILED_ROLES else set())  # type: ignore[arg-type]
        except psycopg.Error as e:
            raise _translate(e) from None


def _check_owed(conn: psycopg.Connection, role: str, partner_id: int, account_id: int, move_ids: list[int]) -> None:
    """Un cobro, un pago o una devolución no pasa de lo que se debe (lo mismo que al registrarlos)."""
    by_cur: dict[tuple[int, str], Decimal] = defaultdict(Decimal)
    for cur_id, cur, amount in conn.execute("""
        SELECT l.currency_id, trim(c.name), l.amount_currency FROM account_move_line l
          JOIN res_currency c ON c.id = l.currency_id
         WHERE l.move_id = ANY(%s) AND l.account_id = %s""", (move_ids, account_id)):
        if amount < 0 if role == "receivable" else amount > 0:   # me pagó, le pagué, le devolví
            by_cur[(cur_id, cur)] += abs(amount)
    if not by_cur:
        return
    name = conn.execute("SELECT name FROM res_partner WHERE id = %s", (partner_id,)).fetchone()[0]
    for (cur_id, cur), reduced in by_cur.items():
        left = moves.owed(conn, role, partner_id, cur_id)
        if left < 0:
            kind = {"receivable": "collect", "payable": "repay", "custody": "custody_out"}[role]
            raise AccountError(400, moves._limit_message(kind, name, cur, left + reduced))
