"""El estado de cuenta de las tarjetas de crédito BBVA Perú («Estado de cuenta de tu tarjeta de
crédito»), del texto con disposición del PDF. Cada movimiento trae sus dos montos, «S/ …» y «$…», y
uno de los dos es cero: la moneda es la del que no lo es.

El BBVA no imprime un subtotal de los movimientos, así que se saca de sus otros números: el pago
total del periodo menos el saldo del periodo anterior, los intereses y cargos del banco y los pagos.
Lo que queda son las compras y las cuotas del ciclo, lo mismo que suma PPM, y sirve para validar que
se leyó cada línea: si falta una, no cuadra."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
import re

from app.accounts import AccountError
from app.card_pdf import ParsedCurrency, ParsedInstallment, ParsedLine, ParsedStatement

MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
          "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
FEES = ("SEGURO", "DESGRAVAMEN", "INTERES", "INTERÉS", "COMISION", "COMISIÓN", "MEMBRESIA", "MEMBRESÍA",
        "PENALIDAD", "ENVIO", "ENVÍO", "PORTES", "ITF")

PEN = r"S/\s*-?[\d,]+(?:\.\d{2})?"
USD = r"\$\s*-?[\d,]+(?:\.\d{2})?"
DATE = r"\d{1,2}/\d{1,2}/\d{4}"
MOVE = re.compile(rf"^\s*({DATE})\s+(.+?)\s+({PEN})\s+({USD})\s*$")
PLAN = re.compile(rf"^\s*({DATE})\s+(.+?)\s+((?:S/|\$)\s?[\d,]+(?:\.\d{{2}})?)\s+(\d+)/(\d+)\s+[\d.,]+\s*%"
                  rf"\s+(?:S/|\$)\s?([\d,]+(?:\.\d{{2}})?)\s+(?:S/|\$)\s?([\d,]+(?:\.\d{{2}})?)\s+({PEN})\s+({USD})\s*$")
PERIOD = re.compile(r"del (\d{1,2}) de (\w+) de (\d{4}) al (\d{1,2}) de (\w+) de (\d{4})")
DUE = re.compile(r"pago hasta el (\d{1,2}) de (\w+)")
LAST4 = re.compile(r"\d{4}-[\d*]{2}\*\*-\*{4}-(\d{4})")


def detect(text: str) -> bool:
    return "BBVA" in text and "Estado de cuenta de tu tarjeta de crédito" in text


def _amount(s: str) -> Decimal:
    v = s.replace("S/", "").replace("$", "").replace(",", "").replace(" ", "")
    return Decimal(v)


def _date(s: str) -> dt.date:
    d, m, y = s.split("/")
    return dt.date(int(y), int(m), int(d))


def _spanish(day: str, month: str, year: int) -> dt.date:
    m = MONTHS.get(month.lower())
    if m is None:
        raise ValueError(month)
    return dt.date(year, m, int(day))


def _pair(pen: str, usd: str) -> list[tuple[str, Decimal]]:
    """Los montos no nulos de la fila, con su moneda (los dos cero: un movimiento en soles en cero)."""
    out = [(c, v) for c, v in (("PEN", _amount(pen)), ("USD", _amount(usd))) if v != 0]
    return out


def _name(desc: str) -> str:
    """«(C) DLC UBER RIDES        PERU» → «DLC UBER RIDES»: sin la marca de compra ni el país."""
    desc = re.sub(r"^\(C\)\s*", "", desc.strip())
    parts = re.split(r"\s{2,}", desc)
    if len(parts) > 1 and re.fullmatch(r"[A-ZÁÉÍÓÚÑ ]{3,}", parts[-1]):
        parts = parts[:-1]
    return " ".join(" ".join(parts).split())


def parse(text: str) -> ParsedStatement:
    lines = [x for x in text.splitlines() if x.strip()]
    flat = " ".join(text.split())

    found = PERIOD.search(flat)
    if found is None:
        raise AccountError(400, "No encontramos el periodo (del … al …) en el estado de cuenta")
    g = found.groups()
    try:
        date_from, closing = _spanish(g[0], g[1], int(g[2])), _spanish(g[3], g[4], int(g[5]))
    except ValueError:
        raise AccountError(400, "No pudimos leer el periodo del estado de cuenta") from None
    last4 = (m.group(1) if (m := LAST4.search(text)) else None)

    date_due = None
    if (m := DUE.search(flat)) and m.group(2).lower() in MONTHS:
        due = _spanish(m.group(1), m.group(2), closing.year)
        date_due = due if due > closing else due.replace(year=closing.year + 1)

    limit = used = available = None
    billed: dict[str, Decimal] = {}
    previous: dict[str, Decimal] = {}
    fees: list[ParsedLine] = []
    moves: list[ParsedLine] = []
    payments: list[ParsedLine] = []
    plans: list[ParsedInstallment] = []
    pending: dict[str, Decimal] = {}
    unread: list[str] = []
    section: str | None = None      # 'moves', 'plan' o 'next'

    for i, raw in enumerate(lines):
        line = raw.rstrip()
        text_ = " ".join(line.split())
        if not text_:
            continue

        if "Pago total del período" in text_ and not billed:
            for nxt in lines[i + 1:i + 5]:
                t = " ".join(nxt.split())
                if t.startswith("Soles:") and (a := re.search(PEN, t)):
                    billed["PEN"] = _amount(a.group())
                elif t.startswith("Dólares:") and (a := re.search(USD, t)):
                    billed["USD"] = _amount(a.group())
            continue
        if text_.startswith("Tu línea de crédito es") and limit is None:
            nums = [_amount(a) for nxt in lines[i + 1:i + 4] for a in re.findall(PEN, nxt)]
            if len(nums) >= 3:
                limit, used, available = nums[:3]
            continue

        if text_.startswith("Estas son tus compras (C) sin cuotas"):
            section = "moves"
            continue
        if text_.startswith("Estas son tus compras (C) en cuotas"):
            section = "plan"
            continue
        if text_.startswith("Estas son tus cuotas en los próximos meses"):
            section = "next"
            continue
        if text_.startswith(("Los intereses compensatorios", "Así calculamos")):
            section = None
            continue
        if text_.startswith(("¿Tienes dudas?", "Estado de cuenta de tu tarjeta", "Página")) or LAST4.search(text_):
            continue    # el pie y la cabecera de cada página: la tabla sigue en la siguiente

        if "PERIODO ANTERIOR" in text_ and (m := MOVE.match(line)):
            amounts = {"PEN": _amount(m.group(3)), "USD": _amount(m.group(4))}
            if "SALDO" in text_:
                previous = amounts
            else:   # los intereses y gastos que se cobran en este periodo
                for c, v in amounts.items():
                    if v:
                        fees.append(ParsedLine(_date(m.group(1)), "Intereses y gastos del periodo anterior", v, c, "fee"))
            continue

        if section == "moves":
            m = MOVE.match(line)
            if not m:
                if re.match(rf"\s*{DATE}", line):
                    unread.append(text_)
                continue
            on, name = _date(m.group(1)), _name(m.group(2))
            upper = name.upper()
            for c, v in _pair(m.group(3), m.group(4)):
                if upper.startswith("PAGO"):
                    payments.append(ParsedLine(on, name, v, c, "payment"))
                elif upper.startswith(FEES) or any(w in upper for w in ("DESGRAVAMEN", "MEMBRESIA", "MEMBRESÍA")):
                    fees.append(ParsedLine(on, re.sub(r"\s+\d{2}-\d{2}-\d{4}$", "", name).capitalize(), v, c, "fee"))
                else:
                    moves.append(ParsedLine(on, name, v, c))
        elif section == "plan":
            m = PLAN.match(line)
            if m:
                cur = "USD" if m.group(3).startswith("$") else "PEN"
                total = _amount(m.group(9) if cur == "USD" else m.group(8))
                name = _name(m.group(2))
                seq, n = int(m.group(4)), int(m.group(5))
                plans.append(ParsedInstallment(_date(m.group(1)), name, cur, _amount(m.group(3)), seq, n,
                                               _amount(m.group(6)), _amount(m.group(7)), total))
                # La cuota del mes también es un movimiento del ciclo, como en el BCP: en su corte
                moves.append(ParsedLine(closing, f"Cuota {seq}/{n} {name}", total, cur))
            elif re.match(rf"\s*{DATE}", line):
                unread.append(text_)
        elif section == "next":
            t = text_.upper()
            if t.startswith(("SOLES", "DÓLARES", "DOLARES")):
                cur = "PEN" if t.startswith("SOLES") else "USD"
                pending[cur] = sum((_amount(a) for a in re.findall(PEN if cur == "PEN" else USD, line)), Decimal(0))

    if limit is None or used is None or available is None:
        raise AccountError(400, "No encontramos la línea de crédito en el estado de cuenta")

    lines_out = moves + payments + fees
    currencies = []
    for c in ("PEN", "USD"):
        if c not in billed and not any(x.currency == c for x in lines_out):
            continue
        sub = None
        if c in billed and c in previous:
            sub = (billed[c] - previous[c]
                   - sum((x.amount for x in fees + payments if x.currency == c), Decimal(0)))
        currencies.append(ParsedCurrency(c, sub, billed.get(c), pending.get(c)))
    lines_out.sort(key=lambda x: x.date)
    return ParsedStatement("BBVA", last4, date_from, closing, date_due, limit, used, available, currencies,
                           lines_out, plans, unread)
