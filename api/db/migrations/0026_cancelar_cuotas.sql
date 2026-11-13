-- migrate:up
-- Cancelar las cuotas que faltan de una compra tuya (decisión de Dany, 2026-11-13), con dos salidas:
--   «Lo devolví» (returned): la tarjeta y «Cuotas por venir» bajan por lo no facturado; no hay gasto.
--   «Pagué lo que faltaba» (prepaid): lo que cobró el banco va a la categoría de la compra ese día,
--   «Cuotas por venir» baja por lo no facturado y la tarjeta, por el interés que te ahorraste.
-- Las cuotas ya facturadas (las que tienen su asiento de cuota) no se tocan. Las que faltaban salen
-- del calendario y quedan guardadas en el plan; borrar el asiento de la cancelación las devuelve.

ALTER TABLE account_installment_plan
  ADD COLUMN cancel_move_id bigint REFERENCES account_move (id) ON DELETE SET NULL,
  ADD COLUMN cancel_kind    text CHECK (cancel_kind IN ('returned', 'prepaid')),
  ADD COLUMN canceled_lines jsonb;   -- las cuotas que faltaban, para deshacer

CREATE FUNCTION cancel_installment_plan(p_plan bigint, p_kind text, p_date date DEFAULT user_today(),
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

-- Deshacer: borrar el asiento de la cancelación deja cancel_move_id en NULL (la FK) y las cuotas
-- vuelven al calendario, con los cortes que se conocen hoy
CREATE FUNCTION restore_canceled_installments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL AND NEW.cancel_move_id IS NULL AND OLD.canceled_lines IS NOT NULL THEN
    INSERT INTO account_installment_plan_line (plan_id, sequence, closing_date, principal, interest)
    SELECT NEW.id, (x->>'sequence')::smallint, (x->>'closing_date')::date, (x->>'principal')::numeric,
           (x->>'interest')::numeric
      FROM jsonb_array_elements(OLD.canceled_lines) x;
    NEW.cancel_kind := NULL;
    NEW.canceled_lines := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_restore_canceled_installments
  BEFORE UPDATE OF cancel_move_id ON account_installment_plan
  FOR EACH ROW EXECUTE FUNCTION restore_canceled_installments();

CREATE FUNCTION realign_after_restore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL AND NEW.cancel_move_id IS NULL THEN
    PERFORM realign_card_closings(NEW.card_account_id);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_realign_after_restore
  AFTER UPDATE OF cancel_move_id ON account_installment_plan
  FOR EACH ROW EXECUTE FUNCTION realign_after_restore();

-- Borrar la compra se lleva también el asiento de su cancelación
CREATE FUNCTION delete_cancel_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL THEN
    DELETE FROM account_move WHERE id = OLD.cancel_move_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_delete_cancel_move
  AFTER DELETE ON account_installment_plan
  FOR EACH ROW EXECUTE FUNCTION delete_cancel_move();

-- migrate:down
-- Las cancelaciones se deshacen: las cuotas vuelven a su plan y sus asientos se borran
DROP TRIGGER trg_realign_after_restore ON account_installment_plan;
DROP FUNCTION realign_after_restore();
CREATE TEMP TABLE canceled_moves ON COMMIT DROP AS
  SELECT cancel_move_id AS id FROM account_installment_plan WHERE cancel_move_id IS NOT NULL;
UPDATE account_installment_plan SET cancel_move_id = NULL WHERE cancel_move_id IS NOT NULL;
DELETE FROM account_move WHERE id IN (SELECT id FROM canceled_moves);
DROP TRIGGER trg_delete_cancel_move ON account_installment_plan;
DROP FUNCTION delete_cancel_move();
DROP TRIGGER trg_restore_canceled_installments ON account_installment_plan;
DROP FUNCTION restore_canceled_installments();
DROP FUNCTION cancel_installment_plan(bigint, text, date, numeric);
ALTER TABLE account_installment_plan
  DROP COLUMN canceled_lines,
  DROP COLUMN cancel_kind,
  DROP COLUMN cancel_move_id;
