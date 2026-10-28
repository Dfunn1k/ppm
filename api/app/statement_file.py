"""Adaptador de extractos: lee el Excel o el CSV que se descarga de la banca por internet y lo
traduce a líneas que entiende la base (fecha, descripción, número de operación, monto con signo).

No hay un formato por banco: se dice qué columna es qué, como en la importación de Odoo. Lo que
enseñaron los extractos reales: los encabezados pueden estar en la fila 5 (con un título y filas
vacías antes), los montos pueden venir como texto con símbolo («S/ -1,907.39») y el número de
operación con ceros a la izquierda («06771621») se lee como texto."""

import csv
import datetime as dt
import io
import re
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import openpyxl
import xlrd

FIELDS = ("date", "payment_ref", "amount", "debit", "credit", "operation_number", "currency", "balance")
DATE_FORMATS = ("DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY")
Cell = str | int | float | dt.date | dt.datetime | None


class FileError(Exception):
    """El archivo no se puede leer o el mapeo no calza con él. El mensaje es para la persona."""


@dataclass(frozen=True)
class Mapping:
    header_row: int                  # la fila de los encabezados, como se ve en Excel (desde 1)
    date_format: str
    decimal_separator: str           # '.' (1,234.50) o ',' (1.234,50)
    columns: dict[str, str]          # campo → encabezado: {'date': 'Fecha operación', …}


@dataclass(frozen=True)
class Row:
    n: int                           # la fila en el archivo, como se ve en Excel
    date: dt.date | None
    payment_ref: str
    operation_number: str | None
    amount: Decimal | None           # con signo: lo que sale, en negativo
    currency: str | None             # la de la columna de moneda, si la hay
    balance: Decimal | None
    problem: str | None = None       # por qué no entra

    @property
    def zero(self) -> bool:
        """«APERTURA DE CUENTA S/ 0.00»: no mueve dinero, se omite."""
        return self.problem is None and self.amount == 0


# --- Leer la tabla ------------------------------------------------------------------------------

