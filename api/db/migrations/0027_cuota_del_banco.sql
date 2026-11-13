-- migrate:up
-- «Usar la del banco» (decisión de Dany, 2026-11-13): cuando la cuota del estado de cuenta no es
-- la de PPM (casi siempre porque al registrar no se escribió la cuota y PPM la tomó sin interés),
-- la compra pasa a la cuota del banco. Se reescribe la compra misma (la tarjeta y «Cuotas por
-- venir» por todas las cuotas), sus líneas del calendario y las cuotas ya facturadas, para que
-- ningún lector (estado de la tarjeta, línea, ciclos) vea un asiento suelto de ajuste.
-- «No es esta compra» guarda el plan descartado en la fila del «Detalle plan cuotas».

ALTER TABLE account_credit_card_statement_installment
  ADD COLUMN rejected_plan_ids bigint[] NOT NULL DEFAULT '{}';

CREATE FUNCTION set_installment_amount(p_plan bigint, p_each numeric) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p       record;
  v_rate  numeric;
  v_total numeric;
  v_base  numeric;
  m       record;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos esa compra en cuotas' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.expense_account_id IS NULL THEN
    RAISE EXCEPTION 'Solo se ajusta la cuota de una compra tuya' USING ERRCODE = 'check_violation';
  END IF;
  IF p.cancel_move_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esas cuotas se cancelaron: deshaz la cancelación primero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_each IS NULL OR p_each <= 0 THEN
    RAISE EXCEPTION 'La cuota va mayor que cero' USING ERRCODE = 'check_violation';
  END IF;
  v_total := p_each * p.n_installments;
  IF v_total < coalesce(p.price, 0) THEN
    RAISE EXCEPTION '% cuotas de % no llegan a lo que costó', p.n_installments, p_each USING ERRCODE = 'check_violation';
  END IF;
  v_rate := installment_plan_rate(p_plan);
  v_base := round(v_total * v_rate, 2);

  PERFORM set_config('ppm.plan_resplit', 'on', true);
  UPDATE account_move_line SET credit = v_base, amount_currency = -v_total
   WHERE move_id = p.move_id AND account_id = p.card_account_id AND credit > 0;
  UPDATE account_move_line SET debit = v_base, amount_currency = v_total
   WHERE move_id = p.move_id AND account_id = system_account('installments') AND debit > 0;
  PERFORM set_config('ppm.plan_resplit', '', true);

  UPDATE account_installment_plan
     SET principal = v_total, installment_amount = p_each, price = coalesce(price, principal)
   WHERE id = p_plan;
  UPDATE account_installment_plan_line SET principal = p_each, interest = NULL
   WHERE plan_id = p_plan;
  FOR m IN SELECT id FROM account_move WHERE installment_plan_id = p_plan LOOP
    PERFORM write_installment_billing(m.id);
  END LOOP;
END $$;

-- El asiento de una cancelación de cuotas no pasa a por confirmar: la tarjeta volvería a deber las
-- cuotas mientras siguen fuera del calendario. Para deshacerla, se borra
CREATE FUNCTION check_cancel_move_posted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'draft' AND OLD.state = 'posted'
     AND EXISTS (SELECT 1 FROM account_installment_plan WHERE cancel_move_id = OLD.id) THEN
    RAISE EXCEPTION 'Una cancelación de cuotas no pasa a por confirmar: bórrala para deshacerla'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_cancel_move_posted
  BEFORE UPDATE OF state ON account_move
  FOR EACH ROW EXECUTE FUNCTION check_cancel_move_posted();

-- migrate:down
DROP TRIGGER IF EXISTS trg_cancel_move_posted ON account_move;
DROP FUNCTION IF EXISTS check_cancel_move_posted();
DROP FUNCTION set_installment_amount(bigint, numeric);
ALTER TABLE account_credit_card_statement_installment DROP COLUMN rejected_plan_ids;
