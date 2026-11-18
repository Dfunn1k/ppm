"""Lo que el navegador muestra de un adjunto, livianito y siempre igual de rápido:

- al subir una foto, como Odoo: se gira según su EXIF y se guarda en WebP de hasta 1920 px y calidad
  80 (unos 200–400 KB en vez de 1–4 MB); el original no se guarda (ver `shrink`);

- la miniatura: WebP de 360 px (la foto, o la primera página del PDF), para la tira y el visor;
- la vista: la foto tal cual si ya es liviana y el navegador la sabe mostrar (JPG, PNG, WEBP), o en
  WebP de hasta 2000 px si no (HEIC del iPhone, o una foto pesada subida antes de achicarlas); en un PDF, cada página como imagen, porque el celular no muestra
  PDFs dentro de la página.

Se generan la primera vez que se piden y se guardan en el almacén junto al archivo (ver filestore),
así que después salen del disco. Una foto se gira según su EXIF, como la tomó la cámara."""

import io

import pypdfium2 as pdfium
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

THUMB = 360           # px del lado mayor de la miniatura (112 px en pantalla, ×3 para pantallas densas)
VIEW = 2000           # px del lado mayor de una foto convertida o de una página de PDF
STORE = 1920          # px del lado mayor de una foto guardada (base.image_autoresize_max_px de Odoo)
LIGHT = 500 * 1024    # una foto que pesa hasta esto el visor la muestra tal cual
SHOWABLE = {"image/jpeg", "image/png", "image/webp"}
PHOTOS = SHOWABLE | {"image/heic"}


def _webp(img: Image.Image, size: int, quality: int) -> bytes:
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.thumbnail((size, size))
    out = io.BytesIO()
    img.save(out, "WEBP", quality=quality, method=4)
    return out.getvalue()


def _pdf_page(content: bytes, page: int, size: int) -> Image.Image:
    pdf = pdfium.PdfDocument(content)
    p = pdf[page - 1]
    w, h = p.get_size()
    return p.render(scale=size / max(w, h)).to_pil()


def page_count(content: bytes) -> int:
    return len(pdfium.PdfDocument(content))


def thumbnail(content: bytes, mimetype: str) -> bytes:
    if mimetype == "application/pdf":
        return _webp(_pdf_page(content, 1, THUMB * 2), THUMB, 70)
    return _webp(Image.open(io.BytesIO(content)), THUMB, 70)


def shrink(content: bytes, mimetype: str) -> tuple[bytes, str]:
    """La foto que se guarda: WebP de hasta 1920 px, girada y sin EXIF (tampoco la ubicación del GPS).
    Solo se toca la que lo necesita: más de 1920 px, más de 500 KB o HEIC (casi ningún navegador la
    muestra); una captura chica queda como está, sin perder nitidez. Si no se puede leer, va tal cual."""
    try:
        img = Image.open(io.BytesIO(content))
        if mimetype != "image/heic" and max(img.size) <= STORE and len(content) <= LIGHT:
            return content, mimetype
        small = _webp(img, STORE, 80)
    except Exception:  # noqa: BLE001 — una foto dañada se guarda igual y se puede descargar
        return content, mimetype
    if mimetype == "image/heic" or len(small) < len(content):
        return small, "image/webp"
    return content, mimetype


def view(content: bytes, mimetype: str, page: int = 1) -> tuple[bytes, str]:
    """La imagen que muestra el visor y su tipo. Una foto liviana que el navegador ya sabe mostrar va
    tal cual."""
    if mimetype == "application/pdf":
        return _webp(_pdf_page(content, page, VIEW), VIEW, 80), "image/webp"
    if mimetype in SHOWABLE and len(content) <= LIGHT:
        return content, mimetype
    return _webp(Image.open(io.BytesIO(content)), VIEW, 82), "image/webp"
