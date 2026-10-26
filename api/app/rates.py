"""Tipo de cambio: el importador diario de SUNAT, lo que ve y corrige el administrador (Z1) y el
tipo del día que las pantallas usan como sugerencia.

El tipo es global y manda el último que se cargó, sea de SUNAT o a mano: si el administrador
corrige un día y luego se vuelve a traer de SUNAT, queda lo de SUNAT (como en Odoo)."""

import datetime as dt
import logging
import threading
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import psycopg

from app.config import get_settings
from app.db import admin_transaction, user_transaction

log = logging.getLogger("ppm.rates")
LIMA = ZoneInfo("America/Lima")       # SUNAT publica en hora de Perú
RUN_AT = dt.time(9, 0)                # una vez al día, por la mañana
RETRIES = 5                           # si falla, hasta 5 intentos más…
RETRY_WAIT = 30 * 60                  # …cada media hora
STALE_DAYS = 3                        # desde cuándo se avisa que está desactualizado


class RateError(Exception):
    """Algo que no se puede cargar; `status` dice por qué (400 o 502)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class RateDay:
    currency: str
    date: dt.date
    buy: Decimal
    sell: Decimal
    source: str                  # 'SUNAT' o 'manual'


@dataclass(frozen=True)
class CurrencyStatus:
    currency: str
    users: int                   # cuántas personas la usan
    last: RateDay | None         # el último tipo cargado
    loaded_at: dt.datetime | None
    days: int | None             # cuántos días tiene el último
    stale: bool                  # más de 3 días, o ninguno


@dataclass(frozen=True)
class AdminRates:
    currencies: list[CurrencyStatus]
    history: list[RateDay]       # los últimos días de cada moneda, el más reciente primero


@dataclass(frozen=True)
class UserRate:
    currency: str
    date: dt.date                # el día del tipo (puede ser anterior al pedido)
    buy: Decimal
    sell: Decimal
    stale: bool


# --- SUNAT ------------------------------------------------------------------------------------

def parse_sunat(text: str) -> RateDay:
    """El archivo de SUNAT es una sola línea: «25/10/2026|3.443|3.451|» (fecha|compra|venta|)."""
    parts = text.strip().split("|")
    try:
        day, buy, sell = parts[0], Decimal(parts[1]), Decimal(parts[2])
        on = dt.datetime.strptime(day.strip(), "%d/%m/%Y").date()
    except (IndexError, ValueError, InvalidOperation):
        raise RateError(502, f"SUNAT respondió algo que no entendemos: {text.strip()[:60]!r}") from None
    if buy <= 0 or sell < buy:
        raise RateError(502, f"SUNAT trajo un tipo raro: compra {buy}, venta {sell}")
    return RateDay("USD", on, buy, sell, "SUNAT")


def fetch_sunat() -> str:
    req = urllib.request.Request(get_settings().sunat_url, headers={"User-Agent": "PPM (pan para mayo)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:   # noqa: S310 (la URL es de la configuración)
            return r.read().decode("utf-8", errors="replace")
    except OSError as e:
        raise RateError(502, f"SUNAT no respondió: {e}") from None


def import_sunat(fetch: Callable[[], str] = fetch_sunat) -> RateDay:
    """Trae el tipo de SUNAT y lo carga. Los fines de semana y feriados el archivo trae el último
    día hábil: se vuelve a cargar ese día y no es una falla."""
    r = parse_sunat(fetch())
    with admin_transaction() as conn:
        conn.execute("SELECT set_currency_rate(%s, %s, %s, %s, 'SUNAT')", (r.currency, r.date, r.buy, r.sell))
    log.info("Tipo de cambio de SUNAT: %s compra %s venta %s", r.date, r.buy, r.sell)
    return r


def _loaded_today() -> bool:
    with admin_transaction() as conn:
        return conn.execute(
            "SELECT EXISTS (SELECT 1 FROM res_currency_rate"
            " WHERE (create_date AT TIME ZONE 'America/Lima')::date = (now() AT TIME ZONE 'America/Lima')::date)"
        ).fetchone()[0]


def import_with_retries(stop: threading.Event, fetch: Callable[[], str] = fetch_sunat,
                        retries: int = RETRIES, wait: float = RETRY_WAIT) -> RateDay | None:
    """Un intento y, si falla, hasta `retries` más. Sin éxito, queda el último tipo que hay."""
    for attempt in range(retries + 1):
        try:
            return import_sunat(fetch)
        except (RateError, psycopg.Error) as e:
            log.warning("Importador de SUNAT, intento %s de %s: %s", attempt + 1, retries + 1, e)
        if attempt < retries and stop.wait(wait):
            return None
    return None


def _seconds_until_next_run(now: dt.datetime) -> float:
    nxt = dt.datetime.combine(now.date(), RUN_AT, LIMA)
    if nxt <= now:
        nxt += dt.timedelta(days=1)
    return (nxt - now).total_seconds()


def run_daily(stop: threading.Event) -> None:
    """El importador: al arrancar, si hoy no se cargó nada; luego una vez al día a las 09:00 de Lima."""
    try:
        if not _loaded_today():
            import_with_retries(stop)
    except psycopg.Error as e:
        log.warning("Importador de SUNAT: no se pudo revisar la base: %s", e)
    while not stop.wait(_seconds_until_next_run(dt.datetime.now(LIMA))):
        import_with_retries(stop)


def start_daily() -> threading.Event:
    """Arranca el importador en un hilo aparte; poner el evento lo detiene."""
    stop = threading.Event()
    threading.Thread(target=run_daily, args=(stop,), name="importador-sunat", daemon=True).start()
    return stop


# --- El administrador (Z1) --------------------------------------------------------------------

def admin_overview(history_days: int = 10) -> AdminRates:
    with admin_transaction() as conn:
        rows = conn.execute("""
            SELECT s.currency, s.personas, s.ultima_fecha, r.rate_buy, r.rate_sell, s.source,
                   s.create_date, s.dias, s.desactualizado
              FROM res_currency_rate_status s
              LEFT JOIN res_currency c ON c.name = s.currency
              LEFT JOIN res_currency_rate r ON r.currency_id = c.id AND r.name = s.ultima_fecha
             ORDER BY s.personas DESC, s.currency""").fetchall()
        history = conn.execute("""
            SELECT trim(c.name), r.name, r.rate_buy, r.rate_sell, r.source
              FROM (SELECT *, row_number() OVER (PARTITION BY currency_id ORDER BY name DESC) AS n
                      FROM res_currency_rate) r
              JOIN res_currency c ON c.id = r.currency_id
             WHERE r.n <= %s
             ORDER BY c.name, r.name DESC""", (history_days,)).fetchall()
    return AdminRates(
        [CurrencyStatus(cur, users, RateDay(cur, on, buy, sell, src) if on else None, at, days, stale)
         for cur, users, on, buy, sell, src, at, days, stale in rows],
        [RateDay(*h) for h in history],
    )


def set_manual(currency: str, on: dt.date, buy: Decimal, sell: Decimal) -> RateDay:
    """Cargar o corregir a mano el tipo de un día (pisa lo que hubiera, incluso lo de SUNAT)."""
    if buy <= 0:
        raise RateError(400, "La compra tiene que ser mayor que cero")
    if sell < buy:
        raise RateError(400, "La venta no puede ser menor que la compra")
    try:
        with admin_transaction() as conn:
            conn.execute("SELECT set_currency_rate(%s, %s, %s, %s, 'manual')", (currency, on, buy, sell))
    except psycopg.errors.CheckViolation as e:
        raise RateError(400, e.diag.message_primary or "No se pudo guardar") from None
    return RateDay(currency.upper(), on, buy, sell, "manual")


# --- Para cada persona ------------------------------------------------------------------------

def user_rates(user_id: int, on: dt.date | None = None) -> list[UserRate]:
    """El tipo que vale para `on` (hoy si no se dice) en cada moneda de la persona que no es la base:
    el de ese día o el último anterior. Las que no tienen ninguno no aparecen."""
    with user_transaction(user_id) as conn:
        return [UserRate(*r) for r in conn.execute("""
            SELECT trim(c.name), r.name, r.rate_buy, r.rate_sell, user_today() - r.name > %s
              FROM res_users_currency uc
              JOIN res_users u ON true
              JOIN res_currency c ON c.id = uc.currency_id AND c.id <> u.currency_id
              JOIN LATERAL (SELECT name, rate_buy, rate_sell FROM res_currency_rate
                             WHERE currency_id = c.id AND name <= coalesce(%s, user_today())
                             ORDER BY name DESC LIMIT 1) r ON true
             ORDER BY c.name""", (STALE_DAYS, on))]
