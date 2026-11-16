"""Exportar mis datos: un ZIP con todo lo que la persona registró, como pedirle al banco el historial
antes de cerrar la cuenta. Trae:

- datos.json: cada tabla con sus filas tal como las guarda PPM (el respaldo completo, fiel al modelo)
  y los catálogos a los que apuntan (monedas, bancos, países, idiomas).
- csv/: una tabla por archivo para abrir en Excel o Sheets, con nombres en vez de ids.
- adjuntos/: las fotos y PDF tal como se subieron (se pueden dejar fuera).

Las tablas salen de la base: todas las que tienen seguridad por fila, así una tabla nueva entra sola.
Se lee dentro de la transacción de la persona, que solo ve lo suyo. Los montos van con punto decimal
y las fechas en ISO (2026-11-15), para que cualquier programa los lea igual. No se guarda nada en
el servidor: el ZIP se arma en un archivo temporal y se entrega."""

from __future__ import annotations

import csv
from dataclasses import dataclass
import datetime as dt
from decimal import Decimal
import io
import json
import re
import tempfile
from typing import IO, Any
import zipfile
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from app import filestore
from app.db import user_transaction

FORMAT_VERSION = 1
HIDDEN = {"res_users": {"password"}}        # nunca sale: la huella de la contraseña
CATALOGS = ("res_currency", "res_bank", "res_country", "res_lang")
SPOOL = 16 * 1024 * 1024                    # hasta 16 MB en memoria; más, al disco temporal

README = """PPM · tus datos ({date})

datos.json   Todo lo que registraste, tabla por tabla, tal como lo guarda PPM: tu respaldo.
csv/         Una tabla por archivo, para abrir en Excel o Sheets (UTF-8, separado por comas).
adjuntos/    Las fotos y PDF que subiste, con el número del adjunto delante del nombre.

Montos con punto decimal y fechas como 2026-11-15.
En cuentas.csv va una fila por cuenta y moneda: una tarjeta con soles y dólares sale dos veces.
En movimientos.csv cada fila es una línea del movimiento: «monto» es positivo cuando entra a la
cuenta o categoría (un gasto suma en su categoría) y negativo cuando sale; las líneas de un mismo
movimiento suman cero en la moneda principal.
"""


@dataclass(frozen=True)
class Summary:
    accounts: int
    categories: int
    moves: int
    partners: int
    recurring: int
    attachments: int
    attachments_bytes: int


def summary(user_id: int) -> Summary:
    with user_transaction(user_id) as conn:
        return Summary(*conn.execute("""
            SELECT (SELECT count(*) FROM account_account WHERE account_type IN ('asset', 'liability')
                                                           AND system_role IS NULL),
                   (SELECT count(*) FROM account_account WHERE account_type IN ('income', 'expense')
                                                           AND system_role IS NULL AND parent_id IS NOT NULL),
                   (SELECT count(*) FROM account_move),
                   (SELECT count(*) FROM res_partner),
                   (SELECT count(*) FROM account_recurring),
                   (SELECT count(*) FROM ir_attachment),
                   (SELECT coalesce(sum(file_size), 0) FROM ir_attachment)""").fetchone())


def today(user_id: int) -> dt.date:
    with user_transaction(user_id) as conn:
        return _today(conn.execute("SELECT tz FROM res_users").fetchone()[0])


def _today(tz: str | None) -> dt.date:
    try:
        return dt.datetime.now(ZoneInfo(tz or "America/Lima")).date()
    except (KeyError, ValueError):
        return dt.datetime.now(ZoneInfo("America/Lima")).date()


