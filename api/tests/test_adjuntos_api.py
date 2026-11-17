"""Adjuntos de un movimiento: la boleta en foto o PDF, verla, descargarla y borrarla."""

import io
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
        [("comprobante.pdf", "application/pdf"), ("boleta-plaza-vea.jpg", "image/jpeg")]   # el más reciente primero
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


def test_solo_fotos_de_hasta_20_mb_o_pdf_de_hasta_5_mb(ana: Ana):
    m = gasto(ana)
    r = subir(ana, m, b"hola, soy un texto", "nota.txt", status=400)
    assert r["detail"] == "Adjunta una foto (JPG, PNG, WEBP o HEIC) o un PDF"
    r = subir(ana, m, b"%PDF-1.7\n" + b"x" * (5 * 1024 * 1024), "enorme.pdf", status=400)
    assert "5 MB" in r["detail"]
    subir(ana, m, b"\xff\xd8\xff" + b"x" * (6 * 1024 * 1024), "pesada.jpg")          # una foto de 6 MB sí entra
    r = subir(ana, m, b"\xff\xd8\xff" + b"x" * (20 * 1024 * 1024), "enorme.jpg", status=400)
    assert "20 MB" in r["detail"]


def test_los_adjuntos_son_de_quien_los_sube(ana: Ana):
    m = gasto(ana)
    foto = subir(ana, m, JPG, "boleta.jpg")
    otra = Ana()
    assert otra.c.get(f"/attachments/{foto['id']}/file").status_code == 404
    assert otra.c.get(f"/moves/{m}/attachments").status_code == 404
    assert otra.c.post(f"/moves/{m}/attachments", files={"file": ("x.jpg", JPG)}).status_code == 404


# --- Miniaturas y visor (0030) ----------------------------------------------------------------

def _foto(fmt: str, size=(1200, 1600), exif_rotate=False, noise=False) -> bytes:
    from PIL import Image
    img = Image.effect_noise(size, 60).convert("RGB") if noise else Image.new("RGB", size, (232, 176, 75))
    out = io.BytesIO()
    if fmt == "HEIF":
        from pillow_heif import from_pillow
        from_pillow(img).save(out, format="HEIF")
    elif exif_rotate:
        exif = Image.Exif()
        exif[0x0112] = 6                                       # la cámara la tomó girada 90°
        img.save(out, fmt, exif=exif)
    else:
        img.save(out, fmt)
    return out.getvalue()


def _pdf(pages: int) -> bytes:
    from PIL import Image
    imgs = [Image.new("RGB", (600, 800), (255, 255, 255)) for _ in range(pages)]
    out = io.BytesIO()
    imgs[0].save(out, "PDF", save_all=True, append_images=imgs[1:])
    return out.getvalue()


def _size(content: bytes) -> tuple[int, int]:
    from PIL import Image
    return Image.open(io.BytesIO(content)).size


def test_la_miniatura_es_un_webp_liviano_y_se_guarda(ana: Ana):
    m = gasto(ana)
    foto = subir(ana, m, _foto("JPEG", exif_rotate=True), "boleta.jpg")
    r = ana.c.get(f"/attachments/{foto['id']}/thumb")
    assert (r.status_code, r.headers["content-type"]) == (200, "image/webp")
    assert "immutable" in r.headers["cache-control"]
    assert _size(r.content) == (360, 270)                       # girada según su EXIF, 360 px de lado mayor
    assert len(r.content) < 20_000
    uid = ana.c.get("/me").json()["id"]
    assert len(list((Path(get_settings().filestore_dir) / str(uid)).glob("derived/*.thumb.webp"))) == 1


def test_una_foto_heic_se_ve(ana: Ana):
    m = gasto(ana)
    heic = subir(ana, m, _foto("HEIF"), "IMG_0001.HEIC")
    assert (heic["name"], heic["mimetype"]) == ("IMG_0001.webp", "image/webp")      # se guarda ya convertida
    assert ana.c.get(f"/attachments/{heic['id']}/thumb").headers["content-type"] == "image/webp"
    r = ana.c.get(f"/attachments/{heic['id']}/view")
    assert (r.headers["content-type"], _size(r.content)) == ("image/webp", (1200, 1600))


