"""El reloj de pruebas (0040): ppm.today fija el «hoy» de user_today(); sin él, es el día de verdad
en la zona horaria de la persona."""

from datetime import date

from tests.test_cuotas_correcciones import ana  # noqa: F401


def test_sin_ajuste_es_el_dia_de_verdad(ana):
    real = ana.execute("SELECT (now() AT TIME ZONE tz)::date FROM res_users WHERE id = %s", (ana.uid,)).fetchone()[0]
    assert ana.execute("SELECT user_today()").fetchone()[0] == real


def test_ppm_today_fija_el_dia(ana):
    ana.execute("SELECT set_config('ppm.today', '2026-11-12', false)")
    assert ana.execute("SELECT user_today()").fetchone()[0] == date(2026, 11, 12)
    ana.execute("SELECT set_config('ppm.today', '', false)")   # vacío vuelve al día de verdad
    assert ana.execute("SELECT user_today() = (now() AT TIME ZONE tz)::date FROM res_users WHERE id = %s",
                       (ana.uid,)).fetchone()[0]