def build(user_id: int, with_attachments: bool) -> IO[bytes]:
    """El ZIP, listo para leer desde el principio."""
    out = tempfile.SpooledTemporaryFile(max_size=SPOOL)
    with user_transaction(user_id) as c, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        conn = c.cursor(row_factory=dict_row)       # filas como dict solo aquí: la conexión vuelve al pool igual
        on = _today(conn.execute("SELECT tz FROM res_users").fetchone()["tz"])
        tables = _tables(conn)
        z.writestr("LEEME.txt", README.format(date=on.isoformat()))
        z.writestr("datos.json", json.dumps({
            "formato": "ppm-exportacion",
            "version": FORMAT_VERSION,
            "exportado": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            "con_adjuntos": with_attachments,
            "tablas": tables,
            "catalogos": {t: _rows(conn, t) for t in CATALOGS},
        }, ensure_ascii=False, indent=1, default=_plain))
        for name, (header, rows) in _sheets(c.cursor()).items():
            z.writestr(f"csv/{name}.csv", _csv(header, rows))
        if with_attachments:
            for a in tables.get("ir_attachment", []):
                content = filestore.read(user_id, a["store_fname"])
                if content is not None:      # una foto que ya no está en el disco no frena el resto
                    z.writestr(zipfile.ZipInfo(_in_zip(a), _zip_time(a["create_date"])), content,
                               compress_type=zipfile.ZIP_STORED)
    out.seek(0)
    return out


def _tables(conn: psycopg.Cursor) -> dict[str, list[dict[str, Any]]]:
    names = [r["relname"] for r in conn.execute("""
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY c.relname""")]
    return {t: _rows(conn, t) for t in names}


def _rows(conn: psycopg.Cursor, table: str) -> list[dict[str, Any]]:
    cols = [r["attname"] for r in conn.execute("""
        SELECT attname FROM pg_attribute WHERE attrelid = %s::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum""", (f"public.{table}",)) if r["attname"] not in HIDDEN.get(table, set())]
    order = "id" if "id" in cols else ", ".join(f'"{c}"' for c in cols[:3])
    select = ", ".join(f'"{c}"' for c in cols)
    return list(conn.execute(f'SELECT {select} FROM public."{table}" ORDER BY {order}'))  # noqa: S608 (nombres de pg_catalog)


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    if isinstance(v, (set, frozenset, tuple)):
        return list(v)
    raise TypeError(type(v).__name__)


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "sí" if v else "no"
    if isinstance(v, (list, tuple)):
        return " ".join(str(x) for x in v)
    return _plain(v) if isinstance(v, (Decimal, dt.date, dt.datetime)) else str(v)


