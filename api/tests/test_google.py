"""Entrar con Google (migración 0032), de punta a punta contra una Google falsa: la ida guarda el
turno en una cookie, la vuelta crea la cuenta, entra, pide la contraseña para unir una cuenta que
ya existe o vincula desde Mi cuenta. Nadie se queda sin llave."""

import base64
import json
import time
import urllib.parse

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import google
from app.config import get_settings
from app.main import app
from tests.conftest import owner_url
from tests.test_acceso import PASSWORD, borrar_usuarios_de_prueba, email, signup  # noqa: F401

CLIENT_ID = "ppm-pruebas.apps.googleusercontent.com"


def jwt(claims: dict) -> str:
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{part({'alg': 'RS256'})}.{part(claims)}.firma"


@pytest.fixture(autouse=True)
def google_falsa(monkeypatch):
    """Google configurada y su token endpoint reemplazado: el «código» trae la cuenta elegida."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secreto")
    get_settings.cache_clear()
    calls: list[dict] = []

    def post_form(url: str, data: dict) -> dict:
        calls.append(data)
        claims = json.loads(base64.urlsafe_b64decode(data["code"]))
        return {"id_token": jwt(claims)}

    monkeypatch.setattr(google, "post_form", post_form)
    yield calls
    get_settings.cache_clear()


def start(c: TestClient, mode: str = "login") -> dict[str, str]:
    r = c.get("/auth/google/start", params={"mode": mode}, follow_redirects=False)
    assert r.status_code == 303, r.text
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r.headers["location"]).query))


def come_back(c: TestClient, sub: str, mail: str, mode: str = "login", name: str = "Ana Torres", **over):
    """Ida y vuelta: elige la cuenta `sub`/`mail` en la Google falsa. Devuelve el destino en la web."""
    q = start(c, mode)
    claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300,
              "nonce": q["nonce"], "sub": sub, "email": mail, "email_verified": True, "name": name} | over
    code = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode()
    r = c.get("/auth/google/callback", params={"code": code, "state": q["state"]}, follow_redirects=False)
    assert r.status_code == 303, r.text
    return r.headers["location"]


def test_la_ida_pide_solo_nombre_y_correo_con_pkce(google_falsa):
    c = TestClient(app)
    q = start(c)
    assert q["client_id"] == CLIENT_ID and q["scope"] == "openid email profile"
    assert q["redirect_uri"] == "http://localhost:5173/api/auth/google/callback"
    assert q["code_challenge_method"] == "S256" and q["state"] and q["nonce"]
    assert c.cookies.get("ppm_google")
    assert c.get("/auth/providers").json() == {"google": True}


def test_sin_configurar_no_hay_boton(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    get_settings.cache_clear()
    c = TestClient(app)
    assert c.get("/auth/providers").json() == {"google": False}
    assert c.get("/auth/google/start", follow_redirects=False).status_code == 404


def test_correo_nuevo_crea_la_cuenta_sin_contrasena():
    c, mail = TestClient(app), email()
    assert come_back(c, "g-1", mail) == "/bienvenida/1"
    me = c.get("/me").json()
    assert (me["email"], me["name"], me["google_email"], me["has_password"]) == (mail, "Ana Torres", mail, False)
    assert "ppm_google" not in c.cookies   # el turno sirve una vez

    # Otra vez con la misma Google: entra a la misma cuenta
    c2 = TestClient(app)
    assert come_back(c2, "g-1", mail) == "/bienvenida/1"
    assert c2.get("/me").json()["id"] == me["id"]
    # Con correo y contraseña no entra: no tiene
    assert c2.post("/auth/login", json={"email": mail, "password": PASSWORD}).status_code == 401


def test_correo_con_cuenta_pide_la_contrasena_para_unir():
    c, mail = TestClient(app), email()
    signup(c, mail)
    c.post("/auth/logout")
    g = TestClient(app)
    assert come_back(g, "g-2", mail.upper()) == "/entrar/google"
    assert g.get("/me").status_code == 401   # todavía no entra
    assert g.get("/auth/google/pending").json() == {"email": mail, "google_email": mail}

    r = g.post("/auth/google/pending", json={"password": "no-es-esta"})
    assert (r.status_code, r.json()["detail"]) == (401, "No es la contraseña de esa cuenta")
    r = g.post("/auth/google/pending", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    assert (r.json()["google_email"], r.json()["has_password"]) == (mail, True)
    assert g.post("/auth/google/pending", json={"password": PASSWORD}).status_code == 410   # una sola vez

    # Desde ahora entra directo con Google
    assert come_back(TestClient(app), "g-2", mail) == "/bienvenida/1"


def test_cancelar_o_un_turno_ajeno_vuelve_a_entrar():
    c = TestClient(app)
    start(c)
    r = c.get("/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert r.headers["location"].endswith("/entrar?google=cancelado")
    start(c)
    r = c.get("/auth/google/callback", params={"code": "x", "state": "otro"}, follow_redirects=False)
    assert r.headers["location"].endswith("/entrar?google=fallo")
    # Sin la cookie del turno (otra persona le pasó su enlace de vuelta)
    r = TestClient(app).get("/auth/google/callback", params={"code": "x", "state": "y"}, follow_redirects=False)
    assert r.headers["location"].endswith("/entrar?google=fallo")


@pytest.mark.parametrize("over", [{"aud": "otra-app"}, {"iss": "https://evil.example"}, {"exp": 1},
                                  {"nonce": "otro"}, {"email_verified": False}])
def test_el_id_token_se_valida(over):
    c = TestClient(app)
    assert come_back(c, "g-3", email(), **over) == "/entrar?google=fallo"
    assert c.get("/me").status_code == 401


def test_vincular_desde_mi_cuenta_con_otro_correo_y_desvincular():
    c, mail = TestClient(app), email()
    signup(c, mail)
    other = email()
    assert come_back(c, "g-4", other, mode="link") == "/mas/cuenta?google=vinculado"
    assert c.get("/me").json()["google_email"] == other
    assert come_back(TestClient(app), "g-4", other) == "/bienvenida/1"   # entra a la misma cuenta

    # Esa Google ya no puede vincularse a otra cuenta
    d = TestClient(app)
    signup(d, email())
    assert come_back(d, "g-4", other, mode="link") == "/mas/cuenta?google=en-uso"

    assert c.delete("/auth/google").status_code == 204
    assert c.get("/me").json()["google_email"] is None


def test_vincular_sin_sesion_no_empieza():
    r = TestClient(app).get("/auth/google/start", params={"mode": "link"}, follow_redirects=False)
    assert r.headers["location"].endswith("/entrar")


def test_el_turno_de_vincular_queda_atado_a_la_sesion():
    """Si al volver de Google la sesión es otra, no se vincula a nadie."""
    c, mail = TestClient(app), email()
    signup(c, mail)
    q = start(c, "link")
    d = TestClient(app)   # otra persona, con su propia sesión, recibe el turno de c
    signup(d, email())
    d.cookies.set("ppm_google", c.cookies["ppm_google"])
    claims = {"iss": "accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300, "nonce": q["nonce"],
              "sub": "g-5", "email": "x@prueba.ppm", "email_verified": True}
    code = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode()
    r = d.get("/auth/google/callback", params={"code": code, "state": q["state"]}, follow_redirects=False)
    assert r.headers["location"].endswith("/mas/cuenta?google=fallo")
    assert c.get("/me").json()["google_email"] is None and d.get("/me").json()["google_email"] is None


def test_sin_contrasena_no_se_desvincula_hasta_crearla():
    c, mail = TestClient(app), email()
    come_back(c, "g-6", mail)
    r = c.delete("/auth/google")
    assert (r.status_code, r.json()["detail"]) == (409, "Primero crea una contraseña: sin ella no tendrías cómo entrar")
    assert c.post("/auth/password", json={"new_password": PASSWORD}).status_code == 204   # crearla: sin «actual»
    assert c.get("/me").json()["has_password"] is True
    assert c.post("/auth/password", json={"new_password": "otra-clave-larga"}).status_code == 400   # ya pide la actual
    assert c.delete("/auth/google").status_code == 204
    assert TestClient(app).post("/auth/login", json={"email": mail, "password": PASSWORD}).status_code == 200


def test_correo_unido_a_otra_google_no_se_pisa():
    c, mail = TestClient(app), email()
    come_back(c, "g-7", mail)
    assert come_back(TestClient(app), "g-8", mail) == "/entrar?google=otra-google"


def test_la_base_no_deja_a_nadie_sin_llave():
    with psycopg.connect(owner_url()) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("INSERT INTO res_users (name, login) VALUES ('Sin llave', 'sin-llave@prueba.ppm')")
