-- migrate:up

-- «Hoy» de cada persona, en su zona horaria. Si la sesión define ppm.today (solo lo hacen las
-- pruebas, la API nunca), ese es el día de hoy: así una prueba con fechas fijas no se rompe cuando
-- el calendario de verdad pasa un corte de tarjeta. Sin ese ajuste, todo sigue igual que antes.
CREATE OR REPLACE FUNCTION user_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('ppm.today', true), '')::date,
                  (now() AT TIME ZONE (SELECT tz FROM res_users WHERE id = current_user_id()))::date);
$$;

-- migrate:down

CREATE OR REPLACE FUNCTION user_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE (SELECT tz FROM res_users WHERE id = current_user_id()))::date;
$$;
