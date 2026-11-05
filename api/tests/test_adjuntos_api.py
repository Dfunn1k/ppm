"""Adjuntos de un movimiento: la boleta en foto o PDF, verla, descargarla y borrarla."""

from pathlib import Path

import pytest

from app.config import get_settings
from tests.test_movimientos_api import Ana, borrar_usuarios_de_prueba  # noqa: F401

JPG = b"\xff\xd8\xff\xe0" + b"boleta" * 100
PDF = b"%PDF-1.7\n" + b"comprobante" * 50


@pytest.fixture
def ana() -> Ana:
    return Ana()


def gasto(ana: Ana) -> int:
    return ana.register(kind="expense", account_id=ana.bcp, amount="186.40", ref="Plaza Vea",
                        splits=[{"category_id": ana.cat["Supermercado y mercado"], "amount": "186.40"}])["summary"]["id"]


def subir(ana: Ana, move: int, content: bytes, name: str, status: int = 201) -> dict:
    r = ana.c.post(f"/moves/{move}/attachments", files={"file": (name, content, "application/octet-stream")})
    assert r.status_code == status, r.text
    return r.json()


def stored(ana: Ana) -> list[Path]:
    uid = ana.c.get("/me").json()["id"]
    return list((Path(get_settings().filestore_dir) / str(uid)).glob("??/*"))


def test_adjuntar_ver_y_borrar(ana: Ana):
    m = gasto(ana)
    foto = subir(ana, m, JPG, "boleta-plaza-vea.jpg")
    pdf = subir(ana, m, PDF, "comprobante.pdf")
    assert [(a["name"], a["mimetype"]) for a in ana.c.get(f"/moves/{m}/attachments").json()] == \
        [("boleta-plaza-vea.jpg", "image/jpeg"), ("comprobante.pdf", "application/pdf")]
    assert foto["file_size"] == len(JPG)

    r = ana.c.get(f"/attachments/{foto['id']}/file")
    assert (r.status_code, r.content, r.headers["content-type"]) == (200, JPG, "image/jpeg")
    assert r.headers["content-disposition"].startswith("inline;")
    r = ana.c.get(f"/attachments/{pdf['id']}/file", params={"download": True})
    assert r.headers["content-disposition"].startswith("attachment;")

    assert ana.c.delete(f"/attachments/{foto['id']}").status_code == 204
    assert [a["name"] for a in ana.c.get(f"/moves/{m}/attachments").json()] == ["comprobante.pdf"]
    assert ana.c.get(f"/attachments/{foto['id']}/file").status_code == 404


def test_la_misma_foto_ocupa_un_solo_lugar_y_se_va_con_el_movimiento(ana: Ana):
    m, otro = gasto(ana), gasto(ana)
    subir(ana, m, JPG, "a.jpg")
    subir(ana, otro, JPG, "b.jpg")
    assert len(stored(ana)) == 1
    assert ana.c.delete(f"/moves/{m}").status_code == 204
    assert len(stored(ana)) == 1           # el otro movimiento todavía la usa
    assert ana.c.delete(f"/moves/{otro}").status_code == 204
    assert stored(ana) == []


def test_solo_fotos_o_pdf_de_hasta_5_mb(ana: Ana):
    m = gasto(ana)
    r = subir(ana, m, b"hola, soy un texto", "nota.txt", status=400)
    assert r["detail"] == "Adjunta una foto (JPG, PNG, WEBP o HEIC) o un PDF"
    r = subir(ana, m, b"\xff\xd8\xff" + b"x" * (5 * 1024 * 1024), "enorme.jpg", status=400)
    assert "5 MB" in r["detail"]


def test_los_adjuntos_son_de_quien_los_sube(ana: Ana):
    m = gasto(ana)
    foto = subir(ana, m, JPG, "boleta.jpg")
    otra = Ana()
    assert otra.c.get(f"/attachments/{foto['id']}/file").status_code == 404
    assert otra.c.get(f"/moves/{m}/attachments").status_code == 404
    assert otra.c.post(f"/moves/{m}/attachments", files={"file": ("x.jpg", JPG)}).status_code == 404