def read_table(name: str, content: bytes) -> list[list[Cell]]:
    """Las filas del archivo, tal cual, como una tabla. Excel (.xlsx, .xls) o texto (.csv, .txt)."""
    if not content:
        raise FileError("El archivo está vacío")
    lower = name.lower()
    try:
        if content[:4] == b"PK\x03\x04" or lower.endswith(".xlsx"):
            return _xlsx(content)
        if content[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" or lower.endswith(".xls"):
            return _xls(content)
    except FileError:
        raise
    except Exception:
        raise FileError("No pudimos leer ese Excel. Descárgalo de nuevo de tu banca por internet") from None
    return _csv(content)


def _xlsx(content: bytes) -> list[list[Cell]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        ws = wb.worksheets[0]
        return [["" if v is None else v for v in row] for row in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


def _xls(content: bytes) -> list[list[Cell]]:
    book = xlrd.open_workbook(file_contents=content)
    sheet = book.sheet_by_index(0)
    rows: list[list[Cell]] = []
    for r in range(sheet.nrows):
        row: list[Cell] = []
        for cell in sheet.row(r):
            if cell.ctype == xlrd.XL_CELL_DATE:
                row.append(xlrd.xldate_as_datetime(cell.value, book.datemode))
            elif cell.ctype == xlrd.XL_CELL_EMPTY:
                row.append("")
            else:
                row.append(cell.value)
        rows.append(row)
    return rows


def _csv(content: bytes) -> list[list[Cell]]:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    lines = [x for x in text.splitlines() if x.strip()][:10]
    delimiter = max((",", ";", "\t", "|"), key=lambda d: sum(x.count(d) for x in lines))
    return [list(r) for r in csv.reader(io.StringIO(text), delimiter=delimiter)]


# --- Encabezados y mapeo ------------------------------------------------------------------------

def _text(v: Cell) -> str:
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip() if v is not None else ""


def find_header(table: list[list[Cell]]) -> int:
    """La fila que empieza con «Fecha» (la misma que ves en Excel); si no hay, la primera con texto."""
    for i, row in enumerate(table[:30]):
        cells = [_text(x) for x in row if _text(x)]
        if cells and cells[0].lower().startswith("fecha"):
            return i + 1
    for i, row in enumerate(table[:30]):
        if any(re.match(r"(?i)fecha", _text(x)) for x in row):
            return i + 1
    for i, row in enumerate(table):
        if any(_text(x) for x in row):
            return i + 1
    raise FileError("El archivo no tiene filas")


def headers(table: list[list[Cell]], header_row: int) -> list[str]:
    if header_row < 1 or header_row > len(table):
        raise FileError(f"El archivo no tiene una fila {header_row}")
    return [_text(x) for x in table[header_row - 1]]


_GUESS = {
    "date": r"^fecha",
    "payment_ref": r"descrip|concepto|detalle|glosa|movimiento",
    "operation_number": r"operaci|n[°ºo]\.?\s|nro|n[uú]mero|referencia",
    "amount": r"^monto|^importe",
    "debit": r"cargo|d[eé]bito|retiro",
    "credit": r"abono|cr[eé]dito|dep[oó]sito",
    "currency": r"moneda",
    "balance": r"saldo",
}


def guess(names: list[str]) -> dict[str, str]:
    """Qué columna parece ser cada campo, por su encabezado. Cada columna, para un solo campo."""
    found: dict[str, str] = {}
    for field, rx in _GUESS.items():
        for h in names:
            if h and re.search(rx, h, re.IGNORECASE) and h not in found.values():
                found[field] = h
                break
    if "amount" in found:
        found.pop("debit", None)
        found.pop("credit", None)
    return found


def check(mapping: Mapping, names: list[str]) -> None:
    c = mapping.columns
    if mapping.date_format not in DATE_FORMATS:
        raise FileError("Elige el formato de la fecha")
    if mapping.decimal_separator not in (".", ","):
        raise FileError("Elige el separador de decimales")
    unknown = set(c) - set(FIELDS)
    if unknown:
        raise FileError(f"No conocemos el campo {sorted(unknown)[0]}")
    missing = [col for col in c.values() if col not in names]
    if missing:
        raise FileError(f"El archivo no tiene la columna «{missing[0]}»")
    if "date" not in c or "payment_ref" not in c:
        raise FileError("Falta decir qué columna es la fecha y cuál la descripción")
    if "amount" in c and ("debit" in c or "credit" in c):
        raise FileError("Usa «Monto» o «Cargo y abono», no los dos")
    if "amount" not in c and "debit" not in c and "credit" not in c:
        raise FileError("Falta decir qué columna es el monto")


# --- Traducir cada fila -------------------------------------------------------------------------

def parse_date(v: Cell, fmt: str) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.match(r"^\s*(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})", _text(v))
    if not m:
        return None
    a, b, c = (int(x) for x in m.groups())
    y, mo, d = {"YYYY-MM-DD": (a, b, c), "MM/DD/YYYY": (c, a, b)}.get(fmt, (c, b, a))
    if y < 100:
        y += 2000
    try:
        return dt.date(y, mo, d)
    except ValueError:
        return None


def parse_amount(v: Cell, decimal_separator: str) -> Decimal | None:
    """«S/ -1,907.39», «(50.00)» o un número de Excel. Vacío = None; si no es número, ValueError."""
    if isinstance(v, bool):
        raise ValueError(v)
    if isinstance(v, (int, float)):
        return Decimal(str(round(v, 2))).quantize(Decimal("0.01"))
    t = _text(v)
    if not t:
        return None
    negative = "-" in t or (t.startswith("(") and t.endswith(")"))
    digits = re.sub(r"[^\d.,]", "", t)
    if not digits:
        raise ValueError(t)
    if decimal_separator == ",":
        digits = digits.replace(".", "").replace(",", ".")
    else:
        digits = digits.replace(",", "")
    try:
        n = Decimal(digits).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ValueError(t) from None
    return -n if negative else n


def parse_currency(v: Cell) -> str | None:
    t = _text(v).upper()
    if not t:
        return None
    if "S/" in t or "PEN" in t or "SOL" in t:
        return "PEN"
    if "USD" in t or "US" in t or "$" in t or "DOL" in t:
        return "USD"
    if "EUR" in t or "€" in t:
        return "EUR"
    return t[:3]


def parse(table: list[list[Cell]], mapping: Mapping, account_currency: str) -> list[Row]:
    """Las filas con movimientos, traducidas. Las vacías y las que no traen fecha (un título, un
    total al pie) se saltan; las demás llevan su problema si no pueden entrar."""
    names = headers(table, mapping.header_row)
    check(mapping, names)
    ix = {f: names.index(col) for f, col in mapping.columns.items()}

    def get(row: list[Cell], field: str) -> Cell:
        i = ix.get(field)
        return row[i] if i is not None and i < len(row) else ""

    rows: list[Row] = []
    for n, row in enumerate(table[mapping.header_row:], start=mapping.header_row + 1):
        if not any(_text(x) for x in row):
            continue
        raw_date = get(row, "date")
        if not _text(raw_date):
            continue                                      # un título o un total, no un movimiento
        date = parse_date(raw_date, mapping.date_format)
        ref = _text(get(row, "payment_ref"))
        op = _text(get(row, "operation_number")) or None
        problem = None
        try:
            if "amount" in ix:
                amount = parse_amount(get(row, "amount"), mapping.decimal_separator)
            else:
                debit = parse_amount(get(row, "debit"), mapping.decimal_separator)
                credit = parse_amount(get(row, "credit"), mapping.decimal_separator)
                amount = None if debit is None and credit is None else (credit or 0) - abs(debit or 0)
        except ValueError:
            amount, problem = None, "el monto no es un número"
        try:
            balance = parse_amount(get(row, "balance"), mapping.decimal_separator) if "balance" in ix else None
        except ValueError:
            balance = None
        currency = parse_currency(get(row, "currency")) if "currency" in ix else None
        if problem is None:
            if date is None:
                problem = f"la fecha «{_text(raw_date)}» no existe o no se entiende"
            elif amount is None:
                problem = "no tiene monto"
            elif not ref:
                problem = "no tiene descripción"
            elif currency is not None and currency != account_currency:
                problem = f"es en otra moneda ({_text(get(row, 'currency'))})"
        rows.append(Row(n, date, ref, op, amount, currency, balance, problem))
    return rows


def chronological(rows: Iterable[Row]) -> list[Row]:
    """Las filas que entran, de la más antigua a la más nueva (muchos bancos van al revés)."""
    good = [r for r in rows if r.problem is None and not r.zero]
    if len(good) > 1 and good[0].date > good[-1].date:   # type: ignore[operator]
        good.reverse()
    return good


def end_balance(rows: list[Row]) -> Decimal | None:
    """El saldo después del último movimiento, si el archivo trae la columna de saldo."""
    with_balance = [r for r in chronological(rows) if r.balance is not None]
    return with_balance[-1].balance if with_balance else None
