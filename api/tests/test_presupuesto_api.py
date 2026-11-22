"""Presupuesto por sobres (D1–D10): cada fila de «Casos con números» de la propuesta, el rojo que vuelve a
cero al empezar el mes, los meses cerrados, los sobres de ahorro, las cuentas que entran y la edad del
dinero. En cada paso se revisa la ecuación: P = Por asignar + lo disponible + lo asignado a meses que
vienen, al céntimo."""

import datetime as dt
import random
from decimal import Decimal

import pytest

from app.budget import AgeOfMoney, add_months, age_of_money
from app.db import act_as_user
from tests.test_movimientos_api import HOY, MES, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import Con

D = Decimal
ESTE = HOY.replace(day=1)
M1 = add_months(ESTE, -1)                 # el mes pasado
M2 = add_months(ESTE, -2)                 # hace dos meses
SIGUIENTE = add_months(ESTE, 1)
P0 = D("2240.00")                         # Efectivo 500 + BCP 1,000 + BBVA US$ 200 a 3.70


def ym(d: dt.date) -> str:
    return d.strftime("%Y-%m")


def day(m: dt.date, n: int = 15) -> str:
    return m.replace(day=n).isoformat()


class Pres(Con):
    """Ana, con sus cuentas, que además presupuesta."""

    def __init__(self) -> None:
        super().__init__()
        self.acc = {a["name"]: a["id"] for a in self.c.get("/manual-accounts").json()}

    def person(self, name: str) -> int:
        r = self.c.post("/partners", json={"name": name})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def budget(self, month: dt.date | None = None) -> dict:
        r = self.c.get("/budget", params={"month": ym(month)} if month else {})
        assert r.status_code == 200, r.text
        b = r.json()
        if b["started"] and (month or ESTE) >= D_start(b):
            cuadra(b)
        return b

    def start(self, month: dt.date = ESTE, savings: list[str] | None = None) -> dict:
        r = self.c.post("/budget/start", json={"month": ym(month), "savings": savings or []})
        assert r.status_code == 201, r.text
        return r.json()

    def post(self, name: str, month: dt.date | None = None) -> dict:
        return next(p for p in self.budget(month)["posts"] if p["name"] == name)

    def assign(self, to: str | None, amount: str, month: dt.date = ESTE, frm: str | None = None,
               status: int = 201) -> dict:
        ids = {p["name"]: p["id"] for p in self.budget(month)["posts"]}
        r = self.c.post("/budget/moves", json={"month": ym(month), "amount": amount,
                                               "to_post_id": ids[to] if to else None,
                                               "from_post_id": ids[frm] if frm else None})
        assert r.status_code == status, r.text
        return r.json()

    def manual(self, lines: list[tuple[str | int, str, str | None]], date: str | None = None,
               partner: int | None = None) -> dict:
        """Un asiento a mano: (cuenta, 'd' o 'c' con monto, …)."""
        out = []
        for account, side, amount in lines:
            acc = account if isinstance(account, int) else self.acc[account]
            line = {"account_id": acc, "debit" if side == "d" else "credit": amount}
            if account in ("Por cobrar", "Por pagar"):
                line["partner_id"] = partner
            out.append(line)
        return self.register(kind="manual", lines=out, **({"date": date} if date else {}))

    def spend(self, category: str, amount: str, date: str | None = None, account: int | None = None, **kw) -> dict:
        return self.register(kind="expense", account_id=account or self.bcp, amount=amount,
                             splits=[{"category_id": self.cat[category], "amount": amount}],
                             **({"date": date} if date else {}), **kw)

    def earn(self, amount: str, date: str | None = None) -> dict:
        return self.register(kind="income", account_id=self.bcp, amount=amount,
                             splits=[{"category_id": self.cat["Salario y facturas"], "amount": amount}],
                             **({"date": date} if date else {}))


def D_start(b: dict) -> dt.date:
    return dt.date.fromisoformat(b["start"])


def cuadra(b: dict) -> None:
    """La ecuación del presupuesto, al céntimo."""
    disponible = sum((D(p["available"]) for p in b["posts"]), D(0)) + D(b["unclassified"]["available"])
    assert D(b["plata"]["total"]) == D(b["to_assign"]) + disponible + D(b["future"]), b
    for p in b["posts"]:
        assert D(p["available"]) == D(p["carried"]) + D(p["assigned"]) + D(p["activity"]), p
        assert D(p["carried"]) >= 0                                      # un rojo no pasa al mes siguiente


