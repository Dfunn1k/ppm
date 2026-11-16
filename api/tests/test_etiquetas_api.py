"""Etiquetas: post-its de colores en el movimiento entero, que cruzan categorías. Crear y
administrarlas, ponerlas al registrar o desde el detalle, filtrar Movimientos, el reporte por
etiqueta, y que las partes que se arman solas (cuotas, partes repartidas) lleven las de su compra.
También: con quién fue un gasto clasificado se ve en el detalle y no se pierde al editar."""

import pytest

from decimal import Decimal

from tests.test_cancelar_cuotas_api import televisor
from tests.test_diferidos_api import INICIO
from tests.test_movimientos_api import HOY, MES, Ana, borrar_usuarios_de_prueba  # noqa: F401
from tests.test_tarjetas_api import ANTES, CORTE, Con


@pytest.fixture
def ana() -> Con:
    return Con()


def tag(ana: Ana, name: str, **extra) -> int:
    r = ana.c.post("/tags", json={"name": name, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def gasto(ana: Ana, amount: str, cat: str = "Hogar", **extra) -> int:
    return ana.register(kind="expense", account_id=ana.bcp, amount=amount,
                        splits=[{"category_id": ana.cat[cat], "amount": amount}], **extra)["summary"]["id"]


def tags_of(ana: Ana, move_id: int) -> list[str]:
    return [t["name"] for t in ana.c.get(f"/moves/{move_id}").json()["tags"]]


def report(ana: Ana, period: str = MES) -> dict:
    r = ana.c.get("/reports/tags", params={"period": period})
    assert r.status_code == 200, r.text
    return r.json()


# --- Administrarlas -----------------------------------------------------------------------------

def test_crear_renombrar_archivar_y_eliminar(ana: Ana):
    cusco = tag(ana, "Viaje a Cusco")
    boda = tag(ana, "Boda de Lucía", color=9)
    t = {x["id"]: x for x in ana.c.get("/tags").json()}
    assert t[cusco]["color"] != 0 and t[boda]["color"] == 9          # sin elegir: de la paleta, no gris
    r = ana.c.post("/tags", json={"name": "  viaje a cusco "})
    assert r.status_code == 400 and "Ya tienes" in r.json()["detail"]

    assert ana.c.patch(f"/tags/{cusco}", json={"name": "Cusco 2026", "color": 4}).status_code == 204
    assert ana.c.patch(f"/tags/{boda}", json={"active": False}).status_code == 204
    rows = ana.c.get("/tags").json()
    assert [(x["name"], x["color"], x["active"]) for x in rows] == [("Cusco 2026", 4, True), ("Boda de Lucía", 9, False)]

    move = gasto(ana, "50", tag_ids=[cusco, boda])
    assert next(x for x in ana.c.get("/tags").json() if x["id"] == cusco)["moves"] == 1
    assert ana.c.delete(f"/tags/{cusco}").status_code == 204
    assert tags_of(ana, move) == ["Boda de Lucía"]                    # el movimiento sigue ahí
    assert ana.balance(ana.bcp) == "950.00"


def test_las_etiquetas_de_otro_no_se_usan():
    ana, luis = Ana(), Ana()
    suya = tag(luis, "Mudanza")
    r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "10", "tag_ids": [suya],
                                   "splits": [{"category_id": ana.cat["Hogar"], "amount": "10"}]})
    assert r.status_code == 404
    assert ana.c.patch(f"/tags/{suya}", json={"name": "x"}).status_code == 404


# --- En un movimiento ---------------------------------------------------------------------------

