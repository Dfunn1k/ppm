"""El estado de cuenta de las tarjetas de crédito Interbank («DETALLE DE PAGO DEL MES»), del texto con
disposición del PDF. Las fechas vienen sin año («21-Oct»): se toma el del periodo, y si el día queda
después del cierre es del año anterior (una compra en cuotas de junio en un corte de enero).

Cada sección (PAGOS REALIZADOS, TUS CONSUMOS, TUS CONSUMOS EN CUOTAS, OTROS COBROS) termina en su
SUBTOTAL en S/ y US$, y el PAGO DEL MES es la suma de los subtotales. Lo que suma PPM (consumos y la
cuota del mes) se valida contra los subtotales de consumos y cuotas; el de pagos trae además lo que
debías en el estado anterior, así que no se usa para validar.

En «TUS CONSUMOS EN CUOTAS», «Cuotas Pactadas 006» y «Cuotas por Pagar 001» dicen que la del mes es la
5 de 6: la que queda por pagar es la que viene."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
import re

from app.accounts import AccountError
from app.card_pdf import ParsedCurrency, ParsedInstallment, ParsedLine, ParsedStatement

# Los meses como los abrevia el banco: en castellano, y por si acaso en inglés
MONTHS = {"ene": 1, "jan": 1, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8,
          "aug": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12, "dec": 12}

NUM = r"-?[\d,]+\.\d{2}"
DAY = r"\d{2}-[A-Za-z]{3}"
MOVE = re.compile(rf"^\s*({DAY})\s+(.+?)\s+({NUM})(?:\s+({NUM}))?\s*$")
PLAN = re.compile(rf"^\s*({DAY})\s+(.+?)\s+(\d{{3}})\s+(\d{{3}})\s+({NUM})\s+({NUM})\s+({NUM})\s+({NUM})\s+({NUM})"
                  rf"\s+({NUM})(?:\s+({NUM}))?\s*$")
BROKEN = re.compile(r"\s-?[\d,]*\d[.,]\S*$")
PERIOD = re.compile(r"del (\d{2}/\d{2}/\d{4}) al cierre de (\d{2}/\d{2}/\d{4})")
LIMIT = re.compile(rf"Tu Línea de Crédito es de:.*?S/\s*({NUM})\s+S/\s*({NUM})\s+S/\s*({NUM})")
DUE = re.compile(r"ÚLTIMO DÍA DE PAGO.*?(\d{2}/\d{2}/\d{4})")
LAST4 = re.compile(r"\d{4} \d{2}\*\* \*{4} (\d{4})")
BILLED = re.compile(rf"PAGO DEL MES \(Suma de subtotales\)[\s-]*=\s*({NUM})\s+({NUM})")
SECTIONS = {"PAGOS REALIZADOS": "payments", "TUS CONSUMOS EN CUOTAS": "plan", "TUS CONSUMOS": "moves",
            "OTROS COBROS": "fees"}


def detect(text: str) -> bool:
    return "interbank" in text.lower() and "DETALLE DE PAGO DEL MES" in text


def _amount(s: str) -> Decimal:
    return Decimal(s.replace(",", ""))


def _date(s: str) -> dt.date:
    d, m, y = s.split("/")
    return dt.date(int(y), int(m), int(d))


def _day(s: str, closing: dt.date) -> dt.date:
    """«21-Oct» en el año del cierre; si queda después del cierre, es del año anterior."""
    d, m = s.split("-")
    month = MONTHS.get(m.lower())
    if month is None:
        raise ValueError(s)
    on = dt.date(closing.year, month, int(d))
    return on if on <= closing else on.replace(year=closing.year - 1)


def _name(desc: str) -> str:
    return " ".join(desc.split())


def parse(text: str) -> ParsedStatement:
    lines = text.splitlines()
    flat = " ".join(text.split())

    found = PERIOD.search(flat)
    if found is None:
        raise AccountError(400, "No encontramos el periodo (del … al cierre de …) en el estado de cuenta")
    date_from, closing = _date(found.group(1)), _date(found.group(2))
    if (m := LIMIT.search(flat)) is None:
        raise AccountError(400, "No encontramos la línea de crédito en el estado de cuenta")
    limit, available, used = (_amount(g) for g in m.groups())
    date_due = _date(m.group(1)) if (m := DUE.search(flat)) else None
    last4 = m.group(1) if (m := LAST4.search(text)) else None
    billed = {"PEN": _amount(m.group(1)), "USD": _amount(m.group(2))} if (m := BILLED.search(flat)) else {}

    moves: list[ParsedLine] = []
    payments: list[ParsedLine] = []
    fees: list[ParsedLine] = []
    plans: list[ParsedInstallment] = []
    pending: dict[str, Decimal] = {"PEN": Decimal("0.00"), "USD": Decimal("0.00")}
    subtotals: dict[str, dict[str, Decimal]] = {}     # sección → moneda → subtotal
    unread: list[str] = []
    section: str | None = None
    usd_col = None          # dónde empieza la columna US$ de la sección (para una fila con un solo monto)
    want_subtotal = False

    for raw in lines:
        line = raw.rstrip()
        t = " ".join(line.split())
        if not t:
            continue
        if t.startswith(("PAGO DEL MES", "PAGO MÍNIMO DEL MES")):
            section = None
            continue
        head = next((k for k in SECTIONS if t.startswith(k)), None)
        if head is not None:
            section, want_subtotal = SECTIONS[head], False
            usd_col = line.find("US$") if "US$" in line else None
            continue
        if section is None:
            continue
        if "S/" in line and "US$" in line and not re.match(rf"\s*{DAY}", line):
            usd_col = line.find("US$")        # la cabecera de columnas puede ir en la línea del titular
            continue
        if t == "SUBTOTAL":
            want_subtotal = True
            continue
        if want_subtotal:
            nums = re.findall(NUM, line)
            if not nums:
                continue                      # la línea de guiones
            sub = subtotals.setdefault(section, {"PEN": Decimal(0), "USD": Decimal(0)})
            sub["PEN"] += _amount(nums[0])
            if len(nums) > 1:
                sub["USD"] += _amount(nums[1])
            want_subtotal = False
            continue

        if section == "plan":
            m = PLAN.match(line)
            if not m:
                if re.match(rf"\s*{DAY}", line):
                    unread.append(t)
                continue                      # el resto del nombre del comercio, en la línea de abajo
            g = m.groups()
            usd = g[10] is not None and _amount(g[10]) != 0
            cur = "USD" if usd else "PEN"
            n, left = int(g[2]), int(g[3])
            total = _amount(g[10] if usd else g[9])
            try:
                on = _day(g[0], closing)
            except ValueError:
                unread.append(t)
                continue
            name, seq = _name(g[1]), n - left
            plans.append(ParsedInstallment(on, name, cur, _amount(g[5]), seq, n, _amount(g[7]), _amount(g[8]), total))
            pending[cur] += _amount(g[6])
            # La cuota del mes también es un movimiento del ciclo, como en el BCP y el BBVA: en su corte
            moves.append(ParsedLine(closing, f"Cuota {seq}/{n} {name}", total, cur))
            continue

        m = MOVE.match(line)
        # Un monto mal leído («125.O0») se pegaría al nombre y la fila quedaría con el «0.00» de la otra
        # moneda: si el nombre termina en algo que parece un monto, la fila no se pudo leer
        if not m or BROKEN.search(m.group(2)):
            if re.match(rf"\s*{DAY}", line):
                unread.append(t)
            continue
        try:
            on = _day(m.group(1), closing)
        except ValueError:
            unread.append(t)
            continue
        if m.group(4) is not None:
            pairs = [("PEN", _amount(m.group(3))), ("USD", _amount(m.group(4)))]
        else:                                 # un solo monto: su moneda es la de la columna donde cae
            col = line.rfind(m.group(3))
            pairs = [("USD" if usd_col is not None and col >= usd_col - 2 else "PEN", _amount(m.group(3)))]
        name = _name(m.group(2))
        for cur, v in pairs:
            if v == 0:
                continue
            if section == "payments":
                payments.append(ParsedLine(on, name, v, cur, "payment"))
            elif section == "fees":
                fees.append(ParsedLine(on, name.capitalize(), v, cur, "fee"))
            else:
                moves.append(ParsedLine(on, name, v, cur))

    if not billed and not subtotals:
        raise AccountError(400, "No encontramos el detalle del pago del mes en el estado de cuenta")

    lines_out = moves + payments + fees
    currencies = []
    for c in ("PEN", "USD"):
        if c not in billed and not any(x.currency == c for x in lines_out):
            continue
        parts = [subtotals[s][c] for s in ("moves", "plan") if s in subtotals]
        currencies.append(ParsedCurrency(c, sum(parts, Decimal(0)) if parts else None, billed.get(c),
                                         pending[c] if plans else None))
    lines_out.sort(key=lambda x: x.date)
    return ParsedStatement("Interbank", last4, date_from, closing, date_due, limit, used, available, currencies,
                           lines_out, plans, unread)
