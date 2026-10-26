-- migrate:up
-- Saldo inicial con una persona: lo que ya te debía (Por cobrar) o lo que ya le debías (Por pagar)
-- desde antes de empezar a usar PPM. Es la foto del cuaderno de fiados el día que lo abriste: va
-- contra «Saldos iniciales» y no mueve ninguna de tus cuentas (esa plata ya había salido o entrado
-- antes). Queda como una deuda abierta con su fecha y se concilia con los pagos como cualquier otra.
-- Es lo mismo que post_custody_opening hace con la plata que guardas de alguien.
CREATE FUNCTION post_partner_opening(p_role text, p_partner_id bigint, p_currency_id smallint,
                                     p_amount numeric, p_date date DEFAULT user_today(),
                                     p_rate numeric DEFAULT 1, p_ref text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_move bigint;
BEGIN
  IF p_role NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION 'El saldo inicial con una persona es lo que te debía o lo que le debías'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Escribe un monto mayor que cero' USING ERRCODE = 'check_violation';
  END IF;
  v_move := post_opening_balance(system_account(p_role), p_amount, p_date, p_rate, p_currency_id, p_partner_id);
  IF nullif(trim(p_ref), '') IS NOT NULL THEN
    UPDATE account_move SET ref = trim(p_ref) WHERE id = v_move;
  END IF;
  RETURN v_move;
END $$;

-- migrate:down
DROP FUNCTION post_partner_opening(text, bigint, smallint, numeric, date, numeric, text);
