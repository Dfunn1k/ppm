"""X4 · Cierre de periodo por la API: qué impide cerrar, cerrar, el candado en el detalle y reabrir."""

from datetime import timedelta

import pytest

from tests.test_movimientos_api import HOY, Ana, borrar_usuarios_de_prueba  # noqa: F401

FIN_MES_PASADO = (HOY.replace(day=1) - timedelta(days=1))


@pytest.fixture
def ana() -> Ana:
    return Ana()


def gasto(ana: Ana, when, pending=False) -> dict:
    return ana.register(kind="expense", account_id=ana.bcp, amount="40", date=when.isoformat(), pending=pending,
                        splits=[{"category_id": ana.cat["Hogar"], "amount": "40"}])


def test_cerrar_el_mes_pasado_y_reabrir(ana: Ana):
    m = gasto(ana, FIN_MES_PASADO - timedelta(days=3))
    s = ana.c.get("/closing").json()
    assert (s["lock_date"], s["suggested"], s["date"]) == (None, FIN_MES_PASADO.isoformat(), FIN_MES_PASADO.isoformat())
    assert (s["drafts"], s["unclassified"], s["can_close"]) == (0, 0, True)

    s = ana.c.put("/closing", json={"lock_date": FIN_MES_PASADO.isoformat()}).json()
    assert s["lock_date"] == FIN_MES_PASADO.isoformat() and s["can_close"] is False
    assert ana.c.get("/me").json()["lock_date"] == FIN_MES_PASADO.isoformat()
    d = ana.c.get(f"/moves/{m['summary']['id']}").json()
    assert d["locked"] is True
    r = ana.c.delete(f"/moves/{m['summary']['id']}")
    assert r.status_code == 400 and "reábrelo en Más › Cierre de periodo" in r.json()["detail"]
    r = ana.c.post("/moves", json={"kind": "expense", "account_id": ana.bcp, "amount": "5",
                                   "date": FIN_MES_PASADO.isoformat(), "splits": [{"category_id": ana.cat["Hogar"], "amount": "5"}]})
    assert r.status_code == 400 and "cerrado hasta" in r.json()["detail"]

    assert ana.c.put("/closing", json={"lock_date": None}).json()["lock_date"] is None
    assert ana.c.delete(f"/moves/{m['summary']['id']}").status_code == 204


def test_lo_que_impide_cerrar(ana: Ana):
    gasto(ana, FIN_MES_PASADO - timedelta(days=1), pending=True)
    s = ana.c.get("/closing", params={"date": FIN_MES_PASADO.isoformat()}).json()
    assert (s["drafts"], s["can_close"]) == (1, False)
    r = ana.c.put("/closing", json={"lock_date": FIN_MES_PASADO.isoformat()})
    assert r.status_code == 400 and r.json()["detail"].startswith("Hay 1 por confirmar")


def test_hoy_no_se_cierra(ana: Ana):
    r = ana.c.put("/closing", json={"lock_date": HOY.isoformat()})
    assert r.status_code == 400 and r.json()["detail"] == "Solo se cierran días que ya pasaron"
