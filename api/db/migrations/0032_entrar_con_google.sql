-- migrate:up
-- Entrar con Google: una segunda llave para la misma puerta. PPM no guarda ninguna llave de Google;
-- anota solo el número de la cuenta de Google (el «sub» del ID token, que nunca cambia) y su correo,
-- para mostrar con cuál entras. Como en auth_oauth de Odoo: el proveedor y oauth_uid en res_users.
--
-- Reglas que cuida la base:
--   · una cuenta de Google entra a una sola cuenta de PPM (índice único)
--   · nadie se queda sin llave: o tiene contraseña o tiene Google (no se desvincula sin contraseña)
--   · si el correo de Google ya tiene cuenta, se unen solo con la contraseña de esa cuenta: Google
--     vuelve con una «unión pendiente» (res_users_token, purpose 'oauth') que dura 15 minutos

CREATE TABLE auth_oauth_provider (
  id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL UNIQUE                -- 'Google'; el Client ID y el secreto van en el entorno
);
INSERT INTO auth_oauth_provider (name) VALUES ('Google');
GRANT SELECT ON auth_oauth_provider TO ppm_app;

ALTER TABLE res_users
  ALTER COLUMN password DROP NOT NULL,                                  -- las cuentas creadas con Google
  ADD COLUMN oauth_provider_id smallint REFERENCES auth_oauth_provider (id),
  ADD COLUMN oauth_uid         text,                                    -- el «sub» de Google
  ADD COLUMN oauth_email       text,                                    -- con qué cuenta de Google entra
  ADD CONSTRAINT res_users_oauth_complete
      CHECK ((oauth_provider_id IS NULL) = (oauth_uid IS NULL) AND (oauth_uid IS NULL) = (oauth_email IS NULL)),
  ADD CONSTRAINT res_users_has_a_key
      CHECK (password IS NOT NULL OR oauth_uid IS NOT NULL);
CREATE UNIQUE INDEX res_users_oauth ON res_users (oauth_provider_id, oauth_uid);

-- La unión pendiente guarda qué cuenta de Google espera unirse
ALTER TABLE res_users_token
  DROP CONSTRAINT res_users_token_purpose_check,
  ADD CONSTRAINT res_users_token_purpose_check CHECK (purpose IN ('reset', 'verify', 'oauth')),
  ADD COLUMN oauth_provider_id smallint REFERENCES auth_oauth_provider (id),
  ADD COLUMN oauth_uid         text,
  ADD COLUMN oauth_email       text,
  ADD CONSTRAINT res_users_token_oauth CHECK ((purpose = 'oauth') = (oauth_uid IS NOT NULL));

