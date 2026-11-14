"""Más › Monedas y formato (migración 0031): el catálogo completo de ISO 4217, agregar y quitar monedas
(la principal y las que tienen cuentas o movimientos no se quitan) y el formato de números y fechas."""

import pytest

from tests.test_movimientos_api import Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def codes(ana: Ana) -> list[str]:
    return [c["code"] for c in ana.c.get("/me/currencies").json()]


def test_el_catalogo_trae_las_monedas_del_mundo_sin_fondos_ni_metales(ana: Ana):
    cat = {c["code"]: c for c in ana.c.get("/catalog").json()["currencies"]}
    assert len(cat) > 150
    assert cat["CLP"] == {"code": "CLP", "name": "Peso chileno", "decimals": 0}
    assert cat["EUR"]["name"] == "Euro" and cat["KWD"]["decimals"] == 2   # PPM guarda hasta 2 decimales
    assert not {"XAU", "XDR", "XTS", "BOV"} & cat.keys()


def test_mis_monedas_con_sus_cuentas_y_tipo_de_cambio(ana: Ana):
    mine = ana.c.get("/me/currencies").json()
    assert [(c["code"], c["symbol"], c["base"], c["accounts"]) for c in mine] == [
        ("PEN", "S/", True, ["BCP", "Efectivo"]), ("USD", "US$", False, ["BBVA $"])]
    assert ana.c.get("/me").json()["formats"] == [
        {"code": "PEN", "symbol": "S/", "decimals": 2}, {"code": "USD", "symbol": "US$", "decimals": 2}]


def test_agregar_una_moneda_y_usarla_en_una_cuenta(ana: Ana):
    r = ana.c.post("/me/currencies", json={"currency": "clp"})
    assert r.status_code == 200, r.text
    clp = next(c for c in r.json() if c["code"] == "CLP")
    assert (clp["symbol"], clp["decimals"], clp["accounts"], clp["rate"]) == ("CLP", 0, [], None)
    assert ana.c.post("/me/currencies", json={"currency": "CLP"}).status_code == 200   # dos veces no duplica
    assert codes(ana) == ["PEN", "CLP", "USD"]
    r = ana.c.post("/accounts/cash", json={"name": "Pesos", "currency": "CLP"})
    assert r.status_code == 201, r.text
    assert ana.c.post("/me/currencies", json={"currency": "ZZZ"}).status_code == 400


def test_quitar_solo_si_nada_la_usa(ana: Ana):
    ana.c.post("/me/currencies", json={"currency": "EUR"})
    r = ana.c.delete("/me/currencies/EUR")
    assert r.status_code == 200 and [c["code"] for c in r.json()] == ["PEN", "USD"]

    r = ana.c.delete("/me/currencies/USD")
    assert (r.status_code, r.json()["detail"]) == (409, "No se puede quitar: la usan BBVA $")
    r = ana.c.delete("/me/currencies/PEN")
    assert (r.status_code, r.json()["detail"]) == (409, "La moneda principal no se quita: todo tu historial está en ella")
    assert codes(ana) == ["PEN", "USD"]


def test_la_base_no_se_quita_ni_por_sql(ana: Ana, as_user):
    import psycopg
    me = ana.c.get("/me").json()["id"]
    conn = as_user(me)
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("DELETE FROM res_users_currency WHERE currency_id = (SELECT currency_id FROM res_users)")


def test_cambiar_el_formato(ana: Ana):
    r = ana.c.patch("/me", json={"lang": "es-ES"})
    assert r.status_code == 200 and r.json()["lang"] == "es-ES"
    assert r.json()["formats"][0] == {"code": "PEN", "symbol": "S/", "decimals": 2}
    assert ana.c.patch("/me", json={"lang": "xx-XX"}).status_code == 400
