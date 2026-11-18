"""Lo que acompaña a cada fila de movimiento en las listas: sus etiquetas (también las heredadas de la
compra que lo originó) y cuántos adjuntos tiene. Una consulta para todos los movimientos de la lista."""

from __future__ import annotations

from collections import defaultdict

import psycopg

from app.tags import TagRef


def tags(conn: psycopg.Connection, move_ids: list[int]) -> dict[int, list[TagRef]]:
    out: dict[int, list[TagRef]] = defaultdict(list)
    if move_ids:
        for mid, tid, name, color in conn.execute("""
            SELECT v.move_id, t.id, t.name, t.color FROM account_move_tag_v v JOIN account_tag t ON t.id = v.tag_id
             WHERE v.move_id = ANY(%s) ORDER BY lower(t.name)""", (move_ids,)):
            out[mid].append(TagRef(tid, name, color))
    return out


def attachments(conn: psycopg.Connection, move_ids: list[int]) -> dict[int, int]:
    if not move_ids:
        return {}
    return dict(conn.execute("""
        SELECT res_id, count(*) FROM ir_attachment
         WHERE res_model = 'account.move' AND res_id = ANY(%s) GROUP BY res_id""", (move_ids,)).fetchall())
