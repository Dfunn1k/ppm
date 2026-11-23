-- migrate:up
-- El presupuesto es una capa aparte de la billetera (decisión «Borrar en el presupuesto», 23-nov): el
-- cierre de periodo protege los asientos, no los sobres. Asignar, deshacer, borrar y cambiar el lado
-- de una cuenta ya no miran lock_date; solo queda que no se asigna antes del mes en que empezó.
CREATE OR REPLACE FUNCTION check_budget_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_start date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT budget_start INTO v_start FROM res_users WHERE id = NEW.user_id;
    IF v_start IS NULL OR NEW.month < v_start THEN
      RAISE EXCEPTION 'Ese mes es de antes de que empezara tu presupuesto' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION check_budget_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM account_account a WHERE a.id = NEW.account_id
                     AND a.account_type IN ('asset', 'liability') AND a.system_role IS NULL) THEN
      RAISE EXCEPTION 'Esa cuenta no se puede sacar ni meter al presupuesto' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.post_id IS NOT NULL
       AND (SELECT kind FROM account_budget_post WHERE id = NEW.post_id) <> 'saving' THEN
      RAISE EXCEPTION 'Lo que pasas a una cuenta fuera del presupuesto sale de un sobre de ahorro'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION check_budget_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r     record := coalesce(NEW, OLD);
  v_lock  date;
  v_start date;
BEGIN
  SELECT lock_date, budget_start INTO v_lock, v_start FROM res_users WHERE id = r.user_id;
  IF v_lock IS NOT NULL AND (r.month + interval '1 month' - interval '1 day')::date <= v_lock THEN
    RAISE EXCEPTION '%', lock_message(v_lock) USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND (v_start IS NULL OR NEW.month < v_start) THEN
    RAISE EXCEPTION 'Ese mes es de antes de que empezara tu presupuesto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION check_budget_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r      record := coalesce(NEW, OLD);
  v_lock date := (SELECT lock_date FROM res_users WHERE id = r.user_id);
BEGIN
  IF v_lock IS NOT NULL AND r.date_from <= v_lock THEN
    RAISE EXCEPTION '%', lock_message(v_lock) USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM account_account a WHERE a.id = NEW.account_id
                     AND a.account_type IN ('asset', 'liability') AND a.system_role IS NULL) THEN
      RAISE EXCEPTION 'Esa cuenta no se puede sacar ni meter al presupuesto' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.post_id IS NOT NULL
       AND (SELECT kind FROM account_budget_post WHERE id = NEW.post_id) <> 'saving' THEN
      RAISE EXCEPTION 'Lo que pasas a una cuenta fuera del presupuesto sale de un sobre de ahorro'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN r;
END $$;
