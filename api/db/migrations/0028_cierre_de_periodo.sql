-- migrate:up
-- Rebanada 13: cierre de periodo. res_users.lock_date (desde 0003) congela todo lo que tiene fecha
-- hasta ese día: ningún asiento se crea, se cambia (fecha, estado, cuentas, montos, moneda, persona)
-- ni se borra. Se lee el cierre del dueño de la fila, no de la sesión: así borrar un usuario (que se
-- lleva sus asientos en cascada) no choca con su propio cierre. Los vencimientos, los cortes de las
-- cuotas y las conciliaciones no cambian saldos y siguen libres.
-- Cerrar exige que no quede nada por confirmar ni por clasificar hasta esa fecha, y solo días que ya
-- pasaron. Reabrir (mover la fecha atrás o quitarla) siempre se puede.

CREATE FUNCTION lock_message(p_lock date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('El periodo está cerrado hasta el %s: reábrelo en Más › Cierre de periodo para cambiar algo de esas fechas',
                to_char(p_lock, 'DD/MM/YYYY'))
$$;

CREATE FUNCTION check_move_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lock date := (SELECT lock_date FROM res_users WHERE id = coalesce(NEW.user_id, OLD.user_id));
BEGIN
  IF v_lock IS NOT NULL
     AND ((TG_OP <> 'INSERT' AND OLD.date <= v_lock) OR (TG_OP <> 'DELETE' AND NEW.date <= v_lock)) THEN
    RAISE EXCEPTION '%', lock_message(v_lock) USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER trg_move_lock
  BEFORE INSERT OR DELETE OR UPDATE OF date, state ON account_move
  FOR EACH ROW EXECUTE FUNCTION check_move_lock();

CREATE FUNCTION check_move_line_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lock date := (SELECT lock_date FROM res_users WHERE id = coalesce(NEW.user_id, OLD.user_id));
  v_date date;
BEGIN
  IF v_lock IS NOT NULL THEN
    -- Al borrar el asiento, sus apuntes se van en cascada cuando el asiento ya no está: no hay fecha
    SELECT date INTO v_date FROM account_move WHERE id = coalesce(NEW.move_id, OLD.move_id);
    IF v_date <= v_lock THEN
      RAISE EXCEPTION '%', lock_message(v_lock) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER trg_move_line_lock
  BEFORE INSERT OR DELETE OR UPDATE OF account_id, debit, credit, currency_id, amount_currency, partner_id
  ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_move_line_lock();

-- Lo que impide cerrar hasta una fecha: cuántos por confirmar y cuántos por clasificar
CREATE FUNCTION lock_blockers(p_date date)
RETURNS TABLE (drafts integer, unclassified integer)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*)::int FROM account_move WHERE state = 'draft' AND date <= p_date),
         (SELECT count(DISTINCT m.id)::int FROM account_move m
            JOIN account_move_line l ON l.move_id = m.id
            JOIN account_account a ON a.id = l.account_id AND a.system_role = 'suspense'
           WHERE m.state = 'posted' AND m.date <= p_date)
$$;

