-- migrate:up
-- Recurrentes y préstamos de banco (rebanada 9): la plantilla con su regla, sus líneas y las
-- excepciones de «solo esta vez»; cada ocurrencia se genera como un asiento real que recuerda de qué
-- recurrencia y fecha viene. El préstamo de banco es una cuenta de pasivo con su ficha y su cuota.

-- Plantilla y regla (como un evento repetido de calendario)
CREATE TABLE account_recurring (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  name            text NOT NULL,                             -- 'Alquiler'
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  -- Regla
  interval_type   text NOT NULL CHECK (interval_type IN ('day', 'week', 'month', 'year')),
  interval_count  smallint NOT NULL DEFAULT 1 CHECK (interval_count >= 1),  -- cada N
  month_day_mode  text CHECK (month_day_mode IN ('days', 'nth_weekday')),
  month_days      smallint[],                                -- {15, 31}: 31 = último día
  weekday         smallint CHECK (weekday BETWEEN 1 AND 7),  -- ISO: 1 = lunes
  nth             smallint CHECK (nth IN (1, 2, 3, 4, -1)),  -- -1 = el último
  date_start      date NOT NULL,                             -- ancla de semanal y anual
  end_type        text NOT NULL DEFAULT 'never' CHECK (end_type IN ('never', 'date', 'count')),
  date_end        date,
  max_count       integer CHECK (max_count >= 1),
  -- Comportamiento
  amount_type     text NOT NULL DEFAULT 'fixed' CHECK (amount_type IN ('fixed', 'variable')),
  post_mode       text NOT NULL CHECK (post_mode IN ('auto', 'draft', 'reminder')),
  lead_days       smallint NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  state           text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'done')),
  generated_until date,                                      -- procesada hasta esta ocurrencia
  create_date     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),                                      -- destino de las FK compuestas
  CHECK ((interval_type = 'month') = (month_day_mode IS NOT NULL)),
  CHECK (month_day_mode IS DISTINCT FROM 'days'
         OR (cardinality(month_days) > 0 AND 1 <= ALL (month_days) AND 31 >= ALL (month_days))),
  CHECK (month_day_mode IS DISTINCT FROM 'nth_weekday' OR (weekday IS NOT NULL AND nth IS NOT NULL)),
  CHECK ((end_type = 'date')  = (date_end IS NOT NULL)),
  CHECK ((end_type = 'count') = (max_count IS NOT NULL))
);
SELECT ppm_enable_rls('account_recurring');

-- Modo por defecto: monto fijo → auto, monto variable → draft
CREATE FUNCTION trg_recurring_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.post_mode := coalesce(NEW.post_mode, CASE NEW.amount_type WHEN 'fixed' THEN 'auto' ELSE 'draft' END);
  RETURN NEW;
END $$;

CREATE TRIGGER recurring_defaults BEFORE INSERT ON account_recurring
  FOR EACH ROW EXECUTE FUNCTION trg_recurring_defaults();

-- Líneas del molde, en la moneda de la plantilla: + debe, − haber
CREATE TABLE account_recurring_line (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  recurring_id bigint NOT NULL,
  account_id   bigint NOT NULL,
  partner_id   bigint,
  name         text,
  amount       numeric(14,2) NOT NULL CHECK (amount <> 0),   -- estimado si es variable
  FOREIGN KEY (recurring_id, user_id) REFERENCES account_recurring (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id)   REFERENCES account_account (id, user_id),
  FOREIGN KEY (partner_id, user_id)   REFERENCES res_partner (id, user_id)
);
CREATE INDEX account_recurring_line_recurring ON account_recurring_line (recurring_id);
SELECT ppm_enable_rls('account_recurring_line');

-- El molde cuadra como un asiento: al menos 2 líneas que suman cero
CREATE FUNCTION trg_recurring_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint := coalesce(NEW.recurring_id, OLD.recurring_id);
BEGIN
  IF EXISTS (SELECT 1 FROM account_recurring_line WHERE recurring_id = v_id
              GROUP BY recurring_id HAVING sum(amount) <> 0 OR count(*) < 2) THEN
    RAISE EXCEPTION 'La plantilla % no cuadra', v_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER recurring_balanced
  AFTER INSERT OR UPDATE OR DELETE ON account_recurring_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_recurring_balanced();

