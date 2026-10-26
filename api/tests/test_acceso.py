"""Acceso de punta a punta, a través de la API: crear cuenta, iniciar y cerrar sesión,
contraseñas y la configuración inicial. La API usa sus propias conexiones (confirma de verdad),
así que cada prueba usa correos @prueba.ppm y los borra al terminar."""

import re
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.conftest import owner_url
from app.mail import Mail, get_mailer
from app.main import app

PASSWORD = "pan-para-mayo-2026"


class FakeMailer:
    def __init__(self) -> None:
        self.sent: list[Mail] = []

    def send(self, mail: Mail) -> None:
        self.sent.append(mail)


@pytest.fixture
def mailer():
    fake = FakeMailer()
    app.dependency_overrides[get_mailer] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def borrar_usuarios_de_prueba():
    yield
    with psycopg.connect(owner_url()) as c:
        c.execute("DELETE FROM res_users WHERE login LIKE '%@prueba.ppm'")


def client() -> TestClient:
    return TestClient(app)


def email() -> str:
    return f"{uuid.uuid4().hex[:10]}@prueba.ppm"


def signup(c: TestClient, mail: str, name: str = "Dany") -> dict:
    r = c.post("/auth/signup", json={"name": name, "email": mail, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()


def test_crear_cuenta_deja_la_sesion_abierta():
    c, mail = client(), email()
    me = signup(c, mail)
    assert me["email"] == mail and me["name"] == "Dany" and me["configured"] is False
    assert "ppm_session" in c.cookies
    assert c.get("/me").json()["id"] == me["id"]


def test_la_cookie_es_httponly_y_lax():
    r = client().post("/auth/signup", json={"name": "Dany", "email": email(), "password": PASSWORD})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=2592000" in cookie


def test_un_correo_una_cuenta_sin_importar_mayusculas():
    mail = email()
    signup(client(), mail)
    r = client().post("/auth/signup", json={"name": "Otro", "email": mail.upper(), "password": PASSWORD})
    assert r.status_code == 409
    assert r.json()["detail"] == "Ese correo ya tiene una cuenta"


def test_contrasena_de_menos_de_8_se_rechaza():
    r = client().post("/auth/signup", json={"name": "Dany", "email": email(), "password": "corta"})
    assert r.status_code == 422


def test_iniciar_sesion():
    mail = email()
    signup(client(), mail)
    c = client()
    r = c.post("/auth/login", json={"email": mail.upper(), "password": PASSWORD})
    assert r.status_code == 200 and c.get("/me").status_code == 200


def test_mismo_mensaje_si_falla_el_correo_o_la_contrasena():
    mail = email()
    signup(client(), mail)
    mala = client().post("/auth/login", json={"email": mail, "password": "otra-cosa-123"})
    nadie = client().post("/auth/login", json={"email": email(), "password": PASSWORD})
    assert mala.status_code == nadie.status_code == 401
    assert mala.json() == nadie.json() == {"detail": "Correo o contraseña incorrectos"}


def test_sin_sesion_no_hay_datos():
    assert client().get("/me").status_code == 401
    c = client()
    c.cookies.set("ppm_session", "inventado")
    assert c.get("/me").status_code == 401


def test_configuracion_inicial():
    c = client()
    signup(c, email())
    r = c.post("/me/setup", json={"country": "PE", "other_currencies": ["USD"], "tz": "America/Lima"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["configured"] is True
    assert (me["country"], me["currency"], me["lang"]) == ("PE", "PEN", "es-PE")
    assert me["currencies"] == ["PEN", "USD"]          # la base primero

    otra = c.post("/me/setup", json={"country": "PE"})
    assert otra.status_code == 400 and "ya se hizo" in otra.json()["detail"]


def test_configuracion_con_pais_desconocido():
    c = client()
    signup(c, email())
    r = c.post("/me/setup", json={"country": "XX"})
    assert r.status_code == 400 and r.json()["detail"] == "País desconocido: XX"


def test_catalogo_para_los_pasos():
    c = client()
    signup(c, email())
    cat = c.get("/catalog").json()
    assert {"code": "PE", "name": "Perú"} in cat["countries"]
    assert {"code": "USD", "name": "Dólar estadounidense"} in cat["currencies"]
    assert client().get("/catalog").status_code == 401


def test_cerrar_sesion():
    c = client()
    signup(c, email())
    token = c.cookies["ppm_session"]
    assert c.post("/auth/logout").status_code == 204
    otra = client()
    otra.cookies.set("ppm_session", token)          # aunque alguien guardara la cookie
    assert otra.get("/me").status_code == 401


def test_cerrar_sesion_en_todos_lados():
    mail = email()
    celular, laptop = client(), client()
    signup(celular, mail)
    laptop.post("/auth/login", json={"email": mail, "password": PASSWORD})
    assert laptop.get("/me").status_code == 200

    assert celular.post("/auth/logout-all").status_code == 204
    assert laptop.get("/me").status_code == 401
    assert celular.get("/me").status_code == 401


def test_cambiar_contrasena_cierra_las_demas_sesiones():
    mail = email()
    aqui, alla = client(), client()
    signup(aqui, mail)
    alla.post("/auth/login", json={"email": mail, "password": PASSWORD})

    mal = aqui.post("/auth/password", json={"current_password": "no-es-esta", "new_password": "nueva-clave-99"})
    assert mal.status_code == 400

    ok = aqui.post("/auth/password", json={"current_password": PASSWORD, "new_password": "nueva-clave-99"})
    assert ok.status_code == 204
    assert aqui.get("/me").status_code == 200        # esta sigue
    assert alla.get("/me").status_code == 401        # la otra se cerró
    assert client().post("/auth/login", json={"email": mail, "password": "nueva-clave-99"}).status_code == 200


def test_la_sesion_vence(conn):
    c = client()
    me = signup(c, email())
    conn.execute("UPDATE res_users_session SET expires_at = now() - interval '1 second' WHERE user_id = %s",
                 (me["id"],))
    conn.commit()
    assert c.get("/me").status_code == 401


def test_recuperar_contrasena(mailer):
    mail = email()
    vieja = client()
    signup(vieja, mail)

    r = client().post("/auth/password-reset", json={"email": mail})
    assert r.status_code == 202
    assert len(mailer.sent) == 1 and mailer.sent[0].to == mail
    token = re.search(r"/restablecer\?token=(\S+)", mailer.sent[0].body).group(1)

    ok = client().post("/auth/password-reset/confirm", json={"token": token, "new_password": "otra-clave-77"})
    assert ok.status_code == 204
    assert vieja.get("/me").status_code == 401       # se cerraron todas las sesiones
    assert client().post("/auth/login", json={"email": mail, "password": "otra-clave-77"}).status_code == 200

    otra_vez = client().post("/auth/password-reset/confirm", json={"token": token, "new_password": "x" * 10})
    assert otra_vez.status_code == 400               # un solo uso


def test_recuperar_con_correo_sin_cuenta_responde_igual(mailer):
    r = client().post("/auth/password-reset", json={"email": email()})
    assert r.status_code == 202 and mailer.sent == []


def test_un_enlace_nuevo_anula_el_anterior(mailer):
    mail = email()
    signup(client(), mail)
    client().post("/auth/password-reset", json={"email": mail})
    client().post("/auth/password-reset", json={"email": mail})
    primero, segundo = (re.search(r"token=(\S+)", m.body).group(1) for m in mailer.sent)
    assert client().post("/auth/password-reset/confirm",
                         json={"token": primero, "new_password": "clave-nueva-1"}).status_code == 400
    assert client().post("/auth/password-reset/confirm",
                         json={"token": segundo, "new_password": "clave-nueva-1"}).status_code == 204


def test_la_base_guarda_huellas_no_secretos(conn):
    c = client()
    me = signup(c, email())
    pwd, token_guardado = conn.execute(
        "SELECT u.password, s.token_hash FROM res_users u JOIN res_users_session s ON s.user_id = u.id"
        " WHERE u.id = %s", (me["id"],)).fetchone()
    assert pwd.startswith("$argon2id$") and PASSWORD not in pwd
    assert token_guardado != c.cookies["ppm_session"] and len(token_guardado) == 64


def test_la_api_no_lee_sesiones_ni_enlaces_directo(conn):
    conn.execute("SET LOCAL ROLE ppm_app")
    for tabla in ("res_users_session", "res_users_token"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with conn.transaction():
                conn.execute(f"SELECT * FROM {tabla}")