@pytest.fixture
def ana() -> Pres:
    return Pres()


def _cambio(antes: dict, despues: dict) -> dict:
    """Lo que cambió entre dos vistas del mismo mes: Por asignar, P y cada sobre que se movió."""
    a = {p["name"]: D(p["available"]) for p in antes["posts"]}
    out = {"to_assign": D(despues["to_assign"]) - D(antes["to_assign"]),
           "plata": D(despues["plata"]["total"]) - D(antes["plata"]["total"])}
    for p in despues["posts"]:
        if D(p["available"]) != a.get(p["name"], D(0)):
            out[p["name"]] = D(p["available"]) - a.get(p["name"], D(0))
    return out


# --- Empezar --------------------------------------------------------------------------------------

def test_sin_presupuesto_solo_la_edad_del_dinero(ana: Pres):
    b = ana.budget()
    assert (b["started"], b["posts"], b["to_assign"]) == (False, [], "0.00")
    assert D(b["plata"]["total"]) == P0
    assert b["age"] == {"days": None, "outflows": 0}                   # sin gastos todavía


def test_empezar_trae_los_grupos_y_construir_patrimonio(ana: Pres):
    b = ana.start(savings=["Fondo de emergencia", " ", "Fondo de emergencia"])
    assert (b["started"], b["start"], b["to_assign"]) == (True, ESTE.isoformat(), "2240.00")
    gasto = [p["name"] for p in b["posts"] if p["kind"] == "expense"]
    assert gasto[:3] == ["Comida y bebida", "Compras", "Vivienda"]       # los grupos, en el orden de Reportes
    assert "Gastos financieros" in gasto
    ahorro = [(p["name"], p["role"]) for p in b["posts"] if p["kind"] == "saving"]
    assert ahorro == [("Construir patrimonio", "patrimony"), ("Fondo de emergencia", None)]
    assert all(p["available"] == "0.00" for p in b["posts"])

    r = ana.c.post("/budget/start", json={"month": MES})
    assert r.status_code == 409 and r.json()["detail"] == "Tu presupuesto ya empezó"


def test_no_empieza_en_un_mes_que_no_llega(ana: Pres):
    r = ana.c.post("/budget/start", json={"month": ym(SIGUIENTE)})
    assert r.status_code == 400 and "ya pasó" in r.json()["detail"]
    assert ana.c.post("/budget/start", json={"month": "2026-13"}).status_code == 422


def test_un_grupo_nuevo_trae_su_sobre(ana: Pres):
    ana.start()
    r = ana.c.post("/categories", json={"kind": "expense", "name": "Veterinaria", "group": "Mascotas",
                                       "icon": "pets", "color": 4})
    assert r.status_code == 201, r.text
    p = ana.post("Mascotas")
    assert (p["kind"], p["icon"], p["color"], p["available"]) == ("expense", "pets", 4, "0.00")


# --- Casos con números (uno por fila de la propuesta) --------------------------------------------

def test_sueldo_asignar_gastar_con_debito_y_con_tarjeta(ana: Pres):
    ana.start()
    b0 = ana.budget()
    ana.earn("4000")                                                    # Sueldo: entra a Por asignar
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": D("4000"), "plata": D("4000")}

    b2 = ana.assign("Comida y bebida", "900")                           # Asignar: sale de Por asignar
    assert _cambio(b1, b2) == {"to_assign": D("-900"), "plata": 0, "Comida y bebida": D("900")}
    assert ana.post("Comida y bebida")["assigned"] == "900.00"

    ana.spend("Supermercado y mercado", "120")                         # Mercado con débito
    b3 = ana.budget()
    assert _cambio(b2, b3) == {"to_assign": 0, "plata": D("-120"), "Comida y bebida": D("-120")}

    card = ana.card()["account"]["id"]
    ana.spend("Restaurantes y delivery", "80", account=card)           # Con tarjeta: igual que con débito (D2)
    b4 = ana.budget()
    assert _cambio(b3, b4) == {"to_assign": 0, "plata": D("-80"), "Comida y bebida": D("-80")}
    assert b4["plata"]["cards"] == "-80.00"
    comida = ana.post("Comida y bebida")
    assert (comida["activity"], comida["available"]) == ("-200.00", "700.00")

    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="80")   # Pagar la tarjeta
    b5 = ana.budget()
    assert _cambio(b4, b5) == {"to_assign": 0, "plata": 0}
    assert b5["plata"]["cards"] == "0.00"


