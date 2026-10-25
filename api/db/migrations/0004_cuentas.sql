-- migrate:up
-- Cuentas (account.account) y la plantilla con la que nace cada usuario.

CREATE TABLE account_account (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  name             text NOT NULL,
  account_type     text NOT NULL REFERENCES account_account_type (code),
  parent_id        bigint,                                -- jerarquía opcional (categorías)
  currency_id      smallint REFERENCES res_currency (id), -- NULL = multimoneda (tarjetas, personas)
  partner_required boolean NOT NULL DEFAULT false,        -- sus apuntes deben decir con quién
  system_role      text,                                  -- la usa la lógica: 'opening', 'fx_gain'…
  icon             text CHECK (icon ~ '^[a-z0-9_]+$'),    -- Material Symbols; NULL = el del padre
  color            smallint CHECK (color BETWEEN 0 AND 11), -- paleta fija; NULL = el del padre
  active           boolean NOT NULL DEFAULT true,
  create_date      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),                                   -- destino de las FK compuestas
  UNIQUE (id, account_type),                              -- para las FK de los subtipos
  UNIQUE NULLS NOT DISTINCT (user_id, parent_id, name, currency_id),
  UNIQUE (user_id, system_role),                          -- un rol de sistema por usuario
  FOREIGN KEY (parent_id, user_id) REFERENCES account_account (id, user_id),
  CHECK (currency_id IS NOT NULL OR account_type IN ('asset', 'liability'))
);
SELECT ppm_enable_rls('account_account');

-- Campos calculados, como los computed fields de Odoo. security_invoker: la vista
-- respeta la seguridad por fila de quien consulta, no la de su dueño.
CREATE VIEW account_account_v WITH (security_invoker = true) AS
SELECT a.*, t.normal_side,
       CASE WHEN a.currency_id IS NULL THEN a.name
            ELSE a.name || ' (' || c.name || ')' END AS display_name  -- 'Cuenta digital BCP (PEN)'
  FROM account_account a
  JOIN account_account_type t ON t.code = a.account_type
  LEFT JOIN res_currency c    ON c.id = a.currency_id;
GRANT SELECT ON account_account_v TO ppm_app;

-- Las cuentas de sistema no se borran, no se archivan ni cambian de tipo (renombrarlas sí)
CREATE FUNCTION trg_account_system() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.system_role IS NOT NULL AND (TG_OP = 'DELETE' OR NOT NEW.active
       OR NEW.account_type <> OLD.account_type OR NEW.system_role IS DISTINCT FROM OLD.system_role) THEN
    RAISE EXCEPTION 'La cuenta «%» la usa la app (%): no se puede borrar, archivar ni cambiar de tipo',
      OLD.name, OLD.system_role;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Al borrar un usuario se borra todo lo suyo: ahí la regla no aplica
CREATE TRIGGER account_system BEFORE UPDATE OR DELETE ON account_account
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION trg_account_system();

-- Plantilla de cuentas iniciales (account.chart.template de Odoo), una para todos los países
CREATE TABLE account_account_template (
  id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id        smallint REFERENCES account_account_template (id),  -- subcategorías
  name             text NOT NULL,
  account_type     text NOT NULL REFERENCES account_account_type (code),
  multicurrency    boolean NOT NULL DEFAULT false,        -- se crea sin moneda
  partner_required boolean NOT NULL DEFAULT false,
  system_role      text UNIQUE,                           -- la usa la lógica: no se borra
  icon             text,                                  -- ícono por defecto (Material Symbols)
  color            smallint,                              -- color por defecto
  UNIQUE NULLS NOT DISTINCT (parent_id, name)
);
GRANT SELECT ON account_account_template TO ppm_app;

-- Cuentas de sistema
INSERT INTO account_account_template (name, account_type, multicurrency, partner_required, system_role) VALUES
  ('Saldos iniciales',            'equity',    false, false, 'opening'),
  ('Efectivo',                    'asset',     false, false, NULL),
  ('Por cobrar',                  'asset',     true,  true,  'receivable'),
  ('Por pagar',                   'liability', true,  true,  'payable'),
  ('Plata que guardo de otros',   'liability', true,  true,  'custody'),
  ('Por clasificar',              'asset',     true,  false, 'suspense'),
  ('Ganancia por tipo de cambio', 'income',    false, false, 'fx_gain');

-- Categorías: primero las principales, luego sus hijas
INSERT INTO account_account_template (name, account_type)
SELECT unnest(ARRAY['Comida y bebida', 'Compras', 'Vivienda', 'Transporte', 'Vehículo',
                    'Vida y entretenimiento', 'Comunicaciones', 'Gastos financieros']), 'expense'
UNION ALL
SELECT unnest(ARRAY['Salario y facturas', 'Cheques, cupones y vales', 'Cuotas y subvenciones',
                    'Ingresos por alquiler', 'Intereses y dividendos', 'Lotería y apuestas',
                    'Pensión alimenticia', 'Regalos', 'Venta']), 'income';

