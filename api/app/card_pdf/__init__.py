"""Leer el estado de cuenta de una tarjeta en PDF: se extrae el texto con su disposición (pdfplumber)
y un lector por banco lo recorre con expresiones regulares, sin IA. Cada lector dice si reconoce el
texto (`detect`) y lo convierte en un `ParsedStatement`. Para agregar un banco: un módulo con
`detect` y `parse`, y su entrada en PARSERS.

La suma de los movimientos leídos se compara con el subtotal del banco en cada moneda; si no
cuadra, `unread` dice qué líneas parecían movimientos y no se pudieron leer."""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime as dt
from decimal import Decimal
import io
from typing import Callable

from app.accounts import AccountError


@dataclass(frozen=True)
class ParsedLine:
    date: dt.date                # fecha de consumo
    name: str
    amount: Decimal              # + cargo, − abono
    currency: str
    kind: str = "move"           # 'move' (consumo, cuota, pago) o 'fee' (cargo del banco)


@dataclass(frozen=True)
class ParsedInstallment:
    """Una fila del «Detalle plan cuotas»."""
    date: dt.date                # la compra
    name: str
    currency: str
    price: Decimal
    sequence: int
    n_installments: int
    capital: Decimal
    interest: Decimal
    total: Decimal


@dataclass(frozen=True)
class ParsedCurrency:
    currency: str
    subtotal: Decimal | None = None
    billed: Decimal | None = None          # monto total facturado
    installments: Decimal | None = None    # saldo de compras en cuotas


@dataclass(frozen=True)
class ParsedStatement:
    bank: str
    last4: str | None
    date_from: dt.date
    closing_date: dt.date
    date_due: dt.date | None
    credit_limit: Decimal
    used: Decimal
    available: Decimal
    currencies: list[ParsedCurrency]
    lines: list[ParsedLine] = field(default_factory=list)
    installments: list[ParsedInstallment] = field(default_factory=list)
    unread: list[str] = field(default_factory=list)   # parecían movimientos y no se pudieron leer


@dataclass(frozen=True)
class Parser:
    bank: str
    detect: Callable[[str], bool]
    parse: Callable[[str], ParsedStatement]


def _parsers() -> list[Parser]:
    from app.card_pdf import bcp
    return [Parser("BCP", bcp.detect, bcp.parse)]


def pdf_text(data: bytes, fit: bool = False) -> str:
    """El texto del PDF con su disposición: cada columna queda en su lugar (así se sabe si un monto
    es en soles o en dólares). Los caracteres repetidos de las negritas se quitan.

    Con `fit`, cada letra ocupa una columna del texto del ancho de la letra mediana de la página: con
    el ancho fijo de pdfplumber (7.25 pt), en un PDF de letra chica los espacios entre columnas se
    aplastan y un monto en dólares cae en la columna de los soles."""
    import pdfplumber
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\n".join(_page_text(p.dedupe_chars(), fit) for p in pdf.pages)
    except Exception:   # pdfplumber lanza varios tipos según el archivo
        raise AccountError(400, "No pudimos abrir ese PDF: si tiene clave, quítasela y vuelve a subirlo") from None


def _page_text(page, fit: bool) -> str:
    density = 7.25
    if fit:
        widths = sorted(c["width"] for c in page.chars if c["text"].strip())
        density = min(widths[len(widths) // 2], density) if widths else density
    return page.extract_text(layout=True, x_density=density) or ""


def _balances(p: ParsedStatement) -> bool:
    """Lo leído cuadra con el subtotal del banco en cada moneda que lo trae."""
    return all(sum((x.amount for x in p.lines if x.kind == "move" and x.currency == c.currency), Decimal(0))
               == c.subtotal for c in p.currencies if c.subtotal is not None)


def parse_text(text: str) -> ParsedStatement:
    for p in _parsers():
        if p.detect(text):
            return p.parse(text)
    raise AccountError(400, "No reconocemos ese estado de cuenta. Por ahora PPM lee los de tarjetas BCP")


def parse_pdf(data: bytes) -> ParsedStatement:
    """Se lee con el ancho de siempre; si no cuadra (o no se pudo leer), otra vez con el ancho de la
    letra del PDF, y queda esa lectura si cuadra."""
    try:
        first: ParsedStatement | AccountError = parse_text(pdf_text(data))
    except AccountError as e:
        first = e
    if isinstance(first, ParsedStatement) and _balances(first):
        return first
    try:
        fitted = parse_text(pdf_text(data, fit=True))
    except AccountError:
        fitted = None
    if fitted is not None and (_balances(fitted) or isinstance(first, AccountError)):
        return fitted
    if isinstance(first, AccountError):
        raise first
    return first
