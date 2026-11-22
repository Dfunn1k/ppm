-- migrate:up
-- Presupuesto por sobres (decisiones D1–D10 del 21-nov-2026): una capa encima de la partida doble
-- que no toca ningún asiento. Se guarda solo lo que decide la persona: desde qué mes presupuesta,
-- sus sobres de ahorro, cuánto pone en cada sobre (y de dónde lo saca) y cómo entra cada cuenta al
-- presupuesto. Lo gastado y «Por asignar» se calculan siempre (budget_activity y app/budget.py), como
-- un saldo sale de sus apuntes: así no hay nada que pueda descuadrarse.

-- Desde qué mes presupuesta (el día 1). NULL = todavía no empezó.
ALTER TABLE res_users ADD COLUMN budget_start date CHECK (extract(day FROM budget_start) = 1);
GRANT UPDATE (budget_start) ON res_users TO ppm_app;

-- Los sobres. Uno de gasto por cada grupo de gasto (la categoría principal, con todas sus hijas: D1),
-- que nace y muere con él; y los de ahorro, que crea la persona (D10). «Construir patrimonio» es el de
-- ahorro que trae PPM: ahí caen el capital de los préstamos y lo que se pasa a inversiones.
CREATE TABLE account_budget_post (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('expense', 'saving')),
  account_id  bigint UNIQUE,                    -- el grupo de gasto (solo los de gasto)
  name        text CHECK (btrim(name) <> ''),   -- solo los de ahorro: los de gasto usan el del grupo
  icon        text CHECK (icon ~ '^[a-z0-9_]+$'),
  color       smallint CHECK (color BETWEEN 0 AND 11),
  system_role text CHECK (system_role IN ('patrimony')),
  active      boolean NOT NULL DEFAULT true,
  create_date timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, system_role),
  CHECK ((kind = 'expense') = (account_id IS NOT NULL)),
  CHECK ((kind = 'saving') = (name IS NOT NULL)),
  CHECK (system_role IS NULL OR kind = 'saving'),
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX account_budget_post_saving_name ON account_budget_post (user_id, lower(name)) WHERE active;
SELECT ppm_enable_rls('account_budget_post');

-- Un grupo de gasto tiene su sobre desde que nace. Solo los grupos (sin padre): una subcategoría
-- cuenta en el sobre de su grupo.
CREATE FUNCTION trg_budget_post_for_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_type = 'expense' AND NEW.parent_id IS NULL THEN
    INSERT INTO account_budget_post (user_id, kind, account_id) VALUES (NEW.user_id, 'expense', NEW.id)
    ON CONFLICT (account_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_budget_post_for_group
  AFTER INSERT ON account_account
  FOR EACH ROW EXECUTE FUNCTION trg_budget_post_for_group();

INSERT INTO account_budget_post (user_id, kind, account_id)
SELECT user_id, 'expense', id FROM account_account WHERE account_type = 'expense' AND parent_id IS NULL;

-- Asignar o mover plata entre sobres: su propia partida doble. Sin sobre de un lado es Por asignar:
-- (NULL → Comida) asigna, (Comida → Salidas) mueve, (Comida → NULL) devuelve a Por asignar.
CREATE TABLE account_budget_move (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  month        date NOT NULL CHECK (extract(day FROM month) = 1),
  from_post_id bigint,
  to_post_id   bigint,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'cover', 'fill', 'start')),
  create_date  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_post_id IS DISTINCT FROM to_post_id),
  CHECK (from_post_id IS NOT NULL OR to_post_id IS NOT NULL),
  FOREIGN KEY (from_post_id, user_id) REFERENCES account_budget_post (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (to_post_id, user_id)   REFERENCES account_budget_post (id, user_id) ON DELETE CASCADE
);
CREATE INDEX account_budget_move_month ON account_budget_move (user_id, month);
SELECT ppm_enable_rls('account_budget_move');

-- Lo que se asigna se fecha en su mes: un mes cerrado no se toca (como los asientos) y no se asigna
-- antes de que empiece el presupuesto.
CREATE FUNCTION check_budget_move() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER trg_budget_move
  BEFORE INSERT OR DELETE OR UPDATE ON account_budget_move
  FOR EACH ROW EXECUTE FUNCTION check_budget_move();

