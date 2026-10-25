-- migrate:up
-- Altas de cuentas con su saldo inicial, en un solo paso (nada queda a medias).
-- Corren como quien está en la sesión: la seguridad por fila sigue aplicando.

-- Subtipo banco (res.partner.bank): solo cuentas de activo, con el CCI de su propio banco
CREATE TABLE res_partner_bank (
  account_id   bigint PRIMARY KEY,
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  account_type text NOT NULL DEFAULT 'asset' CHECK (account_type = 'asset'),
  bank_id      smallint NOT NULL REFERENCES res_bank (id),
  acc_kind     text NOT NULL DEFAULT 'savings' CHECK (acc_kind IN ('savings', 'checking')),  -- ahorros / corriente
  acc_number   text CHECK (acc_number ~ '^[0-9-]{6,30}$'),                  -- '191-12345678-0-12'
  cci          char(20) CHECK (cci ~ '^[0-9]{20}$'),                        -- código interbancario
  cci_bank     char(3) GENERATED ALWAYS AS (left(cci, 3)) STORED,
  FOREIGN KEY (account_id, account_type) REFERENCES account_account (id, account_type) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id)      REFERENCES account_account (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (bank_id, cci_bank)        REFERENCES res_bank (id, cci_code)   -- el CCI es de ese banco
);
SELECT ppm_enable_rls('res_partner_bank');

