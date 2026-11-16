"""Etiquetas: post-its de colores que cruzan categorías («Viaje a Cusco» en el taxi, la comida y el
hotel). Van en el movimiento entero; lo que se arma solo (cuotas, partes repartidas y sus
cancelaciones) lleva las de la compra que lo originó (tag_source en la base). No cambian saldos."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

import psycopg

from app.accounts import AccountError
from app.db import user_transaction

ZERO = Decimal("0.00")
MAX_PER_MOVE = 10


@dataclass(frozen=True)
class Tag:
    id: int
    name: str
    color: int
    active: bool
    moves: int                    # cuántos movimientos la llevan (sin contar los heredados)


@dataclass(frozen=True)
class TagRef:
    id: int
    name: str
    color: int


def _translate(e: psycopg.Error) -> AccountError:
    if isinstance(e, psycopg.errors.UniqueViolation):
        return AccountError(400, "Ya tienes una etiqueta con ese nombre")
    if isinstance(e, psycopg.errors.CheckViolation):
        return AccountError(400, "El nombre va de 1 a 40 letras y el color, de la paleta")
    raise e


def list_tags(user_id: int) -> list[Tag]:
    with user_transaction(user_id) as conn:
        return [Tag(*r) for r in conn.execute("""
            SELECT t.id, t.name, t.color, t.active, count(r.account_move_id)
              FROM account_tag t LEFT JOIN account_move_account_tag_rel r ON r.account_tag_id = t.id
             GROUP BY t.id ORDER BY t.active DESC, lower(t.name)""")]


def any_tags(user_id: int) -> bool:
    with user_transaction(user_id) as conn:
        return conn.execute("SELECT EXISTS (SELECT 1 FROM account_move_account_tag_rel)").fetchone()[0]


def create_tag(user_id: int, name: str, color: int | None) -> Tag:
    name = name.strip()
    if not name:
        raise AccountError(400, "Ponle un nombre")
    with user_transaction(user_id) as conn:
        if color is None:   # sin elegir: el siguiente de la paleta (sin el gris), para que se distingan
            color = conn.execute("SELECT count(*) % 11 + 1 FROM account_tag").fetchone()[0]
        try:
            with conn.transaction():
                tid = conn.execute("INSERT INTO account_tag (name, color) VALUES (%s, %s) RETURNING id",
                                   (name, color)).fetchone()[0]
        except psycopg.Error as e:
            raise _translate(e) from None
    return Tag(tid, name, color, True, 0)


def update_tag(user_id: int, tag_id: int, name: str | None, color: int | None, active: bool | None) -> None:
    if name is not None and not name.strip():
        raise AccountError(400, "Ponle un nombre")
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                row = conn.execute("""
                    UPDATE account_tag SET name = coalesce(%s, name), color = coalesce(%s, color),
                                           active = coalesce(%s, active)
                     WHERE id = %s RETURNING id""",
                                   (name.strip() if name is not None else None, color, active, tag_id)).fetchone()
        except psycopg.Error as e:
            raise _translate(e) from None
    if row is None:
        raise AccountError(404, "No encontramos esa etiqueta")


def delete_tag(user_id: int, tag_id: int) -> None:
    """La quita de sus movimientos; los movimientos no se tocan."""
    with user_transaction(user_id) as conn:
        if conn.execute("DELETE FROM account_tag WHERE id = %s RETURNING id", (tag_id,)).fetchone() is None:
            raise AccountError(404, "No encontramos esa etiqueta")


# --- En un movimiento -----------------------------------------------------------------------------

def write_tags(conn: psycopg.Connection, move_id: int, tag_ids: list[int]) -> None:
    """Deja en el movimiento exactamente estas etiquetas (dentro de la transacción de quien llama)."""
    wanted = list(dict.fromkeys(tag_ids))
    if len(wanted) > MAX_PER_MOVE:
        raise AccountError(400, f"Hasta {MAX_PER_MOVE} etiquetas por movimiento")
    if wanted:
        found = {r[0] for r in conn.execute("SELECT id FROM account_tag WHERE id = ANY(%s)", (wanted,))}
        if len(found) != len(wanted):
            raise AccountError(404, "No encontramos esa etiqueta")
    conn.execute("DELETE FROM account_move_account_tag_rel WHERE account_move_id = %s AND NOT account_tag_id = ANY(%s)",
                 (move_id, wanted))
    for t in wanted:
        conn.execute("INSERT INTO account_move_account_tag_rel (account_move_id, account_tag_id) VALUES (%s, %s)"
                     " ON CONFLICT DO NOTHING", (move_id, t))


def set_move_tags(user_id: int, move_id: int, tag_ids: list[int]) -> None:
    with user_transaction(user_id) as conn:
        source = conn.execute("SELECT tag_source(id) FROM account_move WHERE id = %s", (move_id,)).fetchone()
        if source is None:
            raise AccountError(404, "No encontramos ese movimiento")
        if source[0] != move_id:
            raise AccountError(400, "Esta parte lleva las etiquetas de su compra: cámbialas ahí")
        write_tags(conn, move_id, tag_ids)


def move_tags(conn: psycopg.Connection, move_id: int) -> tuple[list[TagRef], bool]:
    """Las etiquetas de un movimiento y si las hereda de la compra que lo originó."""
    rows = conn.execute("""
        SELECT t.id, t.name, t.color, v.inherited FROM account_move_tag_v v JOIN account_tag t ON t.id = v.tag_id
         WHERE v.move_id = %s ORDER BY lower(t.name)""", (move_id,)).fetchall()
    inherited = conn.execute("SELECT tag_source(%s) <> %s", (move_id, move_id)).fetchone()[0]
    return [TagRef(r[0], r[1], r[2]) for r in rows], bool(inherited)


# --- Reporte --------------------------------------------------------------------------------------

@dataclass(frozen=True)
class TagCategory:
    id: int
    name: str
    amount: Decimal


@dataclass(frozen=True)
class TagLine:
    id: int
    name: str
    color: int
    amount: Decimal               # lo gastado con ella: gastos menos lo que te devolvieron
    moves: int
    categories: list[TagCategory]


@dataclass(frozen=True)
class TagReport:
    period: str
    total: Decimal                # lo gastado con alguna etiqueta (un gasto con dos cuenta una vez)
    tags: list[TagLine]


def report(user_id: int, period: str) -> TagReport:
    """Lo gastado con cada etiqueta en el periodo, por categoría. Solo las líneas de gasto: la parte
    de otra persona y el dinero que salió de la cuenta no son gasto."""
    from app.reports import _period   # reports usa moves, y moves usa este módulo

    with user_transaction(user_id) as conn:
        p = _period(conn, period)
        rows = conn.execute("""
            SELECT v.tag_id, t.name, t.color, a.id, a.name, sum(l.balance), count(DISTINCT m.id)
              FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type = 'expense'
              JOIN account_move_tag_v v ON v.move_id = m.id
              JOIN account_tag t ON t.id = v.tag_id
             WHERE m.date >= %s AND m.date < %s
             GROUP BY v.tag_id, t.name, t.color, a.id, a.name""", (p.start, p.end)).fetchall()
        moves = dict(conn.execute("""
            SELECT v.tag_id, count(DISTINCT m.id) FROM account_move m
              JOIN account_move_tag_v v ON v.move_id = m.id
              JOIN account_move_line l ON l.move_id = m.id
              JOIN account_account a ON a.id = l.account_id AND a.account_type = 'expense'
             WHERE m.state = 'posted' AND m.date >= %s AND m.date < %s GROUP BY v.tag_id""",
                                  (p.start, p.end)).fetchall())
        total = conn.execute("""
            SELECT coalesce(sum(l.balance), 0) FROM account_move_line l
              JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
              JOIN account_account a ON a.id = l.account_id AND a.account_type = 'expense'
             WHERE m.date >= %s AND m.date < %s
               AND EXISTS (SELECT 1 FROM account_move_tag_v v WHERE v.move_id = m.id)""",
                             (p.start, p.end)).fetchone()[0]
    head: dict[int, tuple[str, int]] = {}
    cats: dict[int, list[TagCategory]] = defaultdict(list)
    for tag, name, color, acc, acc_name, amount, _ in rows:
        head[tag] = (name, color)
        if amount:
            cats[tag].append(TagCategory(acc, acc_name, amount))
    lines = []
    for tag, (name, color) in head.items():
        ks = sorted(cats[tag], key=lambda k: (-k.amount, k.name))
        amount = sum((k.amount for k in ks), ZERO)
        if amount or ks:
            lines.append(TagLine(tag, name, color, amount, moves.get(tag, 0), ks))
    lines.sort(key=lambda t: (-t.amount, t.name))
    return TagReport(period, total, lines)