-- Cómo entra cada cuenta al presupuesto desde una fecha (D6): dentro o fuera y, si está fuera, de qué
-- sobre de ahorro sale lo que se le pasa (D10; NULL = «Construir patrimonio»). Sin filas, cada cuenta
-- sigue a su tipo (budget_default_in). Se guarda la historia para no reescribir los meses pasados.
CREATE TABLE account_budget_scope (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  account_id  bigint NOT NULL,
  date_from   date NOT NULL,
  on_budget   boolean NOT NULL,
  post_id     bigint,
  UNIQUE (account_id, date_from),
  CHECK (NOT on_budget OR post_id IS NULL),
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (post_id, user_id) REFERENCES account_budget_post (id, user_id) ON DELETE SET NULL (post_id)
);
SELECT ppm_enable_rls('account_budget_scope');

-- Solo las cuentas de dinero tuyas tienen interruptor; el sobre de una cuenta fuera es de ahorro, y
-- lo que ya quedó en un periodo cerrado no cambia.
CREATE FUNCTION check_budget_scope() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER trg_budget_scope
  BEFORE INSERT OR UPDATE OR DELETE ON account_budget_scope
  FOR EACH ROW EXECUTE FUNCTION check_budget_scope();

-- Cómo entra una cuenta si nadie dijo nada (D6). Dentro siempre: Por pagar, Plata que guardo de otros
-- y Cuotas por venir. Fuera siempre: Por cobrar, los diferidos, Por clasificar, Saldos iniciales y
-- todo ingreso, gasto o patrimonio. Las de dinero tuyas: efectivo, bancos y tarjetas dentro; los
-- préstamos de banco y los demás pasivos fuera.
CREATE FUNCTION budget_default_in(p_account bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN a.system_role IN ('payable', 'custody', 'installments') THEN true
           WHEN a.system_role IS NOT NULL OR a.account_type NOT IN ('asset', 'liability') THEN false
           WHEN a.account_type = 'asset' THEN true
           ELSE EXISTS (SELECT 1 FROM account_credit_card c WHERE c.account_id = a.id)
         END
    FROM account_account a WHERE a.id = p_account
$$;

-- Dentro del presupuesto ese día, y el sobre de ahorro que le toca si está fuera (NULL = el de
-- «Construir patrimonio»).
CREATE FUNCTION budget_scope(p_account bigint, p_date date, OUT on_budget boolean, OUT post_id bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(s.on_budget, budget_default_in(p_account)), s.post_id
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (SELECT x.on_budget, x.post_id FROM account_budget_scope x
                        WHERE x.account_id = p_account AND x.date_from <= p_date
                        ORDER BY x.date_from DESC LIMIT 1) s ON true
$$;

-- La regla de la frontera (decisión «Presupuesto por sobres»): en cada asiento confirmado entre
-- p_from y p_to que toca la plata del presupuesto (P), cada apunte de una cuenta de fuera dice qué
-- le pasó a esa plata. Devuelve, por apunte, a dónde va su efecto (el contrario de su balance):
--   'post'       un sobre: el del grupo de un gasto; el de la categoría de un pago por adelantado
--                (D5); el de ahorro de una cuenta fuera cuando se le pasa plata (D10)
--   'suspense'   Por clasificar, a la vista
--   'unassigned' Por asignar: ingresos, Por cobrar, cobrado por adelantado, préstamos recibidos,
--                retiros de una inversión, saldos iniciales
-- Lo que suman los apuntes de P en un asiento es lo mismo, con signo contrario, que lo que suman los
-- de fuera; por eso P = Por asignar + lo disponible en los sobres no puede romperse.
CREATE FUNCTION budget_activity(p_from date, p_to date)
RETURNS TABLE (move_id bigint, date date, bucket text, post_id bigint, amount numeric)
LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT l.move_id, m.date, l.account_id, l.balance, a.account_type, a.system_role,
           coalesce(a.parent_id, a.id) AS root, s.on_budget, s.post_id AS link
      FROM account_move m
      JOIN account_move_line l ON l.move_id = m.id
      JOIN account_account a   ON a.id = l.account_id
     CROSS JOIN LATERAL budget_scope(l.account_id, m.date) s
     WHERE m.state = 'posted' AND m.date BETWEEN p_from AND p_to
  ), touching AS (
    SELECT l.move_id FROM l GROUP BY l.move_id HAVING bool_or(l.on_budget)
  ), deferral AS (
    SELECT coalesce(c.parent_id, c.id) AS root, x.move AS move_id
      FROM account_deferral d
      JOIN account_account c ON c.id = d.category_account_id
     CROSS JOIN LATERAL (VALUES (d.move_id), (d.cancel_move_id)) x (move)
     WHERE x.move IS NOT NULL AND d.kind = 'expense'
  ), patrimony AS (
    SELECT id FROM account_budget_post WHERE system_role = 'patrimony'
  )
  SELECT l.move_id, l.date,
         CASE WHEN p.id IS NOT NULL THEN 'post'
              WHEN l.system_role = 'suspense' THEN 'suspense'
              ELSE 'unassigned' END,
         p.id, -l.balance
    FROM l
    JOIN touching t USING (move_id)
    LEFT JOIN deferral d ON d.move_id = l.move_id AND l.system_role = 'prepaid'
    LEFT JOIN account_budget_post p ON p.id = CASE
         WHEN l.account_type = 'expense' THEN (SELECT g.id FROM account_budget_post g WHERE g.account_id = l.root)
         WHEN l.system_role = 'prepaid' THEN (SELECT g.id FROM account_budget_post g WHERE g.account_id = d.root)
         WHEN l.system_role IS NULL AND l.account_type IN ('asset', 'liability') AND l.balance > 0
           THEN coalesce(l.link, (SELECT id FROM patrimony))
         END
   WHERE NOT l.on_budget
$$;

-- Cuánto cambió P en cada asiento confirmado (la suma de sus apuntes dentro), y cuánto entró o salió
-- cuando una cuenta cambió de lado con saldo: con esto se mide la edad del dinero (D9) y se arma P.
CREATE FUNCTION budget_flows(p_to date)
RETURNS TABLE (date date, move_id bigint, amount numeric)
LANGUAGE sql STABLE AS $$
  SELECT m.date, m.id, sum(l.balance)
    FROM account_move m
    JOIN account_move_line l ON l.move_id = m.id
   CROSS JOIN LATERAL budget_scope(l.account_id, m.date) s
   WHERE m.state = 'posted' AND m.date <= p_to AND s.on_budget
   GROUP BY m.date, m.id
  HAVING sum(l.balance) <> 0
  UNION ALL
  SELECT x.date_from, NULL,
         (CASE WHEN x.on_budget THEN 1 ELSE -1 END) * coalesce((
           SELECT sum(l.balance) FROM account_move_line l JOIN account_move m ON m.id = l.move_id
            WHERE l.account_id = x.account_id AND m.state = 'posted' AND m.date < x.date_from), 0)
    FROM account_budget_scope x
   WHERE x.date_from <= p_to
     AND x.on_budget IS DISTINCT FROM (budget_scope(x.account_id, x.date_from - 1)).on_budget
$$;

GRANT EXECUTE ON FUNCTION budget_default_in(bigint), budget_scope(bigint, date),
  budget_activity(date, date), budget_flows(date) TO ppm_app;

-- migrate:down
DROP FUNCTION budget_flows(date);
DROP FUNCTION budget_activity(date, date);
DROP FUNCTION budget_scope(bigint, date);
DROP FUNCTION budget_default_in(bigint);
DROP TABLE account_budget_scope;
DROP FUNCTION check_budget_scope();
DROP TABLE account_budget_move;
DROP FUNCTION check_budget_move();
DROP TRIGGER trg_budget_post_for_group ON account_account;
DROP FUNCTION trg_budget_post_for_group();
DROP TABLE account_budget_post;
REVOKE UPDATE (budget_start) ON res_users FROM ppm_app;
ALTER TABLE res_users DROP COLUMN budget_start;
