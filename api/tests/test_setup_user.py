"""Configuración inicial: país → moneda base, monedas que usa y cuentas de la plantilla."""

import psycopg
import pytest


def test_peru_queda_en_soles_con_dolares(new_user, as_user):
    uid = new_user("ana@correo.com")
    c = as_user(uid)
    c.execute("SELECT setup_user('PE', '{USD}')")

    base, lang, tz = c.execute(
        "SELECT cur.name, l.code, u.tz FROM res_users u"
        " JOIN res_currency cur ON cur.id = u.currency_id JOIN res_lang l ON l.id = u.lang_id"
    ).fetchone()
    assert (base.strip(), lang, tz) == ("PEN", "es-PE", "America/Lima")

    monedas = {r[0].strip() for r in c.execute(
        "SELECT cur.name FROM res_users_currency uc JOIN res_currency cur ON cur.id = uc.currency_id")}
    assert monedas == {"PEN", "USD"}


def test_crea_todas_las_cuentas_de_la_plantilla(new_user, as_user):
    c = as_user(new_user("ana@correo.com"))
    c.execute("SELECT setup_user('PE')")

    plantilla = c.execute("SELECT count(*) FROM account_account_template").fetchone()[0]
    cuentas = c.execute("SELECT count(*) FROM account_account").fetchone()[0]
    assert cuentas == plantilla

    roles = {r[0] for r in c.execute(
        "SELECT system_role FROM account_account WHERE system_role IS NOT NULL")}
    assert roles == {"opening", "receivable", "payable", "custody", "suspense",
                     "fx_gain", "fx_loss", "interest", "bad_debt"}

    # Efectivo en la moneda base; las de personas y Por clasificar, multimoneda y con persona
    assert c.execute("SELECT display_name FROM account_account_v WHERE name = 'Efectivo'"
                     ).fetchone()[0] == "Efectivo (PEN)"
    assert c.execute("SELECT currency_id, partner_required FROM account_account"
                     " WHERE system_role = 'custody'").fetchone() == (None, True)

    # Las subcategorías quedan bajo su categoría
    padre = c.execute(
        "SELECT p.name FROM account_account a JOIN account_account p ON p.id = a.parent_id"
        " WHERE a.name = 'Restaurantes y delivery'").fetchone()[0]
    assert padre == "Comida y bebida"


def test_no_se_configura_dos_veces(new_user, as_user):
    c = as_user(new_user("ana@correo.com"))
    c.execute("SELECT setup_user('PE')")
    with pytest.raises(psycopg.errors.RaiseException, match="ya se hizo"):
        c.execute("SELECT setup_user('PE')")


@pytest.mark.parametrize("args, error", [
    ("'XX'", "País desconocido"),
    ("'PE', '{ABC}'", "Moneda desconocida"),
    ("'PE', '{}', 'xx-XX'", "Idioma desconocido"),
    ("'PE', '{}', NULL, 'Marte/Olympus'", "Zona horaria desconocida"),
])
def test_rechaza_datos_desconocidos(new_user, as_user, args, error):
    c = as_user(new_user("ana@correo.com"))
    with pytest.raises(psycopg.errors.RaiseException, match=error):
        c.execute(f"SELECT setup_user({args})")


def test_cuentas_de_sistema_no_se_borran_ni_archivan(new_user, as_user):
    c = as_user(new_user("ana@correo.com"))
    c.execute("SELECT setup_user('PE')")
    with pytest.raises(psycopg.errors.RaiseException, match="la usa la app"):
        c.execute("DELETE FROM account_account WHERE system_role = 'suspense'")
    c.rollback()

    c = as_user(new_user("beto@correo.com"))
    c.execute("SELECT setup_user('PE')")
    with pytest.raises(psycopg.errors.RaiseException, match="la usa la app"):
        c.execute("UPDATE account_account SET active = false WHERE system_role = 'opening'")
    c.rollback()

    # Renombrarlas sí se puede
    c = as_user(new_user("caro@correo.com"))
    c.execute("SELECT setup_user('PE')")
    c.execute("UPDATE account_account SET name = 'Lo de otros' WHERE system_role = 'custody'")


def test_borrar_un_usuario_borra_todo_lo_suyo(conn, new_user, as_user):
    uid = new_user("ana@correo.com")
    as_user(uid).execute("SELECT setup_user('PE', '{USD}')")
    conn.execute("RESET ROLE")
    conn.execute("DELETE FROM res_users WHERE id = %s", (uid,))
    assert conn.execute("SELECT count(*) FROM account_account WHERE user_id = %s",
                        (uid,)).fetchone()[0] == 0
