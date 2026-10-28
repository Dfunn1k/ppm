-- migrate:up
-- Cargos del banco (correcciones de Dany, 2026-10-28): el seguro de desgravamen de cada corte, la
-- membresía anual y otros cargos de la tarjeta son recurrentes por confirmar. Su monto no se sabe de
-- antemano: cada borrador sugiere el del último que confirmaste, como el recibo del mes pasado. No
-- cuentan en la deuda ni en la línea hasta que los confirmas (solo cuenta lo confirmado).

ALTER TABLE account_recurring
  ADD COLUMN bank_charge boolean NOT NULL DEFAULT false;     -- cargo del banco: sigue al último monto

-- Al confirmar un cargo del banco, la plantilla toma su monto (todas sus líneas a escala, en una
-- sola orden para que siga cuadrando)
CREATE FUNCTION account_recurring_follow_amount() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_new    numeric;
  v_old    numeric;
  v_factor numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account_recurring WHERE id = NEW.recurring_id AND bank_charge) THEN
    RETURN NULL;
  END IF;
  -- El total: lo que sube la cuenta de dinero (la tarjeta), en el asiento y en la plantilla
  SELECT abs(sum(l.amount_currency)) INTO v_new
    FROM account_move_line l JOIN account_account a ON a.id = l.account_id
   WHERE l.move_id = NEW.id AND a.account_type IN ('asset', 'liability');
  SELECT abs(sum(t.amount)) INTO v_old
    FROM account_recurring_line t JOIN account_account a ON a.id = t.account_id
   WHERE t.recurring_id = NEW.recurring_id AND a.account_type IN ('asset', 'liability');
  IF v_new IS NULL OR v_old IS NULL OR v_old = 0 OR v_new = v_old THEN
    RETURN NULL;
  END IF;
  v_factor := v_new / v_old;
  WITH scaled AS (
    SELECT id, round(amount * v_factor, 2) AS amount,
           row_number() OVER (ORDER BY abs(amount) DESC, id) AS rk
      FROM account_recurring_line WHERE recurring_id = NEW.recurring_id
  )
  UPDATE account_recurring_line t
     SET amount = CASE WHEN s.rk = 1
                       THEN s.amount - (SELECT sum(amount) FROM scaled)   -- el redondeo, a la más grande
                       ELSE s.amount END
    FROM scaled s
   WHERE s.id = t.id;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_recurring_follow_amount
  AFTER UPDATE OF state ON account_move
  FOR EACH ROW WHEN (NEW.state = 'posted' AND OLD.state = 'draft' AND NEW.recurring_id IS NOT NULL)
  EXECUTE FUNCTION account_recurring_follow_amount();

-- migrate:down
DROP TRIGGER trg_recurring_follow_amount ON account_move;
DROP FUNCTION account_recurring_follow_amount();
ALTER TABLE account_recurring DROP COLUMN bank_charge;
