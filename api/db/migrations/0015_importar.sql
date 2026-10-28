-- migrate:up
-- Importar extractos y Por clasificar (rebanada 8). El extracto es la bandeja de entrada del correo:
-- cada línea del banco entra al libro y nada se pierde. Si ya se importó, se descarta por su huella;
-- si ya existe un movimiento con ese monto en esa cuenta a 3 días o menos, se enlaza con él; lo demás
-- entra confirmado contra Por clasificar. Clasificar es mover cada correo a su carpeta.
-- Leer el Excel o el CSV y aplicar el mapeo es trabajo del adaptador (la API): la base recibe cada
-- línea ya traducida. El archivo queda como adjunto del extracto (ir_attachment).

-- Cómo leer los archivos de cada cuenta (como las plantillas de importación de Odoo)
CREATE TABLE account_import_template (
  account_id        bigint PRIMARY KEY,
  user_id           integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  date_format       text NOT NULL DEFAULT 'DD/MM/YYYY'
                    CHECK (date_format IN ('DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY')),
  decimal_separator char(1) NOT NULL DEFAULT '.' CHECK (decimal_separator IN ('.', ',')),
  header_row        smallint NOT NULL DEFAULT 1 CHECK (header_row >= 1),   -- fila de encabezados
  UNIQUE (account_id, user_id),                                            -- destino de las FK compuestas
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_import_template');

CREATE TABLE account_import_template_column (
  account_id  bigint NOT NULL,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('date', 'amount', 'debit', 'credit', 'payment_ref',
                                             'operation_number', 'currency', 'balance')),
  column_name text NOT NULL,                       -- encabezado en el archivo: 'Fecha operación'
  PRIMARY KEY (account_id, field),
  FOREIGN KEY (account_id, user_id) REFERENCES account_import_template (account_id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_import_template_column');

-- Un archivo importado; el archivo mismo es un ir_attachment con res_model = 'account.bank.statement'.
-- Una cuenta con extractos no se borra: se archiva
CREATE TABLE account_bank_statement (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  account_id       bigint NOT NULL,
  name             text NOT NULL,                  -- nombre del archivo
  date_from        date,
  date_to          date,
  balance_end_real numeric(14,2),                  -- saldo final: del archivo o escrito al importar
  create_date      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id),
  CHECK (date_from <= date_to)
);
CREATE INDEX account_bank_statement_account ON account_bank_statement (account_id);
SELECT ppm_enable_rls('account_bank_statement');

-- Cada línea del extracto y el asiento que le corresponde. Borrar el asiento borra su línea: si se
-- vuelve a importar, regresa, porque el banco dice que ocurrió
CREATE TABLE account_bank_statement_line (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  statement_id     bigint NOT NULL,
  move_id          bigint NOT NULL,
  move_created     boolean NOT NULL,              -- la importación creó el asiento (si no, lo enlazó)
  date             date NOT NULL,
  payment_ref      text NOT NULL,                 -- descripción del banco: no cambia
  operation_number text,                          -- número de operación
  amount           numeric(14,2) NOT NULL CHECK (amount <> 0),   -- con signo, en currency_id
  currency_id      smallint NOT NULL REFERENCES res_currency (id),
  unique_import_id text NOT NULL,                 -- la huella contra duplicados
  UNIQUE (user_id, unique_import_id),
  FOREIGN KEY (statement_id, user_id) REFERENCES account_bank_statement (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (move_id, user_id)      REFERENCES account_move (id, user_id) ON DELETE CASCADE
);
CREATE INDEX account_bank_statement_line_statement ON account_bank_statement_line (statement_id);
CREATE INDEX account_bank_statement_line_move ON account_bank_statement_line (move_id);
SELECT ppm_enable_rls('account_bank_statement_line');

-- Adjuntos (ir.attachment de Odoo): la ficha va en la base y el archivo en el almacén, en la carpeta
-- de cada persona, guardado según su huella SHA-1 (ab/ab12…): la misma foto subida dos veces ocupa
-- un solo lugar. La unión es polimórfica (res_model + res_id), así que dos triggers hacen el trabajo
-- de la llave foránea. Borrar la ficha no borra el archivo: un recolector borra los que ya nadie usa
CREATE TABLE ir_attachment (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  res_model   text NOT NULL CHECK (res_model IN ('account.move', 'account.bank.statement')),
  res_id      bigint NOT NULL,                    -- sin llave foránea: polimórfica
  name        text NOT NULL,                      -- 'movimientos-oct.xlsx'
  mimetype    text NOT NULL,
  file_size   integer NOT NULL CHECK (file_size > 0),
  checksum    char(40) NOT NULL CHECK (checksum ~ '^[0-9a-f]{40}$'),         -- SHA-1 del contenido
  store_fname text NOT NULL CHECK (store_fname ~ '^[0-9a-f]{2}/[0-9a-f]{40}$'),  -- dentro de su carpeta
  create_date timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ir_attachment_res ON ir_attachment (res_model, res_id);
CREATE INDEX ir_attachment_checksum ON ir_attachment (user_id, checksum);
SELECT ppm_enable_rls('ir_attachment');

-- Lo que haría la llave foránea al adjuntar
CREATE FUNCTION trg_attachment_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.res_model = 'account.move'
        AND NOT EXISTS (SELECT 1 FROM account_move WHERE id = NEW.res_id AND user_id = NEW.user_id))
     OR (NEW.res_model = 'account.bank.statement'
        AND NOT EXISTS (SELECT 1 FROM account_bank_statement WHERE id = NEW.res_id AND user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'No existe el registro % de % al que se adjunta', NEW.res_id, NEW.res_model
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER attachment_target BEFORE INSERT OR UPDATE OF res_model, res_id ON ir_attachment
  FOR EACH ROW EXECUTE FUNCTION trg_attachment_target();

-- Lo que haría ON DELETE CASCADE al borrar el asiento o el extracto
CREATE FUNCTION trg_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM ir_attachment WHERE res_model = TG_ARGV[0] AND res_id = OLD.id;
  RETURN OLD;
END $$;

CREATE TRIGGER move_attachment_cleanup AFTER DELETE ON account_move
  FOR EACH ROW EXECUTE FUNCTION trg_attachment_cleanup('account.move');
CREATE TRIGGER statement_attachment_cleanup AFTER DELETE ON account_bank_statement
  FOR EACH ROW EXECUTE FUNCTION trg_attachment_cleanup('account.bank.statement');

-- Importar una línea: descartar el duplicado, enlazar con un asiento que ya existe o crear uno nuevo
-- contra Por clasificar. El adaptador pasa p_nth, el orden de la línea entre las idénticas del mismo
-- día (dos cafés de S/ 5.00 no son uno repetido). Devuelve qué pasó: 'duplicate', 'matched',
-- 'created', o 'locked' / 'future' si la fecha cae en un periodo cerrado o todavía no llega.
-- El enlace con un borrador de recurrencia de monto variable llega con Recurrentes.
CREATE FUNCTION import_statement_line(p_statement bigint, p_date date, p_payment_ref text,
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

-- Clasificar: el apunte de Por clasificar pasa a la cuenta elegida, con la persona si hace falta
-- (obligatoria en Por cobrar, Por pagar y Plata que guardo de otros; opcional en una categoría).
-- Si la cuenta solo acepta la moneda base, el apunte pasa a esa moneda con su valor en libros; a una
-- cuenta en otra moneda no se clasifica: es un cambio de moneda y se registra como transferencia.
-- Que un pago no pase de lo que se debe y la conciliación con la persona los cuida la API
CREATE FUNCTION classify_move(p_move bigint, p_account bigint, p_partner bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  a      account_account%ROWTYPE;
  l      account_move_line%ROWTYPE;
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
BEGIN
  SELECT * INTO l FROM account_move_line
   WHERE move_id = p_move AND account_id = system_account('suspense');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese movimiento no está por clasificar' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO a FROM account_account WHERE id = p_account;
  IF NOT FOUND OR NOT a.active OR a.system_role IN ('suspense', 'opening') THEN
    RAISE EXCEPTION 'No se puede clasificar en esa cuenta' USING ERRCODE = 'check_violation';
  END IF;
  IF a.currency_id IS NOT NULL AND a.currency_id <> l.currency_id AND a.currency_id <> v_base THEN
    RAISE EXCEPTION 'La cuenta «%» es en otra moneda: regístralo como un cambio de moneda', a.name
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE account_move_line
     SET account_id      = a.id,
         partner_id      = p_partner,
         currency_id     = coalesce(a.currency_id, l.currency_id),
         amount_currency = CASE WHEN a.currency_id IS NULL OR a.currency_id = l.currency_id
                                THEN l.amount_currency ELSE l.balance END
   WHERE id = l.id;
END $$;

-- Deshacer una importación: se borran los asientos que el extracto creó y siguen en Por clasificar,
-- y el extracto con sus líneas y su archivo. Lo clasificado y lo enlazado se queda; si se vuelve a
-- importar, se enlaza otra vez y nada se duplica. Devuelve cuántos movimientos borró
CREATE FUNCTION undo_bank_statement(p_statement bigint) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM account_bank_statement WHERE id = p_statement) THEN
    RAISE EXCEPTION 'Extracto desconocido: %', p_statement USING ERRCODE = 'no_data_found';
  END IF;
  DELETE FROM account_move m
   USING account_bank_statement_line sl
   WHERE sl.statement_id = p_statement AND sl.move_created AND m.id = sl.move_id
     AND EXISTS (SELECT 1 FROM account_move_line l
                  WHERE l.move_id = m.id AND l.account_id = system_account('suspense'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM account_bank_statement WHERE id = p_statement;
  RETURN v_n;
END $$;

-- Control de saldo: el del banco contra el del libro a la misma fecha (cuentas de una moneda),
-- solo lo confirmado
CREATE VIEW account_bank_statement_check WITH (security_invoker = true) AS
SELECT s.id, s.user_id, s.account_id, s.name, s.date_to, s.balance_end_real, b.balance_book,
       s.balance_end_real - b.balance_book AS difference
  FROM account_bank_statement s
 CROSS JOIN LATERAL (
   SELECT coalesce(sum(l.amount_currency), 0) AS balance_book
     FROM account_move_line l
     JOIN account_move m ON m.id = l.move_id AND m.state = 'posted' AND m.date <= s.date_to
    WHERE l.account_id = s.account_id
 ) b
 WHERE s.balance_end_real IS NOT NULL;
GRANT SELECT ON account_bank_statement_check TO ppm_app;

-- migrate:down
DROP VIEW account_bank_statement_check;
DROP FUNCTION undo_bank_statement(bigint), classify_move(bigint, bigint, bigint),
              import_statement_line(bigint, date, text, text, numeric, smallint, smallint);
DROP TRIGGER statement_attachment_cleanup ON account_bank_statement;
DROP TRIGGER move_attachment_cleanup ON account_move;
DROP TABLE ir_attachment;
DROP FUNCTION trg_attachment_cleanup(), trg_attachment_target();
DROP TABLE account_bank_statement_line, account_bank_statement,
           account_import_template_column, account_import_template;
