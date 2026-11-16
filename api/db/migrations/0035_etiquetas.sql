-- migrate:up
-- Etiquetas (decisión del 16-nov-2026): post-its de colores que cruzan categorías. Un recibo vive
-- en una sola carpeta (su categoría), pero «Viaje a Cusco» puede ir en el taxi, la comida y el
-- hotel, y luego juntas todo lo que la lleva.
--
-- Van en el movimiento entero, no en cada línea como proponía el modelo: editar un movimiento
-- rehace sus líneas y la etiqueta se perdería; y la interfaz siempre etiqueta el movimiento entero.
-- Lo que se arma solo (las cuotas de una compra, las partes repartidas en el tiempo y sus
-- cancelaciones) lleva las etiquetas de la compra que lo origina: account_move_tag_v las resuelve.
-- Las etiquetas no cambian saldos: el cierre de periodo no las bloquea.

CREATE TABLE account_tag (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  name    text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),   -- 'Viaje a Cusco'
  color   smallint NOT NULL DEFAULT 0 CHECK (color BETWEEN 0 AND 11),  -- la paleta de las categorías
  active  boolean NOT NULL DEFAULT true,                                 -- archivada: no se ofrece
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX account_tag_name ON account_tag (user_id, lower(btrim(name)));
SELECT ppm_enable_rls('account_tag');

-- Many2many con el nombre que le daría Odoo
CREATE TABLE account_move_account_tag_rel (
  account_move_id bigint  NOT NULL,
  account_tag_id  bigint  NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  PRIMARY KEY (account_move_id, account_tag_id),
  FOREIGN KEY (account_move_id, user_id) REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_tag_id, user_id)  REFERENCES account_tag (id, user_id) ON DELETE CASCADE
);
CREATE INDEX account_move_account_tag_rel_tag ON account_move_account_tag_rel (account_tag_id);
SELECT ppm_enable_rls('account_move_account_tag_rel');

-- De qué movimiento toma sus etiquetas: el suyo, o el de la compra que lo originó
CREATE FUNCTION tag_source(p_move bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT d.move_id FROM account_deferral d JOIN account_move m ON m.deferral_id = d.id WHERE m.id = p_move),
    (SELECT d.move_id FROM account_deferral d WHERE d.cancel_move_id = p_move),
    (SELECT p.move_id FROM account_installment_plan p JOIN account_move m ON m.installment_plan_id = p.id
      WHERE m.id = p_move),
    (SELECT p.move_id FROM account_installment_plan p WHERE p.cancel_move_id = p_move),
    p_move)
$$;

-- Las etiquetas de cada movimiento, también las heredadas: por conjuntos (una unión por cada origen),
-- para que un reporte de un año no llame a tag_source fila por fila
CREATE VIEW account_move_tag_v WITH (security_invoker = true) AS
SELECT r.account_move_id AS move_id, r.account_tag_id AS tag_id, false AS inherited
  FROM account_move_account_tag_rel r
UNION ALL   -- una parte repartida
SELECT m.id, r.account_tag_id, true
  FROM account_move m JOIN account_deferral d ON d.id = m.deferral_id
  JOIN account_move_account_tag_rel r ON r.account_move_id = d.move_id
UNION ALL   -- la cancelación de un reparto
SELECT d.cancel_move_id, r.account_tag_id, true
  FROM account_deferral d JOIN account_move_account_tag_rel r ON r.account_move_id = d.move_id
 WHERE d.cancel_move_id IS NOT NULL
UNION ALL   -- una cuota
SELECT m.id, r.account_tag_id, true
  FROM account_move m JOIN account_installment_plan p ON p.id = m.installment_plan_id
  JOIN account_move_account_tag_rel r ON r.account_move_id = p.move_id
UNION ALL   -- la cancelación de las cuotas
SELECT p.cancel_move_id, r.account_tag_id, true
  FROM account_installment_plan p JOIN account_move_account_tag_rel r ON r.account_move_id = p.move_id
 WHERE p.cancel_move_id IS NOT NULL;
GRANT SELECT ON account_move_tag_v TO ppm_app;

-- migrate:down
DROP VIEW account_move_tag_v;
DROP FUNCTION tag_source(bigint);
DROP TABLE account_move_account_tag_rel;
DROP TABLE account_tag;
