"""El estado de cuenta de las tarjetas de crédito BCP (Visa, Amex, Mastercard), del texto con
disposición del PDF. Los montos de la tabla de movimientos están en dos columnas, Soles y Dólares:
la columna se sabe por dónde termina el monto, comparado con los títulos de la tabla."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
import re

from app.accounts import AccountError
from app.card_pdf import ParsedCurrency, ParsedInstallment, ParsedLine, ParsedStatement

MONTHS = {"ene": 1, "jan": 1, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "may": 5, "jun": 6, "jul": 7,
          "ago": 8, "aug": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12, "dec": 12}
CREDITS = {"PAGO", "ABONO", "DEVOLUCION", "DEVOLUCIÓN", "EXTORNO"}   # tipos que bajan la deuda

AMOUNT = r"-?[\d,]+\.\d{2}-?"
DAY = r"\d{2}[A-Za-zé]{3}"
MOVE = re.compile(rf"^\s*({DAY})\s+({DAY})\s+(.+?)\s+({AMOUNT})\s*$")
PLAN = re.compile(rf"^\s*({DAY})\s+({DAY})\s+(.+?)\s+([\d,]+\.\d{{2}})\s+(\d{{2}})/(\d{{2}})\s+[\d.,]+\s*%"
                  rf"\s+([\d,]+\.\d{{2}})\s+([\d,]+\.\d{{2}})\s+([\d,]+\.\d{{2}})\s*$")
CYCLE = re.compile(r"(\d{4})\s+(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s*$")
SHORT_DATE = re.compile(r"\d{2}/\d{2}/\d{2}")
NUMBER = re.compile(r"[\d,]+(?:\.\d{2})?")


def detect(text: str) -> bool:
    return "BCP" in text and "Estado de Cuenta Tarjeta" in text


def _amount(s: str) -> Decimal:
    neg = s.startswith("-") or s.endswith("-")
    v = Decimal(s.strip("-").replace(",", ""))
    return -v if neg else v


def _short(s: str) -> dt.date:
    d, m, y = s.split("/")
    return dt.date(2000 + int(y), int(m), int(d))


def _day(s: str, closing: dt.date) -> dt.date:
    """«05Oct» en el año que la deja en o antes del corte."""
    month = MONTHS.get(s[2:].lower())
    if month is None:
        raise ValueError(s)
    d = dt.date(closing.year, month, int(s[:2]))
    return d if d <= closing else d.replace(year=closing.year - 1)


class _Columns:
    """Dónde terminan los títulos «Soles» y «Dólares» en la página: un monto que termina más cerca
    de «Dólares» es en dólares."""

    def __init__(self) -> None:
        self.cut: int | None = None

    def see(self, line: str) -> None:
        s, d = line.find("Soles"), line.find("Dólares")
        if s >= 0 and d > s:
            self.cut = (s + len("Soles") + d + len("Dólares")) // 2

    def currency(self, end: int) -> str:
        return "USD" if self.cut is not None and end > self.cut else "PEN"


def _amounts(line: str, cols: _Columns) -> dict[str, Decimal]:
    return {cols.currency(m.end()): _amount(m.group()) for m in re.finditer(AMOUNT, line)}


def parse(text: str) -> ParsedStatement:
    lines = text.splitlines()
    head = next((CYCLE.search(x) for x in lines if CYCLE.search(x)), None)
    if head is None:
        raise AccountError(400, "No encontramos el ciclo de facturación (Del/Al) en el estado de cuenta")
    last4, date_from, closing = head.group(1), _short(head.group(2)), _short(head.group(3))

    date_due = limit = used = available = None
    cols = _Columns()
    section: str | None = None          # 'moves', 'fees' o 'plan'
    plan_currency = "PEN"
    moves: list[ParsedLine] = []
    plans: list[ParsedInstallment] = []
    unread: list[str] = []
    cur: dict[str, dict[str, Decimal]] = {"PEN": {}, "USD": {}}

    for i, raw in enumerate(lines):
        line = raw.rstrip()
        text_ = " ".join(line.split())
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        cols.see(line)
        if "Fecha límite de pago" in line and date_due is None:
            found = SHORT_DATE.search(nxt)
            date_due = _short(found.group()) if found else None
        if "Línea utilizada" in line and limit is None:
            nums = NUMBER.findall(nxt)
            if len(nums) >= 3:
                limit, used, available = (Decimal(n.replace(",", "")) for n in nums[:3])
            continue
        if text_.startswith("Compras Cuotas"):
            nums = re.findall(r"[\d,]+\.\d{2}", text_)
            for c, n in zip(("PEN", "USD"), nums, strict=False):
                cur[c]["installments"] = Decimal(n.replace(",", ""))
            continue

        if text_.startswith("SALDO ANTERIOR"):
            section = "moves"
            continue
        if text_.startswith("SUB TOTAL"):
            for c, v in _amounts(line, cols).items():
                cur[c]["subtotal"] = v
            section = "fees"
            continue
        if text_.startswith("MONTO TOTAL FACTURADO"):
            for c, v in _amounts(line, cols).items():
                cur[c]["billed"] = v
            section = None
            continue
        if text_.startswith("DETALLE PLAN CUOTAS"):
            plan_currency = "USD" if "DOLARES" in text_.upper().replace("Ó", "O") else "PEN"
            section = "plan"
            continue
        if text_.startswith(("TOTAL SOLES", "TOTAL DOLARES", "TOTAL DÓLARES", "¿Cómo calcular", "¿COMO ESTA")):
            section = None
            continue

        if section == "moves":
            m = MOVE.match(line)
            if m:
                try:
                    on = _day(m.group(2), closing)
                except ValueError:
                    unread.append(text_)
                    continue
                desc = " ".join(m.group(3).split())
                words = desc.rsplit(" ", 1)
                kind = words[-1].upper() if len(words) == 2 else ""
                amount = _amount(m.group(4))
                if kind in CREDITS and amount > 0:
                    amount = -amount
                name = words[0] if kind in CREDITS | {"CONSUMO", "CARGO"} else desc
                name = re.sub(r" [A-Z]{2}$", "", name)      # el país del comercio: «… LIMA PE»
                moves.append(ParsedLine(on, name, amount, cols.currency(m.end(4))))
            elif re.search(AMOUNT, line):
                found = _amounts(line, cols)
                label = re.sub(AMOUNT, "", text_).strip()
                if label and not re.match(DAY, label):   # intereses o comisiones del ciclo, sin fecha
                    for c, v in found.items():
                        moves.append(ParsedLine(closing, label, v, c))
                else:
                    unread.append(text_)
        elif section == "fees":
            found = _amounts(line, cols)
            label = re.sub(AMOUNT, "", text_).strip()
            for c, v in found.items():
                moves.append(ParsedLine(closing, label.capitalize(), v, c, "fee"))
        elif section == "plan":
            m = PLAN.match(line)
            if m:
                plans.append(ParsedInstallment(
                    _day(m.group(2), closing), " ".join(m.group(3).split()), plan_currency,
                    _amount(m.group(4)), int(m.group(5)), int(m.group(6)),
                    _amount(m.group(7)), _amount(m.group(8)), _amount(m.group(9))))
            elif re.search(r"\d{2}/\d{2}", line) and re.search(AMOUNT, line):
                unread.append(text_)

    if limit is None or used is None or available is None:
        raise AccountError(400, "No encontramos la línea de crédito en el estado de cuenta")
    currencies = [ParsedCurrency(c, v.get("subtotal"), v.get("billed"), v.get("installments"))
                  for c, v in cur.items() if v]
    return ParsedStatement("BCP", last4, date_from, closing, date_due, limit, used, available, currencies,
                           moves, plans, unread)