def test_compra_en_cuotas_cada_cuota_pide_su_plata(ana: Pres):
    ana.start()
    b0 = ana.budget()
    card = ana.card()["account"]["id"]
    ana.manual([("Cuotas por venir", "d", "1200.00"), (card, "c", "1200.00")])   # Televisor en 6 cuotas
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": 0, "plata": 0}                       # las dos están dentro
    assert (b1["plata"]["cards"], b1["plata"]["installments"]) == ("-1200.00", "1200.00")

    ana.manual([("Electrónica", "d", "200.00"), ("Intereses", "d", "15.00"),      # Cuota 1 facturada
                ("Cuotas por venir", "c", "215.00")])
    b2 = ana.budget()
    assert _cambio(b1, b2) == {"to_assign": 0, "plata": D("-215"), "Compras": D("-200"),
                               "Gastos financieros": D("-15")}

    ana.manual([("Electrónica", "d", "580.00"), (card, "d", "20.00"), ("Cuotas por venir", "c", "600.00")])
    b3 = ana.budget()                                                   # «Pagué lo que faltaba»: el banco cobró 580
    assert _cambio(b2, b3) == {"to_assign": 0, "plata": D("-580"), "Compras": D("-580")}


def test_diferido_el_sobre_paga_el_dia_que_sale_la_plata(ana: Pres):
    ana.start(M2)
    d = ana.spend("Seguro vehicular", "1200.00", date=day(M2, 1), deferral={"method": "months", "months": 12})
    vehiculo = ana.post("Vehículo", M2)
    assert (vehiculo["activity"], vehiculo["available"]) == ("-1200.00", "-1200.00")   # el día del pago (D5)
    assert ana.post("Vehículo", M1)["activity"] == "0.00"                             # las partes no tocan P
    assert ana.post("Vehículo")["activity"] == "0.00"

    antes = ana.budget()
    r = ana.c.post(f"/moves/{d['summary']['id']}/deferral/cancel", json={"refund": "300", "account_id": ana.bcp})
    assert r.status_code == 200, r.text                                 # Cancelas: quedaban 900, te devuelven 300
    despues = ana.budget()
    assert _cambio(antes, despues) == {"to_assign": 0, "plata": D("300"), "Vehículo": D("300")}


def test_con_otras_personas(ana: Pres):
    ana.start()
    luis = ana.person("Luis")
    b0 = ana.budget()
    ana.manual([("Restaurantes y delivery", "d", "50.00"), ("Por cobrar", "d", "50.00"), (ana.bcp, "c", "100.00")],
               partner=luis)                                            # Cena S/ 100, la mitad la pone Luis
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": D("-50"), "plata": D("-100"), "Comida y bebida": D("-50")}

    ana.register(kind="collect", account_id=ana.bcp, amount="50", partner_id=luis)   # Luis te paga
    b2 = ana.budget()
    assert _cambio(b1, b2) == {"to_assign": D("50"), "plata": D("50")}

    ana.manual([("Streaming y suscripciones", "d", "22.00"), ("Por pagar", "c", "22.00")], partner=luis)
    b3 = ana.budget()                                                   # Luis pagó el Netflix y te toca 22
    assert _cambio(b2, b3) == {"to_assign": 0, "plata": D("-22"), "Vida y entretenimiento": D("-22")}
    assert b3["plata"]["owed"] == "-22.00"                              # lo que debes entra a P

    ana.register(kind="lend", account_id=ana.bcp, amount="500", partner_id=luis)   # Le prestas 500
    b4 = ana.budget()
    assert _cambio(b3, b4) == {"to_assign": D("-500"), "plata": D("-500")}
    ana.manual([("Deudas incobrables", "d", "500.00"), ("Por cobrar", "c", "500.00")], partner=luis)
    assert _cambio(b4, ana.budget()) == {"to_assign": 0, "plata": 0}    # Darlo por perdido no toca P


def test_reembolso_vuelve_al_sobre(ana: Pres):
    ana.start()
    ana.spend("Ropa y calzado", "120")
    antes = ana.budget()
    ana.register(kind="refund", account_id=ana.bcp, amount="80",
                 splits=[{"category_id": ana.cat["Ropa y calzado"], "amount": "80"}])
    assert _cambio(antes, ana.budget()) == {"to_assign": 0, "plata": D("80"), "Compras": D("80")}
    assert ana.post("Compras")["activity"] == "-40.00"


