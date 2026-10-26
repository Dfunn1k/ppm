-- migrate:up
-- ppm_admin, el rol del importador de SUNAT y del administrador (Z1), queda solo con lo que usan:
-- el tipo de cambio. Antes podía leer, cambiar y borrar cualquier tabla y se saltaba la seguridad
-- por fila (BYPASSRLS); ahora no ve ni una cuenta ni un movimiento de nadie.
--   res_currency_rate          leer, y cargar o corregir un día (set_currency_rate)
--   res_currency               leer (el nombre de cada moneda)
--   res_currency_rate_status   leer: cuántas personas usan cada moneda. La vista es del dueño de la
--                              base, así que cuenta a todos sin que ppm_admin vea a nadie.
ALTER ROLE ppm_admin NOBYPASSRLS;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ppm_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ppm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ppm_admin;

GRANT SELECT, INSERT, UPDATE ON res_currency_rate TO ppm_admin;
GRANT SELECT ON res_currency, res_currency_rate_status TO ppm_admin;

-- migrate:down
ALTER ROLE ppm_admin BYPASSRLS;
GRANT ALL ON ALL TABLES IN SCHEMA public TO ppm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ppm_admin;