-- «Solo esta vez»: saltar, mover o cambiar el total de una ocurrencia
CREATE TABLE account_recurring_exception (
  recurring_id    bigint NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,                             -- la fecha que calculó la regla
  action          text NOT NULL CHECK (action IN ('skip', 'modify')),
  new_date        date,
  new_total       numeric(14,2) CHECK (new_total > 0),       -- suma del debe; las líneas se escalan
  PRIMARY KEY (recurring_id, occurrence_date),
  FOREIGN KEY (recurring_id, user_id) REFERENCES account_recurring (id, user_id) ON DELETE CASCADE,
  CHECK (action = 'skip' OR new_date IS NOT NULL OR new_total IS NOT NULL)
);
SELECT ppm_enable_rls('account_recurring_exception');

-- Cada asiento recuerda la ocurrencia que lo generó (como un número de serie)
ALTER TABLE account_move
  ADD COLUMN recurring_id   bigint,
  ADD COLUMN recurring_date date,                            -- fecha original, aunque se haya movido
  ADD UNIQUE (recurring_id, recurring_date),
  ADD FOREIGN KEY (recurring_id, user_id) REFERENCES account_recurring (id, user_id),
  ADD CHECK ((recurring_id IS NULL) = (recurring_date IS NULL));

-- Préstamo de banco: la ficha de su cuenta de pasivo, con el banco y su cuota recurrente
CREATE TABLE account_loan (
  account_id   bigint PRIMARY KEY,
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  account_type text NOT NULL DEFAULT 'liability' CHECK (account_type = 'liability'),
  bank_id      smallint NOT NULL REFERENCES res_bank (id),
  recurring_id bigint,                                       -- la cuota de cada mes
  UNIQUE (recurring_id),
  FOREIGN KEY (account_id, account_type) REFERENCES account_account (id, account_type) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id)      REFERENCES account_account (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (recurring_id, user_id)    REFERENCES account_recurring (id, user_id)
);
SELECT ppm_enable_rls('account_loan');