def test_por_clasificar_a_la_vista_y_al_clasificar_pasa_al_sobre(ana: Pres):
    ana.start()
    antes = ana.budget()
    d = ana.register(kind="expense", account_id=ana.bcp, amount="60", later=True)
    b = ana.budget()
    assert b["unclassified"] == {"activity": "-60.00", "available": "-60.00"}
    assert _cambio(antes, b) == {"to_assign": 0, "plata": D("-60")}
    r = ana.c.post("/unclassified/classify", json={"move_ids": [d["summary"]["id"]], "account_id": ana.cat["Taxi y apps"]})
    assert r.status_code == 204, r.text
    b2 = ana.budget()
    assert b2["unclassified"]["available"] == "0.00"
    assert _cambio(b, b2) == {"to_assign": 0, "plata": 0, "Transporte": D("-60")}

    # Lo que entra sin saber qué es no se puede repartir hasta clasificarlo
    ana.register(kind="income", account_id=ana.bcp, amount="120", later=True)
    b3 = ana.budget()
    assert b3["unclassified"]["available"] == "120.00" and b3["to_assign"] == b2["to_assign"]


def test_prestamo_de_banco_y_la_cuota_de_la_hipoteca(ana: Pres):
    ana.start()
    banks = {b["name"]: b["id"] for b in ana.c.get("/catalog").json()["banks"]}
    b0 = ana.budget()
    r = ana.c.post("/loans", json={"name": "Hipoteca BCP", "bank_id": banks["BCP"], "currency": "PEN", "fresh": True,
                                   "amount": "50000", "pay_account_id": ana.bcp, "day": 15, "left": 120,
                                   "capital": "1050", "interest": "610", "insurance": "28"})
    assert r.status_code == 201, r.text
    loan = r.json()["id"] if "id" in r.json() else r.json()["account"]["id"]
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": D("50000"), "plata": D("50000")}    # el desembolso (D8)

    ana.assign("Construir patrimonio", "1050")
    b2 = ana.budget()
    ana.manual([("Hipoteca", "d", "610.00"), ("Seguros", "d", "28.00"), (loan, "d", "1050.00"),
                (ana.bcp, "c", "1688.00")])                              # la cuota, separada por sus líneas
    b3 = ana.budget()
    assert _cambio(b2, b3) == {"to_assign": 0, "plata": D("-1688"), "Vivienda": D("-610"),
                               "Gastos financieros": D("-28"), "Construir patrimonio": D("-1050")}
    assert ana.post("Construir patrimonio")["available"] == "0.00"
    s = {x["name"]: x for x in ana.c.get("/budget/accounts").json()}
    assert (s["Hipoteca BCP"]["on_budget"], s["Hipoteca BCP"]["default"]) == (False, False)


def test_inversion_construye_patrimonio_y_retirar_da_por_asignar(ana: Pres):
    ana.start()
    fondo = ana.c.post("/accounts/cash", json={"name": "Fondo mutuo", "currency": "PEN"}).json()
    fondo = fondo["account"]["id"] if "account" in fondo else fondo["id"]
    r = ana.c.put(f"/budget/accounts/{fondo}", json={"on_budget": False, "since": ESTE.isoformat()})
    assert r.status_code == 200, r.text
    assert (r.json()["on_budget"], r.json()["post_id"]) == (False, None)

    ana.assign("Construir patrimonio", "1000")
    b0 = ana.budget()
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=fondo, amount="1000")
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": 0, "plata": D("-1000"), "Construir patrimonio": D("-1000")}

    ana.register(kind="transfer", account_id=fondo, to_account_id=ana.bcp, amount="300")   # Retirar
    b2 = ana.budget()
    assert _cambio(b1, b2) == {"to_assign": D("300"), "plata": D("300")}

    # Desde hoy, lo que se le pase sale de su propio sobre de ahorro
    casa = ana.c.post("/budget/posts", json={"name": "Casa", "icon": "home", "color": 5}).json()["id"]
    r = ana.c.put(f"/budget/accounts/{fondo}", json={"on_budget": False, "since": HOY.isoformat(), "post_id": casa})
    assert r.status_code == 200 and r.json()["post_id"] == casa
    ana.assign("Casa", "200")
    b3 = ana.budget()
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=fondo, amount="200")
    assert _cambio(b3, ana.budget()) == {"to_assign": 0, "plata": D("-200"), "Casa": D("-200")}


