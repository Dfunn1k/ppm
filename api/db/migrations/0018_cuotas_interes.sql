-- migrate:up
-- Cuotas con capital e interés (correcciones de Dany, 2026-10-28). Una compra en cuotas se registra
-- por su precio: es el gasto del día y el capital del plan, y es lo que ocupa la línea (el banco no
-- cuenta los intereses que aún no cobra). Cada cuota guarda su capital y su interés: el interés es
-- una estimación (la cuota del cronograma × n − el precio, en partes iguales) y se vuelve gasto
-- recién en el corte que factura la cuota, como un cargo del banco. Si la compra es de otra
-- persona, ese interés va a lo que te debe, no a tus Intereses. Con el «Detalle plan cuotas» del
-- estado de cuenta se corrige el reparto de una cuota; el capital que falta se reparte entre las
-- que quedan y siempre suma el precio.
-- Las compras registradas antes (precio + intereses en el plan, regla de 0016) quedan con interés 0.

ALTER TABLE account_installment_plan
  ADD COLUMN installment_amount  numeric(14,2) CHECK (installment_amount > 0),   -- la cuota del banco; NULL = sin dato
  ADD COLUMN interest_partner_id bigint,                                         -- de otra persona: le toca el interés
  ADD FOREIGN KEY (interest_partner_id, user_id) REFERENCES res_partner (id, user_id);

ALTER TABLE account_installment_plan_line
  ADD COLUMN interest numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest >= 0);

-- El interés de una cuota, ya facturado: el asiento recuerda su cuota (como recurring_id)
ALTER TABLE account_move
  ADD COLUMN installment_plan_id  bigint,
  ADD COLUMN installment_sequence smallint,
  ADD UNIQUE (installment_plan_id, installment_sequence),
  ADD FOREIGN KEY (installment_plan_id, installment_sequence)
      REFERENCES account_installment_plan_line (plan_id, sequence) ON DELETE CASCADE,
  ADD CHECK ((installment_plan_id IS NULL) = (installment_sequence IS NULL));

-- El calendario: el capital y el interés entre las cuotas, una en cada corte; la última cierra el
-- redondeo de los dos
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

-- Una compra que ya está registrada pasa a cuotas: la primera en el corte que le toca a su fecha.
-- Con la cuota del banco se estima el interés; de otra persona, ese interés se le cobra a ella
DROP FUNCTION create_installment_plan(bigint, int);
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

-- Los apuntes de una compra en cuotas solo cambian al corregir el reparto de una cuota
CREATE OR REPLACE FUNCTION check_plan_line_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ppm.plan_resplit', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM account_installment_plan WHERE move_id = OLD.move_id) THEN
    RAISE EXCEPTION 'Una compra en cuotas no se edita: bórrala y regístrala de nuevo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- El tipo de cambio de la compra: el del apunte de la tarjeta (1 en la moneda base)
CREATE FUNCTION installment_plan_rate(p_plan bigint) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT l.credit / -l.amount_currency
    FROM account_installment_plan p
    JOIN account_move_line l ON l.move_id = p.move_id AND l.account_id = p.card_account_id AND l.credit > 0
   WHERE p.id = p_plan
$$;

-- El interés de las cuotas que ya se facturaron: un asiento por cuota con la fecha de su corte,
-- confirmado (sale del cronograma). La tarjeta sube; del otro lado, tus Intereses o lo que te debe
-- la persona, con el corte de su cuota. Como las recurrentes, se genera al abrir la app
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
    v_date := greatest(r.closing_date, v_lock + 1);          -- en un periodo cerrado: queda por confirmar
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

