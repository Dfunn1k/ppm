"""Adjuntos de un movimiento: la boleta, el voucher o el recibo, en foto o PDF (ir.attachment de Odoo).

La ficha va en ir_attachment (res_model 'account.move') y el archivo en la carpeta de la persona del
almacén, guardado por su huella: la misma foto dos veces ocupa un solo lugar. Borrar el movimiento
borra sus fichas (trigger); el recolector borra los archivos que ya nadie usa."""

from dataclasses import dataclass
import datetime as dt

import psycopg

from app import filestore
from app.accounts import AccountError
from app.db import user_transaction
from app.statements import collect

MAX_BYTES = 5 * 1024 * 1024

# Lo que se acepta, reconocido por los primeros bytes (no por la extensión ni lo que diga el navegador)
_KINDS = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
]


@dataclass(frozen=True)
class Attachment:
    id: int
    name: str
    mimetype: str
    file_size: int
    create_date: dt.datetime


def _mimetype(content: bytes) -> str | None:
    for magic, mime in _KINDS:
        if content.startswith(magic):
            return mime
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content[4:8] == b"ftyp" and content[8:12] in (b"heic", b"heix", b"mif1", b"heif"):
        return "image/heic"
    return None


def _own_move(conn: psycopg.Connection, move_id: int) -> None:
    if conn.execute("SELECT 1 FROM account_move WHERE id = %s", (move_id,)).fetchone() is None:
        raise AccountError(404, "No encontramos ese movimiento")


def of_move(user_id: int, move_id: int) -> list[Attachment]:
    with user_transaction(user_id) as conn:
        _own_move(conn, move_id)
        rows = conn.execute("""
            SELECT id, name, mimetype, file_size, create_date FROM ir_attachment
             WHERE res_model = 'account.move' AND res_id = %s ORDER BY id""", (move_id,)).fetchall()
    return [Attachment(*r) for r in rows]


def add(user_id: int, move_id: int, content: bytes, name: str | None) -> Attachment:
    if len(content) > MAX_BYTES:
        raise AccountError(400, "El archivo pesa más de 5 MB: toma la foto con menos resolución o súbelo como PDF")
    if not content:
        raise AccountError(400, "El archivo está vacío")
    mime = _mimetype(content)
    if mime is None:
        raise AccountError(400, "Adjunta una foto (JPG, PNG, WEBP o HEIC) o un PDF")
    clean = (name or "").strip().replace("/", "-")[:120] or ("adjunto.pdf" if mime == "application/pdf" else "foto.jpg")
    with user_transaction(user_id) as conn:
        _own_move(conn, move_id)
        stored = filestore.save(user_id, content)
        row = conn.execute("""
            INSERT INTO ir_attachment (res_model, res_id, name, mimetype, file_size, checksum, store_fname)
            VALUES ('account.move', %s, %s, %s, %s, %s, %s)
            RETURNING id, name, mimetype, file_size, create_date""",
                           (move_id, clean, mime, stored.file_size, stored.checksum, stored.store_fname)).fetchone()
    return Attachment(*row)


def content(user_id: int, attachment_id: int) -> tuple[str, str, bytes]:
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT name, mimetype, store_fname FROM ir_attachment"
                           " WHERE id = %s AND res_model = 'account.move'", (attachment_id,)).fetchone()
    data = filestore.read(user_id, row[2]) if row else None
    if data is None:
        raise AccountError(404, "No encontramos ese adjunto")
    return row[0], row[1], data   # type: ignore[index]


def delete(user_id: int, attachment_id: int) -> None:
    """Borra la ficha; el movimiento queda igual. El archivo se va si ya nadie lo usa."""
    with user_transaction(user_id) as conn:
        if conn.execute("DELETE FROM ir_attachment WHERE id = %s AND res_model = 'account.move'",
                        (attachment_id,)).rowcount == 0:
            raise AccountError(404, "No encontramos ese adjunto")
    collect(user_id)