def test_dolares_en_libros_y_la_ganancia_cuenta_al_realizarse(ana: Pres):
    ana.start()
    b0 = ana.budget()
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.bbva, amount="380", to_amount="100")
    b1 = ana.budget()
    assert _cambio(b0, b1) == {"to_assign": 0, "plata": 0}               # Cambiar soles por dólares
    # Vender 100 dólares (en libros a 3.70 y 3.80) por 400 soles: la ganancia ya es real
    ana.register(kind="transfer", account_id=ana.bbva, to_account_id=ana.bcp, amount="100", to_amount="400")
    b2 = ana.budget()
    c = _cambio(b1, b2)
    assert c["plata"] == c["to_assign"] > 0                              # entra a Por asignar, no a un sobre
    assert set(c) == {"plata", "to_assign"}
    assert b2["plata"]["if_exchanged"] is not None                       # «Si cambiaras hoy», aparte (D4)


# --- El rojo, lo que pasa al mes siguiente y los meses que vienen ------------------------------

def test_el_rojo_vuelve_a_cero_al_empezar_el_mes_y_lo_absorbe_por_asignar(ana: Pres):
    ana.start(M2)
    ana.assign("Comida y bebida", "100", M2)
    ana.assign("Vivienda", "300", M2)
    ana.spend("Supermercado y mercado", "150", date=day(M2))
    ana.spend("Alquiler", "100", date=day(M2))
    m2 = ana.budget(M2)
    assert ana.post("Comida y bebida", M2)["available"] == "-50.00"
    m1 = ana.budget(M1)
    comida, vivienda = ana.post("Comida y bebida", M1), ana.post("Vivienda", M1)
    assert (comida["carried"], comida["available"]) == ("0.00", "0.00")        # el rojo no pasa (D3)…
    assert (vivienda["carried"], vivienda["available"]) == ("200.00", "200.00")  # …lo que sobra sí
    assert D(m1["to_assign"]) == D(m2["to_assign"]) - 50                         # …y lo paga Por asignar
    assert ana.budget()["to_assign"] == m1["to_assign"]


def test_asignar_a_un_mes_que_viene(ana: Pres):
    ana.start()
    antes = ana.budget()
    ana.assign("Comida y bebida", "200", SIGUIENTE)
    b = ana.budget()
    assert (D(b["to_assign"]), b["future"]) == (D(antes["to_assign"]) - 200, "200.00")
    assert ana.post("Comida y bebida")["available"] == "0.00"
    assert ana.post("Comida y bebida", SIGUIENTE)["available"] == "200.00"
    assert ana.budget(SIGUIENTE)["to_assign"] == b["to_assign"]


def test_mover_entre_sobres_y_lo_que_no_se_puede(ana: Pres):
    ana.start()
    ana.assign("Comida y bebida", "300")
    b = ana.assign("Vida y entretenimiento", "100", frm="Comida y bebida")
    assert {p["name"]: p["available"] for p in b["posts"]}["Comida y bebida"] == "200.00"
    r = ana.assign("Vida y entretenimiento", "250", frm="Comida y bebida", status=400)
    assert r["detail"] == "Comida y bebida tiene 200.00 disponible"
    ana.assign(None, "50", frm="Comida y bebida")                         # devolver a Por asignar
    assert ana.post("Comida y bebida")["available"] == "150.00"

    # Por asignar sí puede quedar en rojo: asignaste de más y se ve
    b = ana.assign("Compras", "5000")
    assert D(b["to_assign"]) < 0


def test_deshacer_una_asignacion(ana: Pres):
    ana.start()
    ana.assign("Comida y bebida", "100")
    ana.assign("Compras", "40")
    moves = ana.c.get("/budget/moves", params={"month": MES}).json()
    assert [(m["amount"], m["from_post_id"], m["source"]) for m in moves] == [("100.00", None, "manual"),
                                                                             ("40.00", None, "manual")]
    r = ana.c.delete(f"/budget/moves/{moves[1]['id']}")
    assert r.status_code == 200 and ana.post("Compras")["available"] == "0.00"

    ana.spend("Supermercado y mercado", "70")                            # ya gastó lo que le dieron
    r = ana.c.delete(f"/budget/moves/{moves[0]['id']}")
    assert r.status_code == 400 and "lo deja en rojo" in r.json()["detail"]
    assert ana.c.delete("/budget/moves/999999999").status_code == 404


