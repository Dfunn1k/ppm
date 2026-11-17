-- migrate:up
-- Estado de cuenta BBVA (decisión del 16-nov-2026): el BBVA no imprime un subtotal, así que se
-- calcula con el pago total menos el saldo anterior, los cargos del banco y los pagos. Para eso las
-- líneas leídas distinguen el pago ('payment'): se empareja con tu pago en PPM, pero no entra en la
-- suma que se compara con el subtotal (las compras y las cuotas del ciclo).
ALTER TABLE account_credit_card_statement_line DROP CONSTRAINT account_credit_card_statement_line_kind_check;
ALTER TABLE account_credit_card_statement_line
  ADD CONSTRAINT account_credit_card_statement_line_kind_check CHECK (kind IN ('move', 'fee', 'payment'));

-- migrate:down
UPDATE account_credit_card_statement_line SET kind = 'move' WHERE kind = 'payment';
ALTER TABLE account_credit_card_statement_line DROP CONSTRAINT account_credit_card_statement_line_kind_check;
ALTER TABLE account_credit_card_statement_line
  ADD CONSTRAINT account_credit_card_statement_line_kind_check CHECK (kind IN ('move', 'fee'));
