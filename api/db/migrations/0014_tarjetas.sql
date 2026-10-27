-- migrate:up
-- Tarjetas de crédito: una cuenta de lo que debes (pasivo, multimoneda) que se llena al revés:
-- cada compra sube lo que le debes al banco. El día de corte cierra cada ciclo; la fecha de pago
-- no se calcula, se copia del estado de cuenta como el vencimiento del recibo de la luz. Comprar en
-- cuotas es comprar al contado con plata que el banco te presta: el gasto cuenta completo el día de
-- la compra y las cuotas son solo el calendario en que te lo cobran (solo capital).

-- Subtipo tarjeta: solo cuentas de pasivo. Usa la clave de su cuenta, como el banco
CREATE TABLE account_credit_card (
  account_id        bigint PRIMARY KEY,
  user_id           integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  account_type      text NOT NULL DEFAULT 'liability' CHECK (account_type = 'liability'),
  bank_id           smallint REFERENCES res_bank (id),
  brand             text CHECK (brand IN ('Visa', 'Mastercard', 'Amex', 'Diners')),
  last4             char(4) CHECK (last4 ~ '^[0-9]{4}$'),         -- solo los últimos 4 dígitos
  expires_on        date,                                         -- vencimiento (fin de mes)
  closing_day       smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),  -- corte
  credit_limit      numeric(14,2) NOT NULL CHECK (credit_limit >= 0),
  limit_currency_id smallint NOT NULL REFERENCES res_currency (id),
  UNIQUE (account_id, user_id),                                   -- destino de las FK compuestas
  FOREIGN KEY (account_id, account_type) REFERENCES account_account (id, account_type) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id)      REFERENCES account_account (id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_credit_card');

-- Un ciclo de facturación por corte, con la fecha de pago que dice el estado de cuenta
CREATE TABLE account_credit_card_cycle (
  card_account_id bigint NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  closing_date    date NOT NULL,                  -- el corte: cierra el ciclo
  date_due        date NOT NULL,                  -- último día de pago
  PRIMARY KEY (card_account_id, closing_date),
  FOREIGN KEY (card_account_id, user_id) REFERENCES account_credit_card (account_id, user_id) ON DELETE CASCADE,
  CHECK (date_due > closing_date)
);
SELECT ppm_enable_rls('account_credit_card_cycle');

-- Una compra en cuotas (como account.payment.term): el asiento de la compra y sus condiciones
CREATE TABLE account_installment_plan (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  move_id         bigint NOT NULL UNIQUE,
  card_account_id bigint NOT NULL,
  currency_id     smallint NOT NULL REFERENCES res_currency (id),  -- moneda de la compra
  principal       numeric(14,2) NOT NULL CHECK (principal > 0),
  n_installments  smallint NOT NULL CHECK (n_installments BETWEEN 1 AND 60),
  first_closing   date NOT NULL,                                  -- corte de la cuota 1
  UNIQUE (id, user_id),
  FOREIGN KEY (move_id, user_id)         REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (card_account_id, user_id) REFERENCES account_credit_card (account_id, user_id)
);
SELECT ppm_enable_rls('account_installment_plan');

-- El calendario: una línea por cuota, solo capital. Se guarda porque es un documento del banco
CREATE TABLE account_installment_plan_line (
  plan_id      bigint NOT NULL,
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  sequence     smallint NOT NULL,                  -- número de cuota
  closing_date date NOT NULL,                      -- corte en que se factura
  principal    numeric(14,2) NOT NULL CHECK (principal > 0),
  PRIMARY KEY (plan_id, sequence),
  FOREIGN KEY (plan_id, user_id) REFERENCES account_installment_plan (id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_installment_plan_line');

-- El día p_day del mes de p_month, o el último día si no existe (corte 31 en febrero → 28)
CREATE FUNCTION day_in_month(p_month date, p_day int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT least(date_trunc('month', p_month)::date + (p_day - 1),
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
$$;

-- El corte que le toca a una fecha: el primero en o después de ella (una compra del día del corte
-- entra en ese ciclo)
CREATE FUNCTION card_closing_for(p_card bigint, p_date date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN day_in_month(p_date, c.closing_day) >= p_date
              THEN day_in_month(p_date, c.closing_day)
              ELSE day_in_month((p_date + interval '1 month')::date, c.closing_day)
         END
    FROM account_credit_card c WHERE c.account_id = p_card
$$;

-- El último corte en o antes de una fecha: el del estado de cuenta que toca pagar
CREATE FUNCTION card_last_closing(p_card bigint, p_date date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN day_in_month(p_date, c.closing_day) <= p_date
              THEN day_in_month(p_date, c.closing_day)
              ELSE day_in_month((p_date - interval '1 month')::date, c.closing_day)
         END
    FROM account_credit_card c WHERE c.account_id = p_card
$$;

-- Alta de una tarjeta: su cuenta de pasivo multimoneda y sus datos, en un solo paso. La línea va en
-- la moneda base. La deuda inicial se registra aparte por moneda (post_card_opening)
CREATE FUNCTION create_credit_card(p_name text, p_closing_day int, p_limit numeric,
                                   p_bank_id smallint DEFAULT NULL, p_brand text DEFAULT NULL,
                                   p_last4 text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_acc bigint;
BEGIN
  INSERT INTO account_account (name, account_type, currency_id, icon)
  VALUES (trim(p_name), 'liability', NULL, 'credit_card') RETURNING id INTO v_acc;
  INSERT INTO account_credit_card (account_id, bank_id, brand, last4, closing_day, credit_limit, limit_currency_id)
  VALUES (v_acc, p_bank_id, p_brand, nullif(trim(p_last4), ''), p_closing_day, p_limit,
          (SELECT currency_id FROM res_users WHERE id = current_user_id()));
  RETURN v_acc;
END $$;

-- Lo que tocaba pagar en el último estado de cuenta, en una moneda: un saldo inicial con fecha del
-- último corte, así queda como «a pagar» y no como «por facturar»
CREATE FUNCTION post_card_opening(p_card bigint, p_currency_id smallint, p_amount numeric,
                                  p_rate numeric DEFAULT 1, p_today date DEFAULT user_today())
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account_credit_card WHERE account_id = p_card) THEN
    RAISE EXCEPTION 'Esa cuenta no es una tarjeta' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN post_opening_balance(p_card, p_amount, card_last_closing(p_card, p_today), p_rate, p_currency_id);
END $$;

-- La fecha de pago de un ciclo, copiada del estado de cuenta; NULL la borra
CREATE FUNCTION set_card_due_date(p_card bigint, p_closing date, p_due date) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF card_closing_for(p_card, p_closing) IS DISTINCT FROM p_closing THEN
    RAISE EXCEPTION 'El % no es un día de corte de esta tarjeta', p_closing USING ERRCODE = 'check_violation';
  END IF;
  IF p_due IS NULL THEN
    DELETE FROM account_credit_card_cycle WHERE card_account_id = p_card AND closing_date = p_closing;
    RETURN;
  END IF;
  IF p_due <= p_closing THEN
    RAISE EXCEPTION 'La fecha de pago va después del corte (%)', p_closing USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO account_credit_card_cycle (card_account_id, closing_date, date_due)
  VALUES (p_card, p_closing, p_due)
  ON CONFLICT (card_account_id, closing_date) DO UPDATE SET date_due = EXCLUDED.date_due;
END $$;

-- El plan va con su compra: el asiento abona la tarjeta por el capital, en la moneda del plan
CREATE FUNCTION check_installment_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account_move_line l
                  WHERE l.move_id = NEW.move_id AND l.account_id = NEW.card_account_id
                    AND l.currency_id = NEW.currency_id AND l.credit > 0
                    AND -l.amount_currency = NEW.principal) THEN
    RAISE EXCEPTION 'Las cuotas son de una compra con esa tarjeta, por el mismo monto y moneda'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_installment_plan
  BEFORE INSERT OR UPDATE ON account_installment_plan
  FOR EACH ROW EXECUTE FUNCTION check_installment_plan();

-- El calendario: el capital entre las cuotas, una en cada corte; la última cierra el redondeo
CREATE FUNCTION generate_installments(p_plan bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p       account_installment_plan%ROWTYPE;
  v_cuota numeric;
  v_saldo numeric;
  v_close date;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  v_cuota := round(p.principal / p.n_installments, 2);
  v_saldo := p.principal;
  v_close := p.first_closing;
  FOR k IN 1..p.n_installments LOOP
    INSERT INTO account_installment_plan_line (plan_id, sequence, closing_date, principal)
    VALUES (p_plan, k, v_close, CASE WHEN k = p.n_installments THEN v_saldo ELSE v_cuota END);
    v_saldo := v_saldo - v_cuota;
    v_close := card_closing_for(p.card_account_id, v_close + 1);
  END LOOP;
END $$;

-- Una compra que ya está registrada pasa a cuotas: la primera en el corte que le toca a su fecha
CREATE FUNCTION create_installment_plan(p_move bigint, p_n int) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  l      record;
  v_date date;
  v_plan bigint;
BEGIN
  IF p_n IS NULL OR p_n NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'En cuotas es de 2 a 60 cuotas' USING ERRCODE = 'check_violation';
  END IF;
  SELECT ln.account_id, ln.currency_id, -ln.amount_currency AS principal, count(*) OVER () AS n
    INTO l
    FROM account_move_line ln
    JOIN account_credit_card c ON c.account_id = ln.account_id
   WHERE ln.move_id = p_move AND ln.credit > 0;
  IF l IS NULL OR l.n <> 1 THEN
    RAISE EXCEPTION 'Solo una compra con una tarjeta va en cuotas' USING ERRCODE = 'check_violation';
  END IF;
  SELECT date INTO v_date FROM account_move WHERE id = p_move;
  INSERT INTO account_installment_plan (move_id, card_account_id, currency_id, principal, n_installments, first_closing)
  VALUES (p_move, l.account_id, l.currency_id, l.principal, p_n, card_closing_for(l.account_id, v_date))
  RETURNING id INTO v_plan;
  PERFORM generate_installments(v_plan);
  RETURN v_plan;
END $$;

-- Cuotas de antes de PPM: las que faltan facturar de una compra vieja. Es un saldo inicial por el
-- capital que falta (no es gasto de este mes) con fecha del último corte, y su plan desde el
-- próximo corte. La cuota del último estado de cuenta ya va en lo que toca pagar
CREATE FUNCTION post_card_installments_opening(p_card bigint, p_currency_id smallint, p_each numeric,
                                               p_n int, p_ref text, p_rate numeric DEFAULT 1,
                                               p_today date DEFAULT user_today())
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_last date;
  v_move bigint;
  v_plan bigint;
BEGIN
  IF p_each IS NULL OR p_each <= 0 THEN
    RAISE EXCEPTION 'Escribe cuánto es cada cuota' USING ERRCODE = 'check_violation';
  END IF;
  IF p_n IS NULL OR p_n NOT BETWEEN 1 AND 59 THEN
    RAISE EXCEPTION 'Faltan de 1 a 59 cuotas' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account_credit_card WHERE account_id = p_card) THEN
    RAISE EXCEPTION 'Esa cuenta no es una tarjeta' USING ERRCODE = 'no_data_found';
  END IF;
  v_last := card_last_closing(p_card, p_today);
  v_move := post_opening_balance(p_card, p_each * p_n, v_last, p_rate, p_currency_id);
  UPDATE account_move SET ref = coalesce(nullif(trim(p_ref), ''), 'Cuotas de antes de PPM') WHERE id = v_move;
  INSERT INTO account_installment_plan (move_id, card_account_id, currency_id, principal, n_installments, first_closing)
  VALUES (v_move, p_card, p_currency_id, p_each * p_n, p_n, card_closing_for(p_card, v_last + 1))
  RETURNING id INTO v_plan;
  PERFORM generate_installments(v_plan);
  RETURN v_move;
END $$;

-- Una compra en cuotas no se edita: se borra con su plan y se registra de nuevo (sus montos,
-- su fecha y su cuenta definen el calendario)
CREATE FUNCTION check_plan_line_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM account_installment_plan WHERE move_id = OLD.move_id) THEN
    RAISE EXCEPTION 'Una compra en cuotas no se edita: bórrala y regístrala de nuevo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_plan_line_locked
  BEFORE UPDATE OF account_id, debit, credit, currency_id, amount_currency ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_plan_line_locked();

CREATE FUNCTION check_plan_move_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.date <> OLD.date OR (NEW.state = 'draft' AND OLD.state = 'posted'))
     AND EXISTS (SELECT 1 FROM account_installment_plan WHERE move_id = OLD.id) THEN
    RAISE EXCEPTION 'Una compra en cuotas no se edita: bórrala y regístrala de nuevo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_plan_move_locked
  BEFORE UPDATE OF date, state ON account_move
  FOR EACH ROW EXECUTE FUNCTION check_plan_move_locked();

-- Estado de cada tarjeta por moneda, a una fecha: cuánto debo, cuánto pago ahora y para cuándo.
--   total_debt: todo lo que debes, incluidas las cuotas que aún no se facturan
--   unbilled:   compras después del último corte más las cuotas de cortes futuros
--   to_pay:     lo facturado (lo demás); si es negativo, es saldo a favor
-- Solo lo confirmado. Una fila por cada moneda que usa la persona.
CREATE FUNCTION credit_card_status(p_today date DEFAULT user_today())
RETURNS TABLE (account_id bigint, currency_id smallint, last_closing date, next_closing date,
               date_due date, total_debt numeric, unbilled numeric, to_pay numeric)
LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT cc.account_id, uc.currency_id, card_last_closing(cc.account_id, p_today) AS last_closing
      FROM account_credit_card cc
      JOIN res_users_currency uc ON uc.user_id = cc.user_id
  )
  SELECT c.account_id, c.currency_id, c.last_closing,
         card_closing_for(c.account_id, c.last_closing + 1),
         cy.date_due,
         coalesce(m.total, 0),
         coalesce(m.charges, 0) + q.installments,
         coalesce(m.total, 0) - coalesce(m.charges, 0) - q.installments
    FROM c
    LEFT JOIN account_credit_card_cycle cy
           ON cy.card_account_id = c.account_id AND cy.closing_date = c.last_closing
   CROSS JOIN LATERAL (
     SELECT -sum(l.amount_currency) AS total,
            -sum(l.amount_currency) FILTER (WHERE l.credit > 0 AND mv.date > c.last_closing
                                              AND p.id IS NULL) AS charges   -- compras sin cuotas tras el corte
       FROM account_move_line l
       JOIN account_move mv ON mv.id = l.move_id AND mv.state = 'posted' AND mv.date <= p_today
       LEFT JOIN account_installment_plan p ON p.move_id = mv.id
      WHERE l.account_id = c.account_id AND l.currency_id = c.currency_id
   ) m
   CROSS JOIN LATERAL (
     SELECT coalesce(sum(pl.principal), 0) AS installments                -- cuotas de cortes futuros
       FROM account_installment_plan_line pl
       JOIN account_installment_plan p ON p.id = pl.plan_id
       JOIN account_move mv ON mv.id = p.move_id AND mv.state = 'posted' AND mv.date <= p_today
      WHERE p.card_account_id = c.account_id AND p.currency_id = c.currency_id
        AND pl.closing_date > c.last_closing
   ) q
$$;

-- migrate:down
DROP FUNCTION credit_card_status(date);
DROP TRIGGER trg_plan_move_locked ON account_move;
DROP TRIGGER trg_plan_line_locked ON account_move_line;
DROP FUNCTION check_plan_move_locked(), check_plan_line_locked(),
              post_card_installments_opening(bigint, smallint, numeric, int, text, numeric, date),
              create_installment_plan(bigint, int), generate_installments(bigint);
DROP TABLE account_installment_plan_line, account_installment_plan, account_credit_card_cycle;
DROP FUNCTION check_installment_plan(), set_card_due_date(bigint, date, date),
              post_card_opening(bigint, smallint, numeric, numeric, date),
              create_credit_card(text, int, numeric, smallint, text, text),
              card_last_closing(bigint, date), card_closing_for(bigint, date), day_in_month(date, int);
DROP TABLE account_credit_card;
