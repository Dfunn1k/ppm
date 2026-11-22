"""Lógica de la persona: sus datos y la configuración inicial (los 3 pasos)."""

import datetime as dt
from dataclasses import dataclass, field

import psycopg
from psycopg.types.json import Jsonb

from app.config import get_settings
from app.db import user_transaction


class SetupError(Exception):
    """setup_user rechazó los datos (país, moneda, idioma o zona desconocidos, o ya configurado)."""


@dataclass(frozen=True)
class CurrencyFormat:
    code: str                 # 'USD'
    symbol: str               # cómo se escribe en tu formato: 'US$'; sin fila en res_currency_format, el código
    decimals: int             # 0 en el yen o el peso chileno


# Los atajos de escritorio que se pueden cambiar y su tecla de fábrica. Esc, Ctrl + Enter y las
# flechas quedan fijas: son convenciones que todo programa respeta.
SHORTCUTS = {"register": "n", "search": "/", "edit": "e", "help": "?"}


class ShortcutError(Exception):
    pass


def shortcut_map(saved: dict[str, str] | None) -> dict[str, str]:
    return {**SHORTCUTS, **{k: v for k, v in (saved or {}).items() if k in SHORTCUTS}}


@dataclass(frozen=True)
class Me:
    id: int
    name: str
    email: str
    configured: bool          # ya pasó por los 3 pasos
    country: str | None       # 'PE'
    currency: str | None      # moneda base: 'PEN'
    lang: str | None          # 'es-PE'
    tz: str
    ui_theme: str
    ui_accent: str
    currencies: list[str]     # todas las que usa, la base primero
    is_admin: bool = False    # está en ADMIN_EMAILS: ve y corrige el tipo de cambio (Z1)
    notice_days: int = 3      # Pendientes: con cuántos días avisan el pago de tarjeta y los vencimientos
    ui_private: bool = False  # modo privado: los montos del Inicio escondidos
    home_account_id: int | None = None   # la cuenta con que arranca el + fuera de una cuenta; None = elegirla cada vez
    lock_date: dt.date | None = None     # cierre de periodo: nada con fecha hasta ese día se toca
    icons: list[str] = field(default_factory=list)   # los íconos de sus categorías y cuentas (la fuente a la medida)
    formats: list[CurrencyFormat] = field(default_factory=list)   # cómo se escribe cada moneda que usa
    google_email: str | None = None   # la cuenta de Google con que entra, si la vinculó
    has_password: bool = True         # False si creó la cuenta con Google y aún no tiene contraseña
    shortcuts: dict[str, str] = field(default_factory=lambda: dict(SHORTCUTS))   # tecla de cada atajo
    shortcut_hints: bool = True       # mostrar las pistas de los atajos en la pantalla
    home_budget: bool = True          # la tarjeta del presupuesto en el Inicio


def get_me(user_id: int) -> Me:
    with user_transaction(user_id) as conn:
        row = conn.execute("""
            SELECT u.id, u.name, u.login, u.currency_id IS NOT NULL, co.code, trim(cur.name), l.code,
                   u.tz, u.ui_theme, u.ui_accent,
                   coalesce((SELECT array_agg(trim(c.name) ORDER BY c.id <> u.currency_id, c.name)
                               FROM res_users_currency uc JOIN res_currency c ON c.id = uc.currency_id),
                            '{}'),
                   u.notice_days, u.ui_private,
                   (SELECT a.id FROM account_account a WHERE a.id = u.home_account_id AND a.active),
                   u.lock_date,
                   coalesce((SELECT array_agg(DISTINCT a.icon ORDER BY a.icon) FROM account_account a
                              WHERE a.icon IS NOT NULL), '{}'),
                   coalesce((SELECT array_agg(ARRAY[trim(c.name), coalesce(f.symbol, trim(c.name)), c.decimal_places::text]
                                              ORDER BY c.id <> u.currency_id, c.name)
                               FROM res_users_currency uc JOIN res_currency c ON c.id = uc.currency_id
                               LEFT JOIN res_currency_format f ON f.currency_id = c.id AND f.lang_id = u.lang_id),
                            '{}'),
                   u.oauth_email, u.password IS NOT NULL, u.ui_shortcuts, u.ui_shortcut_hints, u.home_budget
              FROM res_users u
              LEFT JOIN res_country co  ON co.id = u.country_id
              LEFT JOIN res_currency cur ON cur.id = u.currency_id
              LEFT JOIN res_lang l      ON l.id = u.lang_id
        """).fetchone()
    return Me(*row[:10], currencies=list(row[10]), is_admin=row[2].lower() in get_settings().admin_emails,
              notice_days=row[11], ui_private=row[12], home_account_id=row[13], lock_date=row[14],
              icons=list(row[15]), formats=[CurrencyFormat(c, s, int(d)) for c, s, d in row[16]],
              google_email=row[17], has_password=row[18], shortcuts=shortcut_map(row[19]), shortcut_hints=row[20],
              home_budget=row[21])


