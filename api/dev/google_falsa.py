"""Una Google de mentira para desarrollo y para las pruebas e2e: nunca va en producción.

Hace las dos partes del inicio con Google sin internet ni credenciales:
  GET  /auth   la pantalla donde «eliges tu cuenta» (escribes cualquier correo y nombre)
  POST /token  cambia el código por un ID token con esa cuenta (sin firma: la API no la revisa,
               porque con Google de verdad el token llega directo de Google por HTTPS)
El «código» lleva la cuenta elegida dentro, así no necesita guardar nada.
"""

import base64
import html
import json
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def b64(d: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def unb64(s: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)))


PAGE = """<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Google de prueba</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h1 style="font-size:22px">Google de prueba</h1>
<p style="color:#555">Solo en desarrollo. Escribe la cuenta de Google con la que quieres entrar a PPM.</p>
<form action="/elegir" style="display:flex;flex-direction:column;gap:12px">
<input type="hidden" name="q" value="{q}">
<label>Correo <input name="email" type="email" required value="ana@gmail.com" style="width:100%"></label>
<label>Nombre <input name="name" required value="Ana Torres" style="width:100%"></label>
<button>Continuar</button>
</form>
<p><a href="/cancelar?q={q}">Cancelar</a></p>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _redirect(self, url: str) -> None:
        self.send_response(303)
        self.send_header("Location", url)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/auth":
            body = PAGE.format(q=html.escape(b64(q))).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
        elif url.path == "/elegir":
            asked = unb64(q["q"])
            email = q["email"].strip().lower()
            code = b64({"sub": f"falsa-{email}", "email": email, "name": q["name"], "nonce": asked.get("nonce"),
                        "aud": asked.get("client_id")})
            self._redirect(f"{asked['redirect_uri']}?" + urllib.parse.urlencode({"code": code, "state": asked.get("state", "")}))
        elif url.path == "/cancelar":
            asked = unb64(q["q"])
            self._redirect(f"{asked['redirect_uri']}?" + urllib.parse.urlencode({"error": "access_denied", "state": asked.get("state", "")}))
        else:
            self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/token":
            self.send_error(404)
            return
        form = dict(urllib.parse.parse_qsl(self.rfile.read(int(self.headers["Content-Length"])).decode()))
        try:
            c = unb64(form["code"])
        except (KeyError, ValueError):
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "invalid_grant"}')
            return
        claims = {"iss": "https://accounts.google.com", "aud": c.get("aud") or form.get("client_id"),
                  "exp": int(time.time()) + 300, "iat": int(time.time()), "email_verified": True} | c
        body = json.dumps({"id_token": f"{b64({'alg': 'none'})}.{b64(claims)}.", "token_type": "Bearer"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8099), Handler).serve_forever()
