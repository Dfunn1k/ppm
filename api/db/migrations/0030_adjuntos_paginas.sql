-- migrate:up
-- El visor de adjuntos muestra cada página de un PDF como imagen: su número de páginas se guarda al
-- subirlo (NULL en las fotos, o en un PDF que todavía no se contó: se cuenta la primera vez que se ve).
ALTER TABLE ir_attachment ADD COLUMN page_count smallint CHECK (page_count > 0);

-- migrate:down
ALTER TABLE ir_attachment DROP COLUMN page_count;