-- El N-ésimo día de la semana del mes (p_nth = -1: el último); 1 = lunes
CREATE FUNCTION nth_weekday(p_month date, p_weekday int, p_nth int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_nth > 0
    THEN f + (p_weekday - extract(isodow FROM f)::int + 7) % 7 + 7 * (p_nth - 1)
    ELSE l - (extract(isodow FROM l)::int - p_weekday + 7) % 7
  END
  FROM (SELECT date_trunc('month', p_month)::date AS f,
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date AS l) m
$$;

-- Ocurrencias de una plantilla hasta p_until. Sin feriados: si cae domingo, se mueve esa vez
CREATE FUNCTION account_recurring_dates(p_id bigint, p_until date)
RETURNS TABLE (occurrence_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r account_recurring;
  k integer := 0;   -- número de periodo
  n integer := 0;   -- ocurrencias contadas (para end_type = 'count')
  p date;           -- inicio del periodo k
  d date;
BEGIN
  SELECT * INTO r FROM account_recurring WHERE id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  LOOP
    p := CASE r.interval_type
           WHEN 'day'   THEN r.date_start + k * r.interval_count
           WHEN 'week'  THEN r.date_start + 7 * k * r.interval_count
           WHEN 'month' THEN (date_trunc('month', r.date_start) + make_interval(months => k * r.interval_count))::date
           WHEN 'year'  THEN (r.date_start + make_interval(years => k * r.interval_count))::date
         END;
    EXIT WHEN p > p_until OR (r.end_type = 'date' AND p > r.date_end);
    FOR d IN
      SELECT c FROM (
        SELECT day_in_month(p, unnest(r.month_days)) AS c WHERE r.month_day_mode = 'days'
        UNION SELECT nth_weekday(p, r.weekday, r.nth)     WHERE r.month_day_mode = 'nth_weekday'
        UNION SELECT p                                     WHERE r.interval_type <> 'month'
      ) s WHERE c IS NOT NULL ORDER BY c
    LOOP
      CONTINUE WHEN d < r.date_start;
      IF d > p_until OR (r.end_type = 'date' AND d > r.date_end)
         OR (r.end_type = 'count' AND n >= r.max_count) THEN
        RETURN;
      END IF;
      n := n + 1;
      occurrence_date := d;
      RETURN NEXT;
    END LOOP;
    k := k + 1;
  END LOOP;
END $$;

-- Generar lo pendiente de quien está en la sesión, desde generated_until. Inserta en borrador y
-- luego confirma, así el cuadre se revisa igual que en un asiento manual. Los céntimos de redondeo al
-- convertir de moneda van a la línea más grande. Devuelve cuántos asientos creó
CREATE FUNCTION account_recurring_run(p_today date DEFAULT user_today())
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lock   date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base   smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r        account_recurring;
  o        record;
  v_move   bigint;
  v_date   date;
  v_rate   numeric;
  v_factor numeric;
  v_diff   numeric;
  v_count  integer := 0;
BEGIN
  FOR r IN SELECT * FROM account_recurring
            WHERE state = 'active' AND post_mode <> 'reminder' ORDER BY id FOR UPDATE
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM account_recurring_line WHERE recurring_id = r.id);
    FOR o IN
      SELECT d.occurrence_date, e.action, e.new_date, e.new_total
        FROM account_recurring_dates(r.id, p_today + r.lead_days) d
        LEFT JOIN account_recurring_exception e
               ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
       WHERE d.occurrence_date > coalesce(r.generated_until, '-infinity')
       ORDER BY d.occurrence_date
    LOOP
      IF o.action IS DISTINCT FROM 'skip' THEN
        -- En un periodo cerrado: el primer día abierto, y queda en borrador
        v_date := greatest(coalesce(o.new_date, o.occurrence_date), v_lock + 1);

        INSERT INTO account_move (date, ref, state, recurring_id, recurring_date)
        VALUES (v_date, r.name, 'draft', r.id, o.occurrence_date)
        ON CONFLICT (recurring_id, recurring_date) DO NOTHING      -- nunca duplica
        RETURNING id INTO v_move;

        IF v_move IS NOT NULL THEN
          v_rate := get_rate(r.currency_id, v_date, rate_side((   -- el lado lo pone la cuenta de dinero
                      SELECT a.account_type FROM account_recurring_line l
                        JOIN account_account a ON a.id = l.account_id
                       WHERE l.recurring_id = r.id AND a.account_type IN ('asset', 'liability')
                       ORDER BY l.id LIMIT 1)));
          SELECT coalesce(o.new_total / sum(amount), 1) INTO v_factor
            FROM account_recurring_line WHERE recurring_id = r.id AND amount > 0;

          -- Cada apunte en la moneda de la plantilla si su cuenta la acepta; si no (una cuenta de
          -- gasto en soles), en la moneda base ya convertido
          INSERT INTO account_move_line
                 (move_id, account_id, partner_id, name, debit, credit, currency_id, amount_currency)
          SELECT v_move, l.account_id, l.partner_id, l.name,
                 greatest( round(l.amount * v_factor * v_rate, 2), 0),
                 greatest(-round(l.amount * v_factor * v_rate, 2), 0),
                 c.cur,
                 CASE WHEN c.cur = r.currency_id THEN round(l.amount * v_factor, 2)
                      ELSE round(l.amount * v_factor * v_rate, 2) END
            FROM account_recurring_line l
            JOIN account_account a ON a.id = l.account_id
            CROSS JOIN LATERAL (
              SELECT CASE WHEN a.currency_id IS NULL OR a.currency_id = r.currency_id
                          THEN r.currency_id ELSE v_base END AS cur) c
           WHERE l.recurring_id = r.id
           ORDER BY l.id;

          -- Céntimos de redondeo: van a la línea más grande
          SELECT sum(balance) INTO v_diff FROM account_move_line WHERE move_id = v_move;
          IF v_diff <> 0 THEN
            UPDATE account_move_line SET
                   debit  = debit  - CASE WHEN debit  > 0 THEN v_diff ELSE 0 END,
                   credit = credit + CASE WHEN credit > 0 THEN v_diff ELSE 0 END,
                   amount_currency = CASE WHEN currency_id = v_base
                                          THEN amount_currency - v_diff ELSE amount_currency END
             WHERE id = (SELECT id FROM account_move_line WHERE move_id = v_move
                          ORDER BY abs(balance) DESC, id LIMIT 1);
          END IF;

          IF r.post_mode = 'auto' AND v_date <= p_today AND o.occurrence_date > v_lock THEN
            UPDATE account_move SET state = 'posted' WHERE id = v_move;
          END IF;
          v_count := v_count + 1;
        END IF;
      END IF;
      UPDATE account_recurring SET generated_until = o.occurrence_date WHERE id = r.id;
    END LOOP;
    -- Con fin y sin más ocurrencias: terminada
    IF r.end_type <> 'never'
       AND NOT EXISTS (SELECT 1 FROM account_recurring_dates(r.id, 'infinity') d
                        WHERE d.occurrence_date > coalesce((SELECT generated_until FROM account_recurring
                                                             WHERE id = r.id), '-infinity')) THEN
      UPDATE account_recurring SET state = 'done' WHERE id = r.id;
    END IF;
  END LOOP;

  -- Automáticas generadas por adelantado: se confirman al llegar su fecha
  UPDATE account_move m SET state = 'posted'
    FROM account_recurring t
   WHERE m.recurring_id = t.id AND t.post_mode = 'auto' AND m.state = 'draft'
     AND m.date <= p_today AND m.date > v_lock AND m.recurring_date > v_lock;

  RETURN v_count;
END $$;

-- Recordatorios pendientes (marcar atendido = avanzar generated_until)
CREATE VIEW account_recurring_reminder WITH (security_invoker = true) AS
SELECT r.id AS recurring_id, r.user_id, r.name, d.occurrence_date,
       coalesce(e.new_date, d.occurrence_date) AS date
  FROM account_recurring r
 CROSS JOIN LATERAL account_recurring_dates(r.id, user_today() + r.lead_days) d
  LEFT JOIN account_recurring_exception e
         ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
 WHERE r.state = 'active' AND r.post_mode = 'reminder'
   AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
   AND e.action IS DISTINCT FROM 'skip';
GRANT SELECT ON account_recurring_reminder TO ppm_app;

-- Flujo de caja futuro: lo que todavía no se generó, línea por línea
CREATE FUNCTION account_recurring_forecast(p_until date)
RETURNS TABLE (date date, recurring_id bigint, name text,
               account_id bigint, currency_id smallint, amount numeric)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(e.new_date, d.occurrence_date), r.id, r.name, l.account_id, r.currency_id,
         round(l.amount * coalesce(e.new_total / t.total, 1), 2)
    FROM account_recurring r
    CROSS JOIN LATERAL account_recurring_dates(r.id, p_until) d
    LEFT JOIN account_recurring_exception e
           ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
    JOIN account_recurring_line l ON l.recurring_id = r.id
    CROSS JOIN LATERAL (SELECT sum(amount) AS total FROM account_recurring_line
                         WHERE recurring_id = r.id AND amount > 0) t
   WHERE r.state = 'active'
     AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
     AND e.action IS DISTINCT FROM 'skip'
   ORDER BY 1, r.id, l.id
$$;

-- Importar: además de lo de 0015, un borrador de una recurrencia de monto variable toma el monto del banco
CREATE OR REPLACE FUNCTION import_statement_line(p_statement bigint, p_date date, p_payment_ref text,
                                      p_operation text, p_amount numeric, p_currency smallint,
                                      p_nth smallint DEFAULT 1)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  a      account_account%ROWTYPE;
  v_op   text := nullif(trim(p_operation), '');
  v_uid  text;
  v_move bigint;
  v_amt  numeric;                                  -- en moneda base
  v_how  text := 'matched';
BEGIN
  SELECT acc.* INTO a FROM account_account acc
    JOIN account_bank_statement s ON s.account_id = acc.id
   WHERE s.id = p_statement;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto desconocido: %', p_statement USING ERRCODE = 'no_data_found';
  END IF;
  IF a.currency_id IS NOT NULL AND p_currency <> a.currency_id THEN
    RAISE EXCEPTION 'La cuenta «%» es en otra moneda', a.name USING ERRCODE = 'check_violation';
  END IF;

  -- Huella: la cuenta y el número de operación o, si no viene, la fecha, el monto, la descripción
  -- y el orden entre las idénticas
  v_uid := a.id || '|' || coalesce('op:' || v_op,
           p_date || '|' || round(p_amount, 2) || '|' || md5(p_payment_ref) || '|' || p_nth);
  IF EXISTS (SELECT 1 FROM account_bank_statement_line WHERE unique_import_id = v_uid) THEN
    RETURN 'duplicate';
  END IF;
  IF p_date <= (SELECT lock_date FROM res_users WHERE id = current_user_id()) THEN
    RETURN 'locked';
  END IF;
  IF p_date > user_today() THEN
    RETURN 'future';
  END IF;

  -- 1) Ya existe: mismo monto en esta cuenta, a 3 días o menos, aún sin línea de un extracto de esta
  --    cuenta (lo que anotaste a mano o la otra mitad de una transferencia). Un borrador se confirma
  SELECT m.id INTO v_move
    FROM account_move m
    JOIN account_move_line l ON l.move_id = m.id
   WHERE l.account_id = a.id AND l.currency_id = p_currency AND l.amount_currency = p_amount
     AND m.date BETWEEN p_date - 3 AND p_date + 3
     AND (m.state = 'posted' OR m.date <= user_today())
     AND NOT EXISTS (SELECT 1 FROM account_bank_statement_line sl
                       JOIN account_bank_statement s ON s.id = sl.statement_id
                      WHERE sl.move_id = m.id AND s.account_id = a.id)
   ORDER BY abs(m.date - p_date), m.id
   LIMIT 1;

  -- 1b) Un borrador de una recurrencia de monto variable, de dos líneas, en esta cuenta, en el mismo
  --     sentido y a 3 días o menos (la luz, la cuota del préstamo): toma el monto y la fecha del banco
  --     y se confirma
  IF v_move IS NULL THEN
    SELECT m.id INTO v_move
      FROM account_move m
      JOIN account_recurring r ON r.id = m.recurring_id AND r.amount_type = 'variable'
      JOIN account_move_line l ON l.move_id = m.id
     WHERE m.state = 'draft' AND l.account_id = a.id AND l.currency_id = p_currency
       AND sign(l.amount_currency) = sign(p_amount)
       AND m.date BETWEEN p_date - 3 AND p_date + 3
       AND (SELECT count(*) FROM account_move_line x WHERE x.move_id = m.id) = 2
       AND NOT EXISTS (SELECT 1 FROM account_bank_statement_line sl
                         JOIN account_bank_statement s ON s.id = sl.statement_id
                        WHERE sl.move_id = m.id AND s.account_id = a.id)
     ORDER BY abs(m.date - p_date), m.id
     LIMIT 1;
    IF v_move IS NOT NULL THEN
      v_amt := round(abs(p_amount) * get_rate(p_currency, p_date, rate_side(a.account_type)), 2);
      UPDATE account_move_line
         SET debit  = CASE WHEN (account_id = a.id) = (p_amount > 0) THEN v_amt ELSE 0 END,
             credit = CASE WHEN (account_id = a.id) = (p_amount > 0) THEN 0 ELSE v_amt END,
             amount_currency = CASE WHEN account_id = a.id THEN p_amount
                                    WHEN currency_id = p_currency THEN -p_amount
                                    ELSE CASE WHEN p_amount > 0 THEN -v_amt ELSE v_amt END END
       WHERE move_id = v_move;
      UPDATE account_move SET date = p_date WHERE id = v_move;
    END IF;
  END IF;

  -- 2) Nuevo: el banco contra Por clasificar, que es multimoneda. La glosa empieza como la
  --    descripción del banco
  IF v_move IS NULL THEN
    v_how := 'created';
    v_amt := round(abs(p_amount) * get_rate(p_currency, p_date, rate_side(a.account_type)), 2);
    INSERT INTO account_move (date, ref, state) VALUES (p_date, p_payment_ref, 'posted')
    RETURNING id INTO v_move;
    INSERT INTO account_move_line (move_id, account_id, debit, credit, currency_id, amount_currency)
    VALUES (v_move, a.id, CASE WHEN p_amount > 0 THEN v_amt ELSE 0 END,
            CASE WHEN p_amount < 0 THEN v_amt ELSE 0 END, p_currency, p_amount),
           (v_move, system_account('suspense'), CASE WHEN p_amount < 0 THEN v_amt ELSE 0 END,
            CASE WHEN p_amount > 0 THEN v_amt ELSE 0 END, p_currency, -p_amount);
  ELSE
    UPDATE account_move SET state = 'posted' WHERE id = v_move AND state = 'draft';
  END IF;

  INSERT INTO account_bank_statement_line
         (statement_id, move_id, move_created, date, payment_ref, operation_number, amount, currency_id,
          unique_import_id)
  VALUES (p_statement, v_move, v_how = 'created', p_date, p_payment_ref, v_op, p_amount, p_currency, v_uid);
  RETURN v_how;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION import_statement_line(p_statement bigint, p_date date, p_payment_ref text,
                                      p_operation text, p_amount numeric, p_currency smallint,
                                      p_nth smallint DEFAULT 1)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  a      account_account%ROWTYPE;
  v_op   text := nullif(trim(p_operation), '');
  v_uid  text;
  v_move bigint;
  v_amt  numeric;                                  -- en moneda base
  v_how  text := 'matched';