-- Volviendo de Google: ¿quién es? 'login' (ya vinculada), 'existing' (el correo tiene cuenta sin
-- esta Google: hay que unirlas con la contraseña), 'linked_other' (el correo tiene cuenta unida a
-- otra Google) o 'new' (nadie: se crea la cuenta).
CREATE FUNCTION auth_oauth_lookup(p_provider text, p_uid text, p_email text)
RETURNS TABLE (user_id integer, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_provider smallint := (SELECT id FROM auth_oauth_provider WHERE name = p_provider);
BEGIN
  -- El correo de la cuenta de Google puede cambiar: se actualiza al entrar
  UPDATE res_users SET oauth_email = lower(trim(p_email))
   WHERE oauth_provider_id = v_provider AND oauth_uid = p_uid AND active
  RETURNING id, 'login' INTO user_id, outcome;
  IF user_id IS NOT NULL THEN
    RETURN NEXT; RETURN;
  END IF;
  SELECT u.id, CASE WHEN u.oauth_uid IS NULL THEN 'existing' ELSE 'linked_other' END
    INTO user_id, outcome
    FROM res_users u WHERE lower(u.login) = lower(trim(p_email)) AND u.active;
  IF user_id IS NULL THEN
    outcome := 'new';
  END IF;
  RETURN NEXT;
END $$;

-- Crear cuenta con Google: sin contraseña (se crea luego en Mi cuenta, si quiere)
CREATE FUNCTION auth_oauth_signup(p_name text, p_provider text, p_uid text, p_email text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO res_users (name, login, password, oauth_provider_id, oauth_uid, oauth_email)
  SELECT trim(p_name), lower(trim(p_email)), NULL, id, p_uid, lower(trim(p_email))
    FROM auth_oauth_provider WHERE name = p_provider
  RETURNING id;
$$;

-- La unión pendiente: una nueva anula las anteriores de esa cuenta
CREATE FUNCTION auth_oauth_pending_create(p_user integer, p_token_hash text, p_expires timestamptz,
                                          p_provider text, p_uid text, p_email text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE res_users_token SET used_at = now()
   WHERE user_id = p_user AND purpose = 'oauth' AND used_at IS NULL;
  INSERT INTO res_users_token (user_id, purpose, token_hash, expires_at, oauth_provider_id, oauth_uid, oauth_email)
  SELECT p_user, 'oauth', p_token_hash, p_expires, id, p_uid, lower(trim(p_email))
    FROM auth_oauth_provider WHERE name = p_provider;
$$;

-- Qué espera unirse (para la pantalla «Une tu cuenta con Google» y para comparar la contraseña)
CREATE FUNCTION auth_oauth_pending(p_token_hash text)
RETURNS TABLE (user_id integer, login text, oauth_email text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.login, t.oauth_email, u.password
    FROM res_users_token t JOIN res_users u ON u.id = t.user_id AND u.active
   WHERE t.token_hash = p_token_hash AND t.purpose = 'oauth' AND t.used_at IS NULL AND t.expires_at > now();
$$;

-- La contraseña ya se comprobó en la API: se usa la unión y queda vinculada
CREATE FUNCTION auth_oauth_pending_confirm(p_token_hash text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t res_users_token;
BEGIN
  UPDATE res_users_token SET used_at = now()
   WHERE token_hash = p_token_hash AND purpose = 'oauth' AND used_at IS NULL AND expires_at > now()
  RETURNING * INTO t;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE res_users SET oauth_provider_id = t.oauth_provider_id, oauth_uid = t.oauth_uid, oauth_email = t.oauth_email
   WHERE id = t.user_id;
  RETURN t.user_id;
END $$;

-- Desde Mi cuenta: vincular la cuenta de Google de quien está en la sesión (puede tener otro correo)
CREATE FUNCTION auth_oauth_link(p_provider text, p_uid text, p_email text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE res_users SET oauth_provider_id = (SELECT id FROM auth_oauth_provider WHERE name = p_provider),
                       oauth_uid = p_uid, oauth_email = lower(trim(p_email))
   WHERE id = current_user_id();
$$;

-- Desvincular: si no tiene contraseña, res_users_has_a_key lo impide
CREATE FUNCTION auth_oauth_unlink()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE res_users SET oauth_provider_id = NULL, oauth_uid = NULL, oauth_email = NULL
   WHERE id = current_user_id();
$$;

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'auth\_oauth\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ppm_app', f);
  END LOOP;
END $$;

-- migrate:down
DROP FUNCTION auth_oauth_lookup(text, text, text), auth_oauth_signup(text, text, text, text),
              auth_oauth_pending_create(integer, text, timestamptz, text, text, text),
              auth_oauth_pending(text), auth_oauth_pending_confirm(text),
              auth_oauth_link(text, text, text), auth_oauth_unlink();
DELETE FROM res_users_token WHERE purpose = 'oauth';
ALTER TABLE res_users_token
  DROP CONSTRAINT res_users_token_oauth,
  DROP COLUMN oauth_provider_id, DROP COLUMN oauth_uid, DROP COLUMN oauth_email,
  DROP CONSTRAINT res_users_token_purpose_check,
  ADD CONSTRAINT res_users_token_purpose_check CHECK (purpose IN ('reset', 'verify'));
-- Las cuentas creadas con Google quedan con una huella que no corresponde a ninguna contraseña (no se
-- borran: perderían sus datos); entran con «Olvidé mi contraseña»
UPDATE res_users SET password = '!sin-contrasena' WHERE password IS NULL;
DROP INDEX res_users_oauth;
ALTER TABLE res_users
  DROP CONSTRAINT res_users_has_a_key, DROP CONSTRAINT res_users_oauth_complete,
  DROP COLUMN oauth_provider_id, DROP COLUMN oauth_uid, DROP COLUMN oauth_email,
  ALTER COLUMN password SET NOT NULL;
DROP TABLE auth_oauth_provider;
