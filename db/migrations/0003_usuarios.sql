-- migrate:up
-- Usuarios y aislamiento: una sola base para todos, y cada persona solo ve sus filas.
--
-- Roles (son del servidor, no de esta base, por eso se crean solo si faltan):
--   ppm_app    con el que trabaja la API; sujeto a la seguridad por fila (RLS)
--   ppm_admin  importador y administración; se salta la RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ppm_app') THEN
    CREATE ROLE ppm_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ppm_admin') THEN
    CREATE ROLE ppm_admin NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ppm_app, ppm_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO ppm_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ppm_admin;

-- Globales: los usuarios solo leen
GRANT SELECT ON res_currency, res_lang, res_currency_format, res_country, res_bank,
                account_account_type TO ppm_app;

-- Quién está en esta sesión: lo fija la API al autenticar (set_config('app.user_id', …, true)).
-- Sin usuario: error, nunca "todos".
CREATE FUNCTION current_user_id() RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  v text := current_setting('app.user_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'No hay usuario en esta sesión (app.user_id)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::integer;
END $$;

-- La fila nace al crear la cuenta (con correo y contraseña); setup_user completa
-- país, moneda base e idioma en la configuración inicial.
CREATE TABLE res_users (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              text NOT NULL,                                -- '¿Cómo te llamamos?'
  login             text NOT NULL,                                -- el correo
  password          text NOT NULL,                                -- huella Argon2id, nunca en claro
  email_verified_at timestamptz,                                  -- verificar se exigirá más adelante
  country_id        smallint REFERENCES res_country (id),
  currency_id       smallint REFERENCES res_currency (id),        -- moneda base: la del país
  lang_id           smallint REFERENCES res_lang (id),            -- cómo ves montos y fechas
  tz                text NOT NULL DEFAULT 'America/Lima',         -- zona IANA: define "hoy"
  ui_theme          text NOT NULL DEFAULT 'system' CHECK (ui_theme IN ('system', 'light', 'dark')),
  ui_accent         text NOT NULL DEFAULT 'tinta'
                    CHECK (ui_accent IN ('tinta', 'trigo', 'morado', 'azul')),
  lock_date         date,                                         -- cierre de periodo
  active            boolean NOT NULL DEFAULT true,
  create_date       timestamptz NOT NULL DEFAULT now(),
  -- país, moneda e idioma se completan juntos (o todavía ninguno)
  CHECK ((country_id IS NULL) = (currency_id IS NULL) AND (country_id IS NULL) = (lang_id IS NULL))
);
CREATE UNIQUE INDEX res_users_login ON res_users (lower(login));   -- un correo, una cuenta

-- Cada uno ve y edita solo su fila. Sin FORCE: las funciones de acceso (crear cuenta,
-- iniciar sesión) corren como dueño de la tabla, antes de que haya usuario en la sesión.
ALTER TABLE res_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_row ON res_users USING (id = (SELECT current_user_id()));
GRANT SELECT ON res_users TO ppm_app;
GRANT UPDATE (name, tz, ui_theme, ui_accent, lock_date, country_id, currency_id, lang_id)
  ON res_users TO ppm_app;                                      -- login y password: solo por funciones

-- El día de hoy en la zona del usuario
CREATE FUNCTION user_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE (SELECT tz FROM res_users WHERE id = current_user_id()))::date;
$$;

-- La misma regla en todas las tablas de usuario: ver y escribir solo filas propias.
-- FORCE la aplica también al dueño de la tabla.
CREATE FUNCTION ppm_enable_rls(t regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY own_rows ON %s USING (user_id = (SELECT current_user_id())) '
                 'WITH CHECK (user_id = (SELECT current_user_id()))', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO ppm_app', t);
END $$;

-- Monedas que usa cada persona: la base y las demás
CREATE TABLE res_users_currency (
  user_id     integer  NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  PRIMARY KEY (user_id, currency_id)
);
SELECT ppm_enable_rls('res_users_currency');

-- Contactos: personas con quienes compartes gastos, a quienes prestas o cuya plata guardas
CREATE TABLE res_partner (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  name        text NOT NULL,                            -- 'Sandra Machado'
  email       text,
  phone       text,
  country_id  smallint REFERENCES res_country (id),
  active      boolean NOT NULL DEFAULT true,
  create_date timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)                                  -- destino de las FK compuestas
);
SELECT ppm_enable_rls('res_partner');

-- migrate:down
DROP TABLE res_partner, res_users_currency, res_users;
DROP FUNCTION ppm_enable_rls(regclass), user_today(), current_user_id();
-- Los roles son del servidor: se quitan sus permisos en esta base, pero no se borran.
DROP OWNED BY ppm_app, ppm_admin;
