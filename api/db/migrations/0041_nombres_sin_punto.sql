-- migrate:up

-- Caso 10 de «Sin punto como conector»: los nombres que PPM pone a los asientos que crea ya no llevan «·».
-- Una cuota o una parte repartida se llama como la compra («Laptop»); cuál es la dice el asiento
-- (installment_sequence o deferral_sequence) y la app la pinta en pastilla («3 de 12»). Lo que cancela
-- dice primero qué pasó: «Devolución de Laptop», «Pago adelantado de Celular», «Cancelación de SOAT».

CREATE OR REPLACE FUNCTION post_installment_billing(p_today date DEFAULT user_today()) RETURNS integer
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
            coalesce(r.ref, 'Compra en cuotas'),
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

CREATE OR REPLACE FUNCTION post_deferrals(p_today date DEFAULT user_today()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r       record;
  v_hold  bigint;
  v_move  bigint;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT dl.deferral_id, dl.sequence, dl.date, dl.amount, d.kind, d.category_account_id, m.ref,
           (SELECT count(*) FROM account_deferral_line x WHERE x.deferral_id = d.id) AS n
      FROM account_deferral_line dl
      JOIN account_deferral d ON d.id = dl.deferral_id AND d.cancel_move_id IS NULL
      JOIN account_move m ON m.id = d.move_id AND m.state = 'posted'
     WHERE dl.date <= p_today
       AND NOT EXISTS (SELECT 1 FROM account_move x
                        WHERE x.deferral_id = dl.deferral_id AND x.deferral_sequence = dl.sequence)
     ORDER BY dl.date, dl.deferral_id, dl.sequence
  LOOP
    v_hold := system_account(CASE r.kind WHEN 'expense' THEN 'prepaid' ELSE 'unearned' END);
    INSERT INTO account_move (date, ref, state, deferral_id, deferral_sequence)
    VALUES (greatest(r.date, v_lock + 1),                -- en un periodo cerrado: queda por confirmar
            coalesce(r.ref, 'Repartido'),
            'draft', r.deferral_id, r.sequence)
    RETURNING id INTO v_move;
    -- El gasto: de lo que espera a la categoría. El ingreso: de lo que debes a la categoría
    INSERT INTO account_move_line (move_id, account_id, debit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN r.category_account_id ELSE v_hold END, r.amount, v_base, r.amount);
    INSERT INTO account_move_line (move_id, account_id, credit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN v_hold ELSE r.category_account_id END, r.amount, v_base, -r.amount);
    IF r.date > v_lock THEN
      UPDATE account_move SET state = 'posted' WHERE id = v_move;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION cancel_installment_plan(p_plan bigint, p_kind text, p_date date DEFAULT user_today(),
                                        p_charged numeric DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  p       record;
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_rate  numeric;
  v_total numeric;   -- lo que la compra dejó en soles
  v_rem   numeric;   -- lo que falta facturar, en la moneda de la compra
  v_remb  numeric;   -- y en soles
  v_chb   numeric;   -- lo que cobró el banco, en soles
  v_last  date;
  v_move  bigint;
BEGIN
  SELECT pl.*, m.ref AS move_ref INTO p
    FROM account_installment_plan pl JOIN account_move m ON m.id = pl.move_id AND m.state = 'posted'
   WHERE pl.id = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa compra en cuotas' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.expense_account_id IS NULL THEN
    RAISE EXCEPTION 'Solo se cancelan las cuotas de una compra tuya' USING ERRCODE = 'check_violation';
  END IF;
  IF p.cancel_move_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esas cuotas ya se cancelaron' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind NOT IN ('returned', 'prepaid') THEN
    RAISE EXCEPTION 'Di si lo devolviste o pagaste lo que faltaba' USING ERRCODE = 'check_violation';
  END IF;
  IF p_date > user_today() THEN
    RAISE EXCEPTION 'La fecha no puede ser futura' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM post_installment_billing();   -- lo que ya se facturó, con su asiento
  SELECT max(pl.closing_date) INTO v_last
    FROM account_installment_plan_line pl
   WHERE pl.plan_id = p_plan
     AND EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence);
  IF v_last IS NOT NULL AND p_date < v_last THEN
    RAISE EXCEPTION 'Ese día es antes del corte del % y esa cuota ya se facturó', to_char(v_last, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pl.principal), 0) INTO v_rem
    FROM account_installment_plan_line pl
   WHERE pl.plan_id = p_plan
     AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence);
  IF v_rem = 0 THEN
    RAISE EXCEPTION 'No quedan cuotas por facturar' USING ERRCODE = 'check_violation';
  END IF;
  v_rate := installment_plan_rate(p_plan);
  SELECT l.credit INTO v_total FROM account_move_line l
   WHERE l.move_id = p.move_id AND l.account_id = p.card_account_id AND l.credit > 0;
  v_remb := v_total - coalesce((SELECT sum(l.credit) FROM account_move_line l JOIN account_move x ON x.id = l.move_id
                                 WHERE x.installment_plan_id = p_plan AND l.account_id = system_account('installments')), 0);

  IF p_kind = 'prepaid' THEN
    IF p_charged IS NULL OR p_charged <= 0 OR p_charged > v_rem THEN
      RAISE EXCEPTION 'Lo que te cobró el banco va de más de 0 hasta % (las cuotas que faltaban)', v_rem
        USING ERRCODE = 'check_violation';
    END IF;
    v_chb := CASE WHEN p_charged = v_rem THEN v_remb ELSE least(round(p_charged * v_rate, 2), v_remb) END;
  END IF;

  INSERT INTO account_move (date, ref, state)
  VALUES (p_date, format('%s %s', CASE p_kind WHEN 'returned' THEN 'Devolución de' ELSE 'Pago adelantado de' END,
                         coalesce(p.move_ref, 'Compra en cuotas')), 'posted')
  RETURNING id INTO v_move;
  INSERT INTO account_move_line (move_id, account_id, name, credit, currency_id, amount_currency)
  VALUES (v_move, system_account('installments'), 'Cuotas canceladas', v_remb, p.currency_id, -v_rem);
  IF p_kind = 'returned' THEN
    INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
    VALUES (v_move, p.card_account_id, 'Cuotas canceladas', v_remb, p.currency_id, v_rem);
  ELSE
    INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
    VALUES (v_move, p.expense_account_id, 'Lo que faltaba', v_chb, v_base, v_chb);
    IF v_rem > p_charged THEN
      INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
      VALUES (v_move, p.card_account_id, 'Interés que no se cobra', v_remb - v_chb, p.currency_id, v_rem - p_charged);
    END IF;
  END IF;

  UPDATE account_installment_plan pl
     SET cancel_move_id = v_move, cancel_kind = p_kind,
         canceled_lines = (SELECT jsonb_agg(jsonb_build_object('sequence', l.sequence, 'closing_date', l.closing_date,
                                                               'principal', l.principal, 'interest', l.interest)
                                            ORDER BY l.sequence)
                             FROM account_installment_plan_line l
                            WHERE l.plan_id = p_plan
                              AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = l.plan_id
                                                AND x.installment_sequence = l.sequence))
   WHERE pl.id = p_plan;
  DELETE FROM account_installment_plan_line l
   WHERE l.plan_id = p_plan
     AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = l.plan_id AND x.installment_sequence = l.sequence);
  RETURN v_move;
