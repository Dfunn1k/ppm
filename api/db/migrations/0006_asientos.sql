-- migrate:up
-- Asientos (account.move) y apuntes (account.move_line): cada movimiento de dinero.
-- Las reglas que costarían dinero si fallan viven aquí, en la base: el cuadre, la moneda de
-- cada cuenta, las cuentas que agrupan y las que exigen persona.

CREATE TABLE account_move (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  date        date NOT NULL,
  ref         text NOT NULL,                             -- glosa: 'Saldo inicial Efectivo'
  state       text NOT NULL DEFAULT 'draft'
              CHECK (state IN ('draft', 'posted')),      -- por confirmar / confirmado
  create_date timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)                                   -- destino de las FK compuestas
);
CREATE INDEX account_move_user_date ON account_move (user_id, date);
SELECT ppm_enable_rls('account_move');

CREATE TABLE account_move_line (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  move_id         bigint NOT NULL,
  account_id      bigint NOT NULL,
  name            text,                                  -- etiqueta opcional
  partner_id      bigint,                                -- con quién (obligatorio si la cuenta lo pide)
  debit           numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit          numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance         numeric(14,2) GENERATED ALWAYS AS (debit - credit) STORED,  -- en moneda base
  currency_id     smallint NOT NULL REFERENCES res_currency (id),  -- moneda del apunte
  amount_currency numeric(14,2) NOT NULL,                -- monto en esa moneda, con signo
  CHECK ((debit > 0) <> (credit > 0)),                   -- exactamente un lado con monto
  CHECK (sign(amount_currency) = sign(debit - credit)),  -- mismo sentido
  -- Todo del mismo dueño: nadie apunta a la cuenta, el asiento o la persona de otro
  FOREIGN KEY (move_id, user_id)    REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id),
  FOREIGN KEY (partner_id, user_id) REFERENCES res_partner (id, user_id)
);
CREATE INDEX account_move_line_move ON account_move_line (move_id);
CREATE INDEX account_move_line_account ON account_move_line (account_id);
CREATE INDEX account_move_line_partner ON account_move_line (partner_id) WHERE partner_id IS NOT NULL;
SELECT ppm_enable_rls('account_move_line');

-- Cuadre: un asiento confirmado tiene al menos 2 apuntes, débitos = créditos, cada apunte en la
-- moneda de su cuenta (salvo las multimoneda) y, en moneda base, amount_currency = balance.
-- Se revisa al final de la transacción (diferido): se pueden escribir los apuntes de a uno.
CREATE FUNCTION check_move_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id       bigint;
  v_state    text;
  v_base     smallint;
  v_debit    numeric;
  v_credit   numeric;
  v_lines    int;
  v_bad_cur  int;
  v_bad_base int;
BEGIN
  -- Corre desde dos tablas; cada rama lee solo los campos que su tabla tiene
  IF TG_TABLE_NAME = 'account_move' THEN
    v_id := NEW.id;
  ELSE
    v_id := COALESCE(NEW.move_id, OLD.move_id);
  END IF;

  -- Los borradores pueden estar incompletos; un asiento borrado no tiene nada que revisar
  SELECT m.state, u.currency_id INTO v_state, v_base
    FROM account_move m JOIN res_users u ON u.id = m.user_id
   WHERE m.id = v_id;
  IF v_state IS DISTINCT FROM 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0), count(*),
         count(*) FILTER (WHERE l.currency_id <> a.currency_id),   -- multimoneda (NULL) no cuenta
         count(*) FILTER (WHERE l.currency_id = v_base AND l.amount_currency <> l.balance)
    INTO v_debit, v_credit, v_lines, v_bad_cur, v_bad_base
    FROM account_move_line l
    JOIN account_account a ON a.id = l.account_id
   WHERE l.move_id = v_id;

  IF v_lines < 2 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'Asiento % descuadrado: débitos % <> créditos %', v_id, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_bad_cur > 0 THEN
    RAISE EXCEPTION 'Asiento %: un apunte no usa la moneda de su cuenta', v_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_bad_base > 0 THEN
    RAISE EXCEPTION 'Asiento %: en moneda base, amount_currency debe ser igual a balance', v_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_move_line_balanced
  AFTER INSERT OR UPDATE OR DELETE ON account_move_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_move_balanced();

