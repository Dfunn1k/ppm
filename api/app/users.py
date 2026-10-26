"""Lógica de la persona: sus datos y la configuración inicial (los 3 pasos)."""

from dataclasses import dataclass

import psycopg

from app.db import user_transaction


class SetupError(Exception):
    """setup_user rechazó los datos (país, moneda, idioma o zona desconocidos, o ya configurado)."""


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


def get_me(user_id: int) -> Me:
    with user_transaction(user_id) as conn:
        row = conn.execute("""
            SELECT u.id, u.name, u.login, u.currency_id IS NOT NULL, co.code, trim(cur.name), l.code,
                   u.tz, u.ui_theme, u.ui_accent,
                   coalesce((SELECT array_agg(trim(c.name) ORDER BY c.id <> u.currency_id, c.name)
                               FROM res_users_currency uc JOIN res_currency c ON c.id = uc.currency_id),
                            '{}')
              FROM res_users u
              LEFT JOIN res_country co  ON co.id = u.country_id
              LEFT JOIN res_currency cur ON cur.id = u.currency_id
              LEFT JOIN res_lang l      ON l.id = u.lang_id
        """).fetchone()
    return Me(*row[:10], currencies=list(row[10]))


def update(user_id: int, name: str | None, ui_theme: str | None, ui_accent: str | None) -> Me:
    """Lo que la persona cambia de sí misma: su nombre y cómo se ve PPM."""
    with user_transaction(user_id) as conn:
        conn.execute(
            "UPDATE res_users SET name = coalesce(%s, name), ui_theme = coalesce(%s, ui_theme),"
            " ui_accent = coalesce(%s, ui_accent)", (name.strip() if name else None, ui_theme, ui_accent))
    return get_me(user_id)


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
class Catalog:
    countries: list[Option]
    currencies: list[Option]
    langs: list[Option]
    banks: list[Bank]        # los del país de la persona


def get_catalog(user_id: int) -> Catalog:
    with user_transaction(user_id) as conn:
        q = lambda sql: [Option(*r) for r in conn.execute(sql)]  # noqa: E731
        return Catalog(
            countries=q("SELECT code, name FROM res_country ORDER BY name"),
            currencies=q("SELECT trim(name), full_name FROM res_currency ORDER BY name"),
            langs=q("SELECT code, name FROM res_lang ORDER BY name"),
            banks=[Bank(*r) for r in conn.execute(
                "SELECT b.id, b.name, b.cci_code FROM res_bank b"
                " WHERE b.country_id = coalesce((SELECT country_id FROM res_users), b.country_id)"
                " ORDER BY b.name")],
        )