-- Corregir el reparto de una cuota con el «Detalle plan cuotas» del banco. El capital que falta se
-- reparte entre las cuotas que siguen; la última no tiene a quién pasarle la diferencia. Si el
-- interés ya se facturó, su asiento toma el monto nuevo; de otra persona, cada parte de su deuda
-- sigue al capital de su cuota (sus cobros se vuelven a conciliar después)
CREATE FUNCTION set_installment_split(p_plan bigint, p_sequence int, p_principal numeric, p_interest numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p        account_installment_plan%ROWTYPE;
  v_rate   numeric := installment_plan_rate(p_plan);
  v_before numeric;
  v_rest   numeric;
  v_left   int;
  v_each   numeric;
  v_move   bigint;
  v_amt    numeric;
  v_card   numeric;
  v_parts  numeric;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM account_installment_plan_line
                                  WHERE plan_id = p_plan AND sequence = p_sequence) THEN
    RAISE EXCEPTION 'No encontramos esa cuota' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_principal IS NULL OR p_principal <= 0 OR p_interest IS NULL OR p_interest < 0 THEN
    RAISE EXCEPTION 'El capital va mayor que cero y el interés, cero o más' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(principal), 0) INTO v_before FROM account_installment_plan_line
   WHERE plan_id = p_plan AND sequence < p_sequence;
  SELECT count(*) INTO v_left FROM account_installment_plan_line WHERE plan_id = p_plan AND sequence > p_sequence;
  v_rest := p.principal - v_before - p_principal;
  IF v_left = 0 AND v_rest <> 0 THEN
    RAISE EXCEPTION 'La última cuota cierra el capital: su capital es %', p.principal - v_before
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_left > 0 AND v_rest < 0.01 * v_left THEN
    RAISE EXCEPTION 'Ese capital pasa lo que falta de la compra (%)', p.principal - v_before
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE account_installment_plan_line SET principal = p_principal, interest = p_interest
   WHERE plan_id = p_plan AND sequence = p_sequence;
  IF v_left > 0 THEN
    v_each := round(v_rest / v_left, 2);
    UPDATE account_installment_plan_line
       SET principal = CASE WHEN sequence = p.n_installments THEN v_rest - v_each * (v_left - 1) ELSE v_each END
     WHERE plan_id = p_plan AND sequence > p_sequence;
  END IF;

  -- El interés ya facturado
  SELECT id INTO v_move FROM account_move WHERE installment_plan_id = p_plan AND installment_sequence = p_sequence;
  IF v_move IS NOT NULL AND p_interest = 0 THEN
    DELETE FROM account_move WHERE id = v_move;
  ELSIF v_move IS NOT NULL THEN
    v_amt := round(p_interest * v_rate, 2);
    UPDATE account_move_line SET credit = v_amt, amount_currency = -p_interest
     WHERE move_id = v_move AND credit > 0;
    UPDATE account_move_line SET debit = v_amt,
           amount_currency = CASE WHEN currency_id = p.currency_id THEN p_interest ELSE v_amt END
     WHERE move_id = v_move AND debit > 0;
  END IF;

  -- De otra persona: cada parte de su deuda, con el capital de su cuota
  IF EXISTS (SELECT 1 FROM account_move_line WHERE move_id = p.move_id AND maturity_closing IS NOT NULL) THEN
    PERFORM set_config('ppm.plan_resplit', 'on', true);
    SELECT credit INTO v_card FROM account_move_line
     WHERE move_id = p.move_id AND account_id = p.card_account_id AND credit > 0;
    UPDATE account_move_line l
       SET amount_currency = q.principal, debit = round(q.principal * v_rate, 2)
      FROM account_installment_plan_line q
     WHERE l.move_id = p.move_id AND l.maturity_closing IS NOT NULL
       AND q.plan_id = p_plan AND q.closing_date = l.maturity_closing;
    -- Los céntimos del cambio, a la última parte, para que cuadre con la tarjeta
    SELECT coalesce(sum(debit), 0) INTO v_parts FROM account_move_line WHERE move_id = p.move_id AND debit > 0;
    UPDATE account_move_line SET debit = debit + (v_card - v_parts)
     WHERE id = (SELECT id FROM account_move_line WHERE move_id = p.move_id AND maturity_closing IS NOT NULL
                  ORDER BY maturity_closing DESC LIMIT 1)
       AND v_card <> v_parts;
    PERFORM set_config('ppm.plan_resplit', 'off', true);
  END IF;
END $$;

-- migrate:down
DROP FUNCTION set_installment_split(bigint, int, numeric, numeric);
DROP FUNCTION post_installment_interest(date);
DROP FUNCTION installment_plan_rate(bigint);

CREATE OR REPLACE FUNCTION check_plan_line_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM account_installment_plan WHERE move_id = OLD.move_id) THEN
    RAISE EXCEPTION 'Una compra en cuotas no se edita: bórrala y regístrala de nuevo'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION create_installment_plan(bigint, int, numeric, bigint);
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

CREATE OR REPLACE FUNCTION generate_installments(p_plan bigint) RETURNS void
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

DELETE FROM account_move WHERE installment_plan_id IS NOT NULL;
ALTER TABLE account_move
  DROP COLUMN installment_plan_id,
  DROP COLUMN installment_sequence;
ALTER TABLE account_installment_plan_line DROP COLUMN interest;
ALTER TABLE account_installment_plan
  DROP COLUMN installment_amount,
  DROP COLUMN interest_partner_id;
