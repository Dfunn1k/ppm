-- migrate:up
-- Correcciones de las cuotas tras la revisión de noviembre (2026-11-13).
--
-- 1) Realinear los cortes con el estado de cuenta. 0021 pasaba cada corte viejo por card_closing_for:
--    si el banco cortaba ANTES del día de la tarjeta (el 18 en vez del 20), la cuota del 20 caía en el
--    corte del mes siguiente y ese mes quedaba con dos cuotas. Ahora cada corte va al corte del banco
--    más cercano (su «Al», o el día antes de su «Del», que cierra el ciclo anterior) si está a 10 días
--    o menos; si no hay ninguno cerca, se calcula como antes.
-- 2) El céntimo de las cuotas en otra moneda: cada cuota se pasaba a soles redondeando sola y la
--    suma no daba lo que la compra dejó en «Cuotas por venir». La última se lleva el residuo.

-- El corte del banco que corresponde a un corte calculado (o ya realineado)
CREATE FUNCTION card_closing_near(p_card bigint, p_closing date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT k.d
       FROM (SELECT closing_date AS d FROM account_credit_card_statement WHERE card_account_id = p_card
             UNION
             SELECT date_from - 1 FROM account_credit_card_statement WHERE card_account_id = p_card) k
      WHERE abs(k.d - p_closing) <= 10
      ORDER BY abs(k.d - p_closing), k.d
      LIMIT 1),
    card_closing_for(p_card, p_closing))
$$;

CREATE OR REPLACE FUNCTION realign_card_closings(p_card bigint) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE account_move_line l SET maturity_closing = card_closing_near(p_card, l.maturity_closing)
    FROM account_installment_plan p
   WHERE p.card_account_id = p_card AND l.move_id = p.move_id AND l.maturity_closing IS NOT NULL
     AND card_closing_near(p_card, l.maturity_closing) <> l.maturity_closing;
  UPDATE account_installment_plan_line pl SET closing_date = card_closing_near(p_card, pl.closing_date)
    FROM account_installment_plan p
   WHERE p.id = pl.plan_id AND p.card_account_id = p_card
     AND card_closing_near(p_card, pl.closing_date) <> pl.closing_date;
  UPDATE account_move m SET date = pl.closing_date
    FROM account_installment_plan_line pl
   WHERE m.installment_plan_id = pl.plan_id AND m.installment_sequence = pl.sequence
     AND m.date <> pl.closing_date
     AND pl.closing_date > coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
END $$;

CREATE OR REPLACE FUNCTION write_installment_billing(p_move bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r      record;
  v_amt  numeric;
  v_int  numeric;
BEGIN
  SELECT pl.plan_id, pl.sequence, pl.principal, pl.interest, p.currency_id, p.expense_account_id,
         p.n_installments, p.move_id, p.card_account_id, installment_plan_rate(p.id) AS rate
    INTO r
    FROM account_move m
    JOIN account_installment_plan_line pl ON pl.plan_id = m.installment_plan_id AND pl.sequence = m.installment_sequence
    JOIN account_installment_plan p ON p.id = pl.plan_id
   WHERE m.id = p_move;
  DELETE FROM account_move_line WHERE move_id = p_move;
  IF r.sequence = r.n_installments THEN
    -- La última: lo que la compra dejó en soles menos lo que se llevaron las anteriores
    SELECT l.credit - coalesce((SELECT sum(round(o.principal * r.rate, 2)) FROM account_installment_plan_line o
                                 WHERE o.plan_id = r.plan_id AND o.sequence < r.sequence), 0)
      INTO v_amt
      FROM account_move_line l
     WHERE l.move_id = r.move_id AND l.account_id = r.card_account_id AND l.credit > 0;
  ELSE
    v_amt := round(r.principal * r.rate, 2);
  END IF;
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

-- La última cuota ya facturada de una compra en otra moneda: se reescribe con el residuo
-- (como su dueño: write_installment_billing lee la moneda base y las cuentas de sistema de la sesión)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.id, p.user_id
      FROM account_move m
      JOIN account_installment_plan p ON p.id = m.installment_plan_id AND m.installment_sequence = p.n_installments
      JOIN res_users u ON u.id = p.user_id
     WHERE p.expense_account_id IS NOT NULL AND p.currency_id <> u.currency_id
  LOOP
    PERFORM set_config('app.user_id', r.user_id::text, true);
    PERFORM write_installment_billing(r.id);
  END LOOP;
  PERFORM set_config('app.user_id', '', true);
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION write_installment_billing(p_move bigint) RETURNS void
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

CREATE OR REPLACE FUNCTION realign_card_closings(p_card bigint) RETURNS void
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

DROP FUNCTION card_closing_near(bigint, date);