END $$;

-- Lo ya guardado: solo los nombres que puso PPM, con su forma exacta; uno escrito a mano no se toca.
UPDATE account_move SET ref = substring(ref FROM '^(.*) · cuota [0-9]+/[0-9]+$')
 WHERE installment_plan_id IS NOT NULL AND ref ~ '^.* · cuota [0-9]+/[0-9]+$';
UPDATE account_move SET ref = substring(ref FROM '^(.*) · parte [0-9]+/[0-9]+$')
 WHERE deferral_id IS NOT NULL AND ref ~ '^.* · parte [0-9]+/[0-9]+$';
UPDATE account_move m SET ref = 'Devolución de ' || substring(m.ref FROM '^(.*) · devuelta$')
  FROM account_installment_plan p WHERE p.cancel_move_id = m.id AND m.ref ~ '^.* · devuelta$';
UPDATE account_move m SET ref = 'Pago adelantado de ' || substring(m.ref FROM '^(.*) · pagada por adelantado$')
  FROM account_installment_plan p WHERE p.cancel_move_id = m.id AND m.ref ~ '^.* · pagada por adelantado$';
UPDATE account_move m SET ref = 'Cancelación de ' || substring(m.ref FROM '^(.*) · cancelado$')
  FROM account_deferral d WHERE d.cancel_move_id = m.id AND m.ref ~ '^.* · cancelado$';

