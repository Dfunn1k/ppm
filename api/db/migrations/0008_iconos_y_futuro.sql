-- migrate:up
-- 1) Íconos y colores de las categorías (diseño aprobado de la rebanada 3): cada categoría
--    principal con su color de la paleta (0 a 11) y cada una con su ícono de Material Symbols.
--    Las subcategorías no guardan color: heredan el de su principal (color NULL = el del padre).
-- 2) Un movimiento con fecha futura no puede estar confirmado: queda por confirmar y no cuenta.

CREATE TEMP TABLE look (parent text, name text, icon text, color smallint) ON COMMIT DROP;
INSERT INTO look VALUES
  -- De sistema
  (NULL, 'Saldos iniciales', 'flag', 0),
  (NULL, 'Efectivo', 'payments', NULL),
  (NULL, 'Por cobrar', 'call_received', NULL),
  (NULL, 'Por pagar', 'call_made', NULL),
  (NULL, 'Plata que guardo de otros', 'volunteer_activism', NULL),
  (NULL, 'Por clasificar', 'inbox', NULL),
  -- Gastos: el color va en la principal
  (NULL, 'Comida y bebida', 'restaurant', 2),
  ('Comida y bebida', 'Supermercado y mercado', 'shopping_cart', NULL),
  ('Comida y bebida', 'Restaurantes y delivery', 'restaurant', NULL),
  ('Comida y bebida', 'Cafés y bares', 'local_cafe', NULL),
  (NULL, 'Compras', 'shopping_bag', 9),
  ('Compras', 'Ropa y calzado', 'apparel', NULL),
  ('Compras', 'Electrónica', 'devices', NULL),
  ('Compras', 'Hogar', 'chair', NULL),
  ('Compras', 'Farmacia', 'medication', NULL),
  ('Compras', 'Salud y belleza', 'spa', NULL),
  ('Compras', 'Papelería y herramientas', 'construction', NULL),
  ('Compras', 'Joyería y accesorios', 'diamond', NULL),
  ('Compras', 'Regalos', 'redeem', NULL),
  ('Compras', 'Niños', 'child_care', NULL),
  ('Compras', 'Mascotas y animales', 'pets', NULL),
  (NULL, 'Vivienda', 'home', 6),
  ('Vivienda', 'Alquiler', 'key', NULL),
  ('Vivienda', 'Hipoteca', 'real_estate_agent', NULL),
  ('Vivienda', 'Servicios', 'bolt', NULL),
  ('Vivienda', 'Mantenimiento', 'handyman', NULL),
  ('Vivienda', 'Seguros de propiedad', 'shield', NULL),
  ('Vivienda', 'Impuestos de propiedad', 'receipt_long', NULL),
  (NULL, 'Transporte', 'directions_bus', 4),
  ('Transporte', 'Transporte público', 'directions_bus', NULL),
  ('Transporte', 'Taxi y apps', 'local_taxi', NULL),
  ('Transporte', 'Viajes largos', 'flight', NULL),
  (NULL, 'Vehículo', 'directions_car', 8),
  ('Vehículo', 'Combustible', 'local_gas_station', NULL),
  ('Vehículo', 'Estacionamiento y peajes', 'local_parking', NULL),
  ('Vehículo', 'Mantenimiento', 'car_repair', NULL),
  ('Vehículo', 'Seguro vehicular', 'verified_user', NULL),
  (NULL, 'Vida y entretenimiento', 'celebration', 5),
  ('Vida y entretenimiento', 'Salud', 'health_and_safety', NULL),
  ('Vida y entretenimiento', 'Deporte', 'fitness_center', NULL),
  ('Vida y entretenimiento', 'Educación', 'school', NULL),
  ('Vida y entretenimiento', 'Streaming y suscripciones', 'live_tv', NULL),
  ('Vida y entretenimiento', 'Eventos', 'confirmation_number', NULL),
  ('Vida y entretenimiento', 'Viajes', 'luggage', NULL),
  ('Vida y entretenimiento', 'Hobbies', 'palette', NULL),
  ('Vida y entretenimiento', 'Donaciones', 'volunteer_activism', NULL),
  (NULL, 'Comunicaciones', 'wifi', 11),
  ('Comunicaciones', 'Celular', 'smartphone', NULL),
  ('Comunicaciones', 'Internet', 'wifi', NULL),
  ('Comunicaciones', 'Software y apps', 'apps', NULL),
  (NULL, 'Gastos financieros', 'account_balance', 1),
  ('Gastos financieros', 'Comisiones bancarias', 'percent', NULL),
  ('Gastos financieros', 'Intereses', 'trending_up', NULL),
  ('Gastos financieros', 'Seguros', 'shield', NULL),
  ('Gastos financieros', 'Impuestos y multas', 'gavel', NULL),
  ('Gastos financieros', 'Deudas incobrables', 'money_off', NULL),
  ('Gastos financieros', 'Costo del cambio', 'currency_exchange', NULL),
  -- Ingresos: sueltos, todos en verde
  (NULL, 'Salario y facturas', 'payments', 10),
  (NULL, 'Cheques, cupones y vales', 'local_activity', 10),
  (NULL, 'Cuotas y subvenciones', 'account_balance_wallet', 10),
  (NULL, 'Ingresos por alquiler', 'key', 10),
  (NULL, 'Intereses y dividendos', 'trending_up', 10),
  (NULL, 'Lotería y apuestas', 'casino', 10),
  (NULL, 'Pensión alimenticia', 'family_restroom', 10),
  (NULL, 'Regalos', 'redeem', 10),
  (NULL, 'Venta', 'sell', 10),
  (NULL, 'Ganancia por tipo de cambio', 'currency_exchange', 10);

UPDATE account_account_template t
   SET icon = l.icon, color = l.color
  FROM look l
 WHERE l.name = t.name
   AND l.parent IS NOT DISTINCT FROM (SELECT p.name FROM account_account_template p WHERE p.id = t.parent_id);

-- Las cuentas que ya nacieron de la plantilla: se completan solo si siguen sin ícono ni color
-- (si alguien ya los eligió, se respetan). Corre como dueño de la base: alcanza a todos.
UPDATE account_account a
   SET icon  = coalesce(a.icon, l.icon),
       color = coalesce(a.color, l.color)
  FROM look l
 WHERE l.name = a.name
   AND l.parent IS NOT DISTINCT FROM (SELECT p.name FROM account_account p WHERE p.id = a.parent_id)
   AND (a.icon IS NULL OR (a.color IS NULL AND l.color IS NOT NULL));

-- Con fecha futura no se confirma: la plata todavía no se movió. Hoy es el de la zona de
-- la persona dueña del asiento.
CREATE FUNCTION check_move_not_future() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'posted'
     AND NEW.date > (SELECT (now() AT TIME ZONE u.tz)::date FROM res_users u WHERE u.id = NEW.user_id) THEN
    RAISE EXCEPTION 'Un movimiento con fecha futura queda por confirmar hasta que llegue su día'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_move_not_future
  BEFORE INSERT OR UPDATE OF state, date ON account_move
  FOR EACH ROW EXECUTE FUNCTION check_move_not_future();

-- La lista de Movimientos pide un mes a la vez
CREATE INDEX account_move_line_account_move ON account_move_line (account_id, move_id);

-- migrate:down
DROP INDEX account_move_line_account_move;
DROP TRIGGER trg_move_not_future ON account_move;
DROP FUNCTION check_move_not_future();
UPDATE account_account_template SET icon = NULL, color = NULL;
-- Los íconos y colores de las cuentas se quedan: ya son de cada persona
