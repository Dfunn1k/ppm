-- migrate:up
-- Ingresos y gastos diferidos (decisión de Dany, 2026-11-16). Como «Cuotas por venir», pero sin
-- tarjeta: pagas hoy el año de seguro y la plata espera en «Pagos por adelantado» (algo que tienes);
-- al empezar cada mes, su parte pasa a la categoría. Un cobro adelantado es lo mismo al revés: espera
-- en «Cobrado por adelantado» (algo que debes) y cada mes la parte ganada pasa a ingreso.
--
-- El calendario se arma al registrar (por días: cada mes según los días que cubre; por meses: partes
-- iguales el mismo día de cada mes; la última cierra el redondeo) y se guarda. Cada parte entra
-- confirmada al llegar su fecha, como las cuotas: se genera al abrir la app. En un mes cerrado queda
-- por confirmar. Todo va en moneda base: lo que espera ya está convertido el día del pago.
--
-- Cancelar lo que falta: lo que te devolvieron entra a tu cuenta y el resto cuenta ese día. Las
-- partes que faltaban se quedan en el calendario pero ya no se generan; borrar el asiento de la
-- cancelación (la FK lo deja en NULL) las devuelve.

-- 1) Las dos cuentas de sistema, en moneda base
INSERT INTO account_account_template (name, account_type, multicurrency, partner_required, system_role, icon)
VALUES ('Pagos por adelantado', 'asset', false, false, 'prepaid', 'hourglass_top'),
       ('Cobrado por adelantado', 'liability', false, false, 'unearned', 'hourglass_bottom');

INSERT INTO account_account (user_id, name, account_type, currency_id, system_role, icon)
SELECT u.id, t.name, t.account_type, u.currency_id, t.system_role, t.icon
  FROM res_users u
 CROSS JOIN account_account_template t
 WHERE t.system_role IN ('prepaid', 'unearned')
   AND u.currency_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM account_account a WHERE a.user_id = u.id AND a.system_role = t.system_role);

-- 2) El reparto: el asiento del pago (o del cobro) y sus condiciones
CREATE TABLE account_deferral (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  move_id             bigint NOT NULL UNIQUE,
  kind                text NOT NULL CHECK (kind IN ('expense', 'income')),
  method              text NOT NULL CHECK (method IN ('days', 'months')),
  date_start          date NOT NULL,
  date_end            date,                                  -- por días: el último día que cubre
  n_months            smallint CHECK (n_months BETWEEN 2 AND 60),   -- por meses: en cuántos
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),    -- en moneda base
  category_account_id bigint NOT NULL,                       -- adónde va cada parte
  cancel_move_id      bigint REFERENCES account_move (id) ON DELETE SET NULL,
  UNIQUE (id, user_id),
  CHECK (CASE method WHEN 'days' THEN date_end > date_start AND n_months IS NULL
                     ELSE date_end IS NULL AND n_months IS NOT NULL END),
  FOREIGN KEY (move_id, user_id)             REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_account_id, user_id) REFERENCES account_account (id, user_id)
);
SELECT ppm_enable_rls('account_deferral');

-- El calendario: una línea por parte
CREATE TABLE account_deferral_line (
  deferral_id bigint NOT NULL,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  sequence    smallint NOT NULL,
  date        date NOT NULL,                                 -- cuándo cuenta
  days        smallint,                                      -- por días: cuántos cubre
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (deferral_id, sequence),
  FOREIGN KEY (deferral_id, user_id) REFERENCES account_deferral (id, user_id) ON DELETE CASCADE
);
SELECT ppm_enable_rls('account_deferral_line');

-- La parte ya contada: el asiento recuerda su parte (como las cuotas)
ALTER TABLE account_move
  ADD COLUMN deferral_id       bigint,
  ADD COLUMN deferral_sequence smallint,
  ADD UNIQUE (deferral_id, deferral_sequence),
  ADD FOREIGN KEY (deferral_id, deferral_sequence)
      REFERENCES account_deferral_line (deferral_id, sequence) ON DELETE CASCADE,
  ADD CHECK ((deferral_id IS NULL) = (deferral_sequence IS NULL));

-- 3) Las partes que ya llegaron: un asiento por parte con su fecha, de lo que espera a la categoría
CREATE FUNCTION post_deferrals(p_today date DEFAULT user_today()) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base  smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r       record;
  v_hold  bigint;
  v_move  bigint;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT dl.deferral_id, dl.sequence, dl.date, dl.amount, d.kind, d.category_account_id, m.ref,
           (SELECT count(*) FROM account_deferral_line x WHERE x.deferral_id = d.id) AS n
      FROM account_deferral_line dl
      JOIN account_deferral d ON d.id = dl.deferral_id AND d.cancel_move_id IS NULL
      JOIN account_move m ON m.id = d.move_id AND m.state = 'posted'
     WHERE dl.date <= p_today
       AND NOT EXISTS (SELECT 1 FROM account_move x
                        WHERE x.deferral_id = dl.deferral_id AND x.deferral_sequence = dl.sequence)
     ORDER BY dl.date, dl.deferral_id, dl.sequence
  LOOP
    v_hold := system_account(CASE r.kind WHEN 'expense' THEN 'prepaid' ELSE 'unearned' END);
    INSERT INTO account_move (date, ref, state, deferral_id, deferral_sequence)
    VALUES (greatest(r.date, v_lock + 1),                -- en un periodo cerrado: queda por confirmar
            format('%s · parte %s/%s', coalesce(r.ref, 'Repartido'), r.sequence, r.n),
            'draft', r.deferral_id, r.sequence)
    RETURNING id INTO v_move;
    -- El gasto: de lo que espera a la categoría. El ingreso: de lo que debes a la categoría
    INSERT INTO account_move_line (move_id, account_id, debit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN r.category_account_id ELSE v_hold END, r.amount, v_base, r.amount);
    INSERT INTO account_move_line (move_id, account_id, credit, currency_id, amount_currency)
    VALUES (v_move, CASE r.kind WHEN 'expense' THEN v_hold ELSE r.category_account_id END, r.amount, v_base, -r.amount);
    IF r.date > v_lock THEN
      UPDATE account_move SET state = 'posted' WHERE id = v_move;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- migrate:down
DROP FUNCTION post_deferrals(date);
DELETE FROM account_move WHERE id IN (SELECT move_id FROM account_deferral UNION SELECT cancel_move_id FROM account_deferral)
                            OR deferral_id IS NOT NULL;
ALTER TABLE account_move DROP COLUMN deferral_id, DROP COLUMN deferral_sequence;
DROP TABLE account_deferral_line;
DROP TABLE account_deferral;
ALTER TABLE account_account DISABLE TRIGGER account_system;
DELETE FROM account_account WHERE system_role IN ('prepaid', 'unearned');
ALTER TABLE account_account ENABLE TRIGGER account_system;
DELETE FROM account_account_template WHERE system_role IN ('prepaid', 'unearned');
