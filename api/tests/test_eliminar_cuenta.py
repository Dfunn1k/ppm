"""Eliminar mi cuenta (migración 0033): se ve lo que se va, se firma con la contraseña (o con el
correo, si entró solo con Google) y se borra todo al instante, también los archivos del disco y el
cierre de periodo no lo frena. Nadie más pierde nada. Y la página de privacidad, pública."""

from datetime import timedelta
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from tests.conftest import owner_url
from tests.test_adjuntos_api import JPG, subir
from tests.test_google import come_back, google_falsa  # noqa: F401
from tests.test_movimientos_api import HOY, Ana, borrar_usuarios_de_prueba  # noqa: F401

PASSWORD = "pan-para-mayo-2026"


def rows_of(user_id: int) -> int:
    """Cuántas filas quedan con su user_id en todas las tablas que lo tienen."""
    with psycopg.connect(owner_url()) as c:
        tables = [r[0] for r in c.execute(
            "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'"
            " AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')")]
        return sum(c.execute(f'SELECT count(*) FROM "{t}" WHERE user_id = %s', (user_id,)).fetchone()[0] for t in tables)


def test_se_ve_lo_que_se_va_y_se_borra_todo(google_falsa):  # noqa: F811
    ana, otra = Ana(), Ana()
    uid = ana.c.get("/me").json()["id"]
    fin_mes_pasado = HOY.replace(day=1) - timedelta(days=1)
    m = ana.register(kind="expense", account_id=ana.bcp, amount="40", date=(fin_mes_pasado - timedelta(days=2)).isoformat(),
                     splits=[{"category_id": ana.cat["Hogar"], "amount": "40"}])["summary"]["id"]
    subir(ana, m, JPG, "boleta.jpg")
    assert ana.c.put("/closing", json={"lock_date": fin_mes_pasado.isoformat()}).status_code == 200   # el cierre no frena
    folder = Path(get_settings().filestore_dir) / str(uid)
    assert folder.is_dir()

    d = ana.c.get("/me/deletion").json()
    assert d == {"accounts": 3, "moves": d["moves"], "attachments": 1, "recurring": 0} and d["moves"] >= 4

    r = ana.c.post("/me/delete", json={"password": "no-es-esta"})
    assert (r.status_code, r.json()["detail"]) == (400, "No es tu contraseña")
    assert ana.c.get("/me").status_code == 200

    assert ana.c.post("/me/delete", json={"password": PASSWORD}).status_code == 204
    assert ana.c.get("/me").status_code == 401          # la sesión se fue con la cuenta
    assert rows_of(uid) == 0 and not folder.exists()
    with psycopg.connect(owner_url()) as c:
        assert c.execute("SELECT count(*) FROM res_users WHERE id = %s", (uid,)).fetchone()[0] == 0
    # La otra persona sigue igual
    assert otra.c.get("/me").status_code == 200 and otra.balance(otra.bcp) == "1000.00"


def test_sin_contrasena_se_confirma_con_el_correo(google_falsa):  # noqa: F811
    c, mail = TestClient(app), "solo-google@prueba.ppm"
    come_back(c, "g-eliminar", mail)
    r = c.post("/me/delete", json={"email": "otro@prueba.ppm"})
    assert (r.status_code, r.json()["detail"]) == (400, "No es tu correo")
    assert c.post("/me/delete", json={"email": " Solo-Google@prueba.ppm "}).status_code == 204
    # La misma cuenta de Google puede volver a crear una cuenta nueva desde cero
    assert come_back(TestClient(app), "g-eliminar", mail) == "/bienvenida/1"


def test_con_contrasena_el_correo_no_basta():
    ana = Ana()
    mail = ana.c.get("/me").json()["email"]
    assert ana.c.post("/me/delete", json={"email": mail}).status_code == 400
    assert ana.c.get("/me").status_code == 200


def test_sin_sesion_no_se_borra_nada():
    assert TestClient(app).post("/me/delete", json={"password": PASSWORD}).status_code == 401


def test_la_privacidad_es_publica(monkeypatch):
    c = TestClient(app)
    monkeypatch.delenv("PRIVACY_EMAIL", raising=False)
    get_settings.cache_clear()
    assert c.get("/privacy").json() == {"contact_email": None}
    monkeypatch.setenv("PRIVACY_EMAIL", "privacidad@ejemplo.com")
    get_settings.cache_clear()
    assert c.get("/privacy").json() == {"contact_email": "privacidad@ejemplo.com"}
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _limpiar_google():
    yield
    with psycopg.connect(owner_url()) as c:
        c.execute("DELETE FROM res_users WHERE login = 'solo-google@prueba.ppm'")
