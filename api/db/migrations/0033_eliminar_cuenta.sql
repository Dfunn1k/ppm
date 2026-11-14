-- migrate:up
-- Eliminar mi cuenta: como cerrar la cuenta en el banco. Se borra la fila de res_users y, en cascada,
-- todo lo de esa persona (las 29 tablas con user_id tienen ON DELETE CASCADE): cuentas, asientos,
-- adjuntos, recurrentes, sesiones. Las reglas de cada tabla no lo frenan: al llegar la cascada la
-- persona ya no está, así que no hay cierre de periodo ni moneda principal que cuidar.
-- La API comprueba la contraseña (o el correo, si no tiene) y luego borra los archivos del disco.
CREATE FUNCTION auth_account_delete()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM res_users WHERE id = current_user_id();
$$;
REVOKE ALL ON FUNCTION auth_account_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_account_delete() TO ppm_app;

-- migrate:down
DROP FUNCTION auth_account_delete();
