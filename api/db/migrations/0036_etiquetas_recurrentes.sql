-- migrate:up
-- Etiquetas en las recurrentes (decisión del 16-nov-2026): Netflix o el alquiler llevan su etiqueta y
-- cada movimiento que generan nace con ella, como si se la pusieras al registrarlo. Se copian al
-- crear el movimiento (no se heredan al leer, como las cuotas): así cada vez se puede cambiar suelta,
-- y cambiar las de la recurrente vale desde la próxima, como su monto.

CREATE TABLE account_recurring_account_tag_rel (
  recurring_id   bigint  NOT NULL,
  account_tag_id bigint  NOT NULL,
  user_id        integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  PRIMARY KEY (recurring_id, account_tag_id),
  FOREIGN KEY (recurring_id, user_id)   REFERENCES account_recurring (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_tag_id, user_id) REFERENCES account_tag (id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_recurring_account_tag_rel');

-- Cada movimiento de una recurrente nace con sus etiquetas (account_recurring_run, el pago de un préstamo)
CREATE FUNCTION recurring_move_tags() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_move_account_tag_rel (account_move_id, account_tag_id, user_id)
  SELECT NEW.id, r.account_tag_id, NEW.user_id
    FROM account_recurring_account_tag_rel r
   WHERE r.recurring_id = NEW.recurring_id
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

CREATE TRIGGER account_move_recurring_tags AFTER INSERT ON account_move
  FOR EACH ROW WHEN (NEW.recurring_id IS NOT NULL) EXECUTE FUNCTION recurring_move_tags();

-- migrate:down
DROP TRIGGER account_move_recurring_tags ON account_move;
DROP FUNCTION recurring_move_tags();
DROP TABLE account_recurring_account_tag_rel;
