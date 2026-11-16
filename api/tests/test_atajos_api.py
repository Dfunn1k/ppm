"""Atajos de teclado en tu cuenta: las teclas de fábrica, cambiarlas sin que dos choquen, volver a
las de fábrica y apagar las pistas. Valen en cualquier computadora porque se guardan en la cuenta."""

import pytest

from tests.test_movimientos_api import Ana, borrar_usuarios_de_prueba  # noqa: F401


@pytest.fixture
def ana() -> Ana:
    return Ana()


def patch(ana: Ana, status: int = 200, **body) -> dict:
    r = ana.c.patch("/me", json=body)
    assert r.status_code == status, r.text
    return r.json()


def test_de_fabrica_cambiar_y_volver(ana: Ana):
    me = ana.c.get("/me").json()
    assert me["shortcuts"] == {"register": "n", "search": "/", "edit": "e", "help": "?"}
    assert me["shortcut_hints"] is True

    me = patch(ana, shortcuts={"register": "R"})
    assert me["shortcuts"]["register"] == "r"                         # una letra, en minúscula
    assert me["shortcuts"]["search"] == "/"
    me = patch(ana, shortcuts={"edit": "x"})
    assert (me["shortcuts"]["register"], me["shortcuts"]["edit"]) == ("r", "x")   # se suman

    # Intercambiar dos teclas en un solo cambio
    me = patch(ana, shortcuts={"register": "x", "edit": "r"})
    assert (me["shortcuts"]["register"], me["shortcuts"]["edit"]) == ("x", "r")

    me = patch(ana, shortcuts={})
    assert me["shortcuts"] == {"register": "n", "search": "/", "edit": "e", "help": "?"}


@pytest.mark.parametrize(("body", "message"), [
    ({"register": "/"}, "ya la usa otro atajo"),
    ({"register": "ab"}, "una sola tecla"),
    ({"register": " "}, "una sola tecla"),
    ({"escape": "q"}, "no se puede cambiar"),
])
def test_lo_que_no_se_puede(ana: Ana, body: dict, message: str):
    r = ana.c.patch("/me", json={"shortcuts": body})
    assert r.status_code == 400 and message in r.json()["detail"]


def test_apagar_las_pistas(ana: Ana):
    assert patch(ana, shortcut_hints=False)["shortcut_hints"] is False
    assert ana.c.get("/me").json()["shortcut_hints"] is False
    assert patch(ana, shortcut_hints=True)["shortcut_hints"] is True