def test_una_foto_grande_se_guarda_achicada_como_en_odoo(ana: Ana):
    m = gasto(ana)
    jpg = _foto("JPEG", size=(4000, 3000), exif_rotate=True, noise=True)
    a = subir(ana, m, jpg, "boleta.jpg")
    assert (a["name"], a["mimetype"]) == ("boleta.webp", "image/webp")
    assert a["file_size"] < len(jpg) / 3
    r = ana.c.get(f"/attachments/{a['id']}/file")
    assert _size(r.content) == (1440, 1920)                      # girada según su EXIF y de 1920 px a lo más
    from PIL import Image
    assert not Image.open(io.BytesIO(r.content)).getexif()      # sin EXIF: tampoco la ubicación


def test_una_foto_que_ya_es_liviana_va_tal_cual(ana: Ana):
    m = gasto(ana)
    png = _foto("PNG", size=(40, 40), noise=True)
    a = subir(ana, m, png, "captura.png")
    assert a["mimetype"] == "image/png"                          # en WebP pesaría más: se queda como está
    r = ana.c.get(f"/attachments/{a['id']}/view")
    assert (r.headers["content-type"], r.content) == ("image/png", png)


def test_una_foto_pesada_de_antes_se_ve_liviana(ana: Ana):
    from app import attachments, filestore
    m = gasto(ana)
    a = subir(ana, m, _foto("PNG", size=(40, 40), noise=True), "vieja.png")
    pesada = _foto("PNG", size=(2600, 2600), noise=True)         # como las subidas antes de achicarlas
    uid = ana.c.get("/me").json()["id"]
    nueva = filestore.save(uid, pesada)
    from app.db import user_transaction
    with user_transaction(uid) as conn:
        conn.execute("UPDATE ir_attachment SET checksum = %s, store_fname = %s, file_size = %s WHERE id = %s",
                     (nueva.checksum, nueva.store_fname, nueva.file_size, a["id"]))
    assert len(pesada) > attachments.previews.LIGHT
    r = ana.c.get(f"/attachments/{a['id']}/view")
    assert (r.headers["content-type"], max(_size(r.content))) == ("image/webp", 2000)
    assert ana.c.get(f"/attachments/{a['id']}/file").content == pesada   # descargar da lo guardado


def test_un_pdf_se_ve_pagina_por_pagina(ana: Ana):
    m = gasto(ana)
    pdf = subir(ana, m, _pdf(3), "estado.pdf")
    assert pdf["page_count"] == 3
    r = ana.c.get(f"/attachments/{pdf['id']}/view", params={"page": 2})
    assert (r.status_code, r.headers["content-type"]) == (200, "image/webp")
    assert max(_size(r.content)) == 2000
    assert ana.c.get(f"/attachments/{pdf['id']}/view", params={"page": 4}).status_code == 404
    assert _size(ana.c.get(f"/attachments/{pdf['id']}/thumb").content)[1] == 360


def test_un_archivo_que_no_se_puede_leer_se_descarga_igual(ana: Ana):
    m = gasto(ana)
    a = subir(ana, m, JPG, "rota.jpg")
    assert ana.c.get(f"/attachments/{a['id']}/thumb").status_code == 415
    assert ana.c.get(f"/attachments/{a['id']}/file").status_code == 200


def test_borrar_el_adjunto_se_lleva_su_miniatura(ana: Ana):
    m = gasto(ana)
    a = subir(ana, m, _foto("JPEG"), "boleta.jpg")
    ana.c.get(f"/attachments/{a['id']}/thumb")
    assert ana.c.delete(f"/attachments/{a['id']}").status_code == 204
    uid = ana.c.get("/me").json()["id"]
    assert list((Path(get_settings().filestore_dir) / str(uid)).glob("derived/*")) == []