-- migrate:down

CREATE OR REPLACE FUNCTION post_installment_billing(p_today date DEFAULT user_today()) RETURNS integer
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

CREATE OR REPLACE FUNCTION post_deferrals(p_today date DEFAULT user_today()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r       record;
  v_hold  bigint;
  v_move  bigint;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT dl.deferral_id, dl.sequence, dl.date, dl.amount, d.kind, d.category_account_id, m.ref,
           (SELECT count(*) FROM account_deferral_line x WHERE x.deferral_id = d.id) AS n
      FROM account_deferral_line dl
      JOIN account_deferral d ON d.id = dl.deferral_id AND d.cancel_move_id IS NULL
      JOIN account_move m ON m.id = d.move_id AND m.state = 'posted'
     WHERE dl.date <= p_today
       AND NOT EXISTS (SELECT 1 FROM account_move x
                        WHERE x.deferral_id = dl.deferral_id AND x.deferral_sequence = dl.sequence)
     ORDER BY dl.date, dl.deferral_id, dl.sequence
  LOOP
    v_hold := system_account(CASE r.kind WHEN 'expense' THEN 'prepaid' ELSE 'unearned' END);
    INSERT INTO account_move (date, ref, state, deferral_id, deferral_sequence)
    VALUES (greatest(r.date, v_lock + 1),                -- en un periodo cerrado: queda por confirmar
            format('%s · parte %s/%s', coalesce(r.ref, 'Repartido'), r.sequence, r.n),
            'draft', r.deferral_id, r.sequence)
    RETURNING id INTO v_move;
    -- El gasto: de lo que espera a la categoría. El ingreso: de lo que debes a la categoría
    INSERT INTO account_move_line (move_id, account_id, debit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN r.category_account_id ELSE v_hold END, r.amount, v_base, r.amount);
    INSERT INTO account_move_line (move_id, account_id, credit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN v_hold ELSE r.category_account_id END, r.amount, v_base, -r.amount);
    IF r.date > v_lock THEN
      UPDATE account_move SET state = 'posted' WHERE id = v_move;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION cancel_installment_plan(p_plan bigint, p_kind text, p_date date DEFAULT user_today(),
                                        p_charged numeric DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  p       record;
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_rate  numeric;
  v_total numeric;   -- lo que la compra dejó en soles
  v_rem   numeric;   -- lo que falta facturar, en la moneda de la compra
  v_remb  numeric;   -- y en soles
  v_chb   numeric;   -- lo que cobró el banco, en soles
  v_last  date;
  v_move  bigint;
BEGIN
  SELECT pl.*, m.ref AS move_ref INTO p
    FROM account_installment_plan pl JOIN account_move m ON m.id = pl.move_id AND m.state = 'posted'
   WHERE pl.id = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa compra en cuotas' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.expense_account_id IS NULL THEN
    RAISE EXCEPTION 'Solo se cancelan las cuotas de una compra tuya' USING ERRCODE = 'check_violation';
  END IF;
  IF p.cancel_move_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esas cuotas ya se cancelaron' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind NOT IN ('returned', 'prepaid') THEN
    RAISE EXCEPTION 'Di si lo devolviste o pagaste lo que faltaba' USING ERRCODE = 'check_violation';
  END IF;
  IF p_date > user_today() THEN
    RAISE EXCEPTION 'La fecha no puede ser futura' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM post_installment_billing();   -- lo que ya se facturó, con su asiento
  SELECT max(pl.closing_date) INTO v_last
    FROM account_installment_plan_line pl
   WHERE pl.plan_id = p_plan
     AND EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence);
  IF v_last IS NOT NULL AND p_date < v_last THEN
    RAISE EXCEPTION 'Ese día es antes del corte del % y esa cuota ya se facturó', to_char(v_last, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(pl.principal), 0) INTO v_rem
    FROM account_installment_plan_line pl
   WHERE pl.plan_id = p_plan
     AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = pl.plan_id AND x.installment_sequence = pl.sequence);
  IF v_rem = 0 THEN
    RAISE EXCEPTION 'No quedan cuotas por facturar' USING ERRCODE = 'check_violation';
  END IF;
  v_rate := installment_plan_rate(p_plan);
  SELECT l.credit INTO v_total FROM account_move_line l
   WHERE l.move_id = p.move_id AND l.account_id = p.card_account_id AND l.credit > 0;
  v_remb := v_total - coalesce((SELECT sum(l.credit) FROM account_move_line l JOIN account_move x ON x.id = l.move_id
                                 WHERE x.installment_plan_id = p_plan AND l.account_id = system_account('installments')), 0);

  IF p_kind = 'prepaid' THEN
    IF p_charged IS NULL OR p_charged <= 0 OR p_charged > v_rem THEN
      RAISE EXCEPTION 'Lo que te cobró el banco va de más de 0 hasta % (las cuotas que faltaban)', v_rem
        USING ERRCODE = 'check_violation';
    END IF;
    v_chb := CASE WHEN p_charged = v_rem THEN v_remb ELSE least(round(p_charged * v_rate, 2), v_remb) END;
  END IF;

  INSERT INTO account_move (date, ref, state)
  VALUES (p_date, format('%s · %s', coalesce(p.move_ref, 'Compra en cuotas'),
                         CASE p_kind WHEN 'returned' THEN 'devuelta' ELSE 'pagada por adelantado' END), 'posted')
  RETURNING id INTO v_move;
  INSERT INTO account_move_line (move_id, account_id, name, credit, currency_id, amount_currency)
  VALUES (v_move, system_account('installments'), 'Cuotas canceladas', v_remb, p.currency_id, -v_rem);
  IF p_kind = 'returned' THEN
    INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
    VALUES (v_move, p.card_account_id, 'Cuotas canceladas', v_remb, p.currency_id, v_rem);
  ELSE
    INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
    VALUES (v_move, p.expense_account_id, 'Lo que faltaba', v_chb, v_base, v_chb);
    IF v_rem > p_charged THEN
      INSERT INTO account_move_line (move_id, account_id, name, debit, currency_id, amount_currency)
      VALUES (v_move, p.card_account_id, 'Interés que no se cobra', v_remb - v_chb, p.currency_id, v_rem - p_charged);
    END IF;
  END IF;

  UPDATE account_installment_plan pl
     SET cancel_move_id = v_move, cancel_kind = p_kind,
         canceled_lines = (SELECT jsonb_agg(jsonb_build_object('sequence', l.sequence, 'closing_date', l.closing_date,
                                                               'principal', l.principal, 'interest', l.interest)
                                            ORDER BY l.sequence)
                             FROM account_installment_plan_line l
                            WHERE l.plan_id = p_plan
                              AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = l.plan_id
                                                AND x.installment_sequence = l.sequence))
   WHERE pl.id = p_plan;
  DELETE FROM account_installment_plan_line l
   WHERE l.plan_id = p_plan
     AND NOT EXISTS (SELECT 1 FROM account_move x WHERE x.installment_plan_id = l.plan_id AND x.installment_sequence = l.sequence);
  RETURN v_move;