BEGIN
  SELECT acc.* INTO a FROM account_account acc
    JOIN account_bank_statement s ON s.account_id = acc.id
   WHERE s.id = p_statement;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracto desconocido: %', p_statement USING ERRCODE = 'no_data_found';
  END IF;
  IF a.currency_id IS NOT NULL AND p_currency <> a.currency_id THEN
    RAISE EXCEPTION 'La cuenta «%» es en otra moneda', a.name USING ERRCODE = 'check_violation';
  END IF;

  -- Huella: la cuenta y el número de operación o, si no viene, la fecha, el monto, la descripción
  -- y el orden entre las idénticas
  v_uid := a.id || '|' || coalesce('op:' || v_op,
           p_date || '|' || round(p_amount, 2) || '|' || md5(p_payment_ref) || '|' || p_nth);
  IF EXISTS (SELECT 1 FROM account_bank_statement_line WHERE unique_import_id = v_uid) THEN
    RETURN 'duplicate';
  END IF;
  IF p_date <= (SELECT lock_date FROM res_users WHERE id = current_user_id()) THEN
    RETURN 'locked';
  END IF;
  IF p_date > user_today() THEN
    RETURN 'future';
  END IF;

  -- 1) Ya existe: mismo monto en esta cuenta, a 3 días o menos, aún sin línea de un extracto de esta
  --    cuenta (lo que anotaste a mano o la otra mitad de una transferencia). Un borrador se confirma
  SELECT m.id INTO v_move
    FROM account_move m
    JOIN account_move_line l ON l.move_id = m.id
   WHERE l.account_id = a.id AND l.currency_id = p_currency AND l.amount_currency = p_amount
     AND m.date BETWEEN p_date - 3 AND p_date + 3
     AND (m.state = 'posted' OR m.date <= user_today())
     AND NOT EXISTS (SELECT 1 FROM account_bank_statement_line sl
                       JOIN account_bank_statement s ON s.id = sl.statement_id
                      WHERE sl.move_id = m.id AND s.account_id = a.id)
   ORDER BY abs(m.date - p_date), m.id
   LIMIT 1;

  -- 2) Nuevo: el banco contra Por clasificar, que es multimoneda. La glosa empieza como la
  --    descripción del banco
  IF v_move IS NULL THEN
    v_how := 'created';
    v_amt := round(abs(p_amount) * get_rate(p_currency, p_date, rate_side(a.account_type)), 2);
    INSERT INTO account_move (date, ref, state) VALUES (p_date, p_payment_ref, 'posted')
    RETURNING id INTO v_move;
    INSERT INTO account_move_line (move_id, account_id, debit, credit, currency_id, amount_currency)
    VALUES (v_move, a.id, CASE WHEN p_amount > 0 THEN v_amt ELSE 0 END,
            CASE WHEN p_amount < 0 THEN v_amt ELSE 0 END, p_currency, p_amount),
           (v_move, system_account('suspense'), CASE WHEN p_amount < 0 THEN v_amt ELSE 0 END,
            CASE WHEN p_amount > 0 THEN v_amt ELSE 0 END, p_currency, -p_amount);
  ELSE
    UPDATE account_move SET state = 'posted' WHERE id = v_move AND state = 'draft';
  END IF;

  INSERT INTO account_bank_statement_line
         (statement_id, move_id, move_created, date, payment_ref, operation_number, amount, currency_id,
          unique_import_id)
  VALUES (p_statement, v_move, v_how = 'created', p_date, p_payment_ref, v_op, p_amount, p_currency, v_uid);
  RETURN v_how;
END $$;

DROP VIEW account_recurring_reminder;
DROP FUNCTION account_recurring_forecast(date), account_recurring_run(date),
              account_recurring_dates(bigint, date), nth_weekday(date, int, int);
DROP TABLE account_loan;
ALTER TABLE account_move DROP COLUMN recurring_id, DROP COLUMN recurring_date;
DROP TABLE account_recurring_exception, account_recurring_line, account_recurring;
DROP FUNCTION trg_recurring_balanced(), trg_recurring_defaults();
