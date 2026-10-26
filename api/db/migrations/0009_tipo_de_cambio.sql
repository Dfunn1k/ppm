-- migrate:up
-- Tipo de cambio global: lo mantiene PPM (el importador de SUNAT y el administrador) y todos lo leen.
-- Es moneda base por unidad (soles por dólar). La tasa propia de un movimiento queda en sus apuntes
-- (balance / amount_currency) y nunca toca esta tabla.

CREATE TABLE res_currency_rate (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  name        date NOT NULL,                     -- la fecha, como en Odoo
  rate_buy    numeric(10,4) NOT NULL,            -- compra (moneda base por unidad)
  rate_sell   numeric(10,4) NOT NULL,            -- venta
  source      text NOT NULL DEFAULT 'SUNAT'
              CHECK (source IN ('SUNAT', 'manual')),  -- importador o a mano
  create_date timestamptz NOT NULL DEFAULT now(),     -- cuándo se cargó por última vez
  CHECK (rate_buy > 0 AND rate_sell >= rate_buy),
  UNIQUE (currency_id, name)
);

-- Los usuarios solo leen; escriben el importador y el administrador (ppm_admin)
GRANT SELECT ON res_currency_rate TO ppm_app;

-- Cargar el tipo de un día: manda el último que se cargó, sea de SUNAT o a mano
CREATE FUNCTION set_currency_rate(p_currency text, p_date date, p_buy numeric, p_sell numeric,
                                  p_source text DEFAULT 'SUNAT')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_currency smallint := (SELECT id FROM res_currency WHERE name = upper(p_currency));
BEGIN
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'No conocemos la moneda %', p_currency USING ERRCODE = 'check_violation';
  END IF;
  IF upper(p_currency) = 'PEN' THEN
    RAISE EXCEPTION 'El tipo de cambio es en soles por unidad: el sol no lleva uno'
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO res_currency_rate (currency_id, name, rate_buy, rate_sell, source)
  VALUES (v_currency, p_date, p_buy, p_sell, p_source)
  ON CONFLICT (currency_id, name) DO UPDATE
    SET rate_buy = EXCLUDED.rate_buy, rate_sell = EXCLUDED.rate_sell,
        source = EXCLUDED.source, create_date = now();
END $$;

REVOKE EXECUTE ON FUNCTION set_currency_rate(text, date, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_currency_rate(text, date, numeric, numeric, text) TO ppm_admin;

-- Qué lado usar: compra para lo que tienes, venta para lo que debes
CREATE FUNCTION rate_side(p_account_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_account_type = 'liability' THEN 'sell' ELSE 'buy' END;
$$;

-- Tipo de cambio para una fecha: el de ese día o el último anterior.
-- Ejemplo: get_rate(usd, fecha, rate_side(cuenta.account_type))
CREATE FUNCTION get_rate(p_currency_id smallint, p_date date, p_side text)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_rate numeric;
BEGIN
  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'El lado del tipo de cambio es buy o sell, no %', p_side;
  END IF;
  IF p_currency_id = v_base THEN RETURN 1; END IF;
  SELECT CASE WHEN p_side = 'buy' THEN rate_buy ELSE rate_sell END
    INTO v_rate
    FROM res_currency_rate
   WHERE currency_id = p_currency_id AND name <= p_date
   ORDER BY name DESC
   LIMIT 1;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'Falta el tipo de cambio de % para el %',
      (SELECT name FROM res_currency WHERE id = p_currency_id), p_date
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_rate;
END $$;

-- Qué tan al día está cada moneda que alguien usa (lo ve el administrador). Fecha de Lima: SUNAT es de Perú
CREATE VIEW res_currency_rate_status AS
SELECT c.name AS currency, u.personas, r.name AS ultima_fecha, r.source, r.create_date,
       (now() AT TIME ZONE 'America/Lima')::date - r.name AS dias,
       r.name IS NULL OR (now() AT TIME ZONE 'America/Lima')::date - r.name > 3 AS desactualizado
  FROM res_currency c
  JOIN (SELECT currency_id, count(*) AS personas FROM res_users_currency GROUP BY currency_id) u
    ON u.currency_id = c.id
  LEFT JOIN LATERAL (
    SELECT name, source, create_date FROM res_currency_rate
     WHERE currency_id = c.id ORDER BY name DESC LIMIT 1
  ) r ON true
 WHERE c.name <> 'PEN';

-- migrate:down
DROP VIEW res_currency_rate_status;
DROP FUNCTION get_rate(smallint, date, text);
DROP FUNCTION rate_side(text);
DROP FUNCTION set_currency_rate(text, date, numeric, numeric, text);
DROP TABLE res_currency_rate;
