-- migrate:up
-- «Pagué lo que faltaba» desde una cuenta registra también el pago de la tarjeta. Desde ahora ese
-- pago queda ligado a la cancelación: deshacerla (borrar su asiento) o borrar la compra se lleva
-- también el pago, y la cuenta vuelve a como estaba (decisión de Dany, 2026-11-13). Si se borra el
-- pago por su lado, la cancelación queda sin pago.

ALTER TABLE account_installment_plan
  ADD COLUMN cancel_payment_move_id bigint REFERENCES account_move (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION restore_canceled_installments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL AND NEW.cancel_move_id IS NULL AND OLD.canceled_lines IS NOT NULL THEN
    INSERT INTO account_installment_plan_line (plan_id, sequence, closing_date, principal, interest)
    SELECT NEW.id, (x->>'sequence')::smallint, (x->>'closing_date')::date, (x->>'principal')::numeric,
           (x->>'interest')::numeric
      FROM jsonb_array_elements(OLD.canceled_lines) x;
    NEW.cancel_kind := NULL;
    NEW.canceled_lines := NULL;
    NEW.cancel_payment_move_id := NULL;   -- el pago se borra después (realign_after_restore)
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION realign_after_restore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL AND NEW.cancel_move_id IS NULL THEN
    IF OLD.cancel_payment_move_id IS NOT NULL THEN
      DELETE FROM account_move WHERE id = OLD.cancel_payment_move_id;
    END IF;
    PERFORM realign_card_closings(NEW.card_account_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION delete_cancel_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL THEN
    DELETE FROM account_move WHERE id = OLD.cancel_move_id;
  END IF;
  IF OLD.cancel_payment_move_id IS NOT NULL THEN
    DELETE FROM account_move WHERE id = OLD.cancel_payment_move_id;
  END IF;
  RETURN NULL;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION delete_cancel_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL THEN
    DELETE FROM account_move WHERE id = OLD.cancel_move_id;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION realign_after_restore() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancel_move_id IS NOT NULL AND NEW.cancel_move_id IS NULL THEN
    PERFORM realign_card_closings(NEW.card_account_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION restore_canceled_installments() RETURNS trigger
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

ALTER TABLE account_installment_plan DROP COLUMN cancel_payment_move_id;