def test_al_registrar_editar_y_desde_el_detalle(ana: Ana):
    cusco, boda = tag(ana, "Viaje a Cusco"), tag(ana, "Boda")
    move = gasto(ana, "80", "Restaurantes y delivery", tag_ids=[cusco])
    assert tags_of(ana, move) == ["Viaje a Cusco"]

    body = {"kind": "expense", "account_id": ana.bcp, "amount": "90",
            "splits": [{"category_id": ana.cat["Restaurantes y delivery"], "amount": "90"}]}
    assert ana.c.put(f"/moves/{move}", json=body).status_code == 200
    assert tags_of(ana, move) == ["Viaje a Cusco"]                    # sin decir nada, se quedan
    assert ana.c.put(f"/moves/{move}", json={**body, "tag_ids": [boda]}).status_code == 200
    assert tags_of(ana, move) == ["Boda"]

    # Desde el detalle, en cualquier movimiento: también una transferencia
    t = ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="20")["summary"]["id"]
    assert ana.c.put(f"/moves/{t}/tags", json={"tag_ids": [cusco, boda]}).status_code == 204
    assert tags_of(ana, t) == ["Boda", "Viaje a Cusco"]
    assert ana.c.put(f"/moves/{t}/tags", json={"tag_ids": []}).status_code == 204
    assert tags_of(ana, t) == []
    r = ana.c.put(f"/moves/{t}/tags", json={"tag_ids": list(range(1, 12))})
    assert r.status_code == 400 and "Hasta 10" in r.json()["detail"]


def test_filtrar_movimientos_por_etiqueta(ana: Ana):
    cusco = tag(ana, "Viaje a Cusco")
    a = gasto(ana, "30", tag_ids=[cusco])
    gasto(ana, "40")
    mes = ana.c.get("/moves", params={"month": MES, "tag_id": cusco}).json()
    assert [m["id"] for d in mes["days"] for m in d["moves"]] == [a]
    assert mes["expense_total"] == "30.00"


def test_en_un_periodo_cerrado_tambien_se_etiqueta(ana: Ana):
    viejo = gasto(ana, "25", date=INICIO.isoformat())
    cierre = (HOY.replace(day=1) - __import__("datetime").timedelta(days=1)).isoformat()
    assert ana.c.put("/closing", json={"lock_date": cierre}).status_code == 200
    assert ana.c.put(f"/moves/{viejo}/tags", json={"tag_ids": [tag(ana, "Mudanza")]}).status_code == 204
    assert tags_of(ana, viejo) == ["Mudanza"]


# --- Lo que se arma solo lleva las de su compra -------------------------------------------------

def test_las_partes_repartidas_llevan_las_de_su_compra(ana: Ana):
    seguro = tag(ana, "Auto")
    d = ana.register(kind="expense", account_id=ana.bcp, amount="1200.00", date=INICIO.isoformat(), ref="SOAT",
                     splits=[{"category_id": ana.cat["Seguro vehicular"], "amount": "1200.00"}],
                     deferral={"method": "months", "months": 12}, tag_ids=[seguro])
    parte = d["deferral"]["parts"][2]["move_id"]
    p = ana.c.get(f"/moves/{parte}").json()
    assert ([t["name"] for t in p["tags"]], p["tags_inherited"]) == (["Auto"], True)
    r = ana.c.put(f"/moves/{parte}/tags", json={"tag_ids": []})
    assert r.status_code == 400 and "de su compra" in r.json()["detail"]
    # El pago original no es gasto (va a «Pagos por adelantado»): cuenta la parte de este mes
    rep = report(ana)
    assert rep["total"] == "100.00"
    assert [(t["name"], t["amount"], t["categories"][0]["name"]) for t in rep["tags"]] == [("Auto", "100.00", "Seguro vehicular")]
    assert [m["id"] for x in ana.c.get("/moves", params={"month": MES, "tag_id": seguro}).json()["days"]
            for m in x["moves"]] == [parte]


def test_las_cuotas_llevan_las_de_su_compra(ana: Con):
    tele = tag(ana, "Mudanza")
    card = ana.card()["account"]["id"]
    ana.buy(card, "1200.00", ANTES, installments=6, ref="Televisor", tag_ids=[tele])
    rep = report(ana, CORTE.strftime("%Y-%m"))
    assert [(t["name"], t["amount"]) for t in rep["tags"]] == [("Mudanza", "200.00")]   # la cuota 1 ya se facturó


