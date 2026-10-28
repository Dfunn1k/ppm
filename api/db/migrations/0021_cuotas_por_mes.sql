-- migrate:up
-- Cuotas por mes y estado de cuenta del PDF (correcciones de Dany, 2026-10-28). Reemplaza el reparto
-- estimado de 0018 y la foto calculada de 0020.
--
-- Una compra tuya en cuotas no es gasto el día de la compra: la tarjeta sube por todas las cuotas
-- (cuota × n, lo que le deberás al banco) y del otro lado quedan «Cuotas por venir», como un pago
-- adelantado. En cada corte, la cuota del mes pasa de «Cuotas por venir» a la categoría de la compra;
-- el patrimonio no cambia hasta entonces. Con el «Detalle plan cuotas» del estado de cuenta, la
-- cuota facturada se divide en capital (su categoría) e interés (Intereses). Antes no hay reparto.
-- Si la compra es de otra persona, te debe todas las cuotas desde la compra, una parte por cuota, y
-- no hay reparto.
--
-- El estado de cuenta se importa del PDF: su foto (línea, utilizada, disponible, facturado, saldo de
-- cuotas) es lo que dice el banco y no se recalcula. Sus fechas Del/Al mandan sobre el día de corte
-- de la tarjeta para ese ciclo y el anterior.

-- 1) «Cuotas por venir»: cuenta de sistema, multimoneda
INSERT INTO account_account_template (name, account_type, multicurrency, partner_required, system_role, icon)
VALUES ('Cuotas por venir', 'asset', true, false, 'installments', 'event_repeat');

INSERT INTO account_account (user_id, name, account_type, currency_id, system_role, icon)
SELECT u.id, 'Cuotas por venir', 'asset', NULL, 'installments', 'event_repeat'
  FROM res_users u
 WHERE u.currency_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM account_account a WHERE a.user_id = u.id AND a.system_role = 'installments');

-- 2) El plan: la categoría de la compra (tuya) y el precio (lo que ocupa de la línea)
DELETE FROM account_move WHERE installment_plan_id IS NOT NULL;   -- los intereses estimados de 0018
ALTER TABLE account_installment_plan
  DROP COLUMN interest_partner_id,
  ADD COLUMN price              numeric(14,2) CHECK (price > 0),   -- el precio; NULL = el total de las cuotas
  ADD COLUMN expense_account_id bigint,                            -- tuya: adónde va cada cuota
  ADD FOREIGN KEY (expense_account_id, user_id) REFERENCES account_account (id, user_id);

-- La cuota (principal) y su interés según el banco; NULL = todavía sin «Detalle plan cuotas»
ALTER TABLE account_installment_plan_line ALTER COLUMN interest DROP NOT NULL, ALTER COLUMN interest DROP DEFAULT;
UPDATE account_installment_plan_line SET interest = NULL;
ALTER TABLE account_installment_plan_line ADD CONSTRAINT plan_line_interest_below CHECK (interest < principal);

DROP FUNCTION set_installment_split(bigint, int, numeric, numeric);
DROP FUNCTION post_installment_interest(date);