INSERT INTO account_account_template (parent_id, name, account_type, system_role)
SELECT p.id, v.name, 'expense', v.role
  FROM (VALUES
    ('Comida y bebida', 'Supermercado y mercado', NULL), ('Comida y bebida', 'Restaurantes y delivery', NULL),
    ('Comida y bebida', 'Cafés y bares', NULL),
    ('Compras', 'Ropa y calzado', NULL), ('Compras', 'Electrónica', NULL), ('Compras', 'Hogar', NULL),
    ('Compras', 'Farmacia', NULL), ('Compras', 'Salud y belleza', NULL), ('Compras', 'Papelería y herramientas', NULL),
    ('Compras', 'Joyería y accesorios', NULL), ('Compras', 'Regalos', NULL), ('Compras', 'Niños', NULL),
    ('Compras', 'Mascotas y animales', NULL),
    ('Vivienda', 'Alquiler', NULL), ('Vivienda', 'Hipoteca', NULL), ('Vivienda', 'Servicios', NULL),
    ('Vivienda', 'Mantenimiento', NULL), ('Vivienda', 'Seguros de propiedad', NULL), ('Vivienda', 'Impuestos de propiedad', NULL),
    ('Transporte', 'Transporte público', NULL), ('Transporte', 'Taxi y apps', NULL), ('Transporte', 'Viajes largos', NULL),
    ('Vehículo', 'Combustible', NULL), ('Vehículo', 'Estacionamiento y peajes', NULL),
    ('Vehículo', 'Mantenimiento', NULL), ('Vehículo', 'Seguro vehicular', NULL),
    ('Vida y entretenimiento', 'Salud', NULL), ('Vida y entretenimiento', 'Deporte', NULL),
    ('Vida y entretenimiento', 'Educación', NULL), ('Vida y entretenimiento', 'Streaming y suscripciones', NULL),
    ('Vida y entretenimiento', 'Eventos', NULL), ('Vida y entretenimiento', 'Viajes', NULL),
    ('Vida y entretenimiento', 'Hobbies', NULL), ('Vida y entretenimiento', 'Donaciones', NULL),
    ('Comunicaciones', 'Celular', NULL), ('Comunicaciones', 'Internet', NULL), ('Comunicaciones', 'Software y apps', NULL),
    ('Gastos financieros', 'Comisiones bancarias', NULL), ('Gastos financieros', 'Intereses', 'interest'),
    ('Gastos financieros', 'Seguros', NULL), ('Gastos financieros', 'Impuestos y multas', NULL),
    ('Gastos financieros', 'Deudas incobrables', NULL), ('Gastos financieros', 'Costo del cambio', 'fx_loss')
  ) AS v (parent, name, role)
  JOIN account_account_template p ON p.name = v.parent AND p.parent_id IS NULL AND p.account_type = 'expense';

-- La configuración inicial (los 3 pasos de la app), en un solo llamado.
-- La moneda base es siempre la del país: Perú → soles.
CREATE FUNCTION setup_user(p_country char(2),
                           p_other_currencies char(3)[] DEFAULT '{}',
                           p_lang text DEFAULT NULL,        -- NULL = el del país
                           p_tz text DEFAULT NULL)          -- NULL = se queda la que tiene
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_user    integer := current_user_id();
  v_country res_country%ROWTYPE;
  v_lang    smallint;
  v_map     bigint[] := '{}';   -- id de plantilla → id de cuenta creada
  v_id      bigint;
  t         record;
BEGIN
  IF (SELECT currency_id FROM res_users WHERE id = v_user) IS NOT NULL THEN
    RAISE EXCEPTION 'La configuración inicial ya se hizo';
  END IF;

  SELECT * INTO v_country FROM res_country WHERE code = upper(p_country);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'País desconocido: %', p_country;
  END IF;

  v_lang := coalesce((SELECT id FROM res_lang WHERE code = p_lang), v_country.lang_id);
  IF p_lang IS NOT NULL AND NOT EXISTS (SELECT 1 FROM res_lang WHERE code = p_lang) THEN
    RAISE EXCEPTION 'Idioma desconocido: %', p_lang;
  END IF;
  IF p_tz IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN
    RAISE EXCEPTION 'Zona horaria desconocida: %', p_tz;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_other_currencies) c
              WHERE NOT EXISTS (SELECT 1 FROM res_currency WHERE name = upper(c))) THEN
    RAISE EXCEPTION 'Moneda desconocida en %', p_other_currencies;
  END IF;

  UPDATE res_users
     SET country_id = v_country.id, currency_id = v_country.currency_id, lang_id = v_lang,
         tz = coalesce(p_tz, tz)
   WHERE id = v_user;

  -- Monedas que usa: la base y las demás
  INSERT INTO res_users_currency (user_id, currency_id)
  SELECT v_user, id FROM res_currency
   WHERE id = v_country.currency_id
      OR name = ANY (SELECT upper(c) FROM unnest(p_other_currencies) c);

  -- Cuentas iniciales: las principales antes que sus hijas
  FOR t IN
    WITH RECURSIVE tree AS (
      SELECT tt.*, 0 AS depth FROM account_account_template tt WHERE tt.parent_id IS NULL
      UNION ALL
      SELECT c.*, tree.depth + 1 FROM account_account_template c JOIN tree ON c.parent_id = tree.id
    )
    SELECT * FROM tree ORDER BY depth, id
  LOOP
    INSERT INTO account_account (user_id, name, account_type, parent_id, currency_id,
                                 partner_required, system_role, icon, color)
    VALUES (v_user, t.name, t.account_type, v_map[t.parent_id],
            CASE WHEN t.multicurrency THEN NULL ELSE v_country.currency_id END,
            t.partner_required, t.system_role, t.icon, t.color)
    RETURNING id INTO v_id;
    v_map[t.id] := v_id;
  END LOOP;
  RETURN v_user;
END $$;

-- migrate:down
DROP FUNCTION setup_user(char(2), char(3)[], text, text);
DROP TABLE account_account_template;
DROP VIEW account_account_v;
DROP TABLE account_account;
DROP FUNCTION trg_account_system();
