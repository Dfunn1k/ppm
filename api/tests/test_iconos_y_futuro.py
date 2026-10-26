"""Íconos y colores de las categorías, y la regla de las fechas futuras."""

from datetime import date, timedelta

import psycopg
import pytest


@pytest.fixture
def ana(new_user, as_user):
    c = as_user(new_user("ana@correo.com", "Ana"))
    c.execute("SELECT setup_user('PE')")
    return c


def test_la_plantilla_tiene_icono_en_todas_y_color_en_las_principales(conn):
    sin_icono = conn.execute("SELECT name FROM account_account_template WHERE icon IS NULL").fetchall()
    assert sin_icono == []
    principales_sin_color = conn.execute(
        "SELECT name FROM account_account_template"
        " WHERE parent_id IS NULL AND color IS NULL AND account_type IN ('income', 'expense')").fetchall()
    assert principales_sin_color == []
    hijas_con_color = conn.execute(
        "SELECT name FROM account_account_template WHERE parent_id IS NOT NULL AND color IS NOT NULL").fetchall()
    assert hijas_con_color == []   # heredan el de su principal


def test_una_persona_nueva_recibe_iconos_y_colores(ana):
    icon, color, parent_color = ana.execute(
        "SELECT a.icon, a.color, p.color FROM account_account a JOIN account_account p ON p.id = a.parent_id"
        " WHERE a.name = 'Taxi y apps'").fetchone()
    assert (icon, color, parent_color) == ("local_taxi", None, 4)
    assert ana.execute("SELECT icon, color FROM account_account WHERE name = 'Venta'").fetchone() == ("sell", 10)


def test_con_fecha_futura_no_se_confirma(ana):
    manana = date.today() + timedelta(days=2)
    with pytest.raises(psycopg.errors.CheckViolation, match="fecha futura"):
        ana.execute("INSERT INTO account_move (date, ref, state) VALUES (%s, 'Alquiler', 'posted')", (manana,))


def test_con_fecha_futura_si_queda_por_confirmar(ana):
    manana = date.today() + timedelta(days=2)
    m = ana.execute("INSERT INTO account_move (date, ref, state) VALUES (%s, 'Alquiler', 'draft') RETURNING id",
                    (manana,)).fetchone()[0]
    with pytest.raises(psycopg.errors.CheckViolation, match="fecha futura"):
        ana.execute("UPDATE account_move SET state = 'posted' WHERE id = %s", (m,))
