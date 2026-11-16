-- migrate:up
-- Atajos de teclado (decisión del 16-nov-2026): cada persona puede cambiar las teclas de una letra
-- (registrar, buscar, editar, ver los atajos) y apagar las pistas que los muestran en la pantalla.
-- Se guardan en su cuenta para que valgan en cualquier computadora. Solo lo cambiado: {"register": "r"}.
ALTER TABLE res_users
  ADD COLUMN ui_shortcuts      jsonb   NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(ui_shortcuts) = 'object'),
  ADD COLUMN ui_shortcut_hints boolean NOT NULL DEFAULT true;
GRANT UPDATE (ui_shortcuts, ui_shortcut_hints) ON res_users TO ppm_app;

-- migrate:down
REVOKE UPDATE (ui_shortcuts, ui_shortcut_hints) ON res_users FROM ppm_app;
ALTER TABLE res_users DROP COLUMN ui_shortcuts, DROP COLUMN ui_shortcut_hints;