def test_las_cancelaciones_llevan_las_de_su_compra(ana: Con):
    """Lo que cuenta al cancelar (lo que no te devolvieron de un reparto, lo que pagaste de las
    cuotas que faltaban) también lleva la etiqueta: el reporte por etiqueta da lo mismo que Gastos."""
    auto = tag(ana, "Auto")
    d = ana.register(kind="expense", account_id=ana.bcp, amount="1200.00", date=INICIO.isoformat(), ref="SOAT",
                     splits=[{"category_id": ana.cat["Seguro vehicular"], "amount": "1200.00"}],
                     deferral={"method": "months", "months": 12}, tag_ids=[auto])
    r = ana.c.post(f"/moves/{d['summary']['id']}/deferral/cancel", json={"refund": "600", "account_id": ana.bcp})
    cancel = r.json()["deferral"]["canceled"]["move_id"]
    assert ana.c.get(f"/moves/{cancel}").json()["tags_inherited"] is True

    _, m = televisor(ana)
    assert ana.c.put(f"/moves/{m['summary']['id']}/tags", json={"tag_ids": [auto]}).status_code == 204
    left = sum(Decimal(x["principal"]) for x in m["plan"]["lines"] if not x["billed"])
    r = ana.c.post(f"/plans/{m['plan']['plan_id']}/cancel", json={"kind": "prepaid", "charged": str(left), "account_id": ana.bcp})
    assert r.status_code == 200, r.text
    assert [t["name"] for t in ana.c.get(f"/moves/{r.json()['plan']['canceled']['move_id']}").json()["tags"]] == ["Auto"]

    gastos = ana.c.get("/reports/expenses", params={"period": MES}).json()["total"]
    assert Decimal(gastos) > Decimal("400.00")                         # parte del mes + 300 que no volvieron + cuotas
    assert report(ana)["total"] == gastos


# --- El reporte ---------------------------------------------------------------------------------

def test_el_reporte_suma_solo_lo_gastado(ana: Ana):
    cusco, boda = tag(ana, "Viaje a Cusco"), tag(ana, "Boda")
    luis = ana.c.post("/partners", json={"name": "Luis"}).json()["id"]
    # Una cena de 100 con 40 de Luis: tu gasto son 60
    ana.register(kind="expense", account_id=ana.bcp, amount="100", tag_ids=[cusco],
                 splits=[{"category_id": ana.cat["Restaurantes y delivery"], "amount": "60"},
                         {"partner_id": luis, "amount": "40"}])
    gasto(ana, "300", "Taxi y apps", tag_ids=[cusco, boda])
    # Te devolvieron 50 del taxi
    ana.register(kind="refund", account_id=ana.bcp, amount="50", tag_ids=[cusco],
                 splits=[{"category_id": ana.cat["Taxi y apps"], "amount": "50"}])
    gasto(ana, "999")                                                  # sin etiqueta: no entra
    ana.register(kind="transfer", account_id=ana.bcp, to_account_id=ana.efectivo, amount="20", tag_ids=[cusco])

    rep = report(ana)
    assert rep["total"] == "310.00"                    # 60 + 300 − 50: el taxi con dos etiquetas cuenta una vez
    by = {t["name"]: t for t in rep["tags"]}
    assert (by["Viaje a Cusco"]["amount"], by["Viaje a Cusco"]["moves"]) == ("310.00", 3)
    assert [(k["name"], k["amount"]) for k in by["Viaje a Cusco"]["categories"]] == \
        [("Taxi y apps", "250.00"), ("Restaurantes y delivery", "60.00")]
    assert by["Boda"]["amount"] == "300.00"
    assert [t["name"] for t in rep["tags"]] == ["Viaje a Cusco", "Boda"]
    s = ana.c.get("/reports/summary", params={"month": MES}).json()
    assert (s["tagged"], s["top_tag"]) == ("310.00", "Viaje a Cusco")


# --- Con quién fue (al clasificar) --------------------------------------------------------------

def test_con_quien_se_ve_y_no_se_pierde_al_editar(ana: Ana):
    move = ana.register(kind="expense", account_id=ana.bcp, amount="80", later=True, ref="Cena")["summary"]["id"]
    juan = ana.c.post("/partners", json={"name": "Juan"}).json()["id"]
    cat = ana.cat["Restaurantes y delivery"]
    assert ana.c.post("/unclassified/classify", json={"move_ids": [move], "account_id": cat,
                                                      "partner_id": juan}).status_code == 204
    d = ana.c.get(f"/moves/{move}").json()
    assert (d["with_partner_id"], d["with_partner"]) == (juan, "Juan")
    body = {"kind": "expense", "account_id": ana.bcp, "amount": "85", "splits": [{"category_id": cat, "amount": "85"}]}
    assert ana.c.put(f"/moves/{move}", json=body).status_code == 200
    assert ana.c.get(f"/moves/{move}").json()["with_partner"] == "Juan"