CREATE FUNCTION check_lock_date() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b record;
BEGIN
  IF NEW.lock_date IS NULL OR NEW.lock_date <= coalesce(OLD.lock_date, '-infinity') THEN
    RETURN NEW;                                   -- reabrir siempre se puede
  END IF;
  IF NEW.lock_date >= (now() AT TIME ZONE coalesce(NEW.tz, 'America/Lima'))::date THEN
    RAISE EXCEPTION 'Solo se cierran días que ya pasaron' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO b FROM lock_blockers(NEW.lock_date);
  IF b.drafts > 0 THEN
    RAISE EXCEPTION 'Hay % por confirmar hasta el %: confírmalos o bórralos antes de cerrar',
      b.drafts, to_char(NEW.lock_date, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF b.unclassified > 0 THEN
    RAISE EXCEPTION 'Hay % por clasificar hasta el %: clasifícalos antes de cerrar',
      b.unclassified, to_char(NEW.lock_date, 'DD/MM/YYYY') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_lock_date
  BEFORE UPDATE OF lock_date ON res_users
  FOR EACH ROW EXECUTE FUNCTION check_lock_date();

-- Realinear los cortes no mueve los asientos de cuota que ya están en un periodo cerrado
CREATE OR REPLACE FUNCTION realign_card_closings(p_card bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r       record;
  v_close date;
  v_lock  date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
BEGIN
  FOR r IN
    SELECT pl.id, pl.n_installments, m.date
           + CASE WHEN EXISTS (SELECT 1 FROM account_move_line o
                                WHERE o.move_id = m.id AND o.account_id = system_account('opening'))
                  THEN 1 ELSE 0 END AS anchor,
           (SELECT count(*) FROM account_move_line l JOIN account_account a ON a.id = l.account_id
             WHERE l.move_id = m.id AND a.partner_required) = pl.n_installments AS parts
      FROM account_installment_plan pl
      JOIN account_move m ON m.id = pl.move_id
     WHERE pl.card_account_id = p_card
  LOOP
    v_close := card_closing_for(p_card, r.anchor);
    FOR k IN 1..r.n_installments LOOP
      UPDATE account_installment_plan_line SET closing_date = v_close
       WHERE plan_id = r.id AND sequence = k AND closing_date <> v_close;
      v_close := card_closing_for(p_card, v_close + 1);
    END LOOP;
    IF r.parts THEN
      PERFORM set_plan_maturities(r.id);
    END IF;
  END LOOP;
  UPDATE account_move m SET date = pl.closing_date
    FROM account_installment_plan_line pl
    JOIN account_installment_plan p ON p.id = pl.plan_id
   WHERE p.card_account_id = p_card
     AND m.installment_plan_id = pl.plan_id AND m.installment_sequence = pl.sequence
     AND m.date <> pl.closing_date
     AND m.date > v_lock AND pl.closing_date > v_lock;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION realign_card_closings(p_card bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r       record;
  v_close date;
BEGIN
  FOR r IN
    SELECT pl.id, pl.n_installments, m.date
           + CASE WHEN EXISTS (SELECT 1 FROM account_move_line o
                                WHERE o.move_id = m.id AND o.account_id = system_account('opening'))
                  THEN 1 ELSE 0 END AS anchor,
           (SELECT count(*) FROM account_move_line l JOIN account_account a ON a.id = l.account_id
             WHERE l.move_id = m.id AND a.partner_required) = pl.n_installments AS parts
      FROM account_installment_plan pl
      JOIN account_move m ON m.id = pl.move_id
     WHERE pl.card_account_id = p_card
  LOOP
    v_close := card_closing_for(p_card, r.anchor);
    FOR k IN 1..r.n_installments LOOP
      UPDATE account_installment_plan_line SET closing_date = v_close
       WHERE plan_id = r.id AND sequence = k AND closing_date <> v_close;
      v_close := card_closing_for(p_card, v_close + 1);
    END LOOP;
    IF r.parts THEN
      PERFORM set_plan_maturities(r.id);
    END IF;
  END LOOP;
  UPDATE account_move m SET date = pl.closing_date
    FROM account_installment_plan_line pl
    JOIN account_installment_plan p ON p.id = pl.plan_id
   WHERE p.card_account_id = p_card
     AND m.installment_plan_id = pl.plan_id AND m.installment_sequence = pl.sequence
     AND m.date <> pl.closing_date
     AND pl.closing_date > coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
END $$;
DROP TRIGGER trg_lock_date ON res_users;
DROP FUNCTION check_lock_date();
DROP FUNCTION lock_blockers(date);
DROP TRIGGER trg_move_line_lock ON account_move_line;
DROP FUNCTION check_move_line_lock();
DROP TRIGGER trg_move_lock ON account_move;
DROP FUNCTION check_move_lock();
DROP FUNCTION lock_message(date);
