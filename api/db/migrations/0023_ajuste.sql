-- migrate:up
-- «Ajuste»: la categoría de gasto para lo que nunca sabrás en qué fue o para cuadrar un descuadre.
-- Es el cajón de «varios»: es gasto desde ya y no vuelve a preguntar. Suelta (sin principal), así
-- sale al final de la hoja, en «Otras». No es de sistema: se renombra o se archiva como cualquiera.
-- Lo que todavía no sabes en qué fue va a Por clasificar («Lo clasifico después»): no necesita base.

INSERT INTO account_account_template (name, account_type, icon, color)
VALUES ('Ajuste', 'expense', 'balance', 0);

-- Quien ya está configurado la recibe ahora (corre como dueño de la base: alcanza a todos)
INSERT INTO account_account (user_id, name, account_type, currency_id, icon, color)
SELECT u.id, 'Ajuste', 'expense', u.currency_id, 'balance', 0
  FROM res_users u
 WHERE u.currency_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM account_account a
                    WHERE a.user_id = u.id AND a.parent_id IS NULL AND a.name = 'Ajuste'
                      AND a.currency_id = u.currency_id);

-- migrate:down
DELETE FROM account_account a
 WHERE a.name = 'Ajuste' AND a.parent_id IS NULL AND a.account_type = 'expense' AND a.system_role IS NULL
   AND NOT EXISTS (SELECT 1 FROM account_move_line l WHERE l.account_id = a.id)
   AND NOT EXISTS (SELECT 1 FROM account_account k WHERE k.parent_id = a.id);
DELETE FROM account_account_template WHERE name = 'Ajuste' AND parent_id IS NULL AND account_type = 'expense';
