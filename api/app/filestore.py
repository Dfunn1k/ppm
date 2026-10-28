"""Puerto de archivos: el almacén de adjuntos en el disco del servidor, como el filestore de Odoo.

Cada persona tiene su carpeta (FILESTORE_DIR/<user_id>/) y cada archivo se guarda según su huella
SHA-1 (ab/ab12…): la misma foto subida dos veces ocupa un solo lugar. La base guarda la ficha
(ir_attachment); aquí solo van los bytes. Pasar a S3 sería cambiar este módulo, no la lógica."""

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings


@dataclass(frozen=True)
class Stored:
    checksum: str        # SHA-1 en hexadecimal
    store_fname: str     # 'ab/ab12…', dentro de la carpeta de la persona
    file_size: int


def _folder(user_id: int) -> Path:
    return Path(get_settings().filestore_dir) / str(user_id)


def save(user_id: int, content: bytes) -> Stored:
    """Guarda el archivo (si ya estaba, no lo repite) y devuelve su ficha."""
    checksum = hashlib.sha1(content).hexdigest()
    fname = f"{checksum[:2]}/{checksum}"
    path = _folder(user_id) / fname
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(content)
        os.replace(tmp, path)          # nadie ve un archivo a medio escribir
    return Stored(checksum, fname, len(content))


def read(user_id: int, store_fname: str) -> bytes | None:
    path = _folder(user_id) / store_fname
    return path.read_bytes() if path.is_file() else None


def collect(user_id: int, in_use: set[str]) -> int:
    """Borra de la carpeta de la persona los archivos que ya ninguna ficha usa. Devuelve cuántos."""
    folder = _folder(user_id)
    if not folder.is_dir():
        return 0
    n = 0
    for path in folder.glob("??/*"):
        if path.is_file() and f"{path.parent.name}/{path.name}" not in in_use:
            path.unlink()
            n += 1
    return n
