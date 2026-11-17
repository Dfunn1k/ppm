"""Adjuntos de un movimiento: la boleta, el voucher o el recibo, en foto o PDF (ir.attachment de Odoo).

La ficha va en ir_attachment (res_model 'account.move') y el archivo en la carpeta de la persona del
almacén, guardado por su huella: la misma foto dos veces ocupa un solo lugar. Borrar el movimiento
borra sus fichas (trigger); el recolector borra los archivos que ya nadie usa."""

from dataclasses import dataclass
import datetime as dt

import psycopg

from app import filestore, previews
from app.accounts import AccountError
from app.db import user_transaction
from app.statements import collect

MAX_BYTES = 5 * 1024 * 1024            # un PDF
MAX_PHOTO_BYTES = 20 * 1024 * 1024     # una foto: se achica al guardarla, así que puede llegar pesada

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
    page_count: int | None = None   # un PDF: cuántas páginas tiene el visor


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
    """Los adjuntos de un movimiento, del más reciente al más antiguo."""
    with user_transaction(user_id) as conn:
        _own_move(conn, move_id)
        rows = conn.execute("""
            SELECT id, name, mimetype, file_size, create_date, page_count, store_fname FROM ir_attachment
             WHERE res_model = 'account.move' AND res_id = %s ORDER BY create_date DESC, id DESC""", (move_id,)).fetchall()
        out = []
        for *r, fname in rows:
            if r[2] == "application/pdf" and r[5] is None:      # un PDF de antes: se cuenta una vez
                data = filestore.read(user_id, fname)
                r[5] = _pages(data) if data else None
                conn.execute("UPDATE ir_attachment SET page_count = %s WHERE id = %s", (r[5], r[0]))
            out.append(Attachment(*r))
    return out


def _pages(content: bytes) -> int | None:
    try:
        return previews.page_count(content)
    except Exception:  # noqa: BLE001 — un PDF dañado igual se puede descargar
        return None


def add(user_id: int, move_id: int, content: bytes, name: str | None) -> Attachment:
    if not content:
        raise AccountError(400, "El archivo está vacío")
    mime = _mimetype(content)
    if mime is None:
        raise AccountError(400, "Adjunta una foto (JPG, PNG, WEBP o HEIC) o un PDF")
    if mime == "application/pdf" and len(content) > MAX_BYTES:
        raise AccountError(400, "El PDF pesa más de 5 MB: descárgalo del banco con menos páginas")
    if len(content) > MAX_PHOTO_BYTES:
        raise AccountError(400, "La foto pesa más de 20 MB: tómala con menos resolución")
    clean = (name or "").strip().replace("/", "-")[:120] or ("adjunto.pdf" if mime == "application/pdf" else "foto.jpg")
    if mime in previews.PHOTOS:
        # Como Odoo: la foto se guarda achicada; el nombre lleva la extensión de lo que de verdad es
        content, shrunk = previews.shrink(content, mime)
        if shrunk != mime:
            mime, clean = shrunk, f"{clean.rsplit('.', 1)[0] if '.' in clean else clean}.webp"
    with user_transaction(user_id) as conn:
        _own_move(conn, move_id)
        stored = filestore.save(user_id, content)
        row = conn.execute("""
            INSERT INTO ir_attachment (res_model, res_id, name, mimetype, file_size, checksum, store_fname, page_count)
            VALUES ('account.move', %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, name, mimetype, file_size, create_date, page_count""",
                           (move_id, clean, mime, stored.file_size, stored.checksum, stored.store_fname,
                            _pages(content) if mime == "application/pdf" else None)).fetchone()
    return Attachment(*row)


def content(user_id: int, attachment_id: int) -> tuple[str, str, bytes]:
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT name, mimetype, store_fname FROM ir_attachment"
                           " WHERE id = %s AND res_model = 'account.move'", (attachment_id,)).fetchone()
    data = filestore.read(user_id, row[2]) if row else None
    if data is None:
        raise AccountError(404, "No encontramos ese adjunto")
    return row[0], row[1], data   # type: ignore[index]


def _source(user_id: int, attachment_id: int) -> tuple[str, str, int | None, bytes]:
    with user_transaction(user_id) as conn:
        row = conn.execute("SELECT checksum, mimetype, page_count, store_fname FROM ir_attachment"
                           " WHERE id = %s AND res_model = 'account.move'", (attachment_id,)).fetchone()
    data = filestore.read(user_id, row[3]) if row else None
    if data is None:
        raise AccountError(404, "No encontramos ese adjunto")
    return row[0], row[1], row[2], data   # type: ignore[index]


def thumbnail(user_id: int, attachment_id: int) -> bytes:
    """La miniatura WebP (la foto o la primera página del PDF), hecha una sola vez."""
    checksum, mime, _, data = _source(user_id, attachment_id)
    try:
        return filestore.derived(user_id, checksum, "thumb.webp", lambda: previews.thumbnail(data, mime))
    except Exception:  # noqa: BLE001 — un archivo que no se puede leer: la web muestra su ícono
        raise AccountError(415, "No se puede mostrar este adjunto: descárgalo") from None


def view(user_id: int, attachment_id: int, page: int = 1) -> tuple[bytes, str]:
    """Lo que muestra el visor: la foto (o su WebP si el navegador no la sabe mostrar) o una página."""
    checksum, mime, pages, data = _source(user_id, attachment_id)
    if mime == "application/pdf" and not 1 <= page <= (pages or 1):
        raise AccountError(404, "Ese PDF no tiene esa página")
    if mime in previews.SHOWABLE and len(data) <= previews.LIGHT:
        return data, mime
    kind = f"p{page}.webp" if mime == "application/pdf" else "view.webp"
    try:
        return filestore.derived(user_id, checksum, kind, lambda: previews.view(data, mime, page)[0]), "image/webp"
    except Exception:  # noqa: BLE001
        raise AccountError(415, "No se puede mostrar este adjunto: descárgalo") from None


def delete(user_id: int, attachment_id: int) -> None:
    """Borra la ficha; el movimiento queda igual. El archivo se va si ya nadie lo usa."""
    with user_transaction(user_id) as conn:
        if conn.execute("DELETE FROM ir_attachment WHERE id = %s AND res_model = 'account.move'",
                        (attachment_id,)).rowcount == 0:
            raise AccountError(404, "No encontramos ese adjunto")
    collect(user_id)