-- Confirmar un borrador también dispara la revisión
CREATE CONSTRAINT TRIGGER trg_move_posted
  AFTER INSERT OR UPDATE OF state ON account_move
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_move_balanced();

-- Solo las cuentas hoja reciben movimientos (Comida agrupa; Restaurantes recibe)
CREATE FUNCTION check_line_leaf_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM account_account WHERE parent_id = NEW.account_id) THEN
    RAISE EXCEPTION 'La cuenta % agrupa otras cuentas; usa una de sus hijas', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_line_leaf_account
  BEFORE INSERT OR UPDATE OF account_id ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_line_leaf_account();

-- Las cuentas que lo piden (Por cobrar, Por pagar, Plata que guardo de otros) dicen con quién
CREATE FUNCTION check_line_partner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.partner_id IS NULL
     AND (SELECT partner_required FROM account_account WHERE id = NEW.account_id) THEN
    RAISE EXCEPTION 'La cuenta % necesita una persona (partner_id)', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_line_partner
  BEFORE INSERT OR UPDATE OF account_id, partner_id ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_line_partner();

-- Árbol de cuentas: la hija tiene el tipo de su padre, y un padre con movimientos no agrupa
CREATE FUNCTION check_account_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Una cuenta no puede ser su propio padre' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.account_type <> (SELECT account_type FROM account_account WHERE id = NEW.parent_id) THEN
    RAISE EXCEPTION 'La cuenta «%» debe tener el mismo tipo que su padre', NEW.name
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM account_move_line WHERE account_id = NEW.parent_id) THEN
    RAISE EXCEPTION 'La cuenta padre ya tiene movimientos; no puede agrupar hijas'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_account_parent
  BEFORE INSERT OR UPDATE OF parent_id, account_type ON account_account
  FOR EACH ROW EXECUTE FUNCTION check_account_parent();

-- Con movimientos, una cuenta ya no cambia de tipo ni de moneda: los reportes pasados no cambian de sentido
CREATE FUNCTION trg_account_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.account_type <> OLD.account_type OR NEW.currency_id IS DISTINCT FROM OLD.currency_id)
     AND EXISTS (SELECT 1 FROM account_move_line WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'La cuenta «%» ya tiene movimientos: no puede cambiar de tipo ni de moneda', OLD.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_locked
  BEFORE UPDATE OF account_type, currency_id ON account_account
  FOR EACH ROW EXECUTE FUNCTION trg_account_locked();

-- Saldos (se calculan, no se guardan): por cuenta y moneda, solo lo confirmado.
-- amount_currency en la moneda del apunte; balance en moneda base (valor en libros).
CREATE VIEW account_balance WITH (security_invoker = true) AS
SELECT l.user_id, l.account_id, l.currency_id,
       sum(l.amount_currency) AS amount_currency,
       sum(l.balance)         AS balance
  FROM account_move_line l
  JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
 GROUP BY l.user_id, l.account_id, l.currency_id;

-- Los apuntes de una cuenta con el saldo después de cada uno (C2 · Detalle de cuenta)
CREATE VIEW account_move_line_running WITH (security_invoker = true) AS
SELECT l.id, l.user_id, l.account_id, l.move_id, m.date, m.ref, m.state, l.name, l.partner_id,
       l.currency_id, l.amount_currency, l.balance,
       sum(l.amount_currency) FILTER (WHERE m.state = 'posted') OVER (
         PARTITION BY l.account_id, l.currency_id
         ORDER BY m.date, m.id, l.id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_amount_currency
  FROM account_move_line l
  JOIN account_move m ON m.id = l.move_id;

GRANT SELECT ON account_balance, account_move_line_running TO ppm_app;

-- migrate:down
DROP VIEW account_move_line_running, account_balance;
DROP TRIGGER account_locked ON account_account;
DROP TRIGGER trg_account_parent ON account_account;
DROP TABLE account_move_line, account_move;
DROP FUNCTION trg_account_locked(), check_account_parent(), check_line_partner(),
              check_line_leaf_account(), check_move_balanced();
