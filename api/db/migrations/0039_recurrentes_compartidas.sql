-- migrate:up
-- Recurrentes compartidas: cuando una recurrente con la parte de otra persona se confirma sola
-- (account_recurring_run), lo que se deben se compensa igual que al registrar a mano
-- (moves.reconcile en la API): cada apunte de Por cobrar o Por pagar con persona se concilia.
CREATE FUNCTION trg_recurring_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM reconcile_partner(x.partner_id, x.account_id)
     FROM (SELECT DISTINCT l.partner_id, l.account_id
             FROM account_move_line l
             JOIN account_account a ON a.id = l.account_id
            WHERE l.move_id = NEW.id AND l.partner_id IS NOT NULL
              AND a.system_role IN ('receivable', 'payable')) x;
  RETURN NULL;
END $$;

CREATE TRIGGER recurring_reconcile
  AFTER UPDATE OF state ON account_move
  FOR EACH ROW
  WHEN (NEW.recurring_id IS NOT NULL AND NEW.state = 'posted' AND OLD.state IS DISTINCT FROM 'posted')
  EXECUTE FUNCTION trg_recurring_reconcile();

-- migrate:down
DROP TRIGGER recurring_reconcile ON account_move;
DROP FUNCTION trg_recurring_reconcile();
