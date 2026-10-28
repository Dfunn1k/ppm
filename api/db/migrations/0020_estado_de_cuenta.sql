-- migrate:up
-- El estado de cuenta de la tarjeta (correcciones de Dany, 2026-10-28). Cada ciclo cerrado guarda
-- su foto al corte: lo que debías por moneda, el tipo de cambio de venta con que se convirtió y la
-- línea usada; no se recalcula con el tipo de cambio de otro día, como un estado de cuenta impreso.
-- El ciclo abierto usa el tipo de venta del día, o el que escribas (queda con su fecha hasta el
-- próximo corte). En la conciliación se escriben los totales del banco y se pegan sus movimientos;
-- el «saldo de compras en cuotas según banco» reemplaza el cálculo de cuotas de la línea hasta el
-- siguiente estado de cuenta.

-- El tipo de cambio escrito a mano para el ciclo abierto de una tarjeta
CREATE TABLE account_credit_card_rate (
  card_account_id bigint NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  rate            numeric(12,6) NOT NULL CHECK (rate > 0),   -- soles (moneda de la línea) por unidad
  rate_date       date NOT NULL,                             -- cuándo se escribió
  PRIMARY KEY (card_account_id, currency_id),
  FOREIGN KEY (card_account_id, user_id) REFERENCES account_credit_card (account_id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_credit_card_rate');

-- La foto de un ciclo cerrado y lo que dice el banco de él
CREATE TABLE account_credit_card_statement (
  card_account_id   bigint NOT NULL,
  user_id           integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  closing_date      date NOT NULL,
  credit_limit      numeric(14,2) NOT NULL,                  -- foto: la línea de crédito
  used              numeric(14,2) NOT NULL,                  -- foto: la línea usada al corte, en su moneda
  installments      numeric(14,2) NOT NULL,                  -- foto: cuotas por facturar según PPM (moneda de la línea)
  bank_billed       numeric(14,2),                           -- del banco: total facturado
  bank_available    numeric(14,2),                           -- del banco: línea disponible
  bank_installments numeric(14,2) CHECK (bank_installments >= 0),   -- del banco: saldo de compras en cuotas
  write_date        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_account_id, closing_date),
  UNIQUE (card_account_id, closing_date, user_id),           -- destino de las FK compuestas
  FOREIGN KEY (card_account_id, user_id) REFERENCES account_credit_card (account_id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_credit_card_statement');

-- La foto por moneda: lo que debías y a qué tipo de cambio se contó en la línea
CREATE TABLE account_credit_card_statement_currency (
  card_account_id bigint NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  closing_date    date NOT NULL,
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  debt            numeric(14,2) NOT NULL,                    -- lo que debías en esa moneda al corte
  rate            numeric(12,6) CHECK (rate > 0),            -- NULL = la moneda de la línea
  rate_date       date,
  bank_subtotal   numeric(14,2),                             -- del banco: subtotal en esa moneda
  PRIMARY KEY (card_account_id, closing_date, currency_id),
  FOREIGN KEY (card_account_id, closing_date, user_id)
      REFERENCES account_credit_card_statement (card_account_id, closing_date, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_credit_card_statement_currency');

-- Los movimientos del estado de cuenta, pegados tal cual, para emparejarlos con los de PPM
CREATE TABLE account_credit_card_statement_line (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  card_account_id bigint NOT NULL,
  closing_date    date NOT NULL,
  date            date NOT NULL,
  name            text NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount <> 0),   -- + cargo, − abono
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  FOREIGN KEY (card_account_id, closing_date, user_id)
      REFERENCES account_credit_card_statement (card_account_id, closing_date, user_id) ON DELETE CASCADE
);
CREATE INDEX account_credit_card_statement_line_cycle
    ON account_credit_card_statement_line (card_account_id, closing_date);
SELECT ppm_enable_rls('account_credit_card_statement_line');

-- migrate:down
DROP TABLE account_credit_card_statement_line, account_credit_card_statement_currency,
           account_credit_card_statement, account_credit_card_rate;
