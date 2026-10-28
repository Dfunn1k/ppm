-- migrate:up
-- Vencimientos (rebanada 8b): la fecha en que vence lo que te deben o lo que debes, como el
-- date_maturity de Odoo. Es la fecha escrita en el pagaré: no cambia cuánto se debe, solo para
-- cuándo. Opcional y editable también en lo ya registrado.
-- Prestar la tarjeta en cuotas parte la deuda en una por cuota: cada parte recuerda el corte de su
-- cuota (maturity_closing) y vence con la fecha de pago de ese ciclo cuando se escribe en la
-- tarjeta. Una fecha puesta a mano manda. Un pago cancela primero lo que vence antes.
-- La cuota con interés no cambia el modelo: el plan va por el total que se le debe al banco (precio
-- + intereses), así cada cuota es la del cronograma.

ALTER TABLE account_move_line
  ADD COLUMN date_maturity    date,               -- vence: la fecha puesta a mano
  ADD COLUMN maturity_closing date;               -- parte de una compra en cuotas: el corte de su cuota

-- Lo que falta de cada apunte, ahora con su vencimiento: el puesto a mano o, si es parte de una
-- compra en cuotas, la fecha de pago del ciclo de su corte (NULL hasta que se escriba)
CREATE OR REPLACE VIEW account_move_line_residual WITH (security_invoker = true) AS
SELECT l.id, l.user_id, l.move_id, m.date, m.ref, l.account_id, l.partner_id, l.currency_id,
       l.amount_currency,
       l.amount_currency
         - coalesce((SELECT sum(r.amount) FROM account_partial_reconcile r
                      WHERE r.debit_move_line_id = l.id), 0)
         + coalesce((SELECT sum(r.amount) FROM account_partial_reconcile r
                      WHERE r.credit_move_line_id = l.id), 0) AS amount_residual,
       coalesce(l.date_maturity, cy.date_due) AS date_maturity,
       l.date_maturity AS maturity_manual,
       l.maturity_closing
  FROM account_move_line l
  JOIN account_move m    ON m.id = l.move_id AND m.state = 'posted'
  JOIN account_account a ON a.id = l.account_id AND a.partner_required
  LEFT JOIN account_installment_plan p ON p.move_id = l.move_id
  LEFT JOIN account_credit_card_cycle cy ON cy.card_account_id = p.card_account_id
                                        AND cy.closing_date = l.maturity_closing;

-- Concilia lo pendiente de una persona en una cuenta: de lo que vence antes a lo que vence después
-- (sin vencimiento cuenta su corte o su fecha), de los dos lados, por moneda
CREATE OR REPLACE FUNCTION reconcile_partner(p_partner bigint, p_account bigint) RETURNS integer
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
            ORDER BY coalesce(date_maturity, maturity_closing, date), date, id LOOP
    v_open := c.open;
    FOR d IN SELECT id, amount_residual AS open
               FROM account_move_line_residual
              WHERE partner_id = p_partner AND account_id = p_account
                AND currency_id = c.currency_id AND amount_residual > 0
              ORDER BY coalesce(date_maturity, maturity_closing, date), date, id LOOP
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

-- Prestar la tarjeta en cuotas: cada parte de la deuda (los apuntes con persona del movimiento, en
-- su orden) toma el corte de su cuota. Tiene que haber una parte por cuota
CREATE FUNCTION set_plan_maturities(p_plan bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_parts int;
  v_n     int;
BEGIN
  SELECT count(*) INTO v_parts
    FROM account_move_line l
    JOIN account_account a ON a.id = l.account_id AND a.partner_required
    JOIN account_installment_plan p ON p.move_id = l.move_id
   WHERE p.id = p_plan;
  SELECT n_installments INTO v_n FROM account_installment_plan WHERE id = p_plan;
  IF v_n IS NULL THEN
    RAISE EXCEPTION 'Plan de cuotas desconocido: %', p_plan USING ERRCODE = 'no_data_found';
  END IF;
  IF v_parts <> v_n THEN
    RAISE EXCEPTION 'La deuda tiene % partes y la compra % cuotas: va una parte por cuota', v_parts, v_n
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE account_move_line l
     SET maturity_closing = q.closing_date
    FROM (SELECT l2.id, row_number() OVER (ORDER BY l2.id) AS rn
            FROM account_move_line l2
            JOIN account_account a ON a.id = l2.account_id AND a.partner_required
            JOIN account_installment_plan p ON p.move_id = l2.move_id
           WHERE p.id = p_plan) parts
    JOIN account_installment_plan_line q ON q.plan_id = p_plan AND q.sequence = parts.rn
   WHERE l.id = parts.id;
END $$;

-- migrate:down
DROP FUNCTION set_plan_maturities(bigint);
CREATE OR REPLACE FUNCTION reconcile_partner(p_partner bigint, p_account bigint) RETURNS integer
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
DROP VIEW account_move_line_residual;
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
GRANT SELECT ON account_move_line_residual TO ppm_app;
ALTER TABLE account_move_line DROP COLUMN maturity_closing, DROP COLUMN date_maturity;
