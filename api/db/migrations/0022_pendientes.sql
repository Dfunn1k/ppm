-- migrate:up
-- Pendientes (rebanada 11): una bandeja con lo que espera algo de ti.
-- Los avisos que calcula PPM no se guardan: la vista mail_notice mira el estado real cada vez, así
-- un aviso desaparece solo cuando se resuelve. Se puede posponer hasta una fecha: solo se guarda
-- el «pospuesto hasta» (mail_notice_snooze); vuelve si sigue sin resolverse.
-- Los recordatorios que escribe la persona sí se guardan (mail_activity, como las actividades de
-- Odoo): de una vez, colgados de un movimiento, una persona, una cuenta o sueltos.

-- 1) Con cuántos días de anticipación avisan el pago de tarjeta y los vencimientos
ALTER TABLE res_users
  ADD COLUMN notice_days smallint NOT NULL DEFAULT 3 CHECK (notice_days BETWEEN 0 AND 60);
GRANT UPDATE (notice_days) ON res_users TO ppm_app;

-- 2) Los recordatorios propios. Si se borra lo que lo sostiene, queda suelto: no se pierde la nota.
-- Posponerlo es cambiar su fecha; al hacerlo sale de la bandeja y queda con su done_date.
CREATE TABLE mail_activity (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  date_deadline date NOT NULL,                       -- para cuándo
  summary       text NOT NULL CHECK (btrim(summary) <> ''),   -- 'Llamar a Damaris por la cuota'
  move_id       bigint,
  partner_id    bigint,
  account_id    bigint,
  done_date     date,                                -- NULL: sigue pendiente
  create_date   timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(move_id, partner_id, account_id) <= 1),   -- cuelga de una cosa o de ninguna
  FOREIGN KEY (move_id, user_id)    REFERENCES account_move (id, user_id)    ON DELETE SET NULL (move_id),
  FOREIGN KEY (partner_id, user_id) REFERENCES res_partner (id, user_id)     ON DELETE SET NULL (partner_id),
  FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id) ON DELETE SET NULL (account_id)
);
CREATE INDEX mail_activity_open ON mail_activity (user_id, date_deadline) WHERE done_date IS NULL;
CREATE INDEX mail_activity_move ON mail_activity (move_id) WHERE move_id IS NOT NULL;
CREATE INDEX mail_activity_partner ON mail_activity (partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX mail_activity_account ON mail_activity (account_id) WHERE account_id IS NOT NULL;
SELECT ppm_enable_rls('mail_activity');

-- 3) Los avisos pospuestos: la llave del aviso (la de mail_notice) y hasta cuándo se esconde.
-- Una fila vieja no molesta: cuando su fecha pasa o el aviso se resuelve, deja de importar.
CREATE TABLE mail_notice_snooze (
  user_id      integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  notice_key   text NOT NULL,
  snooze_until date NOT NULL,
  PRIMARY KEY (user_id, notice_key)
);
SELECT ppm_enable_rls('mail_notice_snooze');

-- 4) Los avisos que calcula PPM, agrupados según su tipo:
--   maturity:  lo que te deben (+) o debes (−) y vence en notice_days o menos; uno por persona,
--              cuenta y moneda (date = el vencimiento más próximo)
--   card_due:  lo facturado de una tarjeta y su fecha de pago en notice_days o menos; uno por
--              tarjeta y corte (una fila por moneda, con la misma llave)
--   draft:     cuántos movimientos por confirmar ya llegaron a su día (incluye cargos del banco)
--   suspense:  cuántos movimientos siguen en Por clasificar
--   recurring: una recurrente en modo recordatorio que llegó a su día; uno por fecha
-- snooze_until: hasta cuándo está pospuesto (NULL si no lo está o ya volvió)
CREATE VIEW mail_notice WITH (security_invoker = true) AS
WITH u AS (
  SELECT user_today() AS today, notice_days FROM res_users WHERE id = current_user_id()
), n AS (
  SELECT 'maturity' AS kind, format('maturity/%s/%s/%s', r.partner_id, r.account_id, r.currency_id) AS notice_key,
         min(r.date_maturity) AS date, r.partner_id, r.account_id, r.currency_id,
         sum(r.amount_residual) AS amount, count(*)::int AS count,
         NULL::bigint AS recurring_id, NULL::date AS occurrence_date
    FROM account_move_line_residual r
    JOIN account_account a ON a.id = r.account_id AND a.system_role IN ('receivable', 'payable')
   CROSS JOIN u
   WHERE r.amount_residual <> 0 AND r.date_maturity <= u.today + u.notice_days
   GROUP BY r.partner_id, r.account_id, r.currency_id
  UNION ALL
  SELECT 'card_due', format('card_due/%s/%s', s.account_id, s.last_closing),
         s.date_due, NULL, s.account_id, s.currency_id, s.to_pay, 1, NULL, NULL
    FROM credit_card_status() s
   CROSS JOIN u
   WHERE s.to_pay > 0 AND s.date_due <= u.today + u.notice_days
  UNION ALL
  SELECT 'draft', 'draft', min(m.date), NULL, NULL, NULL, NULL, count(*)::int, NULL, NULL
    FROM account_move m
   CROSS JOIN u
   WHERE m.state = 'draft' AND m.date <= u.today
  HAVING count(*) > 0
  UNION ALL
  SELECT 'suspense', 'suspense', min(m.date), NULL, NULL, NULL, NULL, count(DISTINCT m.id)::int, NULL, NULL
    FROM account_move_line l
    JOIN account_move m ON m.id = l.move_id
   WHERE l.account_id = system_account('suspense')
  HAVING count(*) > 0
  UNION ALL
  SELECT 'recurring', format('recurring/%s/%s', v.recurring_id, v.occurrence_date),
         v.date, NULL, NULL, r.currency_id,
         (SELECT l.amount FROM account_recurring_line l WHERE l.recurring_id = r.id ORDER BY l.id LIMIT 1),
         1, v.recurring_id, v.occurrence_date
    FROM account_recurring_reminder v
    JOIN account_recurring r ON r.id = v.recurring_id
   CROSS JOIN u
   WHERE v.date <= u.today
)
SELECT n.*, s.snooze_until
  FROM n
 CROSS JOIN u
  LEFT JOIN mail_notice_snooze s ON s.notice_key = n.notice_key AND s.snooze_until > u.today;
GRANT SELECT ON mail_notice TO ppm_app;

-- migrate:down
DROP VIEW mail_notice;
DROP TABLE mail_notice_snooze, mail_activity;
REVOKE UPDATE (notice_days) ON res_users FROM ppm_app;
ALTER TABLE res_users DROP COLUMN notice_days;