def test_lo_que_no_se_confirma_no_cuenta(ana: Pres):
    ana.start()
    antes = ana.budget()
    ana.spend("Supermercado y mercado", "99", pending=True)
    assert _cambio(antes, ana.budget()) == {"to_assign": 0, "plata": 0}


def test_editar_o_borrar_un_movimiento_corrige_el_sobre(ana: Pres):
    ana.start()
    antes = ana.budget()
    d = ana.spend("Supermercado y mercado", "120")
    assert ana.post("Comida y bebida")["activity"] == "-120.00"
    assert ana.c.delete(f"/moves/{d['summary']['id']}").status_code == 204
    assert _cambio(antes, ana.budget()) == {"to_assign": 0, "plata": 0}


def test_el_promedio_de_los_tres_meses_anteriores(ana: Pres):
    for m, monto in ((add_months(ESTE, -3), "90"), (M2, "120"), (M1, "90")):
        ana.spend("Supermercado y mercado", monto, date=day(m))
    ana.spend("Supermercado y mercado", "500", date=day(add_months(ESTE, -4)))   # este ya no entra
    ana.start()
    assert ana.post("Comida y bebida")["average"] == "100.00"
    assert ana.post("Compras")["average"] == "0.00"


def test_empezar_antes_y_mover_el_inicio(ana: Pres):
    ana.start(M2)
    ana.assign("Comida y bebida", "100", M1)
    r = ana.c.put("/budget/start", json={"month": MES})
    assert r.status_code == 400 and "deshazlo" in r.json()["detail"]
    r = ana.c.put("/budget/start", json={"month": ym(M1)})
    assert r.status_code == 200 and r.json()["start"] == M1.isoformat()
    b = ana.budget(M2)
    assert (b["posts"], b["to_assign"]) == ([], "0.00")                  # antes del inicio no hay sobres


# --- Meses cerrados ----------------------------------------------------------------------------

def test_un_mes_cerrado_no_se_toca(ana: Pres):
    ana.start(M2)
    ana.assign("Comida y bebida", "100", M1)
    fin = (ESTE - dt.timedelta(days=1)).isoformat()
    r = ana.c.put("/closing", json={"lock_date": fin})
    assert r.status_code == 200, r.text
    assert ana.budget(M1)["locked"] and not ana.budget()["locked"]
    r = ana.assign("Compras", "10", M1, status=400)
    assert "cerrado" in r["detail"]
    moves = ana.c.get("/budget/moves", params={"month": ym(M1)}).json()
    assert ana.c.delete(f"/budget/moves/{moves[0]['id']}").status_code == 400
    r = ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": False, "since": day(M1)})
    assert r.status_code == 400 and "cerrado" in r.json()["detail"]
    assert ana.c.put("/budget/start", json={"month": ym(M1)}).status_code == 400
    ana.assign("Compras", "10")                                          # el mes abierto sí


def test_no_empieza_en_un_mes_cerrado(ana: Pres):
    assert ana.c.put("/closing", json={"lock_date": (ESTE - dt.timedelta(days=1)).isoformat()}).status_code == 200
    r = ana.c.post("/budget/start", json={"month": ym(M1)})
    assert r.status_code == 400 and "cerrado" in r.json()["detail"]
    ana.start()


# --- Qué cuentas entran (D6) ---------------------------------------------------------------

def test_cuentas_por_defecto_y_sacar_una_desde_hoy(ana: Pres):
    ana.start(M1)
    card = ana.card()["account"]["id"]
    s = {x["account_id"]: x for x in ana.c.get("/budget/accounts").json()}
    assert all(s[a]["on_budget"] and s[a]["default"] for a in (ana.efectivo, ana.bcp, ana.bbva, card))
    assert s[ana.bcp]["since"] is None

    pasado = ana.budget(M1)
    antes = ana.budget()
    r = ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": False})
    assert r.status_code == 200 and (r.json()["on_budget"], r.json()["since"]) == (False, HOY.isoformat())
    assert _cambio(antes, ana.budget()) == {"to_assign": D("-500"), "plata": D("-500")}
    assert ana.budget(M1)["to_assign"] == pasado["to_assign"]            # el mes pasado no cambia

    r = ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": True})   # el mismo día: se corrige
    assert r.status_code == 200 and r.json()["on_budget"]
    assert ana.budget()["to_assign"] == antes["to_assign"]


