-- migrate:up
-- Personas (rebanada 6): el cuaderno de fiados. Por cobrar, Por pagar y Plata que guardo de otros
-- ya llevan la persona en cada apunte; aquí se agrega la conciliación, que dice qué deuda cancela
-- cada pago y cuánto falta de cada una (account.partial.reconcile de Odoo), y la cuenta de sistema
-- de Deudas incobrables, adonde va lo que se da por perdido.

-- 1) Deudas incobrables pasa a ser cuenta de sistema ('bad_debt'): la lógica la busca por rol,
--    no por nombre, y nadie la borra ni la archiva sin querer.
UPDATE account_account_template SET system_role = 'bad_debt'
 WHERE name = 'Deudas incobrables' AND system_role IS NULL;

-- Las cuentas que ya nacieron de la plantilla (si alguien la archivó, vuelve a estar activa).
-- Corre como dueño de la base: alcanza a todos.
UPDATE account_account a
   SET system_role = 'bad_debt', active = true
  FROM account_account p
 WHERE p.id = a.parent_id AND p.name = 'Gastos financieros' AND p.account_type = 'expense'
   AND a.name = 'Deudas incobrables' AND a.system_role IS NULL;

-- Quien la borró o la renombró la recibe de nuevo, dentro de Gastos financieros si lo tiene
INSERT INTO account_account (user_id, name, account_type, parent_id, currency_id, system_role, icon)
SELECT u.id, 'Deudas incobrables', 'expense',
       (SELECT p.id FROM account_account p
         WHERE p.user_id = u.id AND p.name = 'Gastos financieros' AND p.parent_id IS NULL
           AND p.account_type = 'expense'
           AND NOT EXISTS (SELECT 1 FROM account_move_line l WHERE l.account_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM account_account x
                            WHERE x.user_id = u.id AND x.parent_id = p.id
                              AND x.name = 'Deudas incobrables' AND x.currency_id = u.currency_id)),
       u.currency_id, 'bad_debt', 'money_off'
  FROM res_users u
 WHERE u.currency_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM account_account a WHERE a.user_id = u.id AND a.system_role = 'bad_debt');

-- 2) Conciliación: cada fila dice que un apunte al Haber cancela parte de uno al Debe, de la misma
--    cuenta, persona y moneda. Lo pendiente de cada deuda se calcula, no se guarda.
ALTER TABLE account_move_line ADD UNIQUE (id, user_id);   -- destino de las FK compuestas

-- Una conciliación no se edita: se borra y se hace otra (por eso el trigger mira solo el INSERT)
CREATE TABLE account_partial_reconcile (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  debit_move_line_id  bigint NOT NULL,
  credit_move_line_id bigint NOT NULL,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),   -- en la moneda de los apuntes
  create_date         timestamptz NOT NULL DEFAULT now(),
  CHECK (debit_move_line_id <> credit_move_line_id),
  -- Borrar o rehacer un movimiento borra sus conciliaciones; la app vuelve a conciliar
  FOREIGN KEY (debit_move_line_id, user_id)  REFERENCES account_move_line (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (credit_move_line_id, user_id) REFERENCES account_move_line (id, user_id) ON DELETE CASCADE
);
CREATE INDEX account_partial_reconcile_debit  ON account_partial_reconcile (debit_move_line_id);
CREATE INDEX account_partial_reconcile_credit ON account_partial_reconcile (credit_move_line_id);
SELECT ppm_enable_rls('account_partial_reconcile');

-- Lo que falta de cada apunte confirmado en las cuentas con persona (amount_residual de Odoo), en
-- la moneda del apunte y con su signo: una deuda que te deben es positiva; un pago, negativo.
CREATE VIEW account_move_line_residual WITH (security_invoker = true) AS
SELECT l.id, l.user_id, l.move_id, m.date, m.ref, l.account_id, l.partner_id, l.currency_id,
       l.amount_currency,
       l.amount_currency
         - coalesce((SELECT sum(r.amount) FROM account_partial_reconcile r
                      WHERE r.debit_move_line_id = l.id), 0)
         + coalesce((SELECT sum(r.amount) FROM account_partial_reconcile r
                      WHERE r.credit_move_line_id = l.id), 0) AS amount_residual
  FROM account_move_line l
  JOIN account_move m    ON m.id = l.move_id AND m.state = 'posted'
  JOIN account_account a ON a.id = l.account_id AND a.partner_required;

-- Saldo por persona, cuenta y moneda (el libro mayor de contactos de Odoo), solo lo confirmado
CREATE VIEW res_partner_balance WITH (security_invoker = true) AS
SELECT l.user_id, l.partner_id, l.account_id, a.system_role, l.currency_id,
       sum(l.amount_currency) AS amount_currency,
       sum(l.balance)         AS balance
  FROM account_move_line l
  JOIN account_move m    ON m.id = l.move_id AND m.state = 'posted'
  JOIN account_account a ON a.id = l.account_id AND a.partner_required
 GROUP BY l.user_id, l.partner_id, l.account_id, a.system_role, l.currency_id;

