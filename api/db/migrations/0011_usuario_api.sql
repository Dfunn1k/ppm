-- migrate:up
-- El usuario con el que la API entra a la base: ppm_api. No es dueño de nada ni superusuario y,
-- sin ponerse un rol, no puede leer ni escribir ninguna tabla (NOINHERIT). Solo puede asumir
-- ppm_app (cada persona, con seguridad por fila) o ppm_admin (el importador y Z1), que es lo que
-- la API ya hace en cada transacción. El dueño (ppm) queda para migrar y respaldar.
-- La contraseña no va aquí (quedaría en git): la pone el servicio «usuario-api» de Docker Compose
-- desde PPM_API_PASSWORD, y recién entonces puede iniciar sesión (LOGIN).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ppm_api') THEN
    CREATE ROLE ppm_api NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT ppm_app, ppm_admin TO ppm_api WITH INHERIT FALSE, SET TRUE;
GRANT CONNECT ON DATABASE ppm TO ppm_api;

-- migrate:down
REVOKE ppm_app, ppm_admin FROM ppm_api;
REVOKE CONNECT ON DATABASE ppm FROM ppm_api;
-- El rol es del servidor, no de esta base: se le quita el acceso, pero no se borra.
ALTER ROLE ppm_api NOLOGIN;