def test_lo_que_no_tiene_interruptor(ana: Pres):
    ana.start()
    r = ana.c.put(f"/budget/accounts/{ana.acc['Por cobrar']}", json={"on_budget": True})
    assert r.status_code == 400 and "no se puede" in r.json()["detail"]
    r = ana.c.put(f"/budget/accounts/{ana.cat['Hogar']}", json={"on_budget": True})
    assert r.status_code == 400
    comida = ana.post("Comida y bebida")["id"]
    r = ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": False, "post_id": comida})
    assert r.status_code == 400 and "sobre de ahorro" in r.json()["detail"]
    r = ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": True, "post_id": comida})
    assert r.status_code == 400


# --- Sobres de ahorro (D10) ---------------------------------------------------------------

def test_sobres_de_ahorro(ana: Pres):
    ana.start()
    r = ana.c.post("/budget/posts", json={"name": "Viaje"})
    assert r.status_code == 201
    viaje = r.json()["id"]
    assert ana.c.post("/budget/posts", json={"name": "viaje"}).status_code == 409
    assert ana.c.patch(f"/budget/posts/{viaje}", json={"name": "Viaje a Cusco"}).status_code == 204
    ana.assign("Viaje a Cusco", "100")
    r = ana.c.patch(f"/budget/posts/{viaje}", json={"active": False})
    assert r.status_code == 400 and "todavía tiene plata" in r.json()["detail"]
    ana.assign(None, "100", frm="Viaje a Cusco")
    assert ana.c.patch(f"/budget/posts/{viaje}", json={"active": False}).status_code == 204
    assert "Viaje a Cusco" not in [p["name"] for p in ana.budget()["posts"]]
    r = ana.c.post("/budget/moves", json={"month": MES, "to_post_id": viaje, "amount": "5"})
    assert r.status_code == 400 and "archivado" in r.json()["detail"]

    patrimonio = ana.post("Construir patrimonio")["id"]
    r = ana.c.patch(f"/budget/posts/{patrimonio}", json={"active": False})
    assert r.status_code == 400 and "lo usa la app" in r.json()["detail"]
    assert ana.c.patch(f"/budget/posts/{patrimonio}", json={"name": "Mi patrimonio"}).status_code == 204
    comida = ana.post("Comida y bebida")["id"]
    r = ana.c.patch(f"/budget/posts/{comida}", json={"name": "Comida"})
    assert r.status_code == 400 and "Categorías" in r.json()["detail"]


def test_no_se_archiva_un_sobre_del_que_salen_cuentas(ana: Pres):
    ana.start()
    casa = ana.c.post("/budget/posts", json={"name": "Casa"}).json()["id"]
    ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": False, "post_id": casa})
    r = ana.c.patch(f"/budget/posts/{casa}", json={"active": False})
    assert r.status_code == 400 and "elige otro sobre" in r.json()["detail"]


def test_cada_quien_ve_solo_sus_sobres(ana: Pres):
    ana.start()
    comida = ana.post("Comida y bebida")["id"]
    bea = Pres()
    bea.start()
    assert comida not in [p["id"] for p in bea.budget()["posts"]]
    r = bea.c.post("/budget/moves", json={"month": MES, "to_post_id": comida, "amount": "5"})
    assert r.status_code == 404


# --- La edad del dinero (D9) ------------------------------------------------------------------

def _d(n: int) -> dt.date:
    return dt.date(2026, 1, 1) + dt.timedelta(days=n)


def test_edad_primero_en_entrar_primero_en_salir():
    flows = [(_d(0), D(1000)), (_d(10), D(-100))]
    assert age_of_money(flows, _d(30)) == AgeOfMoney(10, 1)
    # 950 a los 20 días: 900 llegaron el día 0 y 50 no tenían plata (edad cero)
    flows += [(_d(20), D(-950))]
    assert age_of_money(flows, _d(30)) == AgeOfMoney(14, 2)            # (10 + 18.95) / 2
    # Lo que llega primero cubre el hueco; lo demás espera su turno
    flows += [(_d(30), D(500)), (_d(40), D(-450))]
    assert age_of_money(flows, _d(40)).days == round((10 + D(900 * 20) / 950 + 10) / 3)
    assert age_of_money(flows, _d(25)) == AgeOfMoney(14, 2)             # al día 25 no se ve lo de después


