-- migrate:up
-- La base trabaja en UTC; la fecha de "hoy" de cada persona sale de su zona horaria
-- (res_users.tz y user_today(), en la rebanada 1).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END $$;

-- migrate:down
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I RESET timezone', current_database());
END $$;