-- La cuenta de sistema con ese rol, de quien está en la sesión
CREATE FUNCTION system_account(p_role text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM account_account WHERE system_role = p_role AND user_id = current_user_id();
$$;

-- Saldo inicial de una cuenta de activo o pasivo: un asiento confirmado contra «Saldos iniciales».
-- p_amount va en la moneda de la cuenta (o p_currency_id, si la cuenta es multimoneda); p_rate
-- convierte a la moneda base. Activo al Debe, pasivo al Haber; un monto negativo va al revés.
CREATE FUNCTION post_opening_balance(p_account bigint, p_amount numeric, p_date date,
                                     p_rate numeric DEFAULT 1,
                                     p_currency_id smallint DEFAULT NULL,
                                     p_partner_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  a      account_account%ROWTYPE;
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_cur  smallint;
  v_amt  numeric;    -- en moneda base
  v_sign int;
  v_move bigint;
BEGIN
  SELECT * INTO a FROM account_account WHERE id = p_account;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta desconocida: %', p_account USING ERRCODE = 'no_data_found';
  END IF;
  IF a.account_type NOT IN ('asset', 'liability') THEN
    RAISE EXCEPTION 'Solo lo que tienes o lo que debes tiene saldo inicial' USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount = 0 THEN
    RETURN NULL;
  END IF;
  v_cur := coalesce(a.currency_id, p_currency_id, v_base);
  IF a.currency_id IS NOT NULL AND p_currency_id IS NOT NULL AND p_currency_id <> a.currency_id THEN
    RAISE EXCEPTION 'La cuenta «%» es en otra moneda', a.name USING ERRCODE = 'check_violation';
  END IF;
  IF v_cur <> v_base AND (p_rate IS NULL OR p_rate <= 0) THEN
    RAISE EXCEPTION 'Falta el tipo de cambio' USING ERRCODE = 'check_violation';
  END IF;
  v_amt  := round(p_amount * CASE WHEN v_cur = v_base THEN 1 ELSE p_rate END, 2);
  v_sign := CASE WHEN a.account_type = 'asset' THEN 1 ELSE -1 END;

  INSERT INTO account_move (date, ref, state)
  VALUES (p_date, 'Saldo inicial', 'posted')
  RETURNING id INTO v_move;

  INSERT INTO account_move_line (move_id, account_id, partner_id, debit, credit, currency_id, amount_currency)
  VALUES (v_move, a.id, p_partner_id,
          greatest(v_sign * v_amt, 0), greatest(-v_sign * v_amt, 0), v_cur, v_sign * p_amount),
         (v_move, system_account('opening'), NULL,
          greatest(-v_sign * v_amt, 0), greatest(v_sign * v_amt, 0), v_base, -v_sign * v_amt);
  RETURN v_move;
END $$;

-- Efectivo, billetera o alcancía: cuenta de activo + saldo inicial
CREATE FUNCTION create_cash_account(p_name text, p_currency_id smallint,
                                    p_opening numeric DEFAULT 0, p_date date DEFAULT user_today(),
                                    p_rate numeric DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_acc bigint;
BEGIN
  INSERT INTO account_account (name, account_type, currency_id, icon)
  VALUES (trim(p_name), 'asset', p_currency_id, 'payments') RETURNING id INTO v_acc;
  PERFORM post_opening_balance(v_acc, p_opening, p_date, p_rate);
  RETURN v_acc;
END $$;

-- Cuenta de banco: cuenta + datos del banco + saldo inicial
CREATE FUNCTION create_bank_account(p_name text, p_currency_id smallint, p_bank_id smallint,
                                    p_acc_kind text DEFAULT 'savings', p_acc_number text DEFAULT NULL,
                                    p_cci char(20) DEFAULT NULL,
                                    p_opening numeric DEFAULT 0, p_date date DEFAULT user_today(),
                                    p_rate numeric DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_acc bigint;
BEGIN
  INSERT INTO account_account (name, account_type, currency_id, icon)
  VALUES (trim(p_name), 'asset', p_currency_id, 'account_balance') RETURNING id INTO v_acc;
  INSERT INTO res_partner_bank (account_id, bank_id, acc_kind, acc_number, cci)
  VALUES (v_acc, p_bank_id, p_acc_kind, nullif(trim(p_acc_number), ''), nullif(p_cci, ''));
  PERFORM post_opening_balance(v_acc, p_opening, p_date, p_rate);
  RETURN v_acc;
END $$;

-- Plata que guardo de otros: la cuenta de sistema 'custody', con la persona y la moneda
CREATE FUNCTION post_custody_opening(p_partner_id bigint, p_currency_id smallint, p_amount numeric,
                                     p_date date DEFAULT user_today(), p_rate numeric DEFAULT 1)
RETURNS bigint LANGUAGE sql AS $$
  SELECT post_opening_balance(system_account('custody'), p_amount, p_date, p_rate, p_currency_id, p_partner_id);
$$;

-- Corregir un saldo inicial: se borra el asiento y se vuelve a hacer (nadie audita; un
-- historial limpio vale más que el rastro del error)
CREATE FUNCTION set_opening_balance(p_account bigint, p_amount numeric, p_date date,
                                    p_rate numeric DEFAULT 1, p_currency_id smallint DEFAULT NULL,
                                    p_partner_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM account_move m
   WHERE EXISTS (SELECT 1 FROM account_move_line l
                  WHERE l.move_id = m.id AND l.account_id = p_account
                    AND l.partner_id IS NOT DISTINCT FROM p_partner_id
                    AND (p_currency_id IS NULL OR l.currency_id = p_currency_id))
     AND EXISTS (SELECT 1 FROM account_move_line l
                  WHERE l.move_id = m.id AND l.account_id = system_account('opening'));
  RETURN post_opening_balance(p_account, p_amount, p_date, p_rate, p_currency_id, p_partner_id);
END $$;

-- migrate:down
DROP FUNCTION set_opening_balance(bigint, numeric, date, numeric, smallint, bigint),
              post_custody_opening(bigint, smallint, numeric, date, numeric),
              create_bank_account(text, smallint, smallint, text, text, char(20), numeric, date, numeric),
              create_cash_account(text, smallint, numeric, date, numeric),
              post_opening_balance(bigint, numeric, date, numeric, smallint, bigint),
              system_account(text);
DROP TABLE res_partner_bank;
