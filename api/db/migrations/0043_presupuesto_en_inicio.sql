-- migrate:up
-- La tarjeta del presupuesto en el Inicio (Por asignar y el sobre que se pasó) se puede esconder en
-- Más › Inicio, como las cuentas. Por defecto se ve: solo aparece si el presupuesto ya empezó.
ALTER TABLE res_users ADD COLUMN home_budget boolean NOT NULL DEFAULT true;
GRANT UPDATE (home_budget) ON res_users TO ppm_app;

-- migrate:down
REVOKE UPDATE (home_budget) ON res_users FROM ppm_app;
ALTER TABLE res_users DROP COLUMN home_budget;