def test_edad_promedia_los_ultimos_diez():
    flows = [(_d(0), D(10000))] + [(_d(k), D(-1)) for k in range(1, 13)]
    assert age_of_money(flows, _d(20)) == AgeOfMoney(round(sum(range(3, 13)) / 10), 10)


def test_edad_del_dinero_en_la_api(ana: Pres):
    ana.spend("Supermercado y mercado", "100")                          # sale del saldo inicial (1 de enero)
    b = ana.budget()
    assert b["age"] == {"days": (HOY - dt.date(2026, 1, 1)).days, "outflows": 1}
    card = ana.card()["account"]["id"]
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount="10")   # entre cuentas: no cuenta
    assert ana.budget()["age"]["outflows"] == 1


# --- La ecuación, con cualquier serie de movimientos ------------------------------------------

def test_la_ecuacion_se_cumple_siempre(ana: Pres, conn):
    """Movimientos y asignaciones al azar en tres meses: en cada mes, P = Por asignar + lo disponible +
    lo de meses que vienen, y P es la suma de lo que entró y salió de las cuentas de dentro."""
    rnd = random.Random(20261121)
    ana.start(M2)
    card = ana.card()["account"]["id"]
    luis = ana.person("Luis")
    gastos = ["Supermercado y mercado", "Restaurantes y delivery", "Alquiler", "Taxi y apps", "Electrónica",
              "Streaming y suscripciones", "Combustible"]
    names = [p["name"] for p in ana.budget(M2)["posts"]][:6] + ["Construir patrimonio"]
    # El efectivo sale del presupuesto a mitad del mes pasado y vuelve este mes; el fondo está fuera
    assert ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": False, "since": day(M1, 10)}).status_code == 200
    assert ana.c.put(f"/budget/accounts/{ana.efectivo}", json={"on_budget": True, "since": ESTE.isoformat()}).status_code == 200
    fondo = ana.c.post("/accounts/cash", json={"name": "Fondo mutuo", "currency": "PEN"}).json()
    fondo = fondo["account"]["id"] if "account" in fondo else fondo["id"]
    assert ana.c.put(f"/budget/accounts/{fondo}", json={"on_budget": False, "since": M2.isoformat()}).status_code == 200
    for _ in range(60):
        m = rnd.choice([M2, M1, ESTE])
        when = day(m, rnd.randint(1, 28)) if m != ESTE else day(m, rnd.randint(1, HOY.day))
        amount = f"{rnd.randint(1, 40000) / 100:.2f}"
        op = rnd.choice(["spend", "cash", "card", "income", "assign", "move", "lend", "refund", "transfer", "invest"])
        if op == "spend":
            ana.spend(rnd.choice(gastos), amount, date=when)
        elif op == "cash":
            ana.spend(rnd.choice(gastos), f"{rnd.randint(1, 2000) / 100:.2f}", date=when, account=ana.efectivo)
        elif op == "invest":
            ana.register(kind="transfer", account_id=ana.bcp, to_account_id=fondo, amount=amount, date=when)
        elif op == "card":
            ana.spend(rnd.choice(gastos), amount, date=when, account=card)
        elif op == "income":
            ana.earn(amount, date=when)
        elif op == "lend":
            ana.register(kind="lend", account_id=ana.bcp, amount=amount, partner_id=luis, date=when)
        elif op == "refund":
            ana.register(kind="refund", account_id=ana.bcp, amount=amount, date=when,
                         splits=[{"category_id": ana.cat[rnd.choice(gastos)], "amount": amount}])
        elif op == "transfer":
            ana.register(kind="transfer", account_id=ana.bcp, to_account_id=card, amount=amount, date=when)
        elif op == "assign":
            ana.assign(rnd.choice(names), amount, m)
        else:
            frm = rnd.choice(names)
            have = D(ana.post(frm, m)["available"])
            if have > 0:
                ana.assign(rnd.choice([n for n in names if n != frm]), str(min(have, D(amount))), m, frm=frm)

    uid = ana.c.get("/me").json()["id"]
    act_as_user(conn, uid)
    for m in (M2, M1, ESTE, SIGUIENTE):
        b = ana.budget(m)                                                 # ana.budget revisa la ecuación
        fin = add_months(m, 1) - dt.timedelta(days=1)
        flows = conn.execute("SELECT coalesce(sum(amount), 0) FROM budget_flows(%s)", (fin,)).fetchone()[0]
        assert flows == D(b["plata"]["total"])