def _csv(header: list[str], rows: list[tuple[Any, ...]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(header)
    w.writerows([_cell(v) for v in r] for r in rows)
    return buf.getvalue().encode("utf-8-sig")       # con BOM: Excel lee bien las tildes


def _in_zip(a: dict[str, Any]) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", a["name"]).strip(" .") or "archivo"
    return f"adjuntos/{a['id']}-{name}"


def _zip_time(t: dt.datetime | None) -> tuple[int, int, int, int, int, int]:
    t = t or dt.datetime(1980, 1, 1)
    return (max(t.year, 1980), t.month, t.day, t.hour, t.minute, t.second)


def _sheets(conn: psycopg.Cursor) -> dict[str, tuple[list[str], list[tuple[Any, ...]]]]:
    """Las tablas para Excel: nombres en vez de ids (filas como tuplas: dos columnas sin nombre no se pisan)."""
    def q(sql: str) -> list[tuple[Any, ...]]:
        return list(conn.execute(sql))

    return {
        "cuentas": (["id", "nombre", "tipo", "moneda", "saldo", "saldo en moneda principal", "activa", "creada"], q("""
            SELECT a.id, a.name,
                   CASE WHEN cc.account_id IS NOT NULL THEN 'Tarjeta de crédito'
                        WHEN l.account_id IS NOT NULL THEN 'Préstamo'
                        WHEN b.account_id IS NOT NULL THEN 'Cuenta bancaria'
                        WHEN a.account_type = 'asset' THEN 'Efectivo u otra'
                        ELSE 'Deuda' END,
                   trim(c.name), coalesce(s.amount_currency, 0), coalesce(s.balance, 0), a.active, a.create_date
            FROM account_account a
            LEFT JOIN account_balance s ON s.account_id = a.id
            LEFT JOIN res_currency c ON c.id = coalesce(s.currency_id, a.currency_id)
            LEFT JOIN account_credit_card cc ON cc.account_id = a.id
            LEFT JOIN account_loan l ON l.account_id = a.id
            LEFT JOIN res_partner_bank b ON b.account_id = a.id
            WHERE a.account_type IN ('asset', 'liability') AND a.system_role IS NULL
            ORDER BY a.id, c.name""")),
        "categorias": (["id", "nombre", "tipo", "grupo", "activa"], q("""
            SELECT a.id, a.name, CASE a.account_type WHEN 'expense' THEN 'Gasto' ELSE 'Ingreso' END, p.name, a.active
            FROM account_account a LEFT JOIN account_account p ON p.id = a.parent_id
            WHERE a.account_type IN ('income', 'expense') AND a.system_role IS NULL
            ORDER BY a.account_type, p.name NULLS FIRST, a.name""")),
        "movimientos": (["movimiento", "fecha", "referencia", "estado", "cuenta o categoría", "persona", "detalle",
                         "monto", "moneda", "monto en moneda principal", "etiquetas"], q("""
            SELECT m.id, m.date, m.ref, CASE m.state WHEN 'posted' THEN 'confirmado' ELSE 'por confirmar' END,
                   a.name, p.name, l.name, l.amount_currency, trim(c.name), l.balance,
                   (SELECT string_agg(t.name, ', ' ORDER BY lower(t.name)) FROM account_move_tag_v v
                      JOIN account_tag t ON t.id = v.tag_id WHERE v.move_id = m.id)
            FROM account_move_line l
            JOIN account_move m ON m.id = l.move_id
            JOIN account_account a ON a.id = l.account_id
            LEFT JOIN res_partner p ON p.id = l.partner_id
            LEFT JOIN res_currency c ON c.id = l.currency_id
            ORDER BY m.date, m.id, l.id""")),
        "etiquetas": (["id", "nombre", "color", "activa"], q("""
            SELECT id, name, color, active FROM account_tag ORDER BY lower(name)""")),
        "personas": (["id", "nombre", "correo", "teléfono", "activa", "creada"], q("""
            SELECT id, name, email, phone, active, create_date FROM res_partner ORDER BY name""")),
        "recurrentes": (["id", "nombre", "cada", "unidad", "desde", "hasta", "estado", "cuenta o categoría",
                         "persona", "monto", "moneda"], q("""
            SELECT r.id, r.name, r.interval_count,
                   CASE r.interval_type WHEN 'day' THEN 'día' WHEN 'week' THEN 'semana' WHEN 'month' THEN 'mes'
                                        ELSE 'año' END,
                   r.date_start, r.date_end,
                   CASE r.state WHEN 'active' THEN 'activa' WHEN 'paused' THEN 'en pausa' ELSE 'terminada' END,
                   a.name, p.name, rl.amount, trim(c.name)
            FROM account_recurring r
            JOIN account_recurring_line rl ON rl.recurring_id = r.id
            JOIN account_account a ON a.id = rl.account_id
            LEFT JOIN res_partner p ON p.id = rl.partner_id
            LEFT JOIN res_currency c ON c.id = r.currency_id
            ORDER BY r.id, rl.id""")),
        "tipos_de_cambio": (["fecha", "moneda", "compra", "venta", "fuente"], q("""
            SELECT r.name, trim(c.name), r.rate_buy, r.rate_sell, r.source
            FROM res_currency_rate r JOIN res_currency c ON c.id = r.currency_id
            WHERE r.currency_id IN (SELECT currency_id FROM res_users_currency)
              AND r.name >= coalesce((SELECT min(date) FROM account_move), current_date)
            ORDER BY r.name, c.name""")),
        "adjuntos": (["id", "nombre", "tipo", "bytes", "movimiento", "subido"], q("""
            SELECT id, name, mimetype, file_size, CASE WHEN res_model = 'account.move' THEN res_id END, create_date
            FROM ir_attachment ORDER BY id""")),
    }