def update(user_id: int, name: str | None, ui_theme: str | None, ui_accent: str | None,
           notice_days: int | None = None, ui_private: bool | None = None, home_budget: bool | None = None) -> Me:
    """Lo que la persona cambia de sí misma: su nombre, cómo se ve PPM y con cuánto aviso."""
    with user_transaction(user_id) as conn:
        conn.execute(
            "UPDATE res_users SET name = coalesce(%s, name), ui_theme = coalesce(%s, ui_theme),"
            " ui_accent = coalesce(%s, ui_accent), notice_days = coalesce(%s, notice_days),"
            " ui_private = coalesce(%s, ui_private), home_budget = coalesce(%s, home_budget)",
            (name.strip() if name else None, ui_theme, ui_accent, notice_days, ui_private, home_budget))
    return get_me(user_id)


def set_shortcuts(user_id: int, changes: dict[str, str] | None, hints: bool | None) -> None:
    """Cambiar teclas (solo una letra, número o símbolo; dos atajos no comparten tecla) o, con
    changes = {}, volver a las de fábrica. hints prende o apaga las pistas en la pantalla."""
    with user_transaction(user_id) as conn:
        if changes is not None:
            saved = conn.execute("SELECT ui_shortcuts FROM res_users").fetchone()[0]
            wanted = shortcut_map(saved) if changes else dict(SHORTCUTS)
            for action, key in changes.items():
                if action not in SHORTCUTS:
                    raise ShortcutError("Ese atajo no se puede cambiar")
                if len(key) != 1 or not key.isprintable() or key.isspace():
                    raise ShortcutError("Elige una sola tecla: una letra, un número o un símbolo")
                wanted[action] = key.lower()
            if len(set(wanted.values())) != len(wanted):
                raise ShortcutError("Esa tecla ya la usa otro atajo")
            own = {k: v for k, v in wanted.items() if SHORTCUTS[k] != v}
            conn.execute("UPDATE res_users SET ui_shortcuts = %s", (Jsonb(own),))
        if hints is not None:
            conn.execute("UPDATE res_users SET ui_shortcut_hints = %s", (hints,))


def setup(user_id: int, country: str, other_currencies: list[str], lang: str | None, tz: str | None) -> Me:
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                conn.execute("SELECT setup_user(%s, %s, %s, %s)", (country, other_currencies, lang, tz))
        except psycopg.errors.RaiseException as e:
            raise SetupError(e.diag.message_primary) from None
    return get_me(user_id)


@dataclass(frozen=True)
class Option:
    code: str
    name: str


@dataclass(frozen=True)
class Bank:
    id: int
    name: str
    cci_code: str | None     # con qué empieza su CCI: '002'


@dataclass(frozen=True)
class CurrencyOption:
    code: str
    name: str
    decimals: int


@dataclass(frozen=True)
class Catalog:
    countries: list[Option]
    currencies: list[CurrencyOption]
    langs: list[Option]
    banks: list[Bank]        # los del país de la persona


