-- migrate:up
-- Inicio a tu medida: qué cuentas de dinero se ven en el Inicio y en qué orden, con qué cuenta
-- arranca el + del Inicio y el modo privado (los montos del Inicio escondidos con «••••»).

-- 1) Cada cuenta: si se esconde del Inicio y su lugar (NULL = después de las ordenadas, por antigüedad)
ALTER TABLE account_account
  ADD COLUMN home_hidden   boolean NOT NULL DEFAULT false,
  ADD COLUMN home_sequence smallint;

-- 2) La persona: la cuenta del + del Inicio (NULL = elegirla cada vez) y el modo privado, que se
--    recuerda como el tema. Si la cuenta se borra, vuelve a «elegirla cada vez».
ALTER TABLE res_users
  ADD COLUMN home_account_id bigint,
  ADD COLUMN ui_private      boolean NOT NULL DEFAULT false,
  ADD FOREIGN KEY (home_account_id, id) REFERENCES account_account (id, user_id) ON DELETE SET NULL (home_account_id);
GRANT UPDATE (home_account_id, ui_private) ON res_users TO ppm_app;

-- migrate:down
REVOKE UPDATE (home_account_id, ui_private) ON res_users FROM ppm_app;
ALTER TABLE res_users DROP COLUMN home_account_id, DROP COLUMN ui_private;
ALTER TABLE account_account DROP COLUMN home_hidden, DROP COLUMN home_sequence;