-- El calendario: una cuota por corte; la última cierra el redondeo
CREATE OR REPLACE FUNCTION generate_installments(p_plan bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p       account_installment_plan%ROWTYPE;
  v_cuota numeric;
  v_close date;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  v_cuota := coalesce(p.installment_amount, round(p.principal / p.n_installments, 2));
  v_close := p.first_closing;
  FOR k IN 1..p.n_installments LOOP
    INSERT INTO account_installment_plan_line (plan_id, sequence, closing_date, principal)
    VALUES (p_plan, k, v_close,
            CASE WHEN k = p.n_installments THEN p.principal - v_cuota * (p.n_installments - 1) ELSE v_cuota END);
    v_close := card_closing_for(p.card_account_id, v_close + 1);
  END LOOP;
END $$;

-- Una compra registrada pasa a cuotas. El asiento abona la tarjeta por todas las cuotas; el precio
-- es lo que ocupa de la línea. Tuya: cada cuota va a p_expense cuando se factura
DROP FUNCTION create_installment_plan(bigint, int, numeric, bigint);
CREATE FUNCTION create_installment_plan(p_move bigint, p_n int, p_each numeric DEFAULT NULL,
                                        p_price numeric DEFAULT NULL, p_expense bigint DEFAULT NULL) RETURNS bigint
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
  IF p_each IS NOT NULL AND p_each * p_n <> l.principal THEN
    RAISE EXCEPTION '% cuotas de % no son %', p_n, p_each, l.principal USING ERRCODE = 'check_violation';
  END IF;
  IF p_price IS NOT NULL AND p_price > l.principal THEN
    RAISE EXCEPTION '% cuotas de % no llegan a lo que costó: revisa la cuota', p_n, p_each
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT date INTO v_date FROM account_move WHERE id = p_move;
  INSERT INTO account_installment_plan (move_id, card_account_id, currency_id, principal, n_installments,
                                        first_closing, installment_amount, price, expense_account_id)
  VALUES (p_move, l.account_id, l.currency_id, l.principal, p_n, card_closing_for(l.account_id, v_date),
          p_each, p_price, p_expense)
  RETURNING id INTO v_plan;
  PERFORM generate_installments(v_plan);
  RETURN v_plan;
END $$;

-- Las cuotas tuyas que ya se facturaron: un asiento por cuota con la fecha de su corte, de «Cuotas
-- por venir» a la categoría de la compra (o capital a la categoría e interés a Intereses, si ya
-- está el detalle del banco). Como las recurrentes, se genera al abrir la app
CREATE FUNCTION post_installment_billing(p_today date DEFAULT user_today()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  r       record;
  v_move  bigint;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT pl.plan_id, pl.sequence, pl.closing_date, p.n_installments, m.ref
      FROM account_installment_plan_line pl
      JOIN account_installment_plan p ON p.id = pl.plan_id AND p.expense_account_id IS NOT NULL
      JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
     WHERE pl.closing_date <= p_today
       AND NOT EXISTS (SELECT 1 FROM account_move x
                        WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence)
     ORDER BY pl.closing_date, pl.plan_id
  LOOP
    INSERT INTO account_move (date, ref, state, installment_plan_id, installment_sequence)
    VALUES (greatest(r.closing_date, v_lock + 1),             -- en un periodo cerrado: queda por confirmar
            format('%s · cuota %s/%s', coalesce(r.ref, 'Compra en cuotas'), r.sequence, r.n_installments),
            'draft', r.plan_id, r.sequence)
    RETURNING id INTO v_move;
    PERFORM write_installment_billing(v_move);
    IF r.closing_date > v_lock THEN
      UPDATE account_move SET state = 'posted' WHERE id = v_move;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- Los apuntes del asiento de una cuota: sale de «Cuotas por venir» (en la moneda de la compra, al
-- tipo de la compra) y va a la categoría; con el detalle del banco, el interés va a Intereses
CREATE FUNCTION write_installment_billing(p_move bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r      record;
  v_amt  numeric;
  v_int  numeric;
BEGIN
  SELECT pl.principal, pl.interest, p.currency_id, p.expense_account_id, installment_plan_rate(p.id) AS rate
    INTO r
    FROM account_move m
    JOIN account_installment_plan_line pl ON pl.plan_id = m.installment_plan_id AND pl.sequence = m.installment_sequence
    JOIN account_installment_plan p ON p.id = pl.plan_id
   WHERE m.id = p_move;
  DELETE FROM account_move_line WHERE move_id = p_move;
  v_amt := round(r.principal * r.rate, 2);
  v_int := CASE WHEN r.interest > 0 THEN round(r.interest * r.rate, 2) ELSE 0 END;
  INSERT INTO account_move_line (move_id, account_id, name, credit, currency_id, amount_currency)
  VALUES (p_move, system_account('installments'), 'Cuota', v_amt, r.currency_id, -r.principal);
  INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
  VALUES (p_move, r.expense_account_id, 'Cuota', v_amt - v_int, v_base, v_amt - v_int);
  IF v_int > 0 THEN
    INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
    VALUES (p_move, system_account('interest'), 'Interés', v_int, v_base, v_int);
  END IF;
END $$;

-- El «Detalle plan cuotas» del banco para una cuota: capital + interés = la cuota. Si ya se
-- facturó (tuya), su asiento se divide. De otra persona, solo queda anotado
CREATE FUNCTION set_installment_detail(p_plan bigint, p_sequence int, p_capital numeric, p_interest numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_cuota numeric;
  v_move  bigint;
BEGIN
  SELECT principal INTO v_cuota FROM account_installment_plan_line WHERE plan_id = p_plan AND sequence = p_sequence;
  IF v_cuota IS NULL THEN
    RAISE EXCEPTION 'No encontramos esa cuota' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_capital IS NULL OR p_capital <= 0 OR p_interest IS NULL OR p_interest < 0 THEN
    RAISE EXCEPTION 'El capital va mayor que cero y el interés, cero o más' USING ERRCODE = 'check_violation';
  END IF;
  IF p_capital + p_interest <> v_cuota THEN
    RAISE EXCEPTION 'Capital % + interés % no es la cuota %', p_capital, p_interest, v_cuota
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE account_installment_plan_line SET interest = p_interest WHERE plan_id = p_plan AND sequence = p_sequence;
  SELECT id INTO v_move FROM account_move WHERE installment_plan_id = p_plan AND installment_sequence = p_sequence;
  IF v_move IS NOT NULL THEN
    PERFORM write_installment_billing(v_move);
  END IF;
END $$;

-- 3) El estado de cuenta: lo que dice el PDF, sin recalcular
DELETE FROM account_credit_card_statement;     -- las fotos calculadas de 0020
ALTER TABLE account_credit_card_statement
  DROP COLUMN used,
  DROP COLUMN installments,
  DROP COLUMN bank_billed,
  DROP COLUMN bank_installments,
  ADD COLUMN date_from date NOT NULL,                              -- «Del»: el ciclo empieza
  ADD COLUMN date_due  date,                                       -- fecha límite de pago
  ADD COLUMN bank_used numeric(14,2) NOT NULL,                     -- línea utilizada
  ADD COLUMN filename  text,
  ADD COLUMN unread    text[] NOT NULL DEFAULT '{}',                -- líneas del PDF que no se pudieron leer
  ALTER COLUMN bank_available SET NOT NULL,                        -- crédito disponible
  ADD CHECK (date_from <= closing_date);

ALTER TABLE account_credit_card_statement_currency
  DROP COLUMN debt,
  DROP COLUMN rate,
  DROP COLUMN rate_date,
  ADD COLUMN bank_billed       numeric(14,2),                      -- monto total facturado
  ADD COLUMN bank_installments numeric(14,2);                      -- saldo de compras en cuotas

ALTER TABLE account_credit_card_statement_line
  ADD COLUMN kind text NOT NULL DEFAULT 'move' CHECK (kind IN ('move', 'fee'));   -- fee: cargo del banco

-- El «Detalle plan cuotas» del estado de cuenta, como vino
CREATE TABLE account_credit_card_statement_installment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  card_account_id bigint NOT NULL,
  closing_date    date NOT NULL,
  date            date NOT NULL,                                   -- la compra
  name            text NOT NULL,
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  price           numeric(14,2) NOT NULL,
  sequence        smallint NOT NULL,
  n_installments  smallint NOT NULL,
  capital         numeric(14,2) NOT NULL,
  interest        numeric(14,2) NOT NULL,
  plan_id         bigint REFERENCES account_installment_plan (id) ON DELETE SET NULL,   -- su compra en PPM
  FOREIGN KEY (card_account_id, closing_date, user_id)
      REFERENCES account_credit_card_statement (card_account_id, closing_date, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_credit_card_statement_installment');

-- 4) Los cortes: los del estado de cuenta importado mandan sobre el día de corte de la tarjeta
ALTER FUNCTION card_closing_for(bigint, date) RENAME TO card_closing_calc;
ALTER FUNCTION card_last_closing(bigint, date) RENAME TO card_last_calc;

-- El corte que le toca a una fecha. Dentro de un ciclo importado (Del..Al), su Al. Poco antes de su
-- Del, el día anterior a su Del (así cierra el ciclo de antes). Justo después del último importado,
-- el corte calculado no puede quedar a menos de 10 días: pasa al siguiente
CREATE FUNCTION card_closing_for(p_card bigint, p_date date) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_calc date := card_closing_calc(p_card, p_date);
  s      record;
  v_last date;
BEGIN
  SELECT date_from, closing_date INTO s FROM account_credit_card_statement
   WHERE card_account_id = p_card AND closing_date >= p_date ORDER BY closing_date LIMIT 1;
  IF FOUND THEN
    IF p_date >= s.date_from THEN
      RETURN s.closing_date;
    ELSIF v_calc >= s.date_from - 10 THEN
      RETURN s.date_from - 1;
    END IF;
    RETURN v_calc;
  END IF;
  SELECT max(closing_date) INTO v_last FROM account_credit_card_statement WHERE card_account_id = p_card;
  IF v_last IS NOT NULL AND v_calc - v_last < 10 THEN
    RETURN card_closing_calc(p_card, v_calc + 1);
  END IF;
  RETURN v_calc;
END $$;

-- El último corte en o antes de una fecha
CREATE FUNCTION card_last_closing(p_card bigint, p_date date) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_x date := card_last_calc(p_card, p_date);
  v_c date;
BEGIN
  IF v_x IS NULL THEN
    RETURN NULL;
  END IF;
  FOR k IN 1..4 LOOP
    v_c := card_closing_for(p_card, v_x);
    IF v_c <= p_date THEN
      -- Un corte importado entre el calculado y la fecha
      RETURN greatest(v_c, coalesce((SELECT max(closing_date) FROM account_credit_card_statement
                                       WHERE card_account_id = p_card AND closing_date <= p_date), v_c));
    END IF;
    v_x := card_last_calc(p_card, v_x - 1);
  END LOOP;
  RETURN v_c;
END $$;

-- Al importar un estado de cuenta: las cuotas (y sus partes por cobrar y sus asientos) pasan al
-- corte que les toca con las fechas del banco
CREATE FUNCTION realign_card_closings(p_card bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE account_move_line l SET maturity_closing = card_closing_for(p_card, l.maturity_closing)
    FROM account_installment_plan p
   WHERE p.card_account_id = p_card AND l.move_id = p.move_id AND l.maturity_closing IS NOT NULL
     AND card_closing_for(p_card, l.maturity_closing) <> l.maturity_closing;
  UPDATE account_installment_plan_line pl SET closing_date = card_closing_for(p_card, pl.closing_date)
    FROM account_installment_plan p
   WHERE p.id = pl.plan_id AND p.card_account_id = p_card
     AND card_closing_for(p_card, pl.closing_date) <> pl.closing_date;
  UPDATE account_move m SET date = pl.closing_date
    FROM account_installment_plan_line pl
   WHERE m.installment_plan_id = pl.plan_id AND m.installment_sequence = pl.sequence
     AND m.date <> pl.closing_date
     AND pl.closing_date > coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
END $$;

-- migrate:down
DROP FUNCTION realign_card_closings(bigint);
DROP FUNCTION card_last_closing(bigint, date);
DROP FUNCTION card_closing_for(bigint, date);
ALTER FUNCTION card_closing_calc(bigint, date) RENAME TO card_closing_for;
ALTER FUNCTION card_last_calc(bigint, date) RENAME TO card_last_closing;

DROP TABLE account_credit_card_statement_installment;
ALTER TABLE account_credit_card_statement_line DROP COLUMN kind;
DELETE FROM account_credit_card_statement;
ALTER TABLE account_credit_card_statement_currency
  DROP COLUMN bank_billed,
  DROP COLUMN bank_installments,
  ADD COLUMN debt numeric(14,2) NOT NULL,
  ADD COLUMN rate numeric(12,6) CHECK (rate > 0),
  ADD COLUMN rate_date date;
ALTER TABLE account_credit_card_statement
  DROP COLUMN date_from,
  DROP COLUMN date_due,
  DROP COLUMN bank_used,
  DROP COLUMN filename,
  DROP COLUMN unread,
  ALTER COLUMN bank_available DROP NOT NULL,
  ADD COLUMN used numeric(14,2) NOT NULL,
  ADD COLUMN installments numeric(14,2) NOT NULL,
  ADD COLUMN bank_billed numeric(14,2),
  ADD COLUMN bank_installments numeric(14,2) CHECK (bank_installments >= 0);

DROP FUNCTION set_installment_detail(bigint, int, numeric, numeric);
DELETE FROM account_move WHERE installment_plan_id IS NOT NULL;
DROP FUNCTION post_installment_billing(date);
DROP FUNCTION write_installment_billing(bigint);

DROP FUNCTION create_installment_plan(bigint, int, numeric, numeric, bigint);
CREATE FUNCTION create_installment_plan(p_move bigint, p_n int, p_each numeric DEFAULT NULL,
                                        p_interest_partner bigint DEFAULT NULL) RETURNS bigint
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
  INSERT INTO account_installment_plan (move_id, card_account_id, currency_id, principal, n_installments,
                                        first_closing, installment_amount, interest_partner_id)
  VALUES (p_move, l.account_id, l.currency_id, l.principal, p_n, card_closing_for(l.account_id, v_date),
          p_each, p_interest_partner)
  RETURNING id INTO v_plan;
  PERFORM generate_installments(v_plan);
  RETURN v_plan;
END $$;

ALTER TABLE account_installment_plan
  DROP COLUMN price,
  DROP COLUMN expense_account_id,
  ADD COLUMN interest_partner_id bigint,
  ADD FOREIGN KEY (interest_partner_id, user_id) REFERENCES res_partner (id, user_id);

ALTER TABLE account_installment_plan_line DROP CONSTRAINT plan_line_interest_below;
UPDATE account_installment_plan_line SET interest = 0 WHERE interest IS NULL;
ALTER TABLE account_installment_plan_line ALTER COLUMN interest SET NOT NULL, ALTER COLUMN interest SET DEFAULT 0;

CREATE OR REPLACE FUNCTION generate_installments(p_plan bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p       account_installment_plan%ROWTYPE;
  v_cuota numeric;
  v_saldo numeric;
  v_int   numeric;
  v_ints  numeric;
  v_close date;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  v_cuota := round(p.principal / p.n_installments, 2);
  v_saldo := p.principal;
  v_ints  := coalesce(p.installment_amount * p.n_installments - p.principal, 0);
  IF v_ints < 0 THEN
    RAISE EXCEPTION '% cuotas de % no llegan a lo que costó: revisa la cuota', p.n_installments, p.installment_amount
      USING ERRCODE = 'check_violation';
  END IF;
  v_int   := round(v_ints / p.n_installments, 2);
  v_close := p.first_closing;
  FOR k IN 1..p.n_installments LOOP
    INSERT INTO account_installment_plan_line (plan_id, sequence, closing_date, principal, interest)
    VALUES (p_plan, k, v_close,
            CASE WHEN k = p.n_installments THEN v_saldo ELSE v_cuota END,
            CASE WHEN k = p.n_installments THEN v_ints ELSE v_int END);
    v_saldo := v_saldo - v_cuota;
    v_ints  := v_ints - v_int;
    v_close := card_closing_for(p.card_account_id, v_close + 1);
  END LOOP;
END $$;

CREATE FUNCTION post_installment_interest(p_today date DEFAULT user_today()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r       record;
  v_move  bigint;
  v_date  date;
  v_amt   numeric;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT pl.plan_id, pl.sequence, pl.closing_date, pl.interest, p.card_account_id, p.currency_id,
           p.n_installments, p.interest_partner_id, m.ref, installment_plan_rate(p.id) AS rate
      FROM account_installment_plan_line pl
      JOIN account_installment_plan p ON p.id = pl.plan_id
      JOIN account_move m ON m.id = p.move_id AND m.state = 'posted'
     WHERE pl.interest > 0 AND pl.closing_date <= p_today
       AND NOT EXISTS (SELECT 1 FROM account_move x
                        WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence)
     ORDER BY pl.closing_date, pl.plan_id
  LOOP
    v_date := greatest(r.closing_date, v_lock + 1);
    INSERT INTO account_move (date, ref, state, installment_plan_id, installment_sequence)
    VALUES (v_date, format('%s · cuota %s/%s', coalesce(r.ref, 'Compra en cuotas'), r.sequence, r.n_installments),
            'draft', r.plan_id, r.sequence)
    RETURNING id INTO v_move;
    v_amt := round(r.interest * r.rate, 2);
    INSERT INTO account_move_line (move_id, account_id, name, credit, currency_id, amount_currency)
    VALUES (v_move, r.card_account_id, 'Interés', v_amt, r.currency_id, -r.interest);
    IF r.interest_partner_id IS NOT NULL THEN
      INSERT INTO account_move_line (move_id, account_id, partner_id, name, debit, currency_id, amount_currency,
                                     maturity_closing)
      VALUES (v_move, system_account('receivable'), r.interest_partner_id, 'Interés', v_amt, r.currency_id,
              r.interest, r.closing_date);
    ELSE
      INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
      VALUES (v_move, system_account('interest'), 'Interés', v_amt, v_base, v_amt);
    END IF;
    IF r.closing_date > v_lock THEN
      UPDATE account_move SET state = 'posted' WHERE id = v_move;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- De vuelta solo la firma: el reparto de 0018 no se recupera
CREATE FUNCTION set_installment_split(p_plan bigint, p_sequence int, p_principal numeric, p_interest numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE account_installment_plan_line SET principal = p_principal, interest = p_interest
   WHERE plan_id = p_plan AND sequence = p_sequence;
END $$;

DELETE FROM account_move m
 WHERE EXISTS (SELECT 1 FROM account_move_line l JOIN account_account a ON a.id = l.account_id
                WHERE l.move_id = m.id AND a.system_role = 'installments');
ALTER TABLE account_account DISABLE TRIGGER account_system;
DELETE FROM account_account WHERE system_role = 'installments';
ALTER TABLE account_account ENABLE TRIGGER account_system;
DELETE FROM account_account_template WHERE system_role = 'installments';