GRANT SELECT ON account_move_line_residual, res_partner_balance TO ppm_app;

-- Reglas: Debe con Haber, misma cuenta, persona y moneda, ambos confirmados y sin pasarse de lo pendiente
CREATE FUNCTION check_partial_reconcile() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d account_move_line_residual%ROWTYPE;
  c account_move_line_residual%ROWTYPE;
BEGIN
  SELECT * INTO d FROM account_move_line_residual WHERE id = NEW.debit_move_line_id;
  SELECT * INTO c FROM account_move_line_residual WHERE id = NEW.credit_move_line_id;
  IF d.id IS NULL OR c.id IS NULL THEN
    RAISE EXCEPTION 'Solo se concilian movimientos confirmados de las cuentas con persona'
      USING ERRCODE = 'check_violation';
  END IF;
  IF d.amount_currency <= 0 OR c.amount_currency >= 0 THEN
    RAISE EXCEPTION 'Se concilia un apunte al Debe con uno al Haber' USING ERRCODE = 'check_violation';
  END IF;
  IF d.account_id <> c.account_id OR d.partner_id IS DISTINCT FROM c.partner_id
     OR d.currency_id <> c.currency_id THEN
    RAISE EXCEPTION 'Solo se concilian apuntes de la misma cuenta, persona y moneda'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount > d.amount_residual OR NEW.amount > -c.amount_residual THEN
    RAISE EXCEPTION 'El monto supera lo que falta conciliar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_partial_reconcile
  BEFORE INSERT ON account_partial_reconcile
  FOR EACH ROW EXECUTE FUNCTION check_partial_reconcile();

-- Un movimiento que vuelve a por confirmar deja de cancelar deudas (y de estar cancelado)
CREATE FUNCTION unreconcile_draft_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM account_partial_reconcile r
   USING account_move_line l
   WHERE l.move_id = NEW.id
     AND (r.debit_move_line_id = l.id OR r.credit_move_line_id = l.id);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_move_unreconcile_draft
  AFTER UPDATE OF state ON account_move
  FOR EACH ROW WHEN (NEW.state = 'draft' AND OLD.state = 'posted')
  EXECUTE FUNCTION unreconcile_draft_move();

-- Un apunte que cambia de monto, cuenta, persona o moneda pierde sus conciliaciones
CREATE FUNCTION unreconcile_changed_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM account_partial_reconcile
   WHERE debit_move_line_id = OLD.id OR credit_move_line_id = OLD.id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_line_unreconcile_changed
  BEFORE UPDATE OF account_id, partner_id, debit, credit, currency_id, amount_currency ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION unreconcile_changed_line();

-- Concilia lo pendiente de una persona en una cuenta: de lo más antiguo a lo más nuevo, de los dos
-- lados, por moneda. Respeta lo que ya está conciliado (también lo que se eligió a mano).
CREATE FUNCTION reconcile_partner(p_partner bigint, p_account bigint) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  c     record;
  d     record;
  v_amt numeric;
  v_n   integer := 0;
  v_open numeric;
BEGIN
  FOR c IN SELECT id, currency_id, -amount_residual AS open
             FROM account_move_line_residual
            WHERE partner_id = p_partner AND account_id = p_account AND amount_residual < 0
            ORDER BY date, id LOOP
    v_open := c.open;
    FOR d IN SELECT id, amount_residual AS open
               FROM account_move_line_residual
              WHERE partner_id = p_partner AND account_id = p_account
                AND currency_id = c.currency_id AND amount_residual > 0
              ORDER BY date, id LOOP
      EXIT WHEN v_open = 0;
      v_amt := least(v_open, d.open);
      INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)
      VALUES (d.id, c.id, v_amt);
      v_open := v_open - v_amt;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

-- migrate:down
DROP FUNCTION reconcile_partner(bigint, bigint);
DROP TRIGGER trg_line_unreconcile_changed ON account_move_line;
DROP TRIGGER trg_move_unreconcile_draft ON account_move;
DROP FUNCTION unreconcile_changed_line(), unreconcile_draft_move();
DROP VIEW res_partner_balance, account_move_line_residual;
DROP TABLE account_partial_reconcile;
DROP FUNCTION check_partial_reconcile();
ALTER TABLE account_move_line DROP CONSTRAINT account_move_line_id_user_id_key;
-- Deudas incobrables vuelve a ser una categoría común (las cuentas se quedan: son de cada persona)
ALTER TABLE account_account DISABLE TRIGGER account_system;
UPDATE account_account SET system_role = NULL WHERE system_role = 'bad_debt';
ALTER TABLE account_account ENABLE TRIGGER account_system;
UPDATE account_account_template SET system_role = NULL WHERE system_role = 'bad_debt';
