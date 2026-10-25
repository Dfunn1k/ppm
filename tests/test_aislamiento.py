"""Aislamiento por usuario: una sola base, y cada persona solo ve y toca sus filas."""

import psycopg
import pytest

from app.db import user_transaction


@pytest.fixture
def ana_y_beto(new_user, as_user):
    ana, beto = new_user("ana@correo.com"), new_user("beto@correo.com")
    as_user(ana).execute("SELECT setup_user('PE')")
    as_user(beto).execute("SELECT setup_user('PE', '{USD}')")
    return ana, beto


def test_cada_uno_ve_solo_lo_suyo(ana_y_beto, as_user):
    ana, beto = ana_y_beto
    c = as_user(ana)
    assert {r[0] for r in c.execute("SELECT DISTINCT user_id FROM account_account")} == {ana}
    assert {r[0] for r in c.execute("SELECT id FROM res_users")} == {ana}
    assert c.execute("SELECT count(*) FROM res_users_currency").fetchone()[0] == 1   # solo PEN
    # La vista también respeta la regla (security_invoker)
    assert {r[0] for r in c.execute("SELECT DISTINCT user_id FROM account_account_v")} == {ana}


def test_no_puede_tocar_filas_ajenas(ana_y_beto, as_user, conn):
    ana, beto = ana_y_beto
    conn.execute("RESET ROLE")
    ajena = conn.execute("SELECT id FROM account_account WHERE user_id = %s AND name = 'Efectivo'",
                         (beto,)).fetchone()[0]

    c = as_user(ana)
    assert c.execute("UPDATE account_account SET name = 'mía' WHERE id = %s", (ajena,)).rowcount == 0
    assert c.execute("DELETE FROM res_partner WHERE user_id = %s", (beto,)).rowcount == 0
    assert c.execute("UPDATE res_users SET name = 'x' WHERE id = %s", (beto,)).rowcount == 0


def test_no_puede_escribir_a_nombre_de_otro(ana_y_beto, as_user):
    ana, beto = ana_y_beto
    c = as_user(ana)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute("INSERT INTO res_partner (user_id, name) VALUES (%s, 'Intruso')", (beto,))


def test_lo_nuevo_queda_a_nombre_de_quien_lo_crea(ana_y_beto, as_user):
    ana, _ = ana_y_beto
    c = as_user(ana)
    owner = c.execute("INSERT INTO res_partner (name) VALUES ('Sandra Machado') RETURNING user_id"
                      ).fetchone()[0]
    assert owner == ana


def test_sin_usuario_en_la_sesion_no_ve_nada(conn):
    conn.execute("SET LOCAL ROLE ppm_app")
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="No hay usuario"):
        conn.execute("SELECT * FROM account_account")


def test_no_puede_cambiar_su_correo_ni_contrasena_directo(ana_y_beto, as_user):
    ana, _ = ana_y_beto
    c = as_user(ana)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute("UPDATE res_users SET password = 'otra'")


def test_globales_solo_se_leen(ana_y_beto, as_user):
    ana, _ = ana_y_beto
    c = as_user(ana)
    assert c.execute("SELECT count(*) FROM res_bank").fetchone()[0] >= 4
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        c.execute("INSERT INTO res_currency (name, numeric_code, full_name) VALUES ('XXX', '999', 'x')")


def test_toda_tabla_con_user_id_tiene_seguridad_por_fila(conn):
    """Guardián: si una migración futura olvida ppm_enable_rls, esta prueba falla."""
    sin_regla = conn.execute("""
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
         WHERE c.relkind = 'r'
           AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                    AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'own_rows'))
    """).fetchall()
    assert sin_regla == []


def test_user_transaction_de_la_api(ana_y_beto, conn):
    """La API trabaja como ppm_app y como la persona de la sesión."""
    ana, _ = ana_y_beto
    conn.commit()   # la API usa otra conexión: necesita ver a Ana confirmada
    try:
        with user_transaction(ana) as c:
            assert c.execute("SELECT current_user, current_user_id()").fetchone() == ("ppm_app", ana)
            assert {r[0] for r in c.execute("SELECT DISTINCT user_id FROM account_account")} == {ana}
    finally:
        conn.execute("RESET ROLE")
        conn.execute("DELETE FROM res_users WHERE login IN ('ana@correo.com', 'beto@correo.com')")
        conn.commit()
