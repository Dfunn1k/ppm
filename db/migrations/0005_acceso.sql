-- migrate:up
-- Acceso: sesiones (la «pulsera con número») y enlaces de un solo uso (recuperar contraseña).
--
-- La API no toca estas tablas directamente: no tiene permisos sobre ellas. Pasa siempre por
-- las funciones auth_*, que corren como dueño de la base (SECURITY DEFINER) porque varias se
-- usan antes de saber quién es la persona (crear cuenta, iniciar sesión, leer la cookie).
-- La base solo guarda la huella (sha256) de cada número, nunca el número.

CREATE TABLE res_users_session (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES res_users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,                 -- huella del número de la cookie
  user_agent  text,                                 -- desde qué navegador (para mostrarlo luego)
  create_date timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL                  -- 30 días después de iniciar sesión
);
CREATE INDEX res_users_session_user ON res_users_session (user_id);

CREATE TABLE res_users_token (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES res_users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('reset', 'verify')),
  token_hash  text NOT NULL UNIQUE,                 -- huella del enlace, no el enlace
  create_date timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,                 -- reset: 1 hora
  used_at     timestamptz                           -- un solo uso
);
CREATE INDEX res_users_token_user ON res_users_token (user_id);

-- Crear cuenta: la fila nace sin país ni moneda (los pone setup_user)
CREATE FUNCTION auth_signup(p_name text, p_login text, p_password text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO res_users (name, login, password)
  VALUES (trim(p_name), lower(trim(p_login)), p_password)
  RETURNING id;
$$;

-- Iniciar sesión: la huella de la contraseña se compara en la API (Argon2id)
CREATE FUNCTION auth_login_lookup(p_login text)
RETURNS TABLE (user_id integer, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, password FROM res_users WHERE lower(login) = lower(trim(p_login)) AND active;
$$;

CREATE FUNCTION auth_session_create(p_user integer, p_token_hash text, p_expires timestamptz,
                                    p_user_agent text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM res_users_session WHERE user_id = p_user AND expires_at <= now();   -- limpieza
  INSERT INTO res_users_session (user_id, token_hash, expires_at, user_agent)
  VALUES (p_user, p_token_hash, p_expires, left(p_user_agent, 300));
$$;

-- Leer la cookie: ¿de quién es esta pulsera, y sigue vigente?
CREATE FUNCTION auth_session_user(p_token_hash text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.user_id
    FROM res_users_session s
    JOIN res_users u ON u.id = s.user_id AND u.active
   WHERE s.token_hash = p_token_hash AND s.expires_at > now();
$$;

CREATE FUNCTION auth_session_delete(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM res_users_session WHERE token_hash = p_token_hash;
$$;

-- Cerrar sesión en todos lados: solo las de quien está en la sesión
CREATE FUNCTION auth_session_delete_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM res_users_session WHERE user_id = current_user_id();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Cambiar contraseña: cierra las demás sesiones y deja viva la actual
CREATE FUNCTION auth_password_set(p_password text, p_keep_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE res_users SET password = p_password WHERE id = current_user_id();
  DELETE FROM res_users_session
   WHERE user_id = current_user_id() AND token_hash IS DISTINCT FROM p_keep_token_hash;
$$;

-- Pedir un enlace para recuperar la contraseña. Devuelve false si el correo no existe
-- (la API responde igual en los dos casos, para no revelar qué correos tienen cuenta).
CREATE FUNCTION auth_reset_request(p_login text, p_token_hash text, p_expires timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user integer;
BEGIN
  SELECT id INTO v_user FROM res_users WHERE lower(login) = lower(trim(p_login)) AND active;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  -- Un enlace nuevo anula los anteriores que no se usaron
  UPDATE res_users_token SET used_at = now()
   WHERE user_id = v_user AND purpose = 'reset' AND used_at IS NULL;
  INSERT INTO res_users_token (user_id, purpose, token_hash, expires_at)
  VALUES (v_user, 'reset', p_token_hash, p_expires);
  RETURN true;
END $$;

-- Usar el enlace: pone la contraseña nueva y cierra todas las sesiones
CREATE FUNCTION auth_reset_confirm(p_token_hash text, p_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user integer;
BEGIN
  UPDATE res_users_token SET used_at = now()
   WHERE token_hash = p_token_hash AND purpose = 'reset'
     AND used_at IS NULL AND expires_at > now()
  RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  UPDATE res_users SET password = p_password WHERE id = v_user;
  DELETE FROM res_users_session WHERE user_id = v_user;
  RETURN true;
END $$;

-- Solo la API (ppm_app) puede llamarlas
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'auth\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ppm_app', f);
  END LOOP;
END $$;

-- migrate:down
DROP FUNCTION auth_signup(text, text, text), auth_login_lookup(text),
              auth_session_create(integer, text, timestamptz, text), auth_session_user(text),
              auth_session_delete(text), auth_session_delete_all(),
              auth_password_set(text, text), auth_reset_request(text, text, timestamptz),
              auth_reset_confirm(text, text);
DROP TABLE res_users_token, res_users_session;