def get_catalog(user_id: int) -> Catalog:
    with user_transaction(user_id) as conn:
        q = lambda sql: [Option(*r) for r in conn.execute(sql)]  # noqa: E731
        return Catalog(
            countries=q("SELECT code, name FROM res_country ORDER BY name"),
            currencies=[CurrencyOption(*r) for r in conn.execute(
                "SELECT trim(name), full_name, decimal_places FROM res_currency ORDER BY full_name")],
            langs=q("SELECT code, name FROM res_lang ORDER BY name"),
            banks=[Bank(*r) for r in conn.execute(
                "SELECT b.id, b.name, b.cci_code FROM res_bank b"
                " WHERE b.country_id = coalesce((SELECT country_id FROM res_users), b.country_id)"
                " ORDER BY b.name")],
        )


class CurrencyError(Exception):
    """No se puede agregar o quitar esa moneda (desconocida, la principal o con cuentas)."""


@dataclass(frozen=True)
class MyCurrency:
    code: str
    name: str                 # 'Dólar estadounidense'
    symbol: str
    decimals: int
    base: bool                # la moneda principal: no se quita
    accounts: list[str]       # las cuentas en esa moneda (con ellas no se quita)
    rate: str | None          # de dónde sale su tipo de cambio: 'SUNAT', 'manual' o None (todavía no hay)


def my_currencies(user_id: int) -> list[MyCurrency]:
    """Más › Monedas y formato: la principal y las demás, con sus cuentas y su tipo de cambio."""
    with user_transaction(user_id) as conn:
        rows = conn.execute("""
            SELECT trim(c.name), c.full_name, coalesce(f.symbol, trim(c.name)), c.decimal_places,
                   c.id = u.currency_id,
                   coalesce((SELECT array_agg(a.name ORDER BY a.name) FROM account_account a
                              WHERE a.currency_id = c.id AND a.active AND a.system_role IS NULL
                                AND a.account_type IN ('asset', 'liability')), '{}'),   -- las tuyas, no las de la app
                   (SELECT r.source FROM res_currency_rate r WHERE r.currency_id = c.id
                     ORDER BY r.name DESC LIMIT 1)
              FROM res_users_currency uc
              JOIN res_currency c ON c.id = uc.currency_id
              CROSS JOIN res_users u
              LEFT JOIN res_currency_format f ON f.currency_id = c.id AND f.lang_id = u.lang_id
             ORDER BY c.id <> u.currency_id, c.name""").fetchall()
    return [MyCurrency(code, name, sym, dec, base, list(accs), rate) for code, name, sym, dec, base, accs, rate in rows]


def add_currency(user_id: int, code: str) -> None:
    with user_transaction(user_id) as conn:
        found = conn.execute("SELECT id FROM res_currency WHERE name = upper(%s)", (code,)).fetchone()
        if not found:
            raise CurrencyError(f"No conozco la moneda {code}")
        conn.execute("INSERT INTO res_users_currency (currency_id) VALUES (%s) ON CONFLICT DO NOTHING", found)


def remove_currency(user_id: int, code: str) -> None:
    """Solo se quita si no es la principal y nada la usa: ni cuentas ni movimientos en esa moneda."""
    with user_transaction(user_id) as conn:
        row = conn.execute("""
            SELECT c.id, c.id = u.currency_id,
                   (SELECT array_agg(a.name ORDER BY a.name) FROM account_account a
                     WHERE a.currency_id = c.id AND a.account_type IN ('asset', 'liability')),
                   EXISTS (SELECT 1 FROM account_move_line l WHERE l.currency_id = c.id)
              FROM res_users_currency uc JOIN res_currency c ON c.id = uc.currency_id CROSS JOIN res_users u
             WHERE c.name = upper(%s)""", (code,)).fetchone()
        if not row:
            return
        cid, base, accounts, moved = row
        if base:
            raise CurrencyError("La moneda principal no se quita: todo tu historial está en ella")
        if accounts:
            raise CurrencyError(f"No se puede quitar: la usan {', '.join(accounts)}")
        if moved:
            raise CurrencyError("No se puede quitar: hay movimientos en esa moneda")
        conn.execute("DELETE FROM res_users_currency WHERE currency_id = %s", (cid,))


def set_lang(user_id: int, code: str) -> None:
    with user_transaction(user_id) as conn:
        if conn.execute("UPDATE res_users SET lang_id = l.id FROM res_lang l WHERE l.code = %s", (code,)).rowcount == 0:
            raise CurrencyError(f"No conozco el formato {code}")