END $$;

UPDATE account_move m SET ref = format('%s · cuota %s/%s', m.ref, m.installment_sequence, p.n_installments)
  FROM account_installment_plan p WHERE p.id = m.installment_plan_id AND m.installment_sequence IS NOT NULL;
UPDATE account_move m SET ref = format('%s · parte %s/%s', m.ref, m.deferral_sequence,
                                       (SELECT count(*) FROM account_deferral_line l WHERE l.deferral_id = m.deferral_id))
 WHERE m.deferral_id IS NOT NULL AND m.deferral_sequence IS NOT NULL;
UPDATE account_move m SET ref = substring(m.ref FROM '^Devolución de (.*)$') || ' · devuelta'
  FROM account_installment_plan p WHERE p.cancel_move_id = m.id AND m.ref ~ '^Devolución de ';
UPDATE account_move m SET ref = substring(m.ref FROM '^Pago adelantado de (.*)$') || ' · pagada por adelantado'
  FROM account_installment_plan p WHERE p.cancel_move_id = m.id AND m.ref ~ '^Pago adelantado de ';
UPDATE account_move m SET ref = substring(m.ref FROM '^Cancelación de (.*)$') || ' · cancelado'
  FROM account_deferral d WHERE d.cancel_move_id = m.id AND m.ref ~ '^Cancelación de ';
