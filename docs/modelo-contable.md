# PPM — Modelo contable y base de datos

Oct 4, 2026 · @Dany Anderson Chavez Pauca

## Visión y alcance

La fase 1 de PPM modela solo dos cosas: cuentas y transacciones, con partida doble desde el primer día. Todo lo demás (presupuestos, reportes, metas) se construirá encima de este núcleo, sin cambiarlo.

La fase 1 debe permitir:

- Crear cuentas: bancarias, efectivo, tarjetas de crédito y las cuentas de ingreso y gasto.
- Registrar el saldo inicial de una cuenta bancaria.
- Registrar ingresos, gastos y transferencias como transacciones de partida doble.
- Consultar el saldo de cada cuenta y su historial de movimientos.

Fuera de alcance por ahora: presupuestos, conciliación bancaria y varios usuarios. Motor de base de datos: PostgreSQL.

**Principio de diseño: contable por dentro, intuitivo por fuera.** La base de datos usa partida doble completa, pero la interfaz no mostrará débitos, créditos ni "pasivos". Cada tipo de cuenta tendrá su propio formulario (banco, tarjeta, categoría de gasto); el diseño de esas pantallas queda para una sesión posterior.

**Principio de diseño: la lógica de negocio no depende de librerías ni frameworks.** Las reglas viven en el modelo (tablas, restricciones, funciones). Los estándares externos (ISO, Unicode CLDR) entran como datos que se cargan una vez, no como código que se llama en cada operación. Así cualquier capa, sea la app web, un script o un reporte, obtiene el mismo resultado leyendo las mismas tablas.

## Conceptos de partida doble

El dinero nunca aparece ni desaparece: siempre sale de una cuenta y entra a otra. Piensa en tanques de agua conectados por tuberías; pasar agua de un tanque a otro no crea agua, y cada litro que entra a un tanque salió de otro.

Para que esto funcione, los ingresos y los gastos también son cuentas. El sueldo no "aparece" en tu banco: sale de la cuenta Ingresos:Sueldo y entra a tu cuenta bancaria. Una compra sale del banco y entra a Gastos:Comida.

**Débito y crédito, sin jerga.** Débito = a dónde va el dinero. Crédito = de dónde viene. Toda transacción tiene al menos un débito y un crédito, y ambos suman lo mismo.

**Analogía con Odoo.** Una transacción de PPM es un asiento (`account.move`) y cada línea es un apunte (`account.move.line`) con su `debit` y `credit`. Es el mismo modelo, simplificado para finanzas personales.

| Tipo | Qué representa | Aumenta con | Ejemplos |
| --- | --- | --- | --- |
| Activo | Lo que tienes | Débito | BCP Ahorros, Efectivo |
| Pasivo | Lo que debes | Crédito | Tarjeta Visa, Préstamo |
| Patrimonio | Tu valor neto; saldos de apertura | Crédito | Saldos iniciales |
| Ingreso | De dónde llega el dinero | Crédito | Sueldo, Intereses |
| Gasto | A dónde se va el dinero | Débito | Comida, Transporte |

La regla que la base de datos debe garantizar en cada transacción:

```latex
\sum \text{débitos} = \sum \text{créditos}
```

Por eso una transferencia no es ingreso: solo toca dos cuentas de activo (o activo y pasivo), así que nunca aparece en un reporte de ingresos o gastos. Lo mismo pasa al pagar la tarjeta: el gasto se registró al comprar; el pago solo mueve dinero del banco a la deuda.

## Modelo de datos

Cuatro tablas centrales: un asiento tiene dos o más apuntes, y cada apunte toca una sola cuenta.

&#91;embedded content: modelo entidad-relación · 4 tablas centrales\]

`account_move_line` es la única tabla que guarda montos; las demás dan contexto (qué cuenta, qué fecha, qué tipo). Por eso todos los saldos y reportes salen de ella.

## SQL de la fase 1 (DDL)

Las tablas base, con nombres al estilo Odoo: monedas (`res_currency`), tu usuario (`res_users`, con tu moneda base y tu fecha de cierre), tipos de cuenta (`account_account_type`), cuentas (`account_account`), asientos (`account_move`) y apuntes (`account_move_line`). Las tablas de cada usuario llevan además user\_id y seguridad por fila (ver Arquitectura › Varios usuarios en una base). Requiere PostgreSQL 15 o superior por `NULLS NOT DISTINCT`.

```sql
-- 0. Catálogos globales (vienen con la app, estándar ISO), contactos y tu usuario
CREATE TABLE res_currency (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           char(3) NOT NULL UNIQUE,         -- ISO 4217 alfabético: 'PEN', 'USD'
  numeric_code   char(3) NOT NULL UNIQUE,         -- ISO 4217 numérico: '604', '840'
  full_name      text NOT NULL,                   -- 'Sol'
  decimal_places smallint NOT NULL DEFAULT 2      -- unidad menor de ISO 4217 (las que usa cada uno: res_users_currency)
);

INSERT INTO res_currency (name, numeric_code, full_name, decimal_places) VALUES
  ('PEN', '604', 'Sol',                  2),
  ('USD', '840', 'Dólar estadounidense', 2),
  ('EUR', '978', 'Euro',                 2);   -- … y el resto de ISO 4217

-- Idiomas y su formato de números y fechas (res.lang en Odoo)
CREATE TABLE res_lang (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE,            -- BCP 47: 'es-PE'
  name          text NOT NULL,                   -- 'Español (Perú)'
  decimal_point char(1) NOT NULL,                -- '.'
  thousands_sep char(1),                         -- ',' (NULL = sin separador)
  date_format   text NOT NULL                    -- 'DD/MM/YYYY'
);

INSERT INTO res_lang (code, name, decimal_point, thousands_sep, date_format) VALUES
  ('es-PE', 'Español (Perú)',   '.', ',', 'DD/MM/YYYY'),
  ('es-ES', 'Español (España)', ',', '.', 'DD/MM/YYYY');

-- Cómo se escribe cada moneda en cada idioma (de Unicode CLDR, ajustable)
CREATE TABLE res_currency_format (
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  lang_id     smallint NOT NULL REFERENCES res_lang (id),
  symbol      text NOT NULL,                     -- 'US$'
  position    text NOT NULL DEFAULT 'before'
              CHECK (position IN ('before', 'after')),
  space       boolean NOT NULL DEFAULT true,     -- 'S/ 10' o 'S/10'
  PRIMARY KEY (currency_id, lang_id)
);

INSERT INTO res_currency_format (currency_id, lang_id, symbol, position)
SELECT c.id, l.id, v.symbol, v.position
  FROM (VALUES ('PEN', 'es-PE', 'S/',  'before'), ('USD', 'es-PE', 'US$', 'before'),
               ('EUR', 'es-ES', '€',   'after'),  ('USD', 'es-ES', 'US$', 'after')
       ) AS v (currency, lang, symbol, position)
  JOIN res_currency c ON c.name = v.currency
  JOIN res_lang l     ON l.code = v.lang;

CREATE TABLE res_country (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        char(2) NOT NULL UNIQUE,                  -- ISO 3166-1 alfa-2: 'PE'
  code_alpha3 char(3) NOT NULL UNIQUE,                  -- ISO 3166-1 alfa-3: 'PER'
  numeric_code char(3) NOT NULL UNIQUE,                 -- ISO 3166-1 numérico: '604'
  name        text NOT NULL,                            -- 'Perú'
  currency_id smallint REFERENCES res_currency (id),    -- moneda local
  phone_code  smallint,                                 -- 51
  lang_id     smallint REFERENCES res_lang (id)         -- idioma por defecto
);

INSERT INTO res_country (code, code_alpha3, numeric_code, name, currency_id, phone_code, lang_id)
SELECT 'PE', 'PER', '604', 'Perú', c.id, 51, l.id
  FROM res_currency c, res_lang l WHERE c.name = 'PEN' AND l.code = 'es-PE';
-- … y el resto de ISO 3166-1

-- Contactos: personas con quienes compartes gastos o a quienes prestas dinero
CREATE TABLE res_partner (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,                            -- 'Ana Torres'
  email       text,
  phone       text,
  country_id  smallint REFERENCES res_country (id),
  active      boolean NOT NULL DEFAULT true,
  create_date timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE res_users (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,                                   -- 'Mi usuario'
  currency_id smallint NOT NULL REFERENCES res_currency (id),  -- moneda base
  country_id  smallint NOT NULL REFERENCES res_country (id),   -- tus bancos
  lang_id     smallint NOT NULL REFERENCES res_lang (id),      -- cómo ves montos y fechas
  lock_date   date                                             -- cierre de periodo
);
-- La fila de res_users nace al registrarse y setup_user la completa.
-- Las tablas de cada usuario llevan además user_id y seguridad por fila (Arquitectura › Varios usuarios)

-- 1. Tipos de cuenta: los 5 grupos contables, con su lado normal
CREATE TABLE account_account_type (
  code        text PRIMARY KEY,               -- 'asset', 'liability', ...
  name        text NOT NULL,
  normal_side char(1) NOT NULL CHECK (normal_side IN ('D', 'C'))
);

INSERT INTO account_account_type (code, name, normal_side) VALUES
  ('asset',     'Activo',     'D'),
  ('liability', 'Pasivo',     'C'),
  ('equity',    'Patrimonio', 'C'),
  ('income',    'Ingreso',    'C'),
  ('expense',   'Gasto',      'D');

-- 2. Cuentas (account.account): bancos, efectivo, tarjetas, ingresos y gastos
CREATE TABLE account_account (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  account_type text NOT NULL REFERENCES account_account_type (code),
  parent_id    bigint REFERENCES account_account (id),   -- jerarquía opcional
  currency_id  smallint REFERENCES res_currency (id),    -- NULL = multimoneda (tarjetas)
  partner_required boolean NOT NULL DEFAULT false,      -- por cobrar / por pagar
  system_role  text UNIQUE,                             -- la usa la lógica: 'fx_gain', 'opening'…
  icon         text CHECK (icon ~ '^[a-z0-9_]+$'),     -- Material Symbols; NULL = el del padre
  color        smallint CHECK (color BETWEEN 0 AND 11), -- paleta fija; NULL = el del padre
  active       boolean NOT NULL DEFAULT true,
  create_date  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (parent_id, name, currency_id),
  UNIQUE (id, account_type),                             -- para las FK de los subtipos
  CHECK (currency_id IS NOT NULL OR account_type IN ('asset', 'liability'))
);

-- 3. Asiento (account.move): la cabecera
CREATE TABLE account_move (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date        date NOT NULL,
  ref         text NOT NULL,                             -- descripción
  state       text NOT NULL DEFAULT 'draft'
              CHECK (state IN ('draft', 'posted')),      -- borrador / confirmado
  create_date timestamptz NOT NULL DEFAULT now()
);

-- 4. Apuntes (account.move.line): cada movimiento de dinero
CREATE TABLE account_move_line (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  move_id         bigint NOT NULL REFERENCES account_move (id) ON DELETE CASCADE,
  account_id      bigint NOT NULL REFERENCES account_account (id),
  name            text,                                  -- etiqueta opcional
  partner_id      bigint REFERENCES res_partner (id),    -- con quién (obligatorio si la cuenta lo pide)
  debit           numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit          numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  balance         numeric(14,2) GENERATED ALWAYS AS (debit - credit) STORED,
  currency_id     smallint NOT NULL REFERENCES res_currency (id),  -- moneda del apunte
  amount_currency numeric(14,2) NOT NULL,                -- monto en esa moneda, con signo
  CHECK ((debit > 0) <> (credit > 0)),                   -- exactamente un lado con monto
  CHECK (sign(amount_currency) = sign(debit - credit))   -- mismo sentido
);

CREATE INDEX ON account_move_line (move_id);
CREATE INDEX ON account_move_line (account_id);

-- Campos calculados de la cuenta, como los computed fields de Odoo
CREATE VIEW account_account_v AS
SELECT a.*, t.normal_side,
       CASE WHEN a.currency_id IS NULL THEN a.name
            ELSE a.name || ' (' || c.name || ')' END AS display_name  -- 'Cuenta digital BCP (PEN)'
  FROM account_account a
  JOIN account_account_type t ON t.code = a.account_type
  LEFT JOIN res_currency c    ON c.id = a.currency_id;
```

No hay columna de saldo en `account_account`: el saldo se calcula sumando apuntes, igual que un estado de cuenta se arma con sus movimientos. La columna `balance` de cada apunte es distinta: PostgreSQL la calcula como debit − credit, así que nunca puede contradecirlas; es el mismo campo de `account.move.line` en Odoo.

**Nombre visible.** Toda cuenta se muestra con el ISO de su moneda al final: si escribes "Cuenta digital BCP" en soles, se ve como "Cuenta digital BCP (PEN)"; una cuenta multimoneda, como una tarjeta bimoneda, se ve sin sufijo ("Visa BBVA"). `name` guarda solo lo que escribiste y `display_name` se calcula en la vista `account_account_v`, igual que en Odoo, donde es un campo calculado que no se guarda. La unicidad incluye la moneda: pueden convivir "BCP Ahorros (PEN)" y "BCP Ahorros (USD)".

**Monedas en su propia tabla.** Como `res.currency` en Odoo: el código ISO y los decimales viven en una fila, y las demás tablas guardan `currency_id`. Activar una moneda nueva (EUR) es insertar una fila. La moneda base no se escribe como 'PEN' en el código: se lee de `res_users.currency_id`.

**El símbolo depende de quién lee.** El mismo dólar se escribe `US$ 1,234.50` en un banco peruano, `1234,50 US$` en España y `$1,234.50` en Estados Unidos, porque en casi toda Latinoamérica el signo de dólar solo es el peso local. El símbolo depende de la moneda y del idioma, no solo de la moneda, así que no va en `res_currency`. Va en `res_currency_format` (moneda + idioma), y los separadores de miles y decimales en `res_lang`, como en Odoo. Ambas se cargan desde Unicode CLDR como datos y se pueden ajustar; por ejemplo, para `es-PE` se usa la convención bancaria `US$`. Si falta una combinación, se muestra el código ISO (`CLP 1,234`).

**Tipos de cuenta: los 5 grupos.** `account_type` usa los cinco grupos contables (activo, pasivo, patrimonio, ingreso y gasto), los mismos que Odoo llama `internal_group`. Lo que importa en finanzas personales, si una cuenta es banco, efectivo o tarjeta, ya lo dice su subtipo (`res_partner_bank`, `account_credit_card`) o su ausencia, así que repetirlo en el tipo sería redundante. Si algún reporte necesitara separar, por ejemplo, el efectivo de un préstamo que te deben, se agrega un subtipo en ese momento.

**Sin empresa: tu usuario.** En Odoo la moneda base y la fecha de bloqueo viven en `res.company` porque Odoo lleva la contabilidad de empresas. PPM es personal, así que esa configuración vive en tu usuario (`res_users`), una fila por persona. Cada uno lleva sus propias cuentas, aisladas de las demás (ver Arquitectura › Varios usuarios en una base).

**Países (`res_country`).** Bancos y contactos pertenecen a un país: el CCI y su código de banco solo existen en Perú. Tu usuario guarda tu país. Un banco extranjero queda sin `cci_code`, y entonces la FK del CCI impide ponerle un CCI a una cuenta suya.

## Normalización: cuentas y sus subtipos

Un banco y una tarjeta son cuentas, pero con datos propios: número y CCI uno, corte y línea la otra. Hay dos formas clásicas de modelarlo:

| Patrón | Cómo | Consecuencia |
| --- | --- | --- |
| Una sola tabla ancha | `account_account` con banco, CCI, corte, línea… | Columnas vacías en todo lo que no es banco ni tarjeta, CHECKs condicionales por tipo, y la tabla crece con cada tipo nuevo |
| Tabla base + subtipos 1 a 1 (elegido) | `account_account` con lo común; `res_partner_bank` y `account_credit_card` con lo propio, usando la misma clave | Ninguna columna vacía por no aplicar y restricciones simples; cuesta un JOIN para ver los datos completos |

**Analogía.** Es un expediente: la ficha principal es igual para todos y los anexos solo existen si aplican. Odoo hace lo mismo: la cuenta contable (`account.account`), el diario del banco (`account.journal`), el número de cuenta (`res.partner.bank`) y el banco (`res.bank`) son modelos distintos.

&#91;embedded content: cuentas y sus subtipos · tabla base + tablas 1 a 1\]

La revisión de normalización corrigió cuatro cosas:

1. **Catálogo de bancos.** "BCP" escrito a mano en varias filas es redundante (y aparece "Bcp" o "B.C.P."). Ahora es una fila en `res_bank` y las demás tablas lo referencian.
2. **CCI coherente con su banco.** Los 3 primeros dígitos del CCI son el código del banco, así que el CCI y el banco podían contradecirse. Una columna generada con esos 3 dígitos y una FK compuesta lo impiden.
3. **La tarjeta usa la clave de su cuenta**, igual que el banco: no tiene id ni nombre propios, porque repetirían los de la cuenta.
4. **Subtipos exclusivos.** Cada subtipo guarda un `account_type` fijo y lo usa en una FK compuesta hacia `account_account (id, account_type)`: un banco solo puede colgar de un activo y una tarjeta de un pasivo. Además, `account_installment_plan` apunta a `account_credit_card`, así que un plan de cuotas solo puede ser de una tarjeta.

`res_partner_bank` no lleva `partner_id` como en Odoo porque el titular eres tú; si más adelante entran otros miembros de la familia, se agrega ahí.

```sql
-- Catálogo de bancos (res.bank): en Perú, el código es el que encabeza el CCI
CREATE TABLE res_bank (
  id       smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id smallint NOT NULL REFERENCES res_country (id),
  name     text NOT NULL,                                       -- 'BCP'
  bic      text UNIQUE
           CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'), -- ISO 9362 (SWIFT)
  cci_code char(3) UNIQUE CHECK (cci_code ~ '^[0-9]{3}$'),  -- '002'
  UNIQUE (country_id, name),
  UNIQUE (id, cci_code)                                         -- para la FK del CCI
);

-- Paquete de datos de Perú (códigos usuales; confírmalos con las listas oficiales)
INSERT INTO res_bank (country_id, name, bic, cci_code)
SELECT c.id, v.name, v.bic, v.cci_code
  FROM res_country c,
       (VALUES ('BCP',        'BCPLPEPL', '002'), ('Interbank', 'BINPPEPL', '003'),
               ('Scotiabank', 'BSUDPEPL', '009'), ('BBVA',      'BCONPEPL', '011'))
       AS v (name, bic, cci_code)
 WHERE c.code = 'PE';

-- Subtipo banco (res.partner.bank): solo cuentas de activo
CREATE TABLE res_partner_bank (
  account_id   bigint PRIMARY KEY,
  account_type text NOT NULL DEFAULT 'asset' CHECK (account_type = 'asset'),
  bank_id      smallint NOT NULL REFERENCES res_bank (id),
  acc_kind     text NOT NULL DEFAULT 'savings'
               CHECK (acc_kind IN ('savings', 'checking')),   -- ahorros / corriente
  acc_number   text,                                         -- '191-12345678-0-12'
  cci          char(20) CHECK (cci ~ '^[0-9]{20}$'),         -- código interbancario
  cci_bank     char(3) GENERATED ALWAYS AS (left(cci, 3)) STORED,
  FOREIGN KEY (account_id, account_type)
          REFERENCES account_account (id, account_type) ON DELETE CASCADE,
  FOREIGN KEY (bank_id, cci_bank) REFERENCES res_bank (id, cci_code)  -- el CCI es de ese banco
);

-- Subtipo tarjeta: solo cuentas de pasivo
CREATE TABLE account_credit_card (
  account_id        bigint PRIMARY KEY,
  account_type      text NOT NULL DEFAULT 'liability' CHECK (account_type = 'liability'),
  bank_id           smallint REFERENCES res_bank (id),
  brand             text CHECK (brand IN ('Visa', 'Mastercard', 'Amex', 'Diners')),
  last4             char(4) CHECK (last4 ~ '^[0-9]{4}$'),    -- solo los últimos 4 dígitos
  expires_on        date,                                    -- vencimiento (fin de mes)
  closing_day       smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),  -- corte
  credit_limit      numeric(14,2) NOT NULL CHECK (credit_limit >= 0),
  limit_currency_id smallint NOT NULL REFERENCES res_currency (id),
  FOREIGN KEY (account_id, account_type)
          REFERENCES account_account (id, account_type) ON DELETE CASCADE
);
```

Si el CCI está vacío, la FK del CCI no se revisa (en PostgreSQL una FK con algún valor NULL se da por válida). Los códigos de banco son los usuales; conviene confirmarlos con la lista oficial al cargar el catálogo.

## Configuración inicial y datos por país

Al abrir PPM por primera vez, la app pregunta dos cosas: tu país, que fija tu moneda base (Perú, soles), y qué otras monedas usas. Con eso activa tus monedas, deja listos los bancos de tu país y crea tus cuentas iniciales. Es lo mismo que instalar una localización en Odoo, como `l10n_pe`: el paquete del país trae sus bancos. La plantilla de cuentas, en cambio, es una sola para todos los países.

**Analogía.** Es como encender un celular nuevo: eliges país e idioma y ya viene con el formato de moneda y los bancos de tu país, sin que tú cargues nada.

Hay cuatro clases de datos, y cada una se carga en un momento distinto:

| Datos | Ejemplos | Quién los carga | Cuándo |
| --- | --- | --- | --- |
| Catálogos globales | Monedas, países | La app, desde los estándares ISO | Al instalar |
| Paquete de cada país | Bancos | La app, un paquete por país | Al instalar o al agregar un país |
| Tus datos | Tu usuario, tus cuentas | La configuración inicial, desde plantillas | Al empezar |
| Datos demo | Tipos de cambio y movimientos de muestra | Un script aparte, nunca la configuración inicial | Solo en desarrollo, pruebas y el simulador |

**Por qué los datos demo van aparte.** Son como los platos de cera de la vitrina de un restaurante: muestran la comida, pero nunca llegan a la mesa. Un tipo de cambio de muestra en tu base real sería peligroso, porque `get_rate` usa el último anterior: convertiría tus movimientos con un número inventado y la alerta de tipo desactualizado no saltaría. Por eso se separan por dónde se cargan, no con una columna `is_demo`.

**Estándares para normalizar.** Cada catálogo usa su código internacional, así que los datos se pueden cargar de fuentes oficiales y no dependen de cómo los escriba cada quien:

| Dato | Estándar | Ejemplo |
| --- | --- | --- |
| Moneda | ISO 4217: código alfabético, numérico y decimales | PEN, 604, 2 |
| País | ISO 3166-1: alfa-2, alfa-3 y numérico | PE, PER, 604 |
| Banco | ISO 9362 (BIC o SWIFT) | BCPLPEPL |
| Formato de montos | Unicode CLDR, cargado como datos | US$ 1,234.50 |

**Formatear sin librerías.** El formato de un monto sale solo de tres tablas: los decimales de `res_currency`, el símbolo de `res_currency_format` y los separadores de `res_lang`. Esta función es la especificación: la app web la puede llamar o implementar igual, sin depender de `Intl` ni de ninguna librería, y el resultado es el mismo en cualquier capa.

```sql
CREATE FUNCTION format_amount(p_amount numeric, p_currency_id smallint, p_lang_id smallint)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_amount < 0 THEN '-' ELSE '' END ||
         CASE WHEN COALESCE(f.position, 'before') = 'after'
              THEN x.num || x.sep || COALESCE(f.symbol, c.name)
              ELSE COALESCE(f.symbol, c.name) || x.sep || x.num END
    FROM res_currency c
    JOIN res_lang l ON l.id = p_lang_id
    LEFT JOIN res_currency_format f ON f.currency_id = c.id AND f.lang_id = l.id
    CROSS JOIN LATERAL (
      SELECT replace(replace(replace(
               to_char(round(abs(p_amount), c.decimal_places),
                       'FM999,999,999,990' || CASE WHEN c.decimal_places > 0
                                                   THEN '.' || repeat('0', c.decimal_places)
                                                   ELSE '' END),
               ',', '#'), '.', l.decimal_point), '#', COALESCE(l.thousands_sep, '')) AS num,
             CASE WHEN COALESCE(f.space, true) THEN ' ' ELSE '' END AS sep
    ) x
   WHERE c.id = p_currency_id
$$;
```

| Monto | Idioma | Resultado |
| --- | --- | --- |
| 1234.5 USD | es-PE | `US$ 1,234.50` |
| 1234.5 PEN | es-PE | `S/ 1,234.50` |
| 1234.5 EUR | es-ES | `1.234,50 €` |
| 1234 CLP | es-PE | `CLP 1,234` (sin fila de formato y sin decimales) |

```sql
-- Plantilla de cuentas iniciales (como account.chart.template de Odoo), una sola para todos los países
CREATE TABLE account_account_template (
  id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id        smallint REFERENCES account_account_template (id),  -- subcategorías
  name             text NOT NULL,
  account_type     text NOT NULL REFERENCES account_account_type (code),
  multicurrency    boolean NOT NULL DEFAULT false,        -- se crea sin moneda
  partner_required boolean NOT NULL DEFAULT false,
  system_role      text UNIQUE,                           -- la usa la lógica: no se borra
  icon             text,                                  -- ícono por defecto (Material Symbols)
  color            smallint,                              -- color por defecto
  UNIQUE NULLS NOT DISTINCT (parent_id, name)
);

-- Cuentas de sistema
INSERT INTO account_account_template (name, account_type, multicurrency, partner_required, system_role) VALUES
  ('Saldos iniciales',            'equity',    false, false, 'opening'),
  ('Efectivo',                    'asset',     false, false, NULL),
  ('Por cobrar',                  'asset',     true,  true,  'receivable'),
  ('Por pagar',                   'liability', true,  true,  'payable'),
  ('Plata que guardo de otros',   'liability', true,  true,  'custody'),
  ('Por clasificar',              'asset',     true,  false, 'suspense'),
  ('Ganancia por tipo de cambio', 'income',    false, false, 'fx_gain');

-- Categorías: primero las principales, luego sus hijas
INSERT INTO account_account_template (name, account_type)
SELECT unnest(ARRAY['Comida y bebida', 'Compras', 'Vivienda', 'Transporte', 'Vehículo',
                    'Vida y entretenimiento', 'Comunicaciones', 'Gastos financieros']), 'expense'
UNION ALL
SELECT unnest(ARRAY['Salario y facturas', 'Cheques, cupones y vales', 'Cuotas y subvenciones',
                    'Ingresos por alquiler', 'Intereses y dividendos', 'Lotería y apuestas',
                    'Pensión alimenticia', 'Regalos', 'Venta']), 'income';

INSERT INTO account_account_template (parent_id, name, account_type, system_role)
SELECT p.id, v.name, 'expense', v.role
  FROM (VALUES
    ('Comida y bebida', 'Supermercado y mercado', NULL), ('Comida y bebida', 'Restaurantes y delivery', NULL),
    ('Comida y bebida', 'Cafés y bares', NULL),
    ('Compras', 'Ropa y calzado', NULL), ('Compras', 'Electrónica', NULL), ('Compras', 'Hogar', NULL),
    ('Compras', 'Farmacia', NULL), ('Compras', 'Salud y belleza', NULL), ('Compras', 'Papelería y herramientas', NULL),
    ('Compras', 'Joyería y accesorios', NULL), ('Compras', 'Regalos', NULL), ('Compras', 'Niños', NULL),
    ('Compras', 'Mascotas y animales', NULL),
    ('Vivienda', 'Alquiler', NULL), ('Vivienda', 'Hipoteca', NULL), ('Vivienda', 'Servicios', NULL),
    ('Vivienda', 'Mantenimiento', NULL), ('Vivienda', 'Seguros de propiedad', NULL), ('Vivienda', 'Impuestos de propiedad', NULL),
    ('Transporte', 'Transporte público', NULL), ('Transporte', 'Taxi y apps', NULL), ('Transporte', 'Viajes largos', NULL),
    ('Vehículo', 'Combustible', NULL), ('Vehículo', 'Estacionamiento y peajes', NULL),
    ('Vehículo', 'Mantenimiento', NULL), ('Vehículo', 'Seguro vehicular', NULL),
    ('Vida y entretenimiento', 'Salud', NULL), ('Vida y entretenimiento', 'Deporte', NULL),
    ('Vida y entretenimiento', 'Educación', NULL), ('Vida y entretenimiento', 'Streaming y suscripciones', NULL),
    ('Vida y entretenimiento', 'Eventos', NULL), ('Vida y entretenimiento', 'Viajes', NULL),
    ('Vida y entretenimiento', 'Hobbies', NULL), ('Vida y entretenimiento', 'Donaciones', NULL),
    ('Comunicaciones', 'Celular', NULL), ('Comunicaciones', 'Internet', NULL), ('Comunicaciones', 'Software y apps', NULL),
    ('Gastos financieros', 'Comisiones bancarias', NULL), ('Gastos financieros', 'Intereses', 'interest'),
    ('Gastos financieros', 'Seguros', NULL), ('Gastos financieros', 'Impuestos y multas', NULL),
    ('Gastos financieros', 'Deudas incobrables', NULL), ('Gastos financieros', 'Costo del cambio', 'fx_loss')
  ) AS v (parent, name, role)
  JOIN account_account_template p ON p.name = v.parent AND p.parent_id IS NULL AND p.account_type = 'expense';

-- Las cuentas de sistema no se borran, no se archivan ni cambian de tipo (renombrarlas sí)
CREATE FUNCTION trg_account_system() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.system_role IS NOT NULL AND (TG_OP = 'DELETE' OR NOT NEW.active
       OR NEW.account_type <> OLD.account_type OR NEW.system_role IS DISTINCT FROM OLD.system_role) THEN
    RAISE EXCEPTION 'La cuenta «%» la usa la app (%): no se puede borrar, archivar ni cambiar de tipo',
      OLD.name, OLD.system_role;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER account_system BEFORE UPDATE OR DELETE ON account_account
  FOR EACH ROW EXECUTE FUNCTION trg_account_system();

-- La configuración inicial, en un solo paso
CREATE FUNCTION setup_user(p_country char(2),
                           p_other_currencies char(3)[] DEFAULT '{}')
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_country res_country%ROWTYPE;
  v_cur     smallint;
  v_user    integer := current_user_id();
  v_map     bigint[] := '{}';   -- id de plantilla → id de cuenta creada
  v_id      bigint;
  t         record;
BEGIN
  IF EXISTS (SELECT 1 FROM account_account) THEN     -- con RLS, solo las de este usuario
    RAISE EXCEPTION 'La configuración inicial ya se hizo';
  END IF;
  SELECT * INTO v_country FROM res_country WHERE code = p_country;

  -- Moneda base: siempre la del país (Perú → soles)
  v_cur := v_country.currency_id;

  UPDATE res_users                                    -- la fila nació al registrarse
     SET name = p_name, country_id = v_country.id, currency_id = v_cur, lang_id = v_country.lang_id
   WHERE id = v_user;

  -- Monedas que usa: la base y las demás
  INSERT INTO res_users_currency (user_id, currency_id)
  SELECT v_user, id FROM res_currency WHERE id = v_cur OR name = ANY (p_other_currencies);

  -- Cuentas iniciales: las principales antes que sus hijas
  FOR t IN
    WITH RECURSIVE tree AS (
      SELECT tt.*, 0 AS depth FROM account_account_template tt WHERE tt.parent_id IS NULL
      UNION ALL
      SELECT c.*, tree.depth + 1 FROM account_account_template c JOIN tree ON c.parent_id = tree.id
    )
    SELECT * FROM tree ORDER BY depth, id
  LOOP
    INSERT INTO account_account (name, account_type, parent_id, currency_id, partner_required, system_role)
    VALUES (t.name, t.account_type, v_map[t.parent_id],
            CASE WHEN t.multicurrency THEN NULL ELSE v_cur END, t.partner_required, t.system_role)
    RETURNING id INTO v_id;
    v_map[t.id] := v_id;
  END LOOP;
  RETURN v_user;
END $$;

-- Perú, en soles y usando también dólares
SELECT setup_user('PE', '{USD}');   -- el nombre se pide al crear la cuenta
```

Los bancos no se copian: ya están en sus catálogos con `country_id`, y la app filtra los de tu país (`res_users.country_id`). La moneda base es siempre la del país de tu usuario: en Perú, soles; no se elige ni se cambia. Para abrir otro país hará falta una fuente de tipo de cambio en su moneda, porque la de SUNAT está en soles por unidad (pendiente).

## Categorías iniciales

La plantilla trae un árbol de categorías basado en Wallet by BudgetBakers, el mismo para todos los países: lo local son los bancos, no las categorías. Cada categoría es una cuenta de ingreso o de gasto, y cada subcategoría, una cuenta hija; se pueden renombrar, archivar o agregar.

**Gastos**

| Categoría | Subcategorías |
| --- | --- |
| Comida y bebida | Supermercado y mercado · Restaurantes y delivery · Cafés y bares |
| Compras | Ropa y calzado · Electrónica · Hogar · Farmacia · Salud y belleza · Papelería y herramientas · Joyería y accesorios · Regalos · Niños · Mascotas y animales |
| Vivienda | Alquiler · Hipoteca · Servicios · Mantenimiento · Seguros de propiedad · Impuestos de propiedad |
| Transporte | Transporte público · Taxi y apps · Viajes largos |
| Vehículo | Combustible · Estacionamiento y peajes · Mantenimiento · Seguro vehicular |
| Vida y entretenimiento | Salud · Deporte · Educación · Streaming y suscripciones · Eventos · Viajes · Hobbies · Donaciones |
| Comunicaciones | Celular · Internet · Software y apps |
| Gastos financieros | Comisiones bancarias · Intereses · Seguros · Impuestos y multas · Deudas incobrables · Costo del cambio |

**Ingresos:** Salario y facturas · Cheques, cupones y vales · Cuotas y subvenciones · Ingresos por alquiler · Intereses y dividendos · Lotería y apuestas · Pensión alimenticia · Regalos · Venta · Ganancia por tipo de cambio.

De Wallet quedan fuera dos categorías de ingreso: los reembolsos reducen el gasto original (ver abajo) y un préstamo recibido es una deuda, no un ingreso. Las inversiones y el ahorro tampoco son gasto: son transferencias a una cuenta de activo.

**Cuentas de sistema.** Algunas cuentas las usa la lógica, no solo el usuario: la diferencia de cambio, los saldos iniciales, los intereses de las cuotas. Se marcan con `system_role` y la base impide borrarlas, archivarlas o cambiarles el tipo; renombrarlas sí se puede, porque la lógica las busca por su rol y no por su nombre.

| Rol | Cuenta | Tipo |
| --- | --- | --- |
| `opening` | Saldos iniciales | Patrimonio |
| `receivable` | Por cobrar | Activo, multimoneda, con contacto |
| `payable` | Por pagar | Pasivo, multimoneda, con contacto |
| `suspense` | Por clasificar | Activo, multimoneda |
| `interest` | Gastos financieros › Intereses | Gasto |
| `fx_gain` | Ganancia por tipo de cambio | Ingreso |
| `fx_loss` | Gastos financieros › Costo del cambio | Gasto |

**Por clasificar** es la bandeja de pendientes, como la cuenta de suspenso de Odoo. Lo importado sin categoría cae ahí y no cuenta como gasto ni ingreso hasta que lo clasificas; su saldo debería volver a cero.

**Editar categorías.** Las categorías tienen CRUD completo: crear, editar, archivar, eliminar y fusionar. Cada cuenta, categoría o no, lleva un ícono y un color que eliges. Es como las carpetas del celular: les cambias nombre, ícono y color, y las mueves; si borras una con apps adentro, te pregunta qué hacer con ellas.

**Ícono y color.** El ícono se guarda como el nombre de un ícono de [Material Symbols](https://fonts.google.com/icons) de Google (`shopping_cart`, `restaurant`), y la interfaz lo dibuja con esa fuente. La base solo guarda el texto: si algún día cambias de set, se traduce la clave y los datos no se tocan. El color es un índice de 0 a 11 sobre una paleta fija, como el campo `color` de Odoo; cada índice tiene su tono para el tema claro y el oscuro, así siempre se lee bien. Sin ícono o sin color, la cuenta hereda el de su padre; si es principal, toma el de su tipo.

| Índice | Color | Índice | Color |
| --- | --- | --- | --- |
| 0 | Sin color (gris) | 6 | Almendra |
| 1 | Rojo | 7 | Verde azulado |
| 2 | Naranja | 8 | Azul |
| 3 | Amarillo | 9 | Frambuesa |
| 4 | Cian | 10 | Verde |
| 5 | Púrpura | 11 | Violeta |

**Qué se puede hacer.**

| Acción | Regla |
| --- | --- |
| Crear | Cualquier categoría o subcategoría; la hija toma el tipo del padre |
| Renombrar, ícono, color | Siempre, también en las cuentas de sistema |
| Mover bajo otra | Siempre que el nuevo padre sea del mismo tipo y no sea una de sus hijas |
| Cambiar el tipo (gasto ↔ ingreso) | Solo sin movimientos; si no, cambiaría el sentido de tus reportes pasados |
| Archivar | Se oculta de las listas para registrar; su historial queda. No aplica a las de sistema |
| Eliminar | Solo si no tiene movimientos, subcategorías ni recurrencias. Las llaves foráneas ya lo impiden; la app explica por qué y ofrece archivar o fusionar |
| Fusionar | Pasa sus movimientos y recurrencias a otra categoría del mismo tipo y moneda, y la elimina. No si toca un periodo cerrado ni si es de sistema. Solo para categorías: una cuenta de banco o tarjeta se archiva |

Fusionar sirve cuando creaste "Taxi" y "Uber" y quieres dejar una sola: todo el historial queda bajo la que se queda.

```sql
-- Columnas nuevas (también en account_account_template, para los íconos por defecto)
ALTER TABLE account_account
  ADD COLUMN icon  text CHECK (icon ~ '^[a-z0-9_]+$'),          -- Material Symbols: 'shopping_cart'
  ADD COLUMN color smallint CHECK (color BETWEEN 0 AND 11);     -- índice de la paleta, como en Odoo

-- Ícono y color efectivos: el propio, el del padre o el del tipo
CREATE VIEW account_account_look AS
WITH RECURSIVE t AS (
  SELECT id, account_type, icon, color FROM account_account WHERE parent_id IS NULL
  UNION ALL
  SELECT a.id, a.account_type, coalesce(a.icon, t.icon), coalesce(a.color, t.color)
    FROM account_account a JOIN t ON a.parent_id = t.id
)
SELECT id,
       coalesce(icon, CASE account_type WHEN 'asset' THEN 'account_balance_wallet'
                                        WHEN 'liability' THEN 'credit_card'
                                        WHEN 'equity' THEN 'flag'
                                        WHEN 'income' THEN 'trending_up'
                                        ELSE 'category' END) AS icon,
       coalesce(color, 0) AS color
  FROM t;

-- El tipo no cambia si ya hay movimientos (mover bajo un padre de otro tipo también lo cambia)
CREATE FUNCTION trg_account_type_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_type <> OLD.account_type
     AND EXISTS (SELECT 1 FROM account_move_line WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'La cuenta «%» ya tiene movimientos: no puede cambiar de tipo', OLD.name;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_type_locked BEFORE UPDATE OF account_type ON account_account
  FOR EACH ROW EXECUTE FUNCTION trg_account_type_locked();

-- Fusionar: todo lo de p_from pasa a p_to y p_from se elimina
CREATE FUNCTION account_merge(p_from bigint, p_to bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  f account_account;
  t account_account;
BEGIN
  SELECT * INTO f FROM account_account WHERE id = p_from;
  SELECT * INTO t FROM account_account WHERE id = p_to;
  IF f.account_type NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'Solo se fusionan categorías; una cuenta de banco o tarjeta se archiva';
  END IF;
  IF p_from = p_to OR f.account_type <> t.account_type
     OR f.currency_id IS DISTINCT FROM t.currency_id THEN
    RAISE EXCEPTION 'Solo se fusiona con otra categoría del mismo tipo y moneda';
  END IF;
  IF EXISTS (SELECT 1 FROM account_account WHERE parent_id IN (p_from, p_to)) THEN
    RAISE EXCEPTION 'Las dos categorías deben ser finales (sin subcategorías)';
  END IF;
  UPDATE account_move_line SET account_id = p_to WHERE account_id = p_from;  -- trg_lock_move_line frena si toca un mes cerrado
  UPDATE account_recurring_line SET account_id = p_to WHERE account_id = p_from;
  DELETE FROM account_account WHERE id = p_from;                            -- trg_account_system frena si es de sistema
END $$;
```

La plantilla trae ícono y color para cada categoría: Comida y bebida `restaurant` (naranja), Compras `shopping_bag` (frambuesa), Vivienda `home` (azul), Transporte `directions_bus` (cian), Vehículo `directions_car` (verde azulado), Vida y entretenimiento `celebration` (púrpura), Comunicaciones `smartphone` (violeta), Gastos financieros `account_balance` (almendra) y los ingresos en verde. Las subcategorías traen su propio ícono (`local_cafe`, `pets`, `local_gas_station`…) y heredan el color.

## Reembolsos

Un reembolso cae en la misma categoría del gasto que devuelve, pero en el Haber: la categoría baja y muestra lo que de verdad gastaste. No es ingreso.

**Analogía.** Es una nota de crédito de Odoo: anula parte de una factura usando la misma cuenta de la factura, en sentido contrario. Si devuelves una camisa, no ganaste dinero; gastaste menos en ropa.

Ejemplo: compras una camisa de S/ 120 y te devuelven S/ 80.

| Asiento | Cuenta | Debe | Haber |
| --- | --- | --- | --- |
| Compra | Compras › Ropa y calzado | 120.00 |  |
| Compra | BCP Ahorros |  | 120.00 |
| Reembolso | BCP Ahorros | 80.00 |  |
| Reembolso | Compras › Ropa y calzado |  | 80.00 |

Ropa y calzado queda en S/ 40 de gasto neto y tus ingresos del mes no cambian. Una devolución de impuestos funciona igual, contra Gastos financieros › Impuestos y multas.

**En la interfaz** hay un tipo de movimiento "Reembolso" que solo pregunta la categoría del gasto y la cuenta que recibe el dinero. El usuario no ve Debe ni Haber.

Si el reembolso llega en otro mes, ese mes la categoría puede quedar negativa: el gasto fue en un mes y la devolución en otro. Es lo correcto contablemente, y el reporte lo muestra como "reembolsado" en vez de un gasto negativo.

## Etiquetas y adjuntos

Las etiquetas son otra forma de filtrar, cruzando categorías; se ponen en cada apunte. Los adjuntos guardan la ficha del archivo en la base y el archivo en un filestore, como `ir.attachment` en Odoo.

**Etiquetas.** Son post-its de colores: un recibo vive en una sola carpeta (su categoría), pero el post-it "Viaje a Cusco" puede ir en recibos de Transporte, Comida y Hotel, y luego juntas todos los que lo tienen. Van en el movimiento entero (0035): el modelo las ponía en cada apunte, como la analítica de Odoo, pero editar rehace los apuntes y la etiqueta se perdía. Las cuotas y las partes repartidas llevan las de su compra.

```sql
CREATE TABLE account_tag (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  name    text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),   -- 'Viaje a Cusco'
  color   smallint NOT NULL DEFAULT 0 CHECK (color BETWEEN 0 AND 11),  -- la paleta de las categorías
  active  boolean NOT NULL DEFAULT true,                                 -- archivada: no se ofrece
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX account_tag_name ON account_tag (user_id, lower(btrim(name)));

-- Many2many con el nombre que le daría Odoo
CREATE TABLE account_move_account_tag_rel (
  account_move_id bigint  NOT NULL,
  account_tag_id  bigint  NOT NULL,
  user_id         integer NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  PRIMARY KEY (account_move_id, account_tag_id),
  FOREIGN KEY (account_move_id, user_id) REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_tag_id, user_id)  REFERENCES account_tag (id, user_id) ON DELETE CASCADE
);

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
```

**Adjuntos.** Es una biblioteca: la ficha del catálogo (nombre, tipo, tamaño, huella) va en la base y el libro, en el estante. El estante es el filestore: cada archivo se guarda en una carpeta según su huella SHA-1 (`ab/ab12…`), así que la misma foto subida dos veces ocupa un solo lugar. Si el estante es un disco local o S3 se decide con la tecnología; el modelo solo define la ficha.

La unión es polimórfica, como en Odoo: `res_model` dice qué tipo de registro y `res_id`, cuál. Un solo mecanismo sirve para adjuntar a cualquier cosa. A cambio no hay llave foránea, así que dos triggers hacen su trabajo: uno revisa que el registro exista al adjuntar y otro borra las fichas cuando se borra el asiento.

```sql
CREATE TABLE ir_attachment (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  res_model   text NOT NULL CHECK (res_model IN ('account.move')),  -- se amplía al adjuntar a más cosas
  res_id      bigint NOT NULL,                  -- sin llave foránea: polimórfica
  name        text NOT NULL,                    -- 'boleta-plaza-vea.jpg'
  mimetype    text NOT NULL,                    -- 'image/jpeg'
  file_size   integer NOT NULL CHECK (file_size > 0),
  checksum    char(40) NOT NULL,                -- SHA-1 del contenido
  store_fname text NOT NULL,                    -- 'ab/ab12…' dentro del filestore
  create_date timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ir_attachment (res_model, res_id);
CREATE INDEX ON ir_attachment (checksum);

-- Lo que haría la llave foránea al adjuntar
CREATE FUNCTION trg_attachment_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.res_model = 'account.move'
     AND NOT EXISTS (SELECT 1 FROM account_move WHERE id = NEW.res_id) THEN
    RAISE EXCEPTION 'El asiento % no existe', NEW.res_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER attachment_target BEFORE INSERT OR UPDATE ON ir_attachment
  FOR EACH ROW EXECUTE FUNCTION trg_attachment_target();

-- Lo que haría ON DELETE CASCADE al borrar el asiento
CREATE FUNCTION trg_move_attachment_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM ir_attachment WHERE res_model = 'account.move' AND res_id = OLD.id;
  RETURN OLD;
END $$;

CREATE TRIGGER move_attachment_cleanup AFTER DELETE ON account_move
  FOR EACH ROW EXECUTE FUNCTION trg_move_attachment_cleanup();
```

Borrar la ficha no borra el archivo al instante: otro adjunto puede usar el mismo. Un recolector, como `_gc_file_store` de Odoo, borra del filestore los archivos cuya huella ya no aparece en `ir_attachment`.

**Naturaleza (must, need, want) descartada.** Wallet la usa para la regla 50/30/20; aquí una etiqueta como "Prescindible" cubre el mismo caso, y una columna se puede agregar después sin problema.

## Importación de extractos

Subes el Excel o CSV que descargas de la banca por internet, dices qué columna es qué, y cada línea entra al libro contra Por clasificar, salvo que sea un duplicado o ya exista. No hay un formato por banco: el mapeo de columnas es genérico, como la importación de Odoo, y se recuerda por cuenta.

**El recorrido.**

1. Subes el archivo y eliges la cuenta (BCP Ahorros, Visa BBVA…). El archivo queda como adjunto del extracto.
2. Mapeas las columnas, como en Odoo: "esta es la fecha, esta el monto". La próxima vez que importes a esa cuenta, el mapeo ya viene puesto.
3. Cada línea recibe una huella (`unique_import_id`); si ya se importó, se descarta.
4. Si ya existe un movimiento con ese monto en esa cuenta, a 3 días o menos, se empareja con él en vez de crear otro: lo que registraste a mano, el borrador de una recurrencia o la otra mitad de una transferencia. Si era un borrador, se confirma.
5. Lo demás entra confirmado: el banco contra Por clasificar.
6. PPM compara el saldo final con el del libro: el de la columna de saldo si el archivo la trae o, si no, el que escribas al importar.

**Analogía.** Es la bandeja de entrada del correo: todo llega y nada se pierde. Clasificar es arrastrar cada correo a su carpeta, y "Por clasificar" en cero es la bandeja vacía.

**Las columnas que pide la app.**

| Campo | Obligatorio | Uso |
| --- | --- | --- |
| Fecha | Sí | Fecha del asiento; se elige el formato (DD/MM/YYYY, YYYY-MM-DD…) |
| Monto con signo, o Cargo y Abono por separado | Sí | Lo que sale va en negativo o en la columna de cargo |
| Descripción del banco | Sí | El texto que pone el banco; nunca cambia |
| Número de operación | No | La mejor huella contra duplicados |
| Moneda | Solo en cuentas multimoneda | Si falta, se usa la moneda de la cuenta |
| Saldo | No | Para el control de saldo; si el archivo no lo trae, se escribe al importar |

**Tres textos distintos.** La descripción del banco es la etiqueta del courier en un paquete: dice lo que dice y no se toca ("POS PLAZA VEA SURCO"). La glosa es la etiqueta que le pones tú ("Compras de la semana"); empieza como copia de la del banco y la cambias cuando quieras. El número de operación es el número de guía: identifica la operación y es la mejor forma de no importarla dos veces. En el modelo, la glosa es `account_move.ref`, la de siempre, y las otras dos viven en la línea del extracto.

**Duplicados.** Si la línea trae número de operación, la huella es la cuenta más ese número. Si no, es la cuenta, la fecha, el monto, la descripción y su orden entre líneas idénticas del mismo día; así, dos cafés de S/ 5.00 el mismo día no se confunden con uno repetido. Odoo usa la misma idea en su `unique_import_id`.

**Transferencias entre tus cuentas.** Al importar BCP, la salida a Interbank cae en Por clasificar y la clasificas como transferencia a Interbank Sueldo. Al importar Interbank, esa entrada encuentra el asiento por monto y fecha y se empareja: la transferencia queda una sola vez.

**Casos borde.**

| Caso | Qué pasa |
| --- | --- |
| Descargaste dos veces días que se cruzan | Las líneas repetidas se descartan por su huella |
| Ya lo habías registrado a mano | Se empareja por monto y fecha; no se duplica |
| Borrador de una recurrencia de monto variable | Si es de dos líneas, toma el monto del banco y se confirma |
| Borras un asiento importado | Se borra su línea de extracto; si reimportas, vuelve, porque el banco dice que ocurrió |
| Fecha en periodo cerrado | La línea se rechaza y se avisa; no se cuela en un mes cerrado |
| El saldo no cuadra | Se muestra la diferencia: falta o sobra algún movimiento |

**Probado con extractos reales de dos bancos.** El mapeo genérico leyó ambos sin un adaptador por banco. Lo que enseñaron:

| Lo que trae el archivo | Cómo lo maneja PPM |
| --- | --- |
| Título y filas vacías antes de los encabezados (encabezados en la fila 5) | Busca sola la fila que empieza con "Fecha"; la fila de encabezados es la misma que ves en Excel |
| Filas vacías entre movimientos | Se saltan |
| Montos como texto con símbolo: "S/ -1,907.39" | Se quitan el símbolo y los separadores; el signo se respeta |
| Montos como número y moneda en otra columna ("S/") | Se leen directo; "S/" es PEN y "US$", USD |
| Número de operación con ceros a la izquierda ("06771621") | Se guarda como texto, sin perder los ceros |
| Un banco sin número de operación | La huella usa fecha, monto, descripción y orden |
| Línea en cero ("APERTURA DE CUENTA S/ 0.00") | Se omite: no mueve dinero |
| Ninguno trae columna de saldo | El saldo final se escribe al importar, si quieres el control |
| La comisión y el ITF llegan como líneas aparte | Cada una se clasifica por separado (Comisiones bancarias, Impuestos y multas) |
| Descripciones truncadas ("Yape Jonathan Cue") | Se guardan tal cual; pesarán cuando se diseñen las reglas por comercio |

Para que el control de saldo cuadre, la cuenta debe tener su saldo inicial a la fecha anterior al primer movimiento del archivo.

Las reglas por comercio ("PLAZA VEA siempre a Supermercado") quedan fuera por ahora.

**Tablas.** La plantilla de mapeo por cuenta, el extracto (un archivo importado) y sus líneas, que apuntan al asiento creado o emparejado. Leer el Excel o el CSV y aplicar el mapeo es trabajo del adaptador, fuera de la lógica; la base recibe cada línea ya traducida.

```sql
-- Cómo leer los archivos de cada cuenta (como las plantillas de importación de Odoo)
CREATE TABLE account_import_template (
  account_id        bigint PRIMARY KEY REFERENCES account_account (id) ON DELETE CASCADE,
  date_format       text NOT NULL DEFAULT 'DD/MM/YYYY',
  decimal_separator char(1) NOT NULL DEFAULT '.' CHECK (decimal_separator IN ('.', ',')),
  header_row        smallint NOT NULL DEFAULT 1 CHECK (header_row >= 1)  -- fila de encabezados
);

CREATE TABLE account_import_template_column (
  account_id  bigint NOT NULL REFERENCES account_import_template (account_id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('date', 'amount', 'debit', 'credit', 'payment_ref',
                                             'operation_number', 'currency', 'balance')),
  column_name text NOT NULL,                     -- encabezado en el archivo: 'Fecha operación'
  PRIMARY KEY (account_id, field)
);

-- Un archivo importado; el archivo mismo es un ir_attachment con res_model = 'account.bank.statement'
CREATE TABLE account_bank_statement (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       bigint NOT NULL REFERENCES account_account (id),
  name             text NOT NULL,              -- nombre del archivo
  date_from        date,
  date_to          date,
  balance_end_real numeric(14,2),              -- saldo final: del archivo o escrito al importar
  create_date      timestamptz NOT NULL DEFAULT now()
);

-- Cada línea del extracto y el asiento que le corresponde
CREATE TABLE account_bank_statement_line (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  statement_id     bigint NOT NULL REFERENCES account_bank_statement (id) ON DELETE CASCADE,
  move_id          bigint NOT NULL REFERENCES account_move (id) ON DELETE CASCADE,
  date             date NOT NULL,
  payment_ref      text NOT NULL,              -- descripción del banco: no cambia
  operation_number text,                       -- número de operación
  amount           numeric(14,2) NOT NULL CHECK (amount <> 0),  -- con signo, en currency_id
  currency_id      smallint NOT NULL REFERENCES res_currency (id),
  unique_import_id text NOT NULL UNIQUE        -- la huella contra duplicados
);

ALTER TABLE ir_attachment DROP CONSTRAINT ir_attachment_res_model_check,
  ADD CHECK (res_model IN ('account.move', 'account.bank.statement'));
```

**Importar una línea.** La función decide entre tres caminos: descartar el duplicado, emparejar con un asiento existente o crear uno nuevo contra Por clasificar. El adaptador le pasa `p_nth`, el orden de la línea entre las idénticas del mismo día.

```sql
CREATE FUNCTION import_statement_line(p_statement bigint, p_date date, p_payment_ref text,
                                      p_operation text, p_amount numeric, p_currency smallint,
                                      p_nth smallint DEFAULT 1)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_acc  bigint := (SELECT account_id FROM account_bank_statement WHERE id = p_statement);
  v_susp bigint := (SELECT id FROM account_account WHERE system_role = 'suspense');
  v_uid  text;
  v_move bigint;
  v_rate numeric := get_rate(p_currency, p_date,
                      rate_side((SELECT account_type FROM account_account WHERE id = v_acc)));
  v_amt  numeric := round(abs(p_amount) * v_rate, 2);   -- en moneda base
  v_how  text := 'matched';
BEGIN
  -- Huella: el número de operación o, si no viene, fecha + monto + descripción + orden
  v_uid := v_acc || '|' || coalesce('op:' || nullif(trim(p_operation), ''),
           p_date || '|' || p_amount || '|' || md5(p_payment_ref) || '|' || p_nth);
  IF EXISTS (SELECT 1 FROM account_bank_statement_line WHERE unique_import_id = v_uid) THEN
    RETURN 'duplicate';
  END IF;

  -- 1) Ya existe: mismo monto en esta cuenta, a 3 días o menos, aún sin extracto de esta cuenta
  SELECT m.id INTO v_move
    FROM account_move m
    JOIN account_move_line l ON l.move_id = m.id
   WHERE l.account_id = v_acc AND l.currency_id = p_currency AND l.amount_currency = p_amount
     AND m.date BETWEEN p_date - 3 AND p_date + 3
     AND NOT EXISTS (SELECT 1 FROM account_bank_statement_line sl
                       JOIN account_bank_statement s ON s.id = sl.statement_id
                      WHERE sl.move_id = m.id AND s.account_id = v_acc)
   ORDER BY abs(m.date - p_date), m.id
   LIMIT 1;

  -- 2) Borrador de una recurrencia de dos líneas con otro monto: toma el del banco
  IF v_move IS NULL THEN
    SELECT m.id INTO v_move
      FROM account_move m
      JOIN account_move_line l ON l.move_id = m.id
     WHERE m.state = 'draft' AND m.recurring_id IS NOT NULL
       AND l.account_id = v_acc AND l.currency_id = p_currency
       AND sign(l.amount_currency) = sign(p_amount)
       AND m.date BETWEEN p_date - 5 AND p_date + 5
       AND (SELECT count(*) FROM account_move_line WHERE move_id = m.id) = 2
     ORDER BY abs(m.date - p_date)
     LIMIT 1;
    IF v_move IS NOT NULL THEN
      UPDATE account_move_line SET
             debit  = CASE WHEN debit  > 0 THEN v_amt ELSE 0 END,
             credit = CASE WHEN credit > 0 THEN v_amt ELSE 0 END,
             amount_currency = sign(amount_currency)
                             * CASE WHEN currency_id = p_currency THEN abs(p_amount) ELSE v_amt END
       WHERE move_id = v_move;
      UPDATE account_move SET date = p_date WHERE id = v_move;
    END IF;
  END IF;

  -- 3) Nuevo: el banco contra Por clasificar (multimoneda, acepta la moneda del extracto)
  IF v_move IS NULL THEN
    v_how := 'created';
    INSERT INTO account_move (date, ref, state) VALUES (p_date, p_payment_ref, 'draft')
    RETURNING id INTO v_move;                      -- la glosa empieza como la descripción del banco
    INSERT INTO account_move_line (move_id, account_id, debit, credit, currency_id, amount_currency)
    VALUES (v_move, v_acc,  greatest(sign(p_amount), 0) * v_amt, greatest(-sign(p_amount), 0) * v_amt,
            p_currency,  p_amount),
           (v_move, v_susp, greatest(-sign(p_amount), 0) * v_amt, greatest(sign(p_amount), 0) * v_amt,
            p_currency, -p_amount);
  END IF;

  UPDATE account_move SET state = 'posted' WHERE id = v_move AND state = 'draft';
  INSERT INTO account_bank_statement_line
         (statement_id, move_id, date, payment_ref, operation_number, amount, currency_id, unique_import_id)
  VALUES (p_statement, v_move, p_date, p_payment_ref, nullif(trim(p_operation), ''), p_amount, p_currency, v_uid);
  RETURN v_how;
END $$;
```

**Clasificar.** Es cambiar la línea de Por clasificar por la cuenta elegida: una categoría, otra de tus cuentas (transferencia) o Por cobrar. Si la cuenta elegida solo acepta la moneda base, la línea pasa a esa moneda con su valor en libros. También se elige con quién: va en el partner\_id del apunte, es obligatorio si la cuenta elegida lo pide (Por cobrar, Por pagar, Plata que guardo de otros) y opcional en una categoría (un gasto con alguien).

```sql
CREATE FUNCTION classify_move(p_move bigint, p_account bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_cur  smallint := (SELECT currency_id FROM account_account WHERE id = p_account);
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
BEGIN
  UPDATE account_move_line l
     SET account_id      = p_account,
         currency_id     = coalesce(v_cur, l.currency_id),
         amount_currency = CASE WHEN v_cur IS NULL OR v_cur = l.currency_id THEN l.amount_currency
                                WHEN v_cur = v_base THEN l.balance
                                ELSE NULL END   -- otra moneda: es un cambio, se edita a mano
   WHERE l.move_id = p_move
     AND l.account_id = (SELECT id FROM account_account WHERE system_role = 'suspense');
END $$;

-- Control de saldo: el del archivo contra el del libro a la misma fecha (cuentas de una moneda)
CREATE VIEW account_bank_statement_check AS
SELECT s.id, s.name, s.date_to, s.balance_end_real,
       (SELECT sum(l.amount_currency)
          FROM account_move_line l JOIN account_move m ON m.id = l.move_id
         WHERE l.account_id = s.account_id AND m.state = 'posted' AND m.date <= s.date_to) AS balance_book,
       s.balance_end_real - (SELECT sum(l.amount_currency)
          FROM account_move_line l JOIN account_move m ON m.id = l.move_id
         WHERE l.account_id = s.account_id AND m.state = 'posted' AND m.date <= s.date_to) AS difference
  FROM account_bank_statement s
 WHERE s.balance_end_real IS NOT NULL;
```

## Reglas de integridad

La base de datos rechaza cualquier transacción descuadrada, sin importar desde dónde se escriba. La regla vive en un trigger diferido, no solo en la app.

**Por qué diferido.** Las líneas se insertan una por una; después de la primera línea la transacción siempre está descuadrada. Es como un cajero que cuenta la caja al cerrar la operación, no después de cada billete: el trigger revisa al hacer `COMMIT`.

Solo en asientos confirmados, la función valida cuatro cosas: al menos 2 apuntes, débitos = créditos en moneda base, que cada apunte use la moneda de su cuenta (si la cuenta tiene una; una multimoneda acepta cualquiera) y que, en moneda base, `amount_currency` sea igual a `balance`.

```sql
CREATE FUNCTION check_move_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_id       bigint;
  v_base     smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_debit    numeric;
  v_credit   numeric;
  v_lines    int;
  v_bad_cur  int;
  v_bad_base int;
BEGIN
  -- El trigger corre desde dos tablas: account_move y account_move_line
  IF TG_TABLE_NAME = 'account_move' THEN
    v_id := NEW.id;
  ELSE
    v_id := COALESCE(NEW.move_id, OLD.move_id);
  END IF;

  -- Los borradores pueden estar incompletos; si el asiento se borró,
  -- el estado es NULL y tampoco hay nada que validar
  IF (SELECT state FROM account_move WHERE id = v_id) IS DISTINCT FROM 'posted' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0), COUNT(*),
         COUNT(*) FILTER (WHERE l.currency_id <> a.currency_id),  -- NULL (multi) no cuenta
         COUNT(*) FILTER (WHERE l.currency_id = v_base AND l.amount_currency <> l.balance)
    INTO v_debit, v_credit, v_lines, v_bad_cur, v_bad_base
    FROM account_move_line l
    JOIN account_account a ON a.id = l.account_id
   WHERE l.move_id = v_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'Asiento %: necesita al menos 2 apuntes', v_id;
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Asiento % descuadrado: débitos % <> créditos %', v_id, v_debit, v_credit;
  END IF;
  IF v_bad_cur > 0 THEN
    RAISE EXCEPTION 'Asiento %: un apunte no usa la moneda de su cuenta', v_id;
  END IF;
  IF v_bad_base > 0 THEN
    RAISE EXCEPTION 'Asiento %: en moneda base, amount_currency debe ser igual a balance', v_id;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_move_line_balanced
  AFTER INSERT OR UPDATE OR DELETE ON account_move_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_move_balanced();

-- Confirmar un borrador también dispara la revisión
CREATE CONSTRAINT TRIGGER trg_move_posted
  AFTER INSERT OR UPDATE OF state ON account_move
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_move_balanced();
```

Una transacción confirmada sin líneas también se rechaza, porque el trigger corre al confirmarla. La app debe crear cabecera y líneas siempre dentro del mismo `BEGIN … COMMIT`.

**Cuentas jerárquicas.** Funcionan como carpetas y archivos: una cuenta padre agrupa, y solo las cuentas hoja (sin hijas) reciben movimientos. Dos triggers lo garantizan: la hija tiene el mismo tipo que su padre, y no se puede poner una hija bajo una cuenta que ya tiene movimientos.

```sql
-- Reglas al crear o mover una cuenta dentro del árbol
CREATE FUNCTION check_account_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Una cuenta no puede ser su propio padre';
  END IF;
  IF NEW.account_type <> (SELECT account_type FROM account_account WHERE id = NEW.parent_id) THEN
    RAISE EXCEPTION 'La cuenta % debe tener el mismo tipo que su padre', NEW.name;
  END IF;
  IF EXISTS (SELECT 1 FROM account_move_line WHERE account_id = NEW.parent_id) THEN
    RAISE EXCEPTION 'La cuenta padre ya tiene movimientos; no puede agrupar hijas';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_account_parent
  BEFORE INSERT OR UPDATE OF parent_id, account_type ON account_account
  FOR EACH ROW EXECUTE FUNCTION check_account_parent();

-- Solo las cuentas hoja reciben movimientos
CREATE FUNCTION check_line_leaf_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM account_account WHERE parent_id = NEW.account_id) THEN
    RAISE EXCEPTION 'La cuenta % agrupa otras cuentas; usa una de sus hijas', NEW.account_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_line_leaf_account
  BEFORE INSERT OR UPDATE OF account_id ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_line_leaf_account();
```

Límite conocido: no se detectan ciclos largos (A dentro de B dentro de A). La app solo ofrecerá como padre cuentas que no sean descendientes.

## Estados y corrección de errores

Cada transacción está en borrador o confirmada, como `state` en `account.move`. Un borrador es como una nota pegada en el refrigerador: puede estar incompleto y no mueve tus saldos; al confirmarlo, la base de datos revisa que cuadre.

|  | Borrador (`draft`) | Confirmada (`posted`) |
| --- | --- | --- |
| Cuenta en saldos y reportes | No | Sí |
| Debe cuadrar | No | Sí, al confirmar y al editar |
| Se puede editar o borrar | Sí | Sí |

Usos típicos del borrador: pagos futuros (la cuota del día 15), recurrentes y movimientos importados del banco pendientes de revisar.

**Corrección sin reversos.** Nadie audita PPM, así que un error se corrige donde está: editando la transacción (directamente o pasándola a borrador) o borrándola. El trigger de cuadre corre también al editar una confirmada, así que una corrección nunca puede dejarla descuadrada.

```sql
-- Confirmar un borrador (aquí corre el trigger de cuadre)
UPDATE account_move SET state = 'posted' WHERE id = 8;

-- Corregir un monto en un asiento confirmado
BEGIN;
UPDATE account_move_line SET debit  = 45.00, amount_currency =  45.00 WHERE id = 15;
UPDATE account_move_line SET credit = 45.00, amount_currency = -45.00 WHERE id = 16;
COMMIT;  -- si los apuntes no cuadran, se revierte todo

-- Borrar: los apuntes se van en cascada
DELETE FROM account_move WHERE id = 8;
```

Efecto a tener en cuenta: corregir un movimiento antiguo cambia los saldos desde esa fecha. Es lo correcto, porque el dato estaba mal; para proteger los meses que ya revisaste está el cierre de periodo.

## Cierre de periodo (fecha de bloqueo)

Una fecha de bloqueo congela todo lo anterior, como la fecha de bloqueo de Odoo. Es como cerrar con cinta el cuaderno de septiembre: puedes leerlo, pero no escribir ni borrar en él. Con `lock_date = 2026-09-30` en tu usuario (`res_users`), ningún movimiento con fecha hasta el 30 de septiembre se puede crear, editar, mover ni borrar, así que esos saldos ya no cambian.

Como nadie audita PPM, el cierre se puede reabrir moviendo la fecha hacia atrás o dejándola vacía. Para no dejar pendientes congelados, no se puede cerrar un periodo que tenga borradores ni movimientos por clasificar, y solo se cierran días que ya pasaron. Lo construido (0028) ajusta el SQL de abajo en dos cosas: el candado lee el cierre del dueño de la fila, no de la sesión, para que borrar a una persona no choque con su propio cierre; y solo mira lo que cambia saldos (en el asiento, la fecha y el estado; en el apunte, la cuenta, los montos, la moneda y la persona), así los vencimientos, los cortes de las cuotas y las conciliaciones siguen libres.

```sql
-- La fecha de cierre vive en res_users.lock_date (ver DDL)

-- Nada se toca con fecha igual o anterior al cierre
CREATE FUNCTION check_lock_date() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lock date := (SELECT lock_date FROM res_users WHERE id = current_user_id());
  v_date date;
BEGIN
  IF v_lock IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_TABLE_NAME = 'account_move' THEN
    -- Fecha anterior (al editar o borrar) y nueva (al crear o mover)
    IF (TG_OP <> 'INSERT' AND OLD.date <= v_lock)
       OR (TG_OP <> 'DELETE' AND NEW.date <= v_lock) THEN
      RAISE EXCEPTION 'Periodo cerrado hasta %', v_lock;
    END IF;
  ELSE
    SELECT date INTO v_date FROM account_move
     WHERE id = COALESCE(NEW.move_id, OLD.move_id);
    IF v_date <= v_lock THEN
      RAISE EXCEPTION 'Periodo cerrado hasta %', v_lock;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_lock_move
  BEFORE INSERT OR UPDATE OR DELETE ON account_move
  FOR EACH ROW EXECUTE FUNCTION check_lock_date();

CREATE TRIGGER trg_lock_move_line
  BEFORE INSERT OR UPDATE OR DELETE ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_lock_date();

-- No se cierra un periodo con borradores pendientes
CREATE FUNCTION check_lock_drafts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lock_date IS NOT NULL AND EXISTS (
       SELECT 1 FROM account_move
        WHERE state = 'draft' AND date <= NEW.lock_date) THEN
    RAISE EXCEPTION 'Hay borradores hasta %: confírmalos o bórralos antes de cerrar',
                    NEW.lock_date;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_lock_drafts
  BEFORE UPDATE OF lock_date ON res_users
  FOR EACH ROW EXECUTE FUNCTION check_lock_drafts();

-- Cerrar septiembre / reabrir todo
UPDATE res_users SET lock_date = '2026-09-30';
UPDATE res_users SET lock_date = NULL;
```

## Multimoneda (PEN y USD)

Los soles son la moneda base, como en Odoo: `debit` y `credit` siempre están en soles, y `amount_currency` guarda el monto en la moneda de la cuenta. Así cada transacción cuadra en soles y una cuenta en dólares sigue mostrando dólares.

**Analogía.** Es como una boleta en dólares con su equivalente en soles al pie: el monto real es el de dólares; el de soles sirve para sumar todo en una sola moneda.

Ejemplo: cambias S/ 380 por $100 en una casa de cambio (tipo 3.80).

| Cuenta | Moneda | amount\_currency | Debe (S/) | Haber (S/) |
| --- | --- | --- | --- | --- |
| BBVA Dólares | USD | 100.00 | 380.00 |  |
| BCP Ahorros | PEN | −380.00 |  | 380.00 |

El tipo usado no se guarda aparte: sale de dividir el monto en soles entre `amount_currency`. La tabla `res_currency_rate` solo sugiere un valor al registrar. A diferencia de Odoo, que guarda cuántas unidades de la moneda equivalen a 1 de la moneda base, aquí se guardan compra y venta en soles por unidad, tal como las publica SUNAT.

```sql
CREATE TABLE res_currency_rate (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  name        date NOT NULL,                     -- la fecha, como en Odoo
  rate_buy    numeric(10,4) NOT NULL,            -- compra (moneda base por unidad)
  rate_sell   numeric(10,4) NOT NULL,            -- venta
  source      text NOT NULL DEFAULT 'SUNAT'
              CHECK (source IN ('SUNAT', 'manual')),  -- importador o a mano
  create_date timestamptz NOT NULL DEFAULT now(),
  CHECK (rate_buy > 0 AND rate_sell >= rate_buy),
  UNIQUE (currency_id, name)
);
```

**De dónde sale cada día.** Un importador automático, separado de la lógica de negocio, lee cada día https://www.sunat.gob.pe/a/txt/tipoCambio.txt, que trae una sola línea con la fecha, la compra y la venta (24/10/2026|3.443|3.451|), y la guarda con `source = 'SUNAT'`. Si falla o no hay conexión, lo carga el administrador de PPM con `source = 'manual'`. Para el modelo ambos son iguales: la lógica solo lee la tabla y nunca llama a SUNAT. Es como el periódico que te dejan en la puerta: a la casa no le importa quién lo trajo, solo que esté ahí. Es un dato global: lo mantiene PPM para todos los usuarios, que solo lo leen; quien necesite otra tasa la escribe en su movimiento.

Tres reglas lo hacen confiable:

1. **Manda el último que se cargó.** Si traes el de SUNAT y luego corriges ese día a mano, queda el tuyo; si vuelves a traer el de SUNAT, lo reemplaza otra vez (`ON CONFLICT DO UPDATE`). Hay una sola fila por día, y source dice quién la puso por última vez. Los movimientos ya registrados no cambian: guardan su valor en soles.
2. **Sin dato, el último anterior.** Un domingo, un feriado o un día en que el importador falló usan el último tipo publicado antes de esa fecha. La regla vive en `get_rate`, que usan el registro de movimientos y los reportes.
3. **Aviso si está viejo.** Una vista muestra la fecha del último tipo de cada moneda activa y cuántos días tiene. La app avisa si pasan más de 3 días sin dato nuevo, para que revises el importador o cargues uno a mano.

```sql
-- Lo que hace el importador (fuera de la lógica de negocio), para cada día
INSERT INTO res_currency_rate (currency_id, name, rate_buy, rate_sell, source)
VALUES ((SELECT id FROM res_currency WHERE name = 'USD'), '2026-10-05', 3.7400, 3.7480, 'SUNAT')
ON CONFLICT (currency_id, name) DO UPDATE
  SET rate_buy = EXCLUDED.rate_buy, rate_sell = EXCLUDED.rate_sell, source = 'SUNAT';  -- manda el último

-- Tipo de cambio para una fecha: el de ese día o el último anterior
CREATE FUNCTION get_rate(p_currency_id smallint, p_date date, p_side text)  -- 'buy' o 'sell': lo decide rate_side
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_rate numeric;
BEGIN
  IF p_currency_id = v_base THEN RETURN 1; END IF;
  SELECT CASE WHEN p_side = 'buy' THEN rate_buy ELSE rate_sell END
    INTO v_rate
    FROM res_currency_rate
   WHERE currency_id = p_currency_id AND name <= p_date
   ORDER BY name DESC
   LIMIT 1;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'No hay tipo de cambio hasta el %', p_date;
  END IF;
  RETURN v_rate;
END $$;

-- Qué lado usar: compra para lo que tienes, venta para lo que debes
CREATE FUNCTION rate_side(p_account_type text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_account_type = 'liability' THEN 'sell' ELSE 'buy' END;
$$;
-- Ejemplo: get_rate(usd, fecha, rate_side(cuenta.account_type))
-- Un movimiento con otra tasa la guarda en sus apuntes (balance / amount_currency): esta tabla no cambia

-- Qué tan al día está cada moneda activa
CREATE VIEW res_currency_rate_status AS
SELECT c.name AS currency, r.name AS ultima_fecha, r.source,
       current_date - r.name AS dias,
       (current_date - r.name) > 3 AS desactualizado
  FROM res_currency c
  LEFT JOIN LATERAL (
    SELECT name, source FROM res_currency_rate
     WHERE currency_id = c.id ORDER BY name DESC LIMIT 1
  ) r ON true
 WHERE c.id IN (SELECT currency_id FROM res_users_currency)   -- las que alguien usa (lo ve ppm_admin)
   AND c.name <> 'PEN';                                       -- el tipo global es soles por unidad
```

**Qué tipo de cambio usar.** Se sugiere el de SUNAT del día, y el lado lo pone la cuenta: compra para lo que tienes (bancos, efectivo, por cobrar) y venta para lo que debes (tarjetas, préstamos, por pagar), como al valorizar saldos en Perú. Siempre se puede escribir otro, por ejemplo la tasa real de la casa de cambio. Ese tipo vale solo para ese movimiento: queda en sus apuntes (balance ÷ amount\_currency) y no toca res\_currency\_rate, igual que en Odoo, donde la tasa de un pago no cambia las tasas de la moneda.

| Situación | Tipo sugerido | Por qué |
| --- | --- | --- |
| Cambio de moneda en banco o casa de cambio | El real de la operación | Lo fijan los dos montos que de verdad salieron y entraron |
| Gasto o ingreso en dólares | SUNAT venta del día | Es la referencia usual en comprobantes |
| Valorizar dólares que tienes (reportes) | SUNAT compra | Lo que obtendrías al vender esos dólares |
| Valorizar deudas en dólares (reportes) | SUNAT venta | Lo que te costaría comprar los dólares para pagar |

**Ganancia por tipo de cambio y costo del cambio.** Aparecen cuando el tipo de hoy difiere del tipo con el que registraste esos dólares. Un tipo personalizado no genera diferencia por sí solo: fija el valor en soles de ese momento, y la diferencia aparece después, al convertir o valorizar a otro tipo. En la app no se habla de diferencia de cambio: se dice «Cambiar tus dólares te costó S/ 45.30» o «Ganaste S/ 12 por el tipo de cambio».

| Tienes… | Si el dólar sube | Si el dólar baja |
| --- | --- | --- |
| Dólares (activo) | Ganancia | Pérdida |
| Deuda en dólares (pasivo) | Pérdida | Ganancia |

Ejemplo: recibiste $100 cuando el dólar estaba a 3.70 (S/ 370 en libros). Si los cambias a 3.80 recibes S/ 380: ganancia de S/ 10. A 3.60 recibirías S/ 360: pérdida de S/ 10.

| Cuenta | amount\_currency | Debe (S/) | Haber (S/) |
| --- | --- | --- | --- |
| BCP Ahorros | 380.00 PEN | 380.00 |  |
| BBVA Dólares | −100.00 USD |  | 370.00 |
| Ganancia por tipo de cambio (ingreso) | −10.00 PEN |  | 10.00 |

Dos tipos de diferencia:

- **Realizada**: al convertir dólares a soles (o al revés). Se registra como una línea más en esa transacción, contra "Ganancia por tipo de cambio" o "Costo del cambio".
- **No realizada**: dólares que sigues teniendo y que hoy valen más o menos soles. No se registra; los reportes la calculan como saldo en USD × tipo del día − saldo en soles en libros.

La no realizada vive en una vista: se recalcula cada vez que se consulta, con el último tipo de `res_currency_rate` (compra para lo que tienes, venta para lo que debes). Solo aplica a saldos en moneda distinta de PEN, aunque estén dentro de una cuenta multimoneda.

```sql
CREATE VIEW account_unrealized_fx AS
WITH last_rate AS (
  SELECT DISTINCT ON (currency_id) currency_id, rate_buy, rate_sell, name AS rate_date
    FROM res_currency_rate
   ORDER BY currency_id, name DESC
)
SELECT a.id, a.display_name, c.name AS currency, r.rate_date,
       SUM(l.amount_currency) AS saldo_moneda,   -- lo que tienes (+) o debes (−)
       SUM(l.balance)         AS valor_libros,   -- en moneda base, como se registró
       ROUND(SUM(l.amount_currency)
             * CASE WHEN a.account_type = 'asset' THEN r.rate_buy ELSE r.rate_sell END, 2)
                              AS valor_hoy,
       ROUND(SUM(l.amount_currency)
             * CASE WHEN a.account_type = 'asset' THEN r.rate_buy ELSE r.rate_sell END, 2)
         - SUM(l.balance)     AS diferencia      -- + ganancia, − pérdida
  FROM account_account_v a
  JOIN account_move_line l ON l.account_id = a.id
  JOIN account_move m      ON m.id = l.move_id AND m.state = 'posted'
  JOIN res_currency c      ON c.id = l.currency_id
  JOIN last_rate r         ON r.currency_id = l.currency_id
 WHERE l.currency_id <> (SELECT currency_id FROM res_users WHERE id = current_user_id())
 GROUP BY a.id, a.display_name, c.name, a.account_type, r.rate_date, r.rate_buy, r.rate_sell;
```

Odoo, en cambio, registra la revaluación con un asiento de ajuste al cierre del periodo y lo revierte al día siguiente, porque una empresa debe reportar estados financieros a una fecha. PPM no lo necesita: la vista da el mismo número sin guardar nada.

**Cuentas multimoneda.** Una cuenta con la moneda en blanco acepta líneas en cualquier moneda, como en Odoo. Es una billetera con dos bolsillos: una sola cuenta, pero cuando preguntas cuánto hay, la respuesta es "S/ 800 y $ 50". Se usa para tarjetas bimoneda; las cuentas bancarias mantienen su moneda fija, porque en la realidad solo reciben esa moneda y así la base rechaza un error de registro. El saldo por moneda se calcula agrupando las líneas:

```sql
CREATE VIEW account_balance_currency AS
SELECT a.id, a.display_name, c.name AS currency,
       SUM(l.amount_currency) AS saldo_moneda,   -- con signo, en esa moneda
       SUM(l.balance)         AS valor_libros    -- en moneda base
  FROM account_account_v a
  JOIN account_move_line l ON l.account_id = a.id
  JOIN account_move m      ON m.id = l.move_id AND m.state = 'posted'
  JOIN res_currency c      ON c.id = l.currency_id
 GROUP BY a.id, a.display_name, c.name;
```

## Tarjetas de crédito

Una tarjeta es una cuenta de pasivo: lo que le debes al banco. Corte, pago, cuotas e intereses se apoyan en esa cuenta, sin cambiar la partida doble.

**Analogía.** Comprar en cuotas es como comprar al contado con dinero que el banco te presta: el televisor es tuyo hoy, pero cada cuota es el gasto del mes en que el banco la factura; mientras tanto espera en «Cuotas por venir», como un pago por adelantado, y los intereses son el alquiler de ese dinero, que se paga mes a mes mientras lo usas.

| Evento | Debe | Haber | Fecha |
| --- | --- | --- | --- |
| Compra en 1 cuota | Gasto (Comida, Ropa…) | Tarjeta | Día de la compra |
| Compra en N cuotas | Cuotas por venir, por todas las cuotas | Tarjeta, por todas las cuotas | Día de la compra |
| Cuota facturada | Gasto de la compra (capital) e Intereses | Cuotas por venir | Corte de la cuota |
| Intereses, comisiones y seguros | Gasto: Gastos financieros | Tarjeta | Fecha del estado de cuenta |
| Pago de la tarjeta | Tarjeta | Banco | Día del pago |
| Devolución del comercio | Tarjeta | Gasto | Día del abono |

**PPM no calcula intereses.** Los intereses, comisiones y seguros se registran como los cobra el banco, con la fecha del estado de cuenta. El banco ya hizo el cálculo, con seguros y redondeos que una fórmula no reproduciría al céntimo. Es como el recibo de la luz: no recalculas los kilovatios, copias el monto. Una compra en cuotas no se edita: se borra con su plan y se registra de nuevo. Las cuotas que faltan sí se pueden cancelar, si se devolvió o se pagó por adelantado.

**Tablas.** La tarjeta es un subtipo de cuenta: `account_credit_card` usa la clave de su cuenta de pasivo, que es multimoneda porque casi todas las tarjetas en Perú son bimoneda. Su DDL está en "Normalización: cuentas y sus subtipos"; aquí van las cuotas. El cronograma se guarda en vez de calcularse al vuelo porque es un documento del banco: puede diferir del cálculo (días exactos, seguros) y entonces se corrige la fila.

```sql
-- Una compra en cuotas (como account.payment.term): el asiento de la compra + sus condiciones
CREATE TABLE account_installment_plan (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  move_id         bigint NOT NULL UNIQUE REFERENCES account_move (id) ON DELETE CASCADE,
  card_account_id bigint NOT NULL REFERENCES account_credit_card (account_id),  -- solo tarjetas
  currency_id     smallint NOT NULL REFERENCES res_currency (id),  -- moneda de la compra
  principal       numeric(14,2) NOT NULL CHECK (principal > 0),
  n_installments  smallint NOT NULL CHECK (n_installments BETWEEN 2 AND 60),
  first_closing   date NOT NULL                      -- corte de la cuota 1
);

-- El calendario: una línea por cuota (0018 y 0021 agregan el interés, el precio y la categoría)
CREATE TABLE account_installment_plan_line (
  plan_id       bigint NOT NULL REFERENCES account_installment_plan (id) ON DELETE CASCADE,
  sequence      smallint NOT NULL,                  -- número de cuota
  closing_date  date NOT NULL,                      -- corte en que se factura
  principal     numeric(14,2) NOT NULL,             -- capital de esa cuota
  PRIMARY KEY (plan_id, sequence)
);
```

**Ciclo de facturación.** Con corte el 20, una compra del 25 de septiembre entra al ciclo que cierra el 20 de octubre. La fecha de pago de ese ciclo la escribes cuando llega el estado de cuenta. Si el día no existe en el mes (corte 31 en febrero), se usa el último día.

```sql
-- El día p_day del mes de p_month, o el último día si no existe
CREATE FUNCTION day_in_month(p_month date, p_day int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(date_trunc('month', p_month)::date + (p_day - 1),
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
$$;

-- Corte que le toca a una fecha: el primero en o después de ella
CREATE FUNCTION card_closing_for(p_card bigint, p_date date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN day_in_month(p_date, c.closing_day) >= p_date
              THEN day_in_month(p_date, c.closing_day)
              ELSE day_in_month((p_date + interval '1 month')::date, c.closing_day)
         END
    FROM account_credit_card c WHERE c.account_id = p_card
$$;
```

**Fecha de pago: se copia del estado de cuenta.** La tarjeta solo guarda su día de corte, que define los ciclos de facturación. La fecha de pago no se calcula: cada mes llega impresa en el estado de cuenta y la escribes en su ciclo. Es como el recibo de la luz: no calculas cuándo vence, lo lees. Mientras no la escribas, la tarjeta muestra el ciclo sin fecha de pago.

```sql
-- Un ciclo de facturación por corte, con la fecha de pago que dice el banco
CREATE TABLE account_credit_card_cycle (
  card_account_id bigint NOT NULL REFERENCES account_credit_card (account_id) ON DELETE CASCADE,
  closing_date    date NOT NULL,                 -- el corte: cierra el ciclo
  date_due        date NOT NULL,                 -- último día de pago, del estado de cuenta
  PRIMARY KEY (card_account_id, closing_date),
  CHECK (date_due > closing_date)
);
```

Las cuotas también toman su vencimiento de aquí: cada cuota sabe en qué corte se factura, y su fecha de pago es la de ese ciclo.

**Calendario de cuotas.** Es la cuota del banco en cada corte; si no se escribió, el precio dividido entre las cuotas. Sirve para saber cuánto toca pagar cada mes y cuánta línea se libera; con el «Detalle plan cuotas» del estado de cuenta, la cuota facturada se divide en capital (su categoría) e interés (Intereses).

Ejemplo: televisor de S/ 1,200 en 6 cuotas, comprado el 25 de septiembre con la tarjeta de corte 20.

| Cuota | Corte | Capital |
| --- | --- | --- |
| 1 | 2026-10-20 | 200.00 |
| 2 | 2026-11-20 | 200.00 |
| 3 | 2026-12-20 | 200.00 |
| 4 | 2027-01-20 | 200.00 |
| 5 | 2027-02-20 | 200.00 |
| 6 | 2027-03-20 | 200.00 |

```sql
CREATE FUNCTION generate_installments(p_plan bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  p       account_installment_plan%ROWTYPE;
  v_cuota numeric;
  v_saldo numeric;
  v_close date;
BEGIN
  SELECT * INTO p FROM account_installment_plan WHERE id = p_plan;
  v_cuota := round(p.principal / p.n_installments, 2);
  v_saldo := p.principal;
  v_close := p.first_closing;

  FOR k IN 1..p.n_installments LOOP
    INSERT INTO account_installment_plan_line
      (plan_id, sequence, closing_date, principal)
    VALUES (p_plan, k, v_close,
            CASE WHEN k = p.n_installments THEN v_saldo ELSE v_cuota END);  -- la última cierra el saldo
    v_saldo := v_saldo - v_cuota;
    v_close := card_closing_for(p.card_account_id, v_close + 1);
  END LOOP;
END $$;
```

**Estado de la tarjeta.** Una vista responde lo que preguntas cada mes: cuánto debo en total, cuánto pago ahora y para cuándo. Todo en la moneda de cada cuenta.

```sql
CREATE VIEW account_credit_card_status AS
WITH c AS (
  SELECT cc.account_id, a.name, cur.id AS currency_id, cur.name AS currency,
         CASE WHEN day_in_month(current_date, cc.closing_day) <= current_date
              THEN day_in_month(current_date, cc.closing_day)
              ELSE day_in_month((current_date - interval '1 month')::date, cc.closing_day)
         END AS ultimo_corte
    FROM account_credit_card cc
    JOIN account_account a ON a.id = cc.account_id
   CROSS JOIN res_currency cur                -- una fila por moneda activa
   WHERE cur.active
)
SELECT c.name AS tarjeta, c.currency, c.ultimo_corte,
       cy.date_due                                      AS vence,  -- NULL hasta copiarla del estado de cuenta
       COALESCE(m.deuda_total, 0)                       AS deuda_total,
       COALESCE(m.cargos, 0) + q.cuotas                 AS por_facturar,
       COALESCE(m.deuda_total, 0) - COALESCE(m.cargos, 0) - q.cuotas AS a_pagar
  FROM c
  LEFT JOIN account_credit_card_cycle cy
         ON cy.card_account_id = c.account_id AND cy.closing_date = c.ultimo_corte
  CROSS JOIN LATERAL (
    SELECT -SUM(l.amount_currency) AS deuda_total,
           -SUM(l.amount_currency) FILTER (
              WHERE l.credit > 0 AND mv.date > c.ultimo_corte
                AND p.id IS NULL)  AS cargos   -- compras sin cuotas tras el corte
      FROM account_move_line l
      JOIN account_move mv ON mv.id = l.move_id AND mv.state = 'posted'
      LEFT JOIN account_installment_plan p ON p.move_id = mv.id
     WHERE l.account_id  = c.account_id
       AND l.currency_id = c.currency_id
  ) m
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(pl.principal), 0) AS cuotas  -- cuotas de cortes futuros
      FROM account_installment_plan_line pl
      JOIN account_installment_plan p ON p.id = pl.plan_id
     WHERE p.card_account_id = c.account_id
       AND p.currency_id     = c.currency_id
       AND pl.closing_date   > c.ultimo_corte
  ) q;
```

- **deuda\_total**: todo lo que debes, incluidas las cuotas que aún no se facturan.
- **por\_facturar**: compras después del último corte más cuotas de cortes futuros.
- **a\_pagar**: lo facturado que vence en la fecha `vence`; si es negativo, es saldo a favor.
- **Línea disponible**: línea − deuda total de ambas monedas (dólares al tipo venta). Una compra en cuotas ocupa la línea completa por su precio, y las cuotas que se facturan no la cambian.

## Préstamos

Un préstamo de banco es una cuenta de pasivo propia, y su cuota mensual es una recurrencia en borrador que ajustas con la boleta. Un préstamo entre personas va en Por cobrar o Por pagar con el contacto. El de banco guarda su ficha en account\_loan (la cuenta, el banco y su cuota recurrente), como las tarjetas; el de personas no necesita tablas nuevas.

**Analogía.** La hipoteca tiene su propio expediente en el archivador, con contrato y cronograma. Lo que le prestas a tu hermano es una línea en el cuaderno de fiados.

|  | Banco o financiera | Familia o amigos |
| --- | --- | --- |
| Dónde vive la deuda | Cuenta de pasivo propia: "Préstamo hipotecario BCP" | Por cobrar (prestas tú) o Por pagar (te prestan), con el contacto |
| Por qué ahí | Cada préstamo tiene su saldo, su cuota y su recurrencia, y se ve por separado en tu balance | La persona es un dato del movimiento, como cualquier deuda informal |
| Cuotas | Recurrencia en borrador con interés, capital y seguro | Opcional: una recurrencia si te pagan un monto fijo cada mes |
| Interés | Se copia de la boleta del banco | Solo si lo pactaron: Intereses y dividendos (ingreso) si prestas, Gastos financieros › Intereses si te prestan |
| Si no se paga | No aplica | Gastos financieros › Deudas incobrables |

**Préstamo del banco.** Al recibirlo, el dinero entra al banco y nace la deuda; no es un ingreso. Si el préstamo ya existía, se registra solo su saldo inicial.

| Asiento | Cuenta | Debe | Haber |
| --- | --- | --- | --- |
| Desembolso | BCP Ahorros | 50,000.00 |  |
| Desembolso | Préstamo vehicular BCP |  | 50,000.00 |
| Cuota de diciembre | Gastos financieros › Intereses | 610.00 |  |
| Cuota de diciembre | Préstamo vehicular BCP (capital) | 1,050.00 |  |
| Cuota de diciembre | Gastos financieros › Seguros (desgravamen) | 28.00 |  |
| Cuota de diciembre | BCP Ahorros |  | 1,688.00 |

El interés va a la categoría que lo explique mejor: en una hipoteca, Vivienda › Hipoteca, para que muestre lo que de verdad cuesta vivir ahí; en los demás, Gastos financieros › Intereses. El saldo de la cuenta del préstamo es lo que aún debes; cuando llega a cero, terminas la recurrencia. Un prepago es un movimiento solo de capital, y si el banco recalcula la cuota, cambias el monto de la recurrencia.

```sql
-- La deuda: una cuenta de pasivo más
INSERT INTO account_account (name, account_type, currency_id)
VALUES ('Préstamo vehicular BCP', 'liability', 1);  -- id 70

-- La cuota: recurrencia en borrador; los montos son el estimado que corriges con la boleta
WITH r AS (
  INSERT INTO account_recurring (name, currency_id, interval_type, month_day_mode, month_days,
                                 date_start, end_type, max_count, amount_type)
  VALUES ('Cuota préstamo vehicular', 1, 'month', 'days', '{15}',
          '2026-12-15', 'count', 36, 'variable')  -- variable → post_mode 'draft'
  RETURNING id
)
INSERT INTO account_recurring_line (recurring_id, account_id, amount)
SELECT r.id, v.* FROM r, (VALUES
    (52,   610.00),   -- Gastos financieros › Intereses
    (70,  1050.00),   -- Préstamo vehicular BCP (capital)
    (53,    28.00),   -- Gastos financieros › Seguros
    ( 3, -1688.00)    -- BCP Ahorros
  ) AS v (account_id, amount);
```

**Préstamo entre personas.** Le prestas S/ 500 a tu hermano: Debe Por cobrar (hermano), Haber BCP Ahorros. Cuando te devuelve S/ 200, el cobro se concilia solo con la deuda más antigua y el reporte de antigüedad muestra los S/ 300 pendientes. Si el préstamo es hacia ti, es lo mismo con Por pagar.

**Plata que guardas de alguien.** Tienes S/ 2,000 en tu cuenta de ahorros, pero S/ 1,000 son de tu pareja. No es un préstamo, pero sí una obligación: esa plata no es tuya y algún día la devuelves o la usas por ella (los contadores la llaman fondos de terceros). Va en su propia cuenta de pasivo, Plata que guardo de otros, con la persona, para que la app la muestre como «guardas» y no como «debes». Al cargar el saldo inicial: Debe Ahorros 2,000 / Haber Plata que guardo de otros (pareja) 1,000 / Haber Saldos iniciales 1,000. El banco sigue cuadrando con el extracto y «lo que realmente tengo» solo sube 1,000. Si te da más para guardar, sube; si retira o pagas algo por ella, baja.

## Alta de cuentas: bancos y tarjetas

Un solo formulario crea todo lo necesario, en un solo paso atómico: la cuenta contable, sus datos (banco, número, CCI o datos de la tarjeta) y su saldo inicial. Es lo que hace Odoo al crear un diario de banco, que crea por debajo su cuenta contable. No hace falta crear antes una cuenta de pasivo para una tarjeta, ni registrar a mano el saldo inicial.

**Datos de la tarjeta: solo los últimos 4 dígitos.** Basta para reconocerla ("Visa •••• 4417"), igual que en un ticket de compra. Guardar el número completo convertiría a PPM en un blanco: si la base se filtra, expondría tus tarjetas, y ninguna función de la app lo necesita. El número de cuenta y el CCI sí se guardan completos: los compartes para recibir transferencias y no permiten sacar dinero.

Las tablas `res_partner_bank` y `res_bank` están en "Normalización: cuentas y sus subtipos".

**El saldo inicial se registra solo.** Lo que una cuenta ya tiene (o, en una tarjeta, lo que ya debes) el día que empiezas a usar PPM no es ingreso ni gasto de este periodo: pasó antes. Por eso va contra Saldos iniciales (patrimonio).

| Al crear | Debe | Haber |
| --- | --- | --- |
| Cuenta de ahorros con S/ 1,500 | Cuenta de ahorros 1,500 | Saldos iniciales 1,500 |
| Tarjeta que ya tiene S/ 800 de uso | Saldos iniciales 800 | Tarjeta 800 (línea en PEN) |

```sql
-- Saldo inicial de cualquier cuenta de activo o pasivo
CREATE FUNCTION post_opening_balance(p_account bigint, p_amount numeric, p_date date,
                                     p_rate numeric DEFAULT 1,
                                     p_currency_id smallint DEFAULT NULL)  -- para multimoneda
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  a      account_account_v%ROWTYPE;
  v_base smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  v_eq   bigint;
  v_cur  smallint;
  v_amt  numeric;    -- en moneda base
  v_sign int;
  v_move bigint;
BEGIN
  SELECT * INTO a FROM account_account_v WHERE id = p_account;
  SELECT id INTO v_eq FROM account_account
   WHERE account_type = 'equity' AND name = 'Saldos iniciales';
  v_cur  := COALESCE(a.currency_id, p_currency_id, v_base);
  v_amt  := round(p_amount * CASE WHEN v_cur = v_base THEN 1 ELSE p_rate END, 2);
  v_sign := CASE WHEN a.account_type = 'asset' THEN 1 ELSE -1 END;  -- activo al Debe, pasivo al Haber

  INSERT INTO account_move (date, ref, state)
  VALUES (p_date, 'Saldo inicial ' || a.display_name, 'posted')
  RETURNING id INTO v_move;

  INSERT INTO account_move_line
    (move_id, account_id, debit, credit, currency_id, amount_currency)
  VALUES
    (v_move, a.id, greatest(v_sign * v_amt, 0), greatest(-v_sign * v_amt, 0),
     v_cur, v_sign * p_amount),
    (v_move, v_eq, greatest(-v_sign * v_amt, 0), greatest(v_sign * v_amt, 0),
     v_base, -v_sign * v_amt);
  RETURN v_move;
END $$;

-- Cuenta bancaria: cuenta + datos + saldo inicial
CREATE FUNCTION create_bank_account(
  p_name text, p_currency_id smallint, p_bank_id smallint, p_acc_number text, p_cci char(20),
  p_opening numeric DEFAULT 0, p_date date DEFAULT user_today(), p_rate numeric DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_acc bigint;
BEGIN
  INSERT INTO account_account (name, account_type, currency_id)
  VALUES (p_name, 'asset', p_currency_id) RETURNING id INTO v_acc;
  INSERT INTO res_partner_bank (account_id, bank_id, acc_number, cci)
  VALUES (v_acc, p_bank_id, p_acc_number, p_cci);
  IF p_opening <> 0 THEN
    PERFORM post_opening_balance(v_acc, p_opening, p_date, p_rate);
  END IF;
  RETURN v_acc;
END $$;

-- Tarjeta: su cuenta de pasivo multimoneda + datos + deuda inicial por moneda
CREATE FUNCTION create_credit_card(
  p_name text, p_bank_id smallint, p_brand text, p_last4 char(4), p_expires date,
  p_closing int, p_limit numeric,
  p_debt_pen numeric DEFAULT 0, p_debt_usd numeric DEFAULT 0,
  p_date date DEFAULT user_today(), p_rate numeric DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_acc bigint;
BEGIN
  INSERT INTO account_account (name, account_type, currency_id)
  VALUES (p_name, 'liability', NULL)                      -- 'Visa BBVA', multimoneda
  RETURNING id INTO v_acc;

  INSERT INTO account_credit_card (account_id, bank_id, brand, last4, expires_on, closing_day,
                                   credit_limit, limit_currency_id)
  VALUES (v_acc, p_bank_id, p_brand, p_last4, p_expires, p_closing, p_limit, (SELECT currency_id FROM res_users WHERE id = current_user_id()));

  IF p_debt_pen <> 0 THEN
    PERFORM post_opening_balance(v_acc, p_debt_pen, p_date, 1,
                                 (SELECT id FROM res_currency WHERE name = 'PEN'));
  END IF;
  IF p_debt_usd <> 0 THEN
    PERFORM post_opening_balance(v_acc, p_debt_usd, p_date, p_rate,
                                 (SELECT id FROM res_currency WHERE name = 'USD'));
  END IF;
  RETURN v_acc;                                           -- la tarjeta se identifica por su cuenta
END $$;
```

**Fecha de la deuda inicial de una tarjeta.** Por defecto es el último corte: registras lo que dice tu último estado de cuenta, y así `account_credit_card_status` lo muestra como "a pagar". Lo que usaste después del corte se registra como compras normales, y queda como "por facturar".

**Cuotas en curso al registrar la tarjeta.** Si parte del uso actual son compras en cuotas, conviene registrarlas aparte para que PPM conozca su cronograma: cada una es un saldo inicial por el capital que falta pagar, más un plan con las cuotas que quedan (por ejemplo, 4 de 6). El resto de la deuda va como deuda inicial simple. Así `account_credit_card_status` separa desde el primer día lo que vence ahora de lo que se facturará después.

## Contactos y cuentas por cobrar

Si pagas una cena de S/ 200 y acuerdan dividirla, solo S/ 100 son tu gasto; los otros S/ 100 son dinero que te deben. Ese "me deben" es un activo: una cuenta por cobrar. Al revés, si la otra persona paga y tú le debes tu parte, es un pasivo: una cuenta por pagar. Los préstamos a familiares o amigos son lo mismo, sin gasto de por medio.

**Cómo modelar a la persona.** Hay tres opciones:

| Opción | Cómo | Consecuencia |
| --- | --- | --- |
| Una cuenta por persona | "Por cobrar: Ana", "Por cobrar: Luis"… | El plan de cuentas crece con cada contacto, y el teléfono o el país de la persona no tienen dónde vivir |
| Un subtipo por persona | `account_account` + una tabla con los datos de la persona | Mezcla dos cosas distintas: qué es el dinero (la cuenta) y quién lo debe (la persona) |
| Una cuenta + contacto en el apunte (elegido) | Una sola cuenta "Por cobrar" y cada apunte dice `partner_id` | La persona es un dato del movimiento; así funciona el libro mayor de contactos de Odoo |

**Analogía.** Es el cuaderno de fiados de la bodega: un solo cuaderno, y en cada anotación el nombre del vecino. Para saber cuánto debe la señora Rosa sumas sus anotaciones; nadie lleva un cuaderno por vecino.

No hace falta un subtipo nuevo. Los subtipos (`res_partner_bank`, `account_credit_card`) describen la cuenta: su banco, su corte. La persona, en cambio, es quien está al otro lado de un movimiento concreto, y una misma cena puede dividirse con dos amigos en un solo asiento, así que va en el apunte. A la cuenta solo le hace falta una marca: `partner_required` exige que sus apuntes digan con quién. Sigue siendo un activo (por cobrar) o un pasivo (por pagar), multimoneda para que alguien pueda deberte en dólares.

```sql
-- Las dos cuentas que llevan contacto (multimoneda)
INSERT INTO account_account (name, account_type, currency_id, partner_required) VALUES
  ('Por cobrar', 'asset',     NULL, true),
  ('Por pagar',  'liability', NULL, true);

-- Sus apuntes deben decir con quién
CREATE FUNCTION check_line_partner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.partner_id IS NULL
     AND (SELECT partner_required FROM account_account WHERE id = NEW.account_id) THEN
    RAISE EXCEPTION 'La cuenta % necesita un contacto (partner_id)', NEW.account_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_line_partner
  BEFORE INSERT OR UPDATE OF account_id, partner_id ON account_move_line
  FOR EACH ROW EXECUTE FUNCTION check_line_partner();
```

**Los casos, en asientos.**

| Caso | Debe | Haber |
| --- | --- | --- |
| Pagas la cena de S/ 200 con la Visa y Ana te debe la mitad | Comida 100; Por cobrar (Ana) 100 | Visa BBVA 200 |
| Ana te devuelve por Yape a tu BCP | BCP Ahorros 100 | Por cobrar (Ana) 100 |
| Ana pagó la cena y tú le debes tu mitad | Comida 100 | Por pagar (Ana) 100 |
| Le pagas tu parte | Por pagar (Ana) 100 | BCP Ahorros 100 |
| Le prestas S/ 500 a Luis | Por cobrar (Luis) 500 | BCP Ahorros 500 |
| Das una deuda por perdida o la conviertes en regalo | Gasto: Regalos e incobrables 100 | Por cobrar (Ana) 100 |

Dos consecuencias importantes: tu gasto real en la cena es solo tu mitad, y cuando Ana te paga no es un ingreso, sino dinero que vuelve de un tanque a otro.

```sql
WITH m AS (
  INSERT INTO account_move (date, ref, state)
  VALUES ('2026-10-10', 'Cena con Ana (mitad cada uno)', 'posted')
  RETURNING id
)
INSERT INTO account_move_line (move_id, account_id, partner_id, debit, credit,
                               currency_id, amount_currency)
SELECT m.id, a.id, p.id, v.debit, v.credit,
       (SELECT id FROM res_currency WHERE name = 'PEN'), v.debit - v.credit
  FROM m,
       (VALUES ('Comida',     NULL,         100.00,      0),
               ('Por cobrar', 'Ana Torres', 100.00,      0),
               ('Visa BBVA',  NULL,              0, 200.00)
       ) AS v (account, partner, debit, credit)
  JOIN account_account a  ON a.name = v.account
  LEFT JOIN res_partner p ON p.name = v.partner;
```

**Reporte: quién te debe y a quién le debes.** Es el libro mayor de contactos de Odoo: la suma de los apuntes de cada persona en las cuentas que llevan contacto. Si Ana te debe 100 y tú le debes 30, el saldo neto es 70 a tu favor.

```sql
CREATE VIEW res_partner_balance AS
SELECT p.id, p.name, c.name AS currency,
       SUM(l.amount_currency) AS saldo       -- + te debe, − le debes
  FROM res_partner p
  JOIN account_move_line l ON l.partner_id = p.id
  JOIN account_account a   ON a.id = l.account_id AND a.partner_required
  JOIN account_move m      ON m.id = l.move_id AND m.state = 'posted'
  JOIN res_currency c      ON c.id = l.currency_id
 GROUP BY p.id, p.name, c.name
HAVING SUM(l.amount_currency) <> 0;
```

`partner_id` también puede ir, opcional, en otros apuntes (el restaurante de un gasto, por ejemplo) si más adelante quieres reportes de con quién gastas. Solo es obligatorio en las cuentas marcadas.

**Conciliación: cada deuda con sus pagos.** El saldo por persona dice cuánto te debe Ana; la conciliación dice qué te debe exactamente y desde cuándo. En el cuaderno de fiados, cuando la señora Rosa paga 60 de sus 100, anotas junto a esa compra "pagó 60, faltan 40". Odoo lo hace con `account.partial.reconcile`: cada fila dice que un pago cancela parte de una deuda.

```sql
-- Qué parte de una deuda cancela cada pago
CREATE TABLE account_partial_reconcile (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  debit_move_line_id  bigint NOT NULL REFERENCES account_move_line (id) ON DELETE CASCADE,
  credit_move_line_id bigint NOT NULL REFERENCES account_move_line (id) ON DELETE CASCADE,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),  -- en la moneda de los apuntes
  create_date         timestamptz NOT NULL DEFAULT now(),
  CHECK (debit_move_line_id <> credit_move_line_id)
);

-- Lo que falta de cada apunte (amount_residual en Odoo): se calcula, no se guarda
CREATE VIEW account_move_line_residual AS
SELECT l.id, l.move_id, m.date, m.ref, l.account_id, l.partner_id, l.currency_id,
       l.amount_currency,
       l.amount_currency
         - COALESCE((SELECT SUM(r.amount) FROM account_partial_reconcile r
                      WHERE r.debit_move_line_id = l.id), 0)
         + COALESCE((SELECT SUM(r.amount) FROM account_partial_reconcile r
                      WHERE r.credit_move_line_id = l.id), 0) AS amount_residual
  FROM account_move_line l
  JOIN account_move m    ON m.id = l.move_id AND m.state = 'posted'
  JOIN account_account a ON a.id = l.account_id AND a.partner_required;

-- Reglas: Debe con Haber, misma cuenta, contacto y moneda, y sin pasarse de lo pendiente
CREATE FUNCTION check_partial_reconcile() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d account_move_line%ROWTYPE;
  c account_move_line%ROWTYPE;
BEGIN
  SELECT * INTO d FROM account_move_line WHERE id = NEW.debit_move_line_id;
  SELECT * INTO c FROM account_move_line WHERE id = NEW.credit_move_line_id;
  IF d.amount_currency <= 0 OR c.amount_currency >= 0 THEN
    RAISE EXCEPTION 'Se concilia un apunte al Debe con uno al Haber';
  END IF;
  IF d.account_id <> c.account_id OR d.partner_id IS DISTINCT FROM c.partner_id
     OR d.currency_id <> c.currency_id THEN
    RAISE EXCEPTION 'Solo se concilian apuntes de la misma cuenta, contacto y moneda';
  END IF;
  IF NEW.amount > (SELECT amount_residual FROM account_move_line_residual WHERE id = d.id)
     OR NEW.amount > -(SELECT amount_residual FROM account_move_line_residual WHERE id = c.id) THEN
    RAISE EXCEPTION 'El monto supera lo que falta conciliar';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_partial_reconcile
  BEFORE INSERT ON account_partial_reconcile
  FOR EACH ROW EXECUTE FUNCTION check_partial_reconcile();

-- Concilia los pagos de un contacto con sus deudas más antiguas primero
CREATE FUNCTION reconcile_partner(p_partner bigint, p_account bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c     record;
  d     record;
  v_amt numeric;
BEGIN
  FOR c IN SELECT id, currency_id, -amount_residual AS open
             FROM account_move_line_residual
            WHERE partner_id = p_partner AND account_id = p_account AND amount_residual < 0
            ORDER BY date, id LOOP
    FOR d IN SELECT id, amount_residual AS open
               FROM account_move_line_residual
              WHERE partner_id = p_partner AND account_id = p_account
                AND currency_id = c.currency_id AND amount_residual > 0
              ORDER BY date, id LOOP
      EXIT WHEN c.open = 0;
      v_amt := LEAST(c.open, d.open);
      INSERT INTO account_partial_reconcile (debit_move_line_id, credit_move_line_id, amount)
      VALUES (d.id, c.id, v_amt);
      c.open := c.open - v_amt;
    END LOOP;
  END LOOP;
END $$;

-- Deudas abiertas con su antigüedad (aged receivable / payable de Odoo)
CREATE VIEW account_aged_partner AS
SELECT p.name AS contacto, a.name AS cuenta, c.name AS currency, r.date, r.ref,
       r.amount_residual AS pendiente,
       current_date - r.date AS dias,
       CASE WHEN current_date - r.date <= 30 THEN '0-30'
            WHEN current_date - r.date <= 60 THEN '31-60'
            WHEN current_date - r.date <= 90 THEN '61-90'
            ELSE 'más de 90' END AS tramo
  FROM account_move_line_residual r
  JOIN res_partner p     ON p.id = r.partner_id
  JOIN account_account a ON a.id = r.account_id
  JOIN res_currency c    ON c.id = r.currency_id
 WHERE r.amount_residual <> 0;
```

Ejemplo: la cena del 10-oct deja a Ana debiendo 100. El 15-oct te paga 60; `reconcile_partner` concilia ese pago con la deuda más antigua y la cena queda con 40 pendientes, que el reporte de antigüedad muestra en el tramo 0-30. Al registrar un pago, la app ejecuta la conciliación automática (de la deuda más antigua a la más nueva), y tú puedes deshacerla y elegir otra si el pago era para una deuda concreta. Si borras o editas un movimiento, sus conciliaciones se borran en cascada y la app vuelve a conciliar.

Solo se concilia dentro de la misma cuenta. Si Ana te debe 100 en Por cobrar y tú le debes 30 en Por pagar, el saldo por persona ya muestra el neto (70); para cerrar ambas deudas se registra una compensación (Debe Por pagar 30 / Haber Por cobrar 30) y cada parte se concilia en su cuenta.

## Transacciones recurrentes

Una recurrencia es una plantilla de asiento con una regla de repetición: el sueldo, el alquiler o Netflix se definen una vez y la app genera cada ocurrencia como un asiento real. Editar la plantilla no cambia lo ya generado.

**Analogía.** Es un evento repetido de Google Calendar. La regla ("cada lunes") vive en un solo lugar, las fechas futuras se calculan al vuelo y cada fecha se puede cambiar sola ("solo este evento"). La diferencia es que en PPM cada ocurrencia, al llegar, se convierte en un asiento.

**La plantilla.** Guarda nombre, moneda y líneas con monto con signo (+ debe, − haber) que suman cero, igual que un asiento. Puede tener varias líneas: el sueldo con bruto, AFP, renta de 5ta y neto. El monto está en la moneda de la plantilla: cada apunte va en esa moneda si su cuenta la acepta (la tarjeta, en dólares) o en soles convertido (la cuenta de gasto). El tipo de cambio no se guarda: `get_rate` lo resuelve el día de cada ocurrencia.

**La regla.**

| Variable | Opciones | Ejemplo |
| --- | --- | --- |
| Frecuencia | Cada N días, semanas, meses o años | Quincenal = cada 2 semanas |
| Día del mes (solo mensual) | Días fijos (31 = último día) o N-ésimo día de la semana (−1 = el último) | Sueldo los días 15 y 31; último viernes |
| Semanal y anual | Se anclan al día de `date_start` | Cumpleaños cada 12 de marzo |
| Vigencia | Sin fin, hasta una fecha, N veces | Un seguro de 12 pagos |
| Estado | Activa, pausada, terminada | Pausar el gimnasio |

**Monto y modo de confirmación.** Cada plantilla elige su modo; si no se indica, el monto fijo va a `auto` y el variable a `draft`. El monto variable guarda un estimado, que sirve para la proyección y como valor inicial del borrador.

| Modo | Qué crea | Analogía | Por defecto para |
| --- | --- | --- | --- |
| `auto` | Asiento confirmado al llegar su fecha | Débito automático | Monto fijo: Netflix, alquiler |
| `draft` | Asiento en borrador para revisar | Factura que llega al correo | Monto variable: luz, agua, sueldo con bonos |
| `reminder` | Nada; avisa hasta que lo marques atendido | Post-it en la refrigeradora | Pagos sin cuenta de origen fija |

`lead_days` adelanta la generación: el borrador del alquiler aparece 3 días antes. Un automático generado por adelantado espera en borrador y se confirma solo al llegar su fecha.

**Excepciones ("solo este evento").** Una ocurrencia se puede saltar, mover de fecha o cambiar de total sin tocar la plantilla; si tiene varias líneas, todas se escalan en la misma proporción. Cambiar la regla aplica desde la siguiente ocurrencia y borra las excepciones futuras, como "este y los siguientes" en Google Calendar.

**Tablas.** Tres tablas nuevas (plantilla, líneas, excepciones) y dos columnas en `account_move` que enlazan cada asiento con la ocurrencia que lo generó. Una plantilla con asientos generados no se borra: se marca terminada, como archivar en Odoo.

```sql
-- Plantilla y regla (como un evento repetido de calendario)
CREATE TABLE account_recurring (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,                             -- 'Alquiler'
  currency_id     smallint NOT NULL REFERENCES res_currency (id),
  -- Regla
  interval_type   text NOT NULL
                  CHECK (interval_type IN ('day', 'week', 'month', 'year')),
  interval_count  smallint NOT NULL DEFAULT 1 CHECK (interval_count >= 1),  -- cada N
  month_day_mode  text CHECK (month_day_mode IN ('days', 'nth_weekday')),
  month_days      smallint[],                                -- {15, 31}: 31 = último día
  weekday         smallint CHECK (weekday BETWEEN 1 AND 7),  -- ISO: 1 = lunes
  nth             smallint CHECK (nth IN (1, 2, 3, 4, -1)),  -- -1 = el último
  date_start      date NOT NULL,                             -- ancla de semanal y anual
  end_type        text NOT NULL DEFAULT 'never'
                  CHECK (end_type IN ('never', 'date', 'count')),
  date_end        date,
  max_count       integer CHECK (max_count >= 1),
  -- Comportamiento
  amount_type     text NOT NULL DEFAULT 'fixed'
                  CHECK (amount_type IN ('fixed', 'variable')),
  post_mode       text NOT NULL CHECK (post_mode IN ('auto', 'draft', 'reminder')),
  lead_days       smallint NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  state           text NOT NULL DEFAULT 'active'
                  CHECK (state IN ('active', 'paused', 'done')),
  generated_until date,                                      -- procesada hasta esta ocurrencia
  create_date     timestamptz NOT NULL DEFAULT now(),
  CHECK ((interval_type = 'month') = (month_day_mode IS NOT NULL)),
  CHECK (month_day_mode IS DISTINCT FROM 'days'
         OR (cardinality(month_days) > 0 AND 1 <= ALL (month_days) AND 31 >= ALL (month_days))),
  CHECK (month_day_mode IS DISTINCT FROM 'nth_weekday' OR (weekday IS NOT NULL AND nth IS NOT NULL)),
  CHECK ((end_type = 'date')  = (date_end IS NOT NULL)),
  CHECK ((end_type = 'count') = (max_count IS NOT NULL))
);

-- Modo por defecto: monto fijo → auto, monto variable → draft
CREATE FUNCTION trg_recurring_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.post_mode := coalesce(NEW.post_mode,
                            CASE NEW.amount_type WHEN 'fixed' THEN 'auto' ELSE 'draft' END);
  RETURN NEW;
END $$;

CREATE TRIGGER recurring_defaults BEFORE INSERT ON account_recurring
  FOR EACH ROW EXECUTE FUNCTION trg_recurring_defaults();

-- Líneas del molde, en la moneda de la plantilla: + debe, − haber
CREATE TABLE account_recurring_line (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recurring_id bigint NOT NULL REFERENCES account_recurring (id) ON DELETE CASCADE,
  account_id   bigint NOT NULL REFERENCES account_account (id),
  partner_id   bigint REFERENCES res_partner (id),
  name         text,
  amount       numeric(14,2) NOT NULL CHECK (amount <> 0)  -- estimado si es variable
);

-- El molde cuadra como un asiento: al menos 2 líneas que suman cero
CREATE FUNCTION trg_recurring_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id bigint := coalesce(NEW.recurring_id, OLD.recurring_id);
BEGIN
  IF EXISTS (SELECT 1 FROM account_recurring_line WHERE recurring_id = v_id
              GROUP BY recurring_id HAVING sum(amount) <> 0 OR count(*) < 2) THEN
    RAISE EXCEPTION 'La plantilla % no cuadra', v_id;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER recurring_balanced
  AFTER INSERT OR UPDATE OR DELETE ON account_recurring_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_recurring_balanced();

-- "Solo este evento": saltar, mover o cambiar el total de una ocurrencia
CREATE TABLE account_recurring_exception (
  recurring_id    bigint NOT NULL REFERENCES account_recurring (id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,                 -- la fecha que calculó la regla
  action          text NOT NULL CHECK (action IN ('skip', 'modify')),
  new_date        date,
  new_total       numeric(14,2) CHECK (new_total > 0),  -- suma del debe; las líneas se escalan
  PRIMARY KEY (recurring_id, occurrence_date),
  CHECK (action = 'skip' OR new_date IS NOT NULL OR new_total IS NOT NULL)
);

-- Cada asiento recuerda la ocurrencia que lo generó (como un número de serie)
ALTER TABLE account_move
  ADD COLUMN recurring_id   bigint REFERENCES account_recurring (id),
  ADD COLUMN recurring_date date,                -- fecha original, aunque se haya movido
  ADD UNIQUE (recurring_id, recurring_date),
  ADD CHECK ((recurring_id IS NULL) = (recurring_date IS NULL));
```

Las demás reglas del apunte (moneda de la cuenta, contacto obligatorio, cuadre) se validan al generar, con los mismos triggers de siempre. Un recordatorio puede no tener líneas; los modos `auto` y `draft` sí las necesitan.

**Calcular las fechas.** `account_recurring_dates` recorre la regla y devuelve la fecha de cada ocurrencia (`occurrence_date`, que también la identifica). No hay ajuste por feriados: si un mes la fecha cae domingo, se mueve esa ocurrencia. Las excepciones se aplican después, al generar.

```sql
-- El N-ésimo día de la semana del mes (p_nth = -1: el último); 1 = lunes
CREATE FUNCTION nth_weekday(p_month date, p_weekday int, p_nth int) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_nth > 0
    THEN f + (p_weekday - extract(isodow FROM f)::int + 7) % 7 + 7 * (p_nth - 1)
    ELSE l - (extract(isodow FROM l)::int - p_weekday + 7) % 7
  END
  FROM (SELECT date_trunc('month', p_month)::date AS f,
               (date_trunc('month', p_month) + interval '1 month - 1 day')::date AS l) m
$$;

-- Ocurrencias de una plantilla hasta p_until
CREATE FUNCTION account_recurring_dates(p_id bigint, p_until date)
RETURNS TABLE (occurrence_date date)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r account_recurring;
  k integer := 0;   -- número de periodo
  n integer := 0;   -- ocurrencias contadas (para end_type = 'count')
  p date;           -- inicio del periodo k
  d date;
BEGIN
  SELECT * INTO r FROM account_recurring WHERE id = p_id;
  LOOP
    p := CASE r.interval_type
           WHEN 'day'   THEN r.date_start + k * r.interval_count
           WHEN 'week'  THEN r.date_start + 7 * k * r.interval_count
           WHEN 'month' THEN (date_trunc('month', r.date_start)
                              + make_interval(months => k * r.interval_count))::date
           WHEN 'year'  THEN (r.date_start + make_interval(years => k * r.interval_count))::date
         END;
    EXIT WHEN p > p_until OR (r.end_type = 'date' AND p > r.date_end);
    FOR d IN
      SELECT c FROM (
        SELECT day_in_month(p, unnest(r.month_days)) AS c WHERE r.month_day_mode = 'days'
        UNION SELECT nth_weekday(p, r.weekday, r.nth)     WHERE r.month_day_mode = 'nth_weekday'
        UNION SELECT p                                     WHERE r.interval_type <> 'month'
      ) s WHERE c IS NOT NULL ORDER BY c
    LOOP
      CONTINUE WHEN d < r.date_start;
      IF d > p_until OR (r.end_type = 'date' AND d > r.date_end)
         OR (r.end_type = 'count' AND n >= r.max_count) THEN
        RETURN;
      END IF;
      n := n + 1;
      occurrence_date := d;
      RETURN NEXT;
    END LOOP;
    k := k + 1;
  END LOOP;
END $$;
```

**Generar.** `account_recurring_run` se llama al abrir la app (GET /me) y antes de mostrar recurrentes, y procesa todo lo pendiente desde `generated_until`. Siempre inserta en borrador y luego confirma, así el trigger de cuadre corre igual que con un asiento manual. Los céntimos de redondeo al convertir de moneda van a la línea más grande.

```sql
-- Corre por usuario: el programador fija app.user_id de cada uno antes de llamarla
CREATE FUNCTION account_recurring_run(p_today date DEFAULT user_today())
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_lock   date := coalesce((SELECT lock_date FROM res_users WHERE id = current_user_id()), '-infinity');
  v_base   smallint := (SELECT currency_id FROM res_users WHERE id = current_user_id());
  r        account_recurring;
  o        record;
  v_move   bigint;
  v_date   date;
  v_rate   numeric;
  v_factor numeric;
  v_diff   numeric;
  v_count  integer := 0;
BEGIN
  FOR r IN SELECT * FROM account_recurring
            WHERE state = 'active' AND post_mode <> 'reminder' FOR UPDATE
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM account_recurring_line WHERE recurring_id = r.id);
    FOR o IN
      SELECT d.occurrence_date, e.action, e.new_date, e.new_total
        FROM account_recurring_dates(r.id, p_today + r.lead_days) d
        LEFT JOIN account_recurring_exception e
               ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
       WHERE d.occurrence_date > coalesce(r.generated_until, '-infinity')
       ORDER BY d.occurrence_date
    LOOP
      IF o.action IS DISTINCT FROM 'skip' THEN
        -- En un periodo cerrado: primer día abierto, y queda en borrador
        v_date := greatest(coalesce(o.new_date, o.occurrence_date), v_lock + 1);

        INSERT INTO account_move (date, ref, state, recurring_id, recurring_date)
        VALUES (v_date, r.name, 'draft', r.id, o.occurrence_date)
        ON CONFLICT (recurring_id, recurring_date) DO NOTHING      -- nunca duplica
        RETURNING id INTO v_move;

        IF v_move IS NOT NULL THEN
          v_rate := get_rate(r.currency_id, v_date, rate_side((   -- el lado lo pone la cuenta de dinero
                      SELECT a.account_type FROM account_recurring_line l
                        JOIN account_account a ON a.id = l.account_id
                       WHERE l.recurring_id = r.id AND a.account_type IN ('asset', 'liability')
                       ORDER BY l.id LIMIT 1)));
          SELECT coalesce(o.new_total / sum(amount), 1) INTO v_factor
            FROM account_recurring_line WHERE recurring_id = r.id AND amount > 0;

          -- Cada apunte en la moneda de la plantilla si su cuenta la acepta;
          -- si no (una cuenta de gasto en soles), en la moneda base ya convertido
          INSERT INTO account_move_line
                 (move_id, account_id, partner_id, name, debit, credit, currency_id, amount_currency)
          SELECT v_move, l.account_id, l.partner_id, l.name,
                 greatest( round(l.amount * v_factor * v_rate, 2), 0),
                 greatest(-round(l.amount * v_factor * v_rate, 2), 0),
                 c.cur,
                 CASE WHEN c.cur = r.currency_id THEN round(l.amount * v_factor, 2)
                      ELSE round(l.amount * v_factor * v_rate, 2) END
            FROM account_recurring_line l
            JOIN account_account a ON a.id = l.account_id
            CROSS JOIN LATERAL (
              SELECT CASE WHEN a.currency_id IS NULL OR a.currency_id = r.currency_id
                          THEN r.currency_id ELSE v_base END AS cur) c
           WHERE l.recurring_id = r.id;

          -- Céntimos de redondeo: van a la línea más grande
          SELECT sum(balance) INTO v_diff FROM account_move_line WHERE move_id = v_move;
          IF v_diff <> 0 THEN
            UPDATE account_move_line SET
                   debit  = debit  - CASE WHEN debit  > 0 THEN v_diff ELSE 0 END,
                   credit = credit + CASE WHEN credit > 0 THEN v_diff ELSE 0 END,
                   amount_currency = CASE WHEN currency_id = v_base
                                          THEN amount_currency - v_diff ELSE amount_currency END
             WHERE id = (SELECT id FROM account_move_line WHERE move_id = v_move
                          ORDER BY abs(balance) DESC LIMIT 1);
          END IF;

          IF r.post_mode = 'auto' AND v_date <= p_today AND o.occurrence_date > v_lock THEN
            UPDATE account_move SET state = 'posted' WHERE id = v_move;
          END IF;
          v_count := v_count + 1;
        END IF;
      END IF;
      UPDATE account_recurring SET generated_until = o.occurrence_date WHERE id = r.id;
    END LOOP;
  END LOOP;

  -- Automáticas generadas por adelantado: se confirman al llegar su fecha
  UPDATE account_move m SET state = 'posted'
    FROM account_recurring t   -- otro alias: r ya es la variable del bucle
   WHERE m.recurring_id = t.id AND t.post_mode = 'auto' AND m.state = 'draft'
     AND m.date <= p_today AND m.date > v_lock AND m.recurring_date > v_lock;

  RETURN v_count;
END $$;
```

**Recordatorios y proyección.** Un recordatorio sigue pendiente hasta que lo marcas atendido, lo que solo avanza `generated_until`; nada se guarda. La proyección calcula las ocurrencias futuras al vuelo, como los eventos que el calendario muestra pero que aún no existen.

```sql
-- Recordatorios pendientes (marcar atendido = avanzar generated_until)
CREATE VIEW account_recurring_reminder AS
SELECT r.id AS recurring_id, r.name, d.occurrence_date,
       coalesce(e.new_date, d.occurrence_date) AS date
  FROM account_recurring r
  CROSS JOIN LATERAL account_recurring_dates(r.id, current_date + r.lead_days) d
  LEFT JOIN account_recurring_exception e
         ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
 WHERE r.state = 'active' AND r.post_mode = 'reminder'
   AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
   AND e.action IS DISTINCT FROM 'skip';

-- Flujo de caja futuro: lo que todavía no se generó, línea por línea
CREATE FUNCTION account_recurring_forecast(p_until date)
RETURNS TABLE (date date, recurring_id bigint, name text,
               account_id bigint, currency_id smallint, amount numeric)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(e.new_date, d.occurrence_date), r.id, r.name, l.account_id, r.currency_id,
         round(l.amount * coalesce(e.new_total / t.total, 1), 2)
    FROM account_recurring r
    CROSS JOIN LATERAL account_recurring_dates(r.id, p_until) d
    LEFT JOIN account_recurring_exception e
           ON e.recurring_id = r.id AND e.occurrence_date = d.occurrence_date
    JOIN account_recurring_line l ON l.recurring_id = r.id
    CROSS JOIN LATERAL (SELECT sum(amount) AS total FROM account_recurring_line
                         WHERE recurring_id = r.id AND amount > 0) t
   WHERE r.state = 'active'
     AND d.occurrence_date > coalesce(r.generated_until, '-infinity')
     AND e.action IS DISTINCT FROM 'skip'
$$;
```

**Casos borde.**

| Caso | Qué pasa |
| --- | --- |
| No abriste la app en semanas | Se generan todas las pendientes con su fecha original |
| La ocurrencia cae en un periodo cerrado | Borrador con fecha del primer día abierto; `recurring_date` guarda la original y no se confirma sola |
| El proceso corre dos veces | No duplica: `UNIQUE (recurring_id, recurring_date)` |
| Borraste un asiento generado | No vuelve: `generated_until` ya pasó esa fecha |
| Se paga con tarjeta | La línea abona la tarjeta y entra sola en su ciclo de corte |
| Préstamos y compras en cuotas | No son recurrencias: ya tienen su cronograma |
| Compra de dólares cada mes | No es recurrencia: una plantilla tiene una sola moneda y el tipo real varía |
| Borrar una plantilla con asientos | No se permite; se marca terminada |

## Casos de uso con SQL

Todo movimiento, sea saldo inicial, ingreso, gasto o transferencia, es la misma operación: una cabecera y dos o más líneas. Lo único que cambia es qué cuentas se tocan.

Cuentas de ejemplo:

```sql
INSERT INTO account_account (name, account_type, currency_id)
SELECT v.name, v.account_type, c.id
  FROM (VALUES ('BCP Ahorros',      'asset',     'PEN'),
               ('Interbank Sueldo', 'asset',     'PEN'),
               ('Efectivo',         'asset',     'PEN'),
               ('Visa BBVA',        'liability', NULL),   -- multimoneda
               ('Saldos iniciales', 'equity',    'PEN'),
               ('Sueldo',           'income',    'PEN'),
               ('Comida',           'expense',   'PEN'),
               ('Transporte',       'expense',   'PEN')
       ) AS v (name, account_type, currency)
  LEFT JOIN res_currency c ON c.name = v.currency;
```

Secuencia de octubre 2026 y sus líneas (S/):

| Fecha | Caso | Débito: va a | Crédito: viene de | Monto | ¿Es ingreso o gasto? |
| --- | --- | --- | --- | --- | --- |
| 01-oct | Saldo inicial | BCP Ahorros | Saldos iniciales | 1,500.00 | No |
| 02-oct | Ingreso | Interbank Sueldo | Sueldo | 4,000.00 | Ingreso |
| 03-oct | Transferencia | BCP Ahorros | Interbank Sueldo | 1,000.00 | No |
| 04-oct | Retiro en cajero | Efectivo | BCP Ahorros | 200.00 | No |
| 05-oct | Gasto en efectivo | Comida | Efectivo | 35.00 | Gasto |
| 06-oct | Gasto con tarjeta | Comida | Visa BBVA | 120.00 | Gasto |
| 07-oct | Pago de tarjeta | Visa BBVA | Interbank Sueldo | 120.00 | No |

De siete movimientos, solo tres son ingresos o gastos. Las transferencias, el retiro y el pago de tarjeta solo cambian el dinero de tanque.

Plantilla: la transferencia del 03-oct. Cabecera y líneas van en una sola sentencia con un CTE, así nunca queda una cabecera sola.

```sql
BEGIN;

WITH m AS (
  INSERT INTO account_move (date, ref, state)
  VALUES ('2026-10-03', 'Transferencia Interbank -> BCP', 'posted')
  RETURNING id
)
INSERT INTO account_move_line (move_id, account_id, debit, credit,
                               currency_id, amount_currency)
SELECT m.id, a.id, v.debit, v.credit,
       a.currency_id, v.debit - v.credit   -- cuentas en soles
  FROM m,
       (VALUES ('BCP Ahorros',      1000.00, 0),        -- va a
               ('Interbank Sueldo', 0,       1000.00)   -- viene de
       ) AS v (account, debit, credit)
  JOIN account_account a ON a.name = v.account;

COMMIT;  -- aquí corre el trigger de cuadre
```

Los otros casos usan la misma plantilla cambiando fecha, descripción y las dos filas de `VALUES` según la tabla.

## Consultas: saldos y libro mayor

El saldo de una cuenta es la suma de sus líneas, con el signo de su lado normal. Una vista lo calcula para todas las cuentas a la vez.

```sql
CREATE VIEW account_balance AS
SELECT a.id, a.display_name, a.account_type,
       COALESCE(SUM(l.debit), 0)  AS total_debit,
       COALESCE(SUM(l.credit), 0) AS total_credit,
       CASE a.normal_side
         WHEN 'D' THEN COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
         ELSE          COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0)
       END AS balance                                -- en moneda base
  FROM account_account_v a
  LEFT JOIN (account_move_line l
             JOIN account_move m ON m.id = l.move_id
                                AND m.state = 'posted')  -- solo confirmados
         ON l.account_id = a.id
 GROUP BY a.id, a.display_name, a.account_type, a.normal_side;
```

Saldos tras los siete movimientos del ejemplo (S/):

| Cuenta | Tipo | Saldo |
| --- | --- | --- |
| Interbank Sueldo | Activo | 2,880.00 |
| BCP Ahorros | Activo | 2,300.00 |
| Efectivo | Activo | 165.00 |
| Visa BBVA | Pasivo | 0.00 |
| Saldos iniciales | Patrimonio | 1,500.00 |
| Sueldo | Ingreso | 4,000.00 |
| Comida | Gasto | 155.00 |

Comprobación de la ecuación contable: activos 5,345 = pasivos 0 + patrimonio 1,500 + (ingresos 4,000 − gastos 155).

Libro mayor de una cuenta, con saldo acumulado (como un estado de cuenta bancario):

```sql
SELECT m.date, m.ref, l.debit, l.credit,
       SUM(l.balance)
         OVER (ORDER BY m.date, m.id, l.id) AS running_balance
  FROM account_move_line l
  JOIN account_move m    ON m.id = l.move_id
  JOIN account_account a ON a.id = l.account_id
 WHERE a.name = 'BCP Ahorros'
   AND m.state = 'posted'
 ORDER BY m.date, m.id, l.id;
```

Para cuentas de lado normal crédito (pasivo, patrimonio, ingreso) el acumulado se invierte: `-SUM(l.balance)`.

Total de una cuenta padre (por ejemplo Comida = Restaurantes + Supermercado): un CTE recursivo junta a cada cuenta con todas sus descendientes y suma sus saldos.

```sql
WITH RECURSIVE tree AS (
  SELECT id AS root_id, id FROM account_account
  UNION ALL
  SELECT t.root_id, a.id
    FROM tree t
    JOIN account_account a ON a.parent_id = t.id
)
SELECT r.display_name, r.account_type, SUM(b.balance) AS total
  FROM tree t
  JOIN account_account_v r ON r.id = t.root_id
  JOIN account_balance b   ON b.id = t.id
 GROUP BY r.id, r.display_name, r.account_type
 ORDER BY r.account_type, r.display_name;
```

## Arquitectura

El dominio está diseñado; falta definir cómo se ejecuta, en este orden: requisitos no funcionales, dónde vive la lógica, casos de uso, puertos, adaptadores y, al final, tecnologías. Las tecnologías se eligen para cumplir lo anterior, no al revés.

**Requisitos no funcionales.**

| Requisito | Definido | Consecuencia |
| --- | --- | --- |
| Usuarios | Varios, cada uno con su cuenta y sus datos; no se conectan entre sí | Un libro por usuario, aislado; solo los catálogos y el tipo de cambio son compartidos |
| Dispositivos | Cualquiera: PC, celular, tablet | Aplicación web que se adapta a la pantalla |
| Conexión | Siempre en línea, como Odoo; sin modo offline | Sin sincronización ni conflictos entre dispositivos |
| Dónde viven los datos | Solo en el servidor | Una sola base es la fuente de verdad; el proveedor se elige con la tecnología |
| Acceso | Correo y contraseña; otras formas de entrar, después | res\_users con login y huella de contraseña; recuperación por enlace de un solo uso |
| Respaldos | Uno diario de la base y los adjuntos, guardados 30 días | En un desastre se pierde como máximo un día |
| Caídas | La app avisa «sin conexión, reintenta» | Cada operación es una transacción: nada queda a medias |

**Dónde vive la lógica: en ambos lados, como Odoo.** Odoo pone la lógica en Python y deja a la base las restricciones declarativas (`_sql_constraints`, llaves foráneas). PPM hace lo mismo, con una sola diferencia: el cuadre y el cierre de periodo también quedan como triggers, porque un descuadre en dinero es el error que nunca debe pasar.

| Va en la base | Va en la aplicación |
| --- | --- |
| Estructura: llaves foráneas, `UNIQUE`, `CHECK`, `NOT NULL`, columnas generadas | Procesos: generar recurrentes, importar extractos, conciliar, clasificar, configuración inicial |
| Invariantes críticos: cuadre del asiento, periodo cerrado, cuentas de sistema | Cálculos: tipo de cambio aplicable, fechas de corte y vencimiento, calendario de cuotas |
|  | Validaciones con mensaje para el usuario, antes de llegar a la base |

Las funciones SQL del documento (`account_recurring_run`, `import_statement_line`, `setup_user`, `get_rate`…) quedan como especificación exacta de esos procesos: la aplicación los implementa con el mismo comportamiento.

**Varios usuarios en una base.** Todos comparten una sola base de PostgreSQL. Las tablas de cada usuario llevan `user_id`, y la seguridad por fila (RLS) hace que cada sesión lea y escriba solo sus filas. Es un archivo con portero: cada carpeta lleva el nombre de su dueño y el portero solo te entrega las tuyas, aunque la app pida otra por error.

**Quién eres en cada sesión.** Al iniciar sesión, la app fija `app.user_id` en cada transacción (`SET LOCAL app.user_id = 42`), como el `env.uid` de Odoo, y `current_user_id()` lo lee. Las columnas `user_id` lo toman por defecto, así que los INSERT de las funciones no cambian, y sus consultas ya ven solo las filas del usuario. La app se conecta con un rol sin privilegios (`ppm_app`) que no puede saltarse la seguridad por fila; el importador y el administrador usan `ppm_admin`.

| Clase | Tablas | Quién escribe |
| --- | --- | --- |
| Globales, sin `user_id` | `res_country`, `res_lang`, `res_currency`, `res_currency_format`, `res_currency_rate`, `res_bank`, `account_account_type`, `account_account_template` | PPM (importador y administrador); los usuarios solo leen |
| El usuario | `res_users` (cada uno ve solo su fila), `res_users_currency` | El usuario |
| Cuentas y tarjetas | `account_account`, `res_partner_bank`, `account_credit_card`, `account_credit_card_cycle`, `account_installment_plan`, `account_installment_plan_line` | El usuario |
| Movimientos y contactos | `account_move`, `account_move_line`, `account_partial_reconcile`, `res_partner`, `account_tag`, `account_move_line_account_tag_rel` | El usuario |
| Recurrentes | `account_recurring`, `account_recurring_line`, `account_recurring_exception` | El usuario |
| Importación y adjuntos | `account_import_template`, `account_import_template_column`, `account_bank_statement`, `account_bank_statement_line`, `ir_attachment` | El usuario |

**`user_id` en todas, también en las hijas.** Cada apunte, línea o ciclo lleva `user_id`, y sus llaves foráneas son compuestas: `(move_id, user_id)` apunta a `account_move (id, user_id)`. Es la misma técnica que `(account_id, account_type)` en los subtipos: la base impide que un apunte cuelgue del asiento o de la cuenta de otro usuario. Odoo hace lo mismo con `company_id` en `account.move.line`.

| Restricción hoy | Pasa a |
| --- | --- |
| `account_account`: `UNIQUE NULLS NOT DISTINCT (parent_id, name, currency_id)` | `(user_id, parent_id, name, currency_id)`: dos personas pueden tener su «Efectivo» |
| `account_account.system_role UNIQUE` | `UNIQUE (user_id, system_role)`: cada uno tiene su «Por clasificar» |
| `account_tag.name UNIQUE` | `UNIQUE (user_id, name)` |
| `account_bank_statement_line.unique_import_id UNIQUE` | `UNIQUE (user_id, unique_import_id)` |
| `res_users.id smallint` | `integer`, para muchos usuarios |

**Monedas de cada uno.** `res_currency` es global, así que ya no tiene `active`: las monedas que usa cada persona van en `res_users_currency`. Si no, activar el dólar para uno lo activaría para todos.

**Adjuntos.** El almacén de archivos tiene una carpeta por usuario (`filestore/42/ab/ab12…`), como Odoo tiene un filestore por base. Borrar a un usuario es borrar su carpeta; la deduplicación por SHA-1 vale dentro de cada usuario.

```sql
-- Quién está en esta sesión (lo fija la app al autenticar)
CREATE FUNCTION current_user_id() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.user_id')::integer;   -- sin sesión: error, nunca "todos"
$$;

-- Monedas que usa cada persona (reemplaza res_currency.active)
CREATE TABLE res_users_currency (
  user_id     integer  NOT NULL DEFAULT current_user_id() REFERENCES res_users (id) ON DELETE CASCADE,
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  PRIMARY KEY (user_id, currency_id)
);

-- El patrón en cada tabla de usuario: la cabecera y su hija
ALTER TABLE account_move
  ADD COLUMN user_id integer NOT NULL DEFAULT current_user_id()
             REFERENCES res_users (id) ON DELETE CASCADE,
  ADD UNIQUE (id, user_id);                          -- destino de las FK compuestas

ALTER TABLE account_move_line
  ADD COLUMN user_id integer NOT NULL DEFAULT current_user_id(),
  ADD FOREIGN KEY (move_id, user_id)    REFERENCES account_move (id, user_id) ON DELETE CASCADE,
  ADD FOREIGN KEY (account_id, user_id) REFERENCES account_account (id, user_id);

-- Seguridad por fila: la misma regla en todas las tablas de usuario
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'res_users_currency', 'account_account', 'res_partner_bank', 'account_credit_card',
    'account_credit_card_cycle', 'account_installment_plan', 'account_installment_plan_line',
    'account_move', 'account_move_line', 'account_partial_reconcile', 'res_partner', 'account_tag',
    'account_move_line_account_tag_rel', 'account_recurring', 'account_recurring_line',
    'account_recurring_exception', 'account_import_template', 'account_import_template_column',
    'account_bank_statement', 'account_bank_statement_line', 'ir_attachment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);   -- también para el dueño
    EXECUTE format('CREATE POLICY own_rows ON %I USING (user_id = current_user_id())
                    WITH CHECK (user_id = current_user_id())', t);
  END LOOP;
END $$;

ALTER TABLE res_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_row ON res_users USING (id = current_user_id());

-- Globales: los usuarios solo leen; PPM mantiene
GRANT SELECT ON res_country, res_lang, res_currency, res_currency_format, res_currency_rate,
                res_bank, account_account_type, account_account_template TO ppm_app;
ALTER ROLE ppm_admin BYPASSRLS;   -- importador y administración
```

**Inicio de sesión.** Con correo y contraseña, o con Google (ver la decisión «Entrar con Google»). Sigue a `auth_signup` de Odoo: el correo es el `login`, la contraseña se guarda como huella Argon2id y nunca en claro, y la recuperación es un enlace de un solo uso que vence en 1 hora. De ese enlace se guarda la huella, como una llave de la que solo se archiva el molde. Por ahora no se exige verificar el correo antes de usar la app; la contra es que, si alguien escribe mal su correo, no podrá recuperar su contraseña. La sesión dura hasta 30 días sin uso y se puede cerrar en todos los dispositivos.

**Zona horaria.** Cada usuario tiene su `tz`, como en Odoo. «Hoy» es el día en su zona y no el del servidor: a las 8 p. m. en Lima el servidor, en UTC, ya está en el día siguiente. `user_today()` lo calcula, y donde el SQL de un usuario dice `current_date` se lee `user_today()`.

```sql
ALTER TABLE res_users
  ADD COLUMN login             text NOT NULL,                 -- el correo
  ADD COLUMN password          text,                          -- huella Argon2id; vacía si entra solo con Google (0032)
  ADD COLUMN email_verified_at timestamptz,                   -- verificar se exigirá más adelante
  ADD COLUMN tz                text NOT NULL DEFAULT 'America/Lima',  -- zona IANA
  ADD COLUMN ui_theme          text NOT NULL DEFAULT 'system'
                               CHECK (ui_theme IN ('system', 'light', 'dark')),     -- Ajustes › Apariencia
  ADD COLUMN ui_accent         text NOT NULL DEFAULT 'tinta'
                               CHECK (ui_accent IN ('tinta', 'trigo', 'morado', 'azul')),  -- paleta cerrada
  ADD COLUMN active            boolean NOT NULL DEFAULT true,
  ADD COLUMN create_date       timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX res_users_login ON res_users (lower(login));   -- un correo, una cuenta

-- Enlaces de un solo uso: recuperar la contraseña (y verificar el correo, cuando se active)
CREATE TABLE res_users_token (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES res_users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('reset', 'verify')),
  token_hash  text NOT NULL UNIQUE,                           -- la huella del enlace, no el enlace
  expires_at  timestamptz NOT NULL,                           -- reset: 1 hora
  used_at     timestamptz                                     -- un solo uso
);

-- El día de hoy en la zona del usuario
CREATE FUNCTION user_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE (SELECT tz FROM res_users WHERE id = current_user_id()))::date;
$$;
```

**Respaldos.** Uno diario de la base y de los adjuntos, guardados 30 días. Si hay un desastre se pierde como máximo un día. Si el servidor se cae, la app muestra «sin conexión, reintenta» y nada queda a medias, porque cada operación es una sola transacción.

**Puertos y adaptadores.** El puerto es el enchufe de la pared, la forma que exige la lógica; el adaptador es el aparato que se conecta. Se cambia el aparato y la pared ni se entera, como al cambiar de servidor de correo en `ir.mail_server` de Odoo. La lógica solo conoce los puertos.

| # | Puerto: lo que pide la lógica | Adaptador elegido | Para después |
| --- | --- | --- | --- |
| 1 | Libro: guardar y leer en una transacción con el usuario de la sesión | PostgreSQL con seguridad por fila | — |
| 2 | Fuente del tipo de cambio: el tipo de hoy (fecha, compra, venta) | Archivo de SUNAT; el formulario del administrador como respaldo | Otra fuente oficial, si SUNAT cambia el archivo |
| 3 | Lector de extractos: las filas de un archivo | Lector de Excel (.xls, .xlsx) y CSV; el mapeo de columnas es lógica | — |
| 4 | Almacén de adjuntos: guardar, leer y borrar por huella | Disco del servidor, una carpeta por usuario, como el filestore de Odoo | Almacenamiento de objetos S3; el hosting debe dar disco que persista |
| 5 | Correo saliente: enviar un mensaje (recuperar contraseña) | SMTP, con cualquier proveedor | — |
| 6 | Contraseñas: crear y comprobar la huella | Argon2id (recomendación de OWASP); la librería, con la tecnología | — |
| 7 | Reloj: qué día es hoy para el usuario | Reloj del sistema con `res_users.tz`; en las pruebas, un reloj fijo | — |
| 8 | Programador de tareas: ejecutar algo cada día | Programador del servidor, como `ir.cron`: SUNAT, limpieza de adjuntos, respaldo | — |

**Tecnologías.** Se eligen para cumplir lo anterior.

| Pieza | Elegido | Condición o pendiente |
| --- | --- | --- |
| Base de datos | PostgreSQL 18, sin pgvector | `pg_trgm` (búsqueda por similitud de texto) cuando se necesite; pgvector solo si llega algo que lo pida |
| Hosting | Cualquiera donde se pueda montar | Debe dar PostgreSQL 18, disco que persista, correo SMTP saliente y tareas programadas |
| Lenguaje y framework del servidor | Python + FastAPI | Pydantic solo en la API, dataclasses con Decimal en la lógica; SQL directo con psycopg 3, sin ORM; migraciones en archivos SQL numerados |
| Interfaz web | React, como app aparte que usa la API de FastAPI | TypeScript con Vite; shadcn/ui + Tailwind CSS con tema oscuro y claro; Material Symbols; Recharts (gráficos de shadcn); TanStack Query; React Hook Form + Zod; tipos generados desde la API de FastAPI (OpenAPI); React Router; instalable como PWA, siempre en línea |

**Casos de uso (propuesta para editar).** Cada caso es una acción completa de la app, con su entrada, sus reglas y su resultado; casi siempre se vuelve un botón o un formulario. Están agrupados por módulo y el código lleva el prefijo del módulo, para agregar más sin renumerar. "Sistema" significa que lo dispara un proceso programado, no una persona. Los marcados como nuevo no salieron del diseño anterior: son sugerencias para que decidas.

**Usuario y configuración (CFG)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| CFG-01 | Crear cuenta de usuario | Registro con correo y contraseña; nace un libro vacío y aislado | Usuario |
| CFG-02 | Iniciar y cerrar sesión | Entrar a su propio libro y salir | Usuario |
| CFG-03 | Configuración inicial | Elige país (que fija la moneda base) y otras monedas; se crean las cuentas y categorías de la plantilla | Usuario, una vez |
| CFG-04 | Activar o desactivar monedas | Agregar USD, EUR… después de la configuración | Usuario |
| CFG-05 | Cambiar idioma y formato | Formato de montos y fechas (res\_lang) | Usuario |
| CFG-06 | Exportar mis datos (nuevo) | Descargar todo el libro en Excel o CSV, como respaldo propio | Usuario |
| CFG-07 | Eliminar mi cuenta (nuevo) | Borra el usuario y todo su libro | Usuario |

**Cuentas y categorías (CTA)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| CTA-01 | Crear cuenta de banco o efectivo | Con banco, número, CCI y saldo inicial en un solo paso | Usuario |
| CTA-02 | Crear tarjeta de crédito | Corte, línea y deuda actual; el vencimiento se copia de cada estado de cuenta | Usuario |
| CTA-03 | Crear préstamo de banco | Cuenta de pasivo con su saldo y, opcional, la recurrencia de la cuota | Usuario |
| CTA-04 | Crear o editar categoría | Cuenta de ingreso o gasto, con subcategorías, ícono y color; eliminar solo si está vacía | Usuario |
| CTA-05 | Renombrar, mover o archivar cuenta | Las cuentas de sistema solo se renombran | Usuario |
| CTA-06 | Ver mis cuentas y saldos | Saldo por cuenta y por moneda, con su valor en soles | Usuario |
| CTA-07 | Fusionar categorías | Pasa movimientos y recurrencias de una categoría a otra del mismo tipo y la elimina | Usuario |

**Movimientos (MOV)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| MOV-01 | Registrar gasto | De qué cuenta sale y en qué categoría; opcional: dividir con un contacto o pagar en cuotas | Usuario |
| MOV-02 | Registrar ingreso | Qué tipo de ingreso y a qué cuenta entra | Usuario |
| MOV-03 | Registrar transferencia o cambio de moneda | Entre tus cuentas; si cambia la moneda, registra el costo del cambio (o la ganancia) | Usuario |
| MOV-04 | Registrar reembolso | Abona la categoría del gasto original | Usuario |
| MOV-05 | Registrar asiento manual | Líneas libres de Debe y Haber, para casos raros | Usuario |
| MOV-06 | Editar o borrar movimiento | Corrige donde está, sin reversos; no en periodo cerrado | Usuario |
| MOV-07 | Confirmar o pasar a borrador | Solo lo confirmado cuenta en saldos | Usuario |
| MOV-08 | Etiquetar movimiento | Agrega o quita etiquetas | Usuario |
| MOV-09 | Adjuntar comprobante | Foto o PDF de la boleta | Usuario |
| MOV-10 | Buscar y filtrar movimientos | Por fecha, cuenta, categoría, etiqueta, contacto o texto | Usuario |
| MOV-11 | Usar otro tipo de cambio en un movimiento | Escribes la tasa real de la operación; vale solo para ese movimiento y no cambia el tipo de cambio del día | Usuario |

**Tarjetas (TAR)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| TAR-01 | Ver estado de la tarjeta | Último corte, vencimiento, a pagar, por facturar y línea disponible | Usuario |
| TAR-02 | Ver calendario de cuotas | Qué cuota toca en cada corte | Usuario |
| TAR-03 | Registrar cargos del estado de cuenta | Intereses, comisiones y seguros como los cobra el banco | Usuario |
| TAR-04 | Pagar la tarjeta | Transferencia de tu banco a la tarjeta, sugiriendo el monto a pagar | Usuario |

**Contactos y deudas (CON)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| CON-01 | Crear o editar contacto | Nombre, teléfono, correo | Usuario |
| CON-02 | Prestar o recibir prestado | Por cobrar o Por pagar con el contacto | Usuario |
| CON-03 | Cobrar o pagar una deuda | Se concilia sola con la deuda más antigua | Usuario |
| CON-04 | Ver quién me debe y a quién debo | Saldo por persona y antigüedad de cada deuda | Usuario |
| CON-05 | Dar por perdida una deuda | Pasa el saldo a Deudas incobrables | Usuario |
| CON-06 | Compensar deudas con un contacto | Si te debe y le debes a la misma persona, cancela ambas hasta el monto menor; solo queda la diferencia | Usuario |
| CON-07 | Guardar plata de otros | Entra a tu cuenta y queda en Plata que guardo de otros con la persona; devolverla o usarla por ella la baja | Usuario |

**Recurrentes (REC)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| REC-01 | Crear recurrencia | Gasto, ingreso, transferencia o cuota de préstamo, con su regla y su modo (automático, borrador o recordatorio) | Usuario |
| REC-02 | Editar regla o monto | Aplica desde la siguiente ocurrencia; lo generado no cambia | Usuario |
| REC-03 | Saltar o cambiar una ocurrencia | "Solo este evento": otra fecha u otro monto | Usuario |
| REC-04 | Pausar, reanudar o terminar | Pausar el gimnasio; terminar el préstamo pagado | Usuario |
| REC-05 | Generar recurrentes | Crea los asientos pendientes hasta hoy y confirma los automáticos | Sistema, cada día |
| REC-06 | Ver y atender recordatorios | Lista de pendientes; marcar como atendido | Usuario |
| REC-07 | Ver proyección | Lo que se viene en las próximas semanas o meses | Usuario |

**Importación de extractos (IMP)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| IMP-01 | Importar extracto | Sube el archivo, mapea columnas, descarta duplicados, empareja lo existente y el resto va a Por clasificar | Usuario |
| IMP-02 | Clasificar movimiento | Pasa una línea de Por clasificar a su categoría, cuenta o contacto | Usuario |
| IMP-03 | Ver extractos y control de saldo | Qué se importó y si el saldo cuadra con el banco | Usuario |
| IMP-04 | Deshacer una importación (nuevo) | Borra los asientos que creó ese extracto, si aún no se clasificaron | Usuario |

**Tipo de cambio (TC)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| TC-01 | Importar tipo de cambio del día | Trae el de SUNAT; si ese día ya tenía uno, lo reemplaza (manda el último) | Sistema, cada día |
| TC-02 | Corregir un día mal cargado | Reemplaza el del día, aunque venga de SUNAT (manda el último); corregirlo no cambia los movimientos ya registrados | Administrador de PPM |
| TC-03 | Ver estado del tipo de cambio | Avisa si está desactualizado más de 3 días | Administrador de PPM |
| TC-04 | Elegir compra o venta según la cuenta | Compra para lo que tienes (bancos, efectivo, por cobrar); venta para lo que debes (tarjetas, préstamos, por pagar) | Sistema, en cada movimiento |

**Cierre de periodo (CIE)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| CIE-01 | Cerrar periodo | Bloquea todo hasta una fecha; no deja cerrar con borradores pendientes | Usuario |
| CIE-02 | Reabrir periodo | Mueve la fecha de cierre hacia atrás o la quita | Usuario |

**Reportes (REP)**

| Código | Caso de uso | Qué hace | Lo dispara |
| --- | --- | --- | --- |
| REP-01 | Ver resumen | Cuánto tengo, cuánto debo y mi patrimonio a una fecha | Usuario |
| REP-02 | Ver ingresos y gastos | Por categoría y periodo, con totales por grupo | Usuario |
| REP-03 | Ver movimientos de una cuenta | Libro mayor con saldo acumulado | Usuario |
| REP-04 | Ver gasto por etiqueta | Cuánto costó el viaje, por categoría | Usuario |
| REP-05 | Ver diferencia de cambio | Ganancia o pérdida no realizada de lo que tienes en dólares | Usuario |

Fuera de alcance por ahora: presupuesto, edad del dinero y reglas por comercio (ver preguntas abiertas).

**Cómo los ve el usuario.** La app opera con partida doble, pero la persona nunca necesita saber contabilidad: cada caso de uso se presenta como una acción de la vida diaria, y la app arma el asiento por dentro. El simulador muestra el Debe y el Haber porque es un laboratorio; la interfaz final no.

| La persona toca | Qué hace la app por dentro |
| --- | --- |
| Gasté | Categoría de gasto contra la cuenta con la que pagó |
| Recibí dinero (sueldo, venta) | Tu cuenta contra la categoría de ingreso |
| Moví dinero entre mis cuentas | Transferencia; si cambia la moneda, registra el costo del cambio (o la ganancia) |
| Me devolvieron | Reembolso: abona la categoría del gasto original |
| Pagamos a medias | Gasto dividido: tu parte a la categoría, la del otro a Por cobrar |
| Pagué mi tarjeta | Transferencia del banco a la tarjeta |
| Pagué la cuota del préstamo | Interés y seguro a gasto, capital a la deuda |
| Presté dinero | Tu cuenta contra Por cobrar, con la persona |
| Me prestaron | Por pagar contra tu cuenta, con la persona |
| Me pagaron lo que me debían | Por cobrar contra tu cuenta |
| Pagué lo que debía | Tu cuenta contra Por pagar |
| Alguien pagó por mí | Gasto pagado con Por pagar, con la persona |
| Quedamos a mano | Compensación entre Por cobrar y Por pagar por el monto menor |
| No me va a pagar | Por cobrar contra Deudas incobrables |
| Ya tenía este saldo | Saldo inicial contra Saldos iniciales |

**Palabras.** La interfaz no usa términos contables:

| En el modelo | En la app |
| --- | --- |
| Activo / Pasivo | Lo que tengo / Lo que debo |
| Patrimonio | Lo que realmente tengo (neto) |
| Asiento, apunte | Movimiento |
| Borrador | Por confirmar |
| Por cobrar / Por pagar | Me deben / Debo |
| Conciliación | No se muestra: ocurre sola |
| Debe / Haber | No se muestra: "sale de" y "entra a" |
| Diferencia de cambio | Costo del cambio / Ganancia por tipo de cambio |

Esto es la base para la pregunta abierta de cómo se ve cada tipo de cuenta en la interfaz.

- [x] Dónde vive la lógica: en ambos lados, como Odoo
- [x] Casos de uso: los 58 aprobados
- [x] Varios usuarios en una base: user\_id y seguridad por fila
- [x] Requisitos que faltan: inicio de sesión y recuperación de contraseña, respaldos, caídas del servidor
- [x] Puertos y adaptadores
- [x] Tecnologías

## Interfaz

**Mapa de pantallas (aprobado el 25 oct 2026).** PPM tiene 22 pantallas y cada uno de los 58 casos de uso vive en al menos una. Se navega con una barra inferior de cinco botones (Inicio, Movimientos, **+**, Cuentas, Más); en una pantalla ancha, la misma barra pasa a ser un menú lateral. El **+** abre Registrar desde cualquier lugar, porque registrar un gasto es lo que más se hace.

| Sección | Pantalla | Qué se hace ahí | Casos de uso |
| --- | --- | --- | --- |
| Acceso | A1 · Entrar o crear cuenta | Correo y contraseña; recuperar la contraseña | CFG-01, CFG-02 |
| Acceso | A2 · Configuración inicial | Asistente de 3 pasos: país y moneda, otras monedas, primeras cuentas con su saldo | CFG-03, CTA-01 |
| Inicio | I1 · Inicio | Lo que realmente tengo, el mes, ahorro, avisos, cuentas y últimos movimientos | REP-01, REC-06 |
| + | R1 · Registrar | Gasto, ingreso o transferencia; en «más»: reembolso, préstamo a o de alguien, cobrar o pagar una deuda, guardar o devolver plata de otros, asiento manual. Cuotas, dividir, etiquetas, adjunto y otro tipo de cambio | MOV-01 a MOV-05, MOV-08, MOV-09, MOV-11, CON-02, CON-03, CON-07 |
| Movimientos | M1 · Movimientos | Lista por día con búsqueda y filtros; al filtrar por etiqueta muestra el total | MOV-10, REP-04 |
| Movimientos | M2 · Detalle de un movimiento | Ver, editar o borrar; confirmar o pasar a por confirmar; etiquetas y adjuntos | MOV-06 a MOV-09 |
| Movimientos | M3 · Por clasificar | La bandeja: elegir en qué, de qué cuenta o con quién, uno por uno o varios a la vez | IMP-02 |
| Cuentas | C1 · Mis cuentas | Lo que tengo y lo que debo, con el valor en soles de lo que está en dólares | CTA-06, REP-05 |
| Cuentas | C2 · Detalle de cuenta | Saldo, movimientos con saldo acumulado, renombrar o archivar, importar extracto | REP-03, CTA-05 |
| Cuentas | C3 · Detalle de tarjeta | Ciclo actual, a pagar, por facturar, línea disponible, cuotas, cargos del banco y pagar | TAR-01 a TAR-04 |
| Cuentas | C4 · Detalle de préstamo | Saldo, cuotas pagadas y la recurrencia de la cuota | CTA-03 |
| Cuentas | C5 · Nueva cuenta | Elegir qué es (banco o efectivo, tarjeta, préstamo) y llenar solo lo de ese tipo | CTA-01 a CTA-03 |
| Cuentas | C6 · Personas | Quién me debe y a quién debo; en cada persona: sus deudas, compensar o dar por perdida | CON-01, CON-04 a CON-07 |
| Cuentas | C7 · Importar extracto | Subir el archivo, mapear columnas, revisar el resultado; extractos anteriores y deshacer | IMP-01, IMP-03, IMP-04 |
| Más | X0 · Más | Menú hacia Mi cuenta, Recurrentes, Reportes, Categorías, Cierre, Ajustes y, solo para el administrador, Tipo de cambio | — |
| Más | X1 · Recurrentes | Lista, próximas, recordatorios y proyección; crear, editar, saltar una vez, pausar | REC-01 a REC-04, REC-06, REC-07 |
| Más | X2 · Reportes | En qué se va la plata, ingresos y gastos por periodo, patrimonio en el tiempo, flujo de dinero, por etiqueta, diferencia de cambio, y Personas: cuánto debo y quién me debe | REP-01, REP-02, REP-04, REP-05, CON-01 |
| Más | X3 · Categorías | Árbol con íconos y colores; crear, editar, mover, archivar, fusionar | CTA-04, CTA-05, CTA-07 |
| Más | X4 · Cierre de periodo | Cerrar hasta una fecha, solo si no queda nada por confirmar ni por clasificar; reabrir | CIE-01, CIE-02 |
| Más | X5 · Ajustes | Apariencia (tema y acento), monedas, idioma y formato | CFG-04, CFG-05 |
| Más | X6 · Mi cuenta | Exportar mis datos, cerrar sesión, eliminar mi cuenta | CFG-02, CFG-06, CFG-07 |
| Administración | Z1 · Tipo de cambio | Solo el administrador de PPM: estado del día y corrección | TC-02, TC-03 |
| Sin pantalla | — | Lo hace la app sola: generar recurrentes, traer el tipo de cambio, elegir compra o venta | REC-05, TC-01, TC-04 |

En el lienzo «Pantallas de PPM» están dibujadas I1, R1, M1 y C1, y las demás en bocetos grises. Personas (C6) va en Cuentas porque las deudas son plata que tienes o debes, y Reportes suma la vista Personas para verlas todas juntas. Recurrentes y Reportes van en Más para no pasar de cinco botones; por eso se agregó el menú Más (X0) como pantalla 22.

## Plan de construcción

Se construye por rebanadas, como una casa que se habita cuarto por cuarto: cada rebanada deja una parte de PPM usable con datos reales, y sus pantallas se diseñan en serio justo antes de programarla.

- **Código:** un repositorio privado en GitHub, `ppm`, con `api/` (migraciones SQL numeradas, FastAPI y pruebas) y `web/` (React), y Docker Compose con PostgreSQL 18 en la raíz; la web genera sus tipos del `/openapi.json` de la API.
- **Migraciones:** dbmate aplica los archivos `db/migrations/NNNN_nombre.sql` en orden y anota cuáles ya corrió.
- **Python:** uv instala las dependencias y fija sus versiones exactas en `uv.lock`.
- **Entrega:** cada paso va en una rama con su pull request; Dany lo revisa con las pruebas en verde y lo aprueba (merge).
- **Pruebas:** pytest contra un PostgreSQL 18 real; los 58 casos de uso se vuelven pruebas automáticas. En la web, pocas pruebas de los recorridos clave al inicio.
- **Entorno:** Docker Compose en la máquina de Dany (PostgreSQL 18, API y web con un comando) y GitHub Actions corre las pruebas en cada cambio.

Orden de las rebanadas:

1. Base: crear cuenta, iniciar sesión, configuración de 3 pasos, aislamiento por usuario
2. Cuentas con su saldo inicial (incluye Plata que guardo de otros)
3. Registrar gasto, ingreso y transferencia, y la lista de Movimientos
4. Inicio
5. Tipo de cambio y dólares, con el importador de SUNAT
6. Personas y las opciones de «Más» en Registrar
7. Tarjetas y cuotas
8. Importar extracto y Por clasificar
9. Ajustes a tarjetas y personas (8b): cuota con interés, prestar la tarjeta, vencimientos y calendario
10. Recurrentes y préstamos de banco
11. Pendientes: los avisos que PPM calcula y los recordatorios que escribes tú, en una bandeja
12. Reportes
13. Cierre de periodo

## Decisiones y preguntas abiertas

Doscientas cincuenta decisiones sostienen la fase 1; cada una puede revisarse antes de escribir código de la app.

| Decisión | Elegido | Alternativa descartada | Por qué |
| --- | --- | --- | --- |
| Montos | Columnas `debit` y `credit` | Un solo monto con signo | Más legible mientras aprendes; igual que Odoo. Se suma balance = debit − credit como columna generada |
| Ingresos y gastos | Son cuentas | Tabla de categorías aparte | Una sola tabla y una sola regla para todo movimiento |
| Saldo | Calculado desde las líneas | Columna de saldo en `account_account` | Una sola fuente de verdad; nunca se desincroniza |
| Cuadre | Trigger diferido en la BD | Validar solo en la app | Ninguna vía de escritura puede descuadrar |
| Saldo inicial | Transacción contra Saldos iniciales | Columna `initial_balance` | Todo queda en el historial |
| Monedas | Base PEN; cada línea guarda también amount\_currency (como Odoo) | Cuadre por moneda con cuenta puente | Todo cuadra y se reporta en soles; las cuentas en USD siguen en dólares |
| Jerarquía | Árbol con parent\_id; la hija hereda el tipo y solo las hojas reciben movimientos | Cuentas planas | Reportes por grupo (Comida) sin perder el detalle (Restaurantes) |
| Tipo de cambio | SUNAT del día como sugerencia, siempre editable; en cambios de moneda, el tipo real | Solo el tipo oficial | Reflejar lo que de verdad pagaste o recibiste |
| Diferencia de cambio | La realizada se registra; la no realizada solo se calcula en reportes | Asientos de revaluación cada mes | Mismo principio que el saldo: lo derivado se calcula, no se guarda |
| Nombre visible | display\_name calculado en una vista: nombre + ISO de la moneda entre paréntesis | Escribir la moneda dentro de name | name queda limpio y el nombre visible nunca se desincroniza de la moneda |
| Estados | Borrador y confirmada; solo las confirmadas cuentan y deben cuadrar | Todo se confirma al guardar | Pagos futuros e importaciones por revisar sin tocar los saldos |
| Corrección de errores | Editar (directo o pasando a borrador) o borrar | Asiento de reverso, como en Odoo | Nadie audita; un historial limpio vale más que el rastro del error |
| Cierre de periodo | Fecha de bloqueo en res\_users; reabrible; no se cierra con borradores | Sin bloqueo, todo editable siempre | Los saldos de meses ya revisados no cambian por accidente |
| Tarjetas | Una cuenta de pasivo multimoneda + tabla account\_credit\_card con corte, pago y línea | Columnas de tarjeta dentro de account\_account | account\_account sigue genérica y la tarjeta bimoneda queda en un solo lugar |
| Compras en cuotas | Cada cuota es gasto en el corte que la factura; hasta entonces espera en «Cuotas por venir» (0021) | Gasto completo el día de la compra | Elegido por Dany en 0021: el patrimonio no cambia hasta que el banco factura y el interés nunca da montos negativos |
| Intereses | No se calculan: se registran como los cobra el banco | Calcularlos con la TEA (método francés) | El banco ya los calcula, con seguros y redondeos que una fórmula no reproduce |
| Alta de cuentas | Funciones que crean cuenta, datos y saldo inicial en un paso | Crear la cuenta y luego el saldo a mano | Un solo paso para el usuario y nada queda a medias |
| Número de tarjeta | Solo los últimos 4 dígitos | Número completo | Basta para reconocerla y no expone la tarjeta si la base se filtra |
| Pago mínimo | No se maneja | Anotarlo desde el estado de cuenta | No aporta a la contabilidad y cada banco usa su fórmula |
| Cuentas multimoneda | Moneda en blanco = acepta cualquier moneda; solo activos y pasivos; nombre sin sufijo | Una cuenta por moneda | Una tarjeta bimoneda es un solo producto; los saldos por moneda se calculan agrupando |
| Subtipos de cuenta | Tabla base account\_account + res\_partner\_bank y account\_credit\_card 1 a 1, con FK (account\_id, account\_type) | Una sola tabla ancha | Sin columnas vacías por no aplicar; cada subtipo con sus propias restricciones |
| Bancos | Catálogo res\_bank; el CCI se valida contra el código de su banco | Nombre del banco como texto libre | Sin variantes escritas a mano y sin un CCI de otro banco |
| Monedas en tabla | res\_currency y currency\_id en todas las tablas; moneda base en res\_users | El código 'PEN' como texto en cada fila | Símbolo y decimales en un solo lugar; la moneda base no queda escrita en el código |
| Nombres de tablas | Estilo Odoo: account\_account, account\_move, account\_move\_line, res\_partner\_bank… | Nombres propios en inglés (accounts, transactions…) | Familiares para quien trabaja con Odoo |
| Tipos de cuenta | Los 5 grupos (asset, liability, equity, income, expense); si es banco o tarjeta lo dice su subtipo | account\_type detallado como Odoo (asset\_cash, liability\_credit\_card…) | Suficiente para finanzas personales; el detalle ya está en los subtipos y no se repite |
| Configuración | res\_users: tu usuario guarda la moneda base y la fecha de cierre | res\_company, como en Odoo | La app es personal: no hay empresa |
| Deudas entre personas | Cuentas Por cobrar y Por pagar (partner\_required) + partner\_id en el apunte | Una cuenta o un subtipo por persona | Un solo cuaderno de fiados: la persona es un dato del movimiento, no de la cuenta |
| Contactos | res\_partner, con país | El nombre de la persona en la descripción | Reporte de quién te debe y datos de contacto en un solo lugar |
| Países | res\_country; bancos y contactos con country\_id; tu país en res\_users | Asumir Perú en todo | El CCI depende del país |
| Conciliación | account\_partial\_reconcile; lo pendiente se calcula; automática de la deuda más antigua a la más nueva, manual opcional | Solo el saldo por persona | Ver cada deuda abierta y su antigüedad |
| Estándares | ISO 4217 (monedas), ISO 3166-1 (países), ISO 9362 (bancos); formato de montos por idioma como datos (res\_lang, res\_currency\_format); en es-PE el dólar es US$ | Un símbolo fijo por moneda | Datos cargables de fuentes oficiales; la base guarda el código ISO, no el símbolo |
| Configuración inicial | Elegir país y monedas; setup\_user activa monedas y crea cuentas desde account\_account\_template; los bancos vienen en el paquete del país | Cargar todo a mano | Como una localización de Odoo (l10n\_pe): listo para usar desde el primer día |
| Desacople de librerías | Reglas en el modelo; ISO y CLDR entran como datos; format\_amount como especificación del formato | Formatear con Intl u otra librería en la interfaz | La lógica no depende de un framework; cualquier capa da el mismo resultado |
| Fuente del tipo de cambio | Importador diario automático desde el archivo de SUNAT, con respaldo manual; manda el último que se cargó (SUNAT o a mano); sin dato se usa el último anterior (get\_rate); aviso a los 3 días | Solo carga manual | Siempre hay un tipo de cambio disponible sin trabajo diario, y la lógica no depende de SUNAT |
| Recurrencias | Plantilla account\_recurring con su regla; cada ocurrencia se genera como asiento real | Duplicar el último asiento cada periodo (auto\_post de Odoo) | La regla vive en un solo lugar y admite excepciones y proyección |
| Confirmación de recurrencias | Modo por plantilla (auto, draft, reminder); por defecto fijo → auto y variable → draft | Un solo modo para todas | Netflix no necesita revisión; la luz sí |
| Edición de recurrencias | Los cambios aplican desde la siguiente ocurrencia; un asiento generado y borrado no se regenera (generated\_until) | Regenerar todo con la regla nueva | Lo generado ya es un hecho, como una clase ya dictada |
| Datos demo | Capa propia que solo se carga en desarrollo, pruebas y el simulador | Cargarlos con la plantilla y marcarlos con is\_demo | Un tipo de cambio de muestra contaminaría get\_rate y los saldos; como en Odoo, se decide al crear la base |
| Categorías iniciales | Árbol general basado en Wallet, igual para todos los países | Plantilla de categorías por país | En qué se gasta es universal; lo local son los bancos |
| Cuentas de sistema | system\_role en account\_account; no se borran, archivan ni cambian de tipo | Buscarlas por nombre | La lógica no depende de un nombre que el usuario puede cambiar |
| Sin clasificar | Cuenta de activo multimoneda Por clasificar (suspenso de Odoo) | Categoría de gasto Otros, como Wallet | Sirve para entradas y salidas, y no cuenta como gasto hasta clasificar |
| Reembolsos | Abono a la categoría del gasto original | Categoría de ingreso Reembolsos, como Wallet | El gasto queda neto y los ingresos no se inflan, como una nota de crédito |
| Etiquetas | account\_tag en el apunte (many2many) | En el asiento | En una compra mixta solo se etiqueta la parte que corresponde, como la analítica de Odoo |
| Adjuntos | ir\_attachment polimórfica (res\_model, res\_id) y filestore por SHA-1 | Tabla de unión con llave foránea por cada registro | Un solo mecanismo para cualquier registro, como Odoo; la integridad la cuidan dos triggers |
| Naturaleza del gasto | No se modela | must, need y want como Wallet | Las etiquetas cubren el caso; se puede agregar después |
| Alcance de tarjetas | Corte, vencimiento y cuotas | Meses de gracia y disposición de efectivo | Lo mínimo indispensable; lo demás es raro y complica el modelo |
| Préstamos de banco | Cuenta de pasivo propia + recurrencia en borrador que se ajusta con la boleta | Cronograma calculado con la TEA o copiado fila por fila del banco | Lo mínimo indispensable: sin tablas nuevas, y los montos los manda el banco |
| Préstamos entre personas | Por cobrar o Por pagar con el contacto | Una cuenta por préstamo, como los del banco | Es una deuda informal y ya tiene conciliación y reporte de antigüedad |
| Formato de importación | Excel o CSV con mapeo genérico de columnas, recordado por cuenta | Un adaptador por banco; PDF del estado de cuenta | Sirve para cualquier banco sin programar nada, como la importación de Odoo |
| Destino de lo importado | Asiento confirmado contra Por clasificar | Bandeja previa fuera del libro | El saldo coincide con el banco al instante; reusa la cuenta de suspenso |
| Duplicados | unique\_import\_id: número de operación, o fecha + monto + descripción + orden | Revisarlos a mano | Se puede reimportar sin miedo, aunque los archivos se crucen |
| Emparejamiento | Mismo monto y cuenta a 3 días o menos; borradores recurrentes de dos líneas toman el monto del banco | Crear siempre un asiento nuevo | Ni lo manual ni las transferencias entre tus cuentas se duplican |
| Textos de una operación | Descripción del banco (payment\_ref, fija), glosa (account\_move.ref, editable) y número de operación | Un solo texto | Puedes renombrar sin perder lo que dijo el banco |
| Reglas por comercio | Todavía no | Clasificación automática desde el inicio | Primero hay que ver cómo describen los bancos las operaciones |
| Conexión y datos | Siempre en línea; los datos solo en el servidor, como Odoo | Copia local en cada dispositivo con sincronización | La sincronización y sus conflictos agregan mucha complejidad |
| Dónde vive la lógica | Procesos en la aplicación; estructura e invariantes críticos (cuadre, cierre, cuentas de sistema) en la base | Todo en la base o todo en la aplicación | Procesos fáciles de probar, y una red de seguridad donde un error costaría dinero |
| Ícono y color | Nombre de Material Symbols + índice de paleta (0 a 11); se heredan del padre; para todas las cuentas | Imagen subida por el usuario; color libre en hexadecimal | Liviano, uniforme y legible en ambos temas; la base solo guarda una clave |
| Eliminar categorías | Solo si está vacía; si no, archivar o fusionar con otra | Borrar con sus movimientos | Ningún movimiento queda huérfano, como en Odoo |
| Cambiar el tipo | Solo sin movimientos (trigger account\_type\_locked) | Siempre editable | Los reportes pasados no cambian de sentido |
| Cuentas con contacto | Solo Por cobrar y Por pagar, creadas en la configuración inicial; el formulario de cuentas no ofrece la opción | Casilla «Lleva contacto» al crear cualquier cuenta | Los dos cuadernos de fiados ya cubren todo; la casilla confundía y casi no se usaba |
| Fecha de pago de tarjetas | Se copia del estado de cuenta en cada ciclo (account\_credit\_card\_cycle) | Regla de pago por tarjeta (día fijo o N días tras el corte) con corrimiento por feriados | El banco ya la imprime; calcularla era complejidad sin beneficio |
| Feriados y días hábiles | No se modelan: las recurrentes usan días fijos o un día de la semana, y una ocurrencia se mueve a mano | Tabla de feriados llenada por una librería, con corrimiento al día hábil | Las fechas las dicta quien cobra o paga; mantener feriados por decreto no compensa |
| Compra o venta | Según la cuenta (rate\_side): compra para lo que tienes, venta para lo que debes | Venta para todo | El costo del cambio mide solo lo que cobra el intermediario; sigue la valorización de saldos usada en Perú |
| Nombre de la pérdida por cambio | «Costo del cambio» y «Ganancia por tipo de cambio» | «Pérdida por diferencia de cambio» | Quien no sabe contabilidad entiende que es lo que le cobraron por cambiar |
| Tipo de cambio de un movimiento | Vale solo para ese movimiento: queda en sus apuntes y no toca res\_currency\_rate, como en Odoo | Guardarlo como el tipo del día | La tasa de una casa de cambio es de esa operación; el día sigue con el de SUNAT o el cargado a mano |
| Marca de las cuentas de sistema | Columna system\_role en la cuenta, única por rol | Referencias desde la configuración del usuario, como las cuentas en res.company de Odoo | La lógica busca por rol; una columna evita mantener una referencia por cada cuenta especial y la base protege esas cuentas con un trigger |
| Aislamiento entre usuarios | Una sola base: user\_id en las tablas de cada usuario y seguridad por fila (RLS) de PostgreSQL | Una base o un esquema por usuario | Una migración para todos, altas instantáneas y catálogos compartidos; la base no entrega filas ajenas aunque la app tenga un error |
| Tipo de cambio global | Lo mantiene PPM (importador y administrador); los usuarios solo lo leen y usan su propia tasa por movimiento | Cada usuario con su propia tabla de tipos de cambio | Un solo importador sirve a todos y nadie tiene que cargar nada; la tasa por movimiento cubre los casos especiales |
| Dónde va user\_id | En todas las tablas de usuario, también las hijas, con llaves foráneas compuestas (id, user\_id) | Solo en las cabeceras (cuenta, asiento) | La regla de seguridad es la misma en todas y la base impide mezclar filas de dos usuarios |
| Monedas de cada usuario | Tabla res\_users\_currency | res\_currency.active | res\_currency es global: activar una moneda para uno la activaría para todos |
| Adjuntos con varios usuarios | Una carpeta por usuario en el almacén de archivos | Un almacén común deduplicado entre usuarios | Borrar a un usuario es borrar su carpeta; repetir una boleta entre dos personas no importa |
| Inicio de sesión | Correo y contraseña (huella Argon2id); recuperación por enlace de 1 hora y un solo uso | Entrar con Google u otras cuentas desde el inicio | Lo mínimo que funciona en cualquier lado; las integraciones se suman después sin cambiar el modelo |
| Verificar el correo | Por ahora no se exige | Verificar antes de usar la app | Se entra de inmediato; la contra es que un correo mal escrito no podrá recuperar la contraseña |
| Respaldos | Diario, de la base y los adjuntos, guardados 30 días | Recuperación al minuto (point-in-time) | Perder como máximo un día es aceptable para finanzas personales y es lo más simple |
| Almacén de adjuntos | Por ahora, disco del servidor con una carpeta por usuario | Almacenamiento de objetos S3 | Es lo más simple; como es un adaptador, pasar a S3 después no toca la lógica. El hosting debe dar disco que persista |
| Correo saliente | SMTP | La API propia de un proveedor | Es el estándar, como en Odoo: cambiar de proveedor es cambiar la configuración |
| Zona horaria | res\_users.tz y user\_today() | La hora del servidor | De noche, el servidor en UTC ya está en el día siguiente y una recurrente saldría un día antes |
| Base de datos | PostgreSQL 18, sin pgvector | PostgreSQL 17; pgvector desde el inicio | La 18 es la estable más nueva y tiene soporte hasta 2030; pgvector se agrega después con CREATE EXTENSION si hace falta |
| Hosting | Cualquiera que cumpla las condiciones; se elige al desplegar | Elegir el proveedor ahora | No cambia la lógica ni los adaptadores; basta con que dé PostgreSQL 18, disco persistente, SMTP y tareas programadas |
| Lenguaje y framework del servidor | Python + FastAPI | Django, TypeScript + NestJS, Odoo como framework, Rust | Es el lenguaje de Dany, no impone ORM y deja el SQL del documento como fuente de verdad; la velocidad de Rust no se notaría porque el tiempo se va en la red y la base |
| Validación de datos | Pydantic solo en la API; en la lógica, dataclasses con Decimal y date | Pydantic también en el dominio | La lógica no depende de librerías; cambiar FastAPI no la toca |
| Acceso a la base | SQL directo con psycopg 3; filtros variables con psycopg.sql | SQLModel u otro ORM; SQLAlchemy Core | El SQL del documento se usa tal cual, se ve lo que se ejecuta y se respetan triggers, seguridad por fila y FK compuestas |
| Migraciones | Archivos SQL numerados, escritos a mano a partir de este documento | Migraciones generadas desde el código (Alembic autogenerate) | El esquema solo cambia cuando lo decide Dany; es lo que falló en el PPM anterior |
| Interfaz web | React, como app aparte que usa la API de FastAPI | Páginas del servidor con Jinja y HTMX; Vue; Svelte | El ecosistema más grande de componentes finos, gráficos y animaciones, y la mayor cantidad de ayuda disponible |
| Lenguaje de la interfaz | TypeScript | JavaScript | Los tipos atrapan errores antes de ejecutar, como pyright en Python |
| Armado de la interfaz | Vite: archivos que descarga el navegador | Next.js | Next.js trae su propio servidor en Node; ya está FastAPI |
| Componentes y estilos | shadcn/ui + Tailwind CSS | MUI, Mantine | Los componentes quedan en el proyecto y se ajustan sin pelear; tema oscuro y claro de fábrica |
| Íconos de la app | Material Symbols en toda la app | Lucide | Son los mismos de las categorías: un solo estilo |
| Gráficos | Recharts, a través de los gráficos de shadcn | Apache ECharts | Hereda el tema y trae lo que PPM necesita, incluido el Sankey de flujo de dinero |
| Datos del servidor en la interfaz | TanStack Query | fetch a mano | Caché, refresco y estados de carga y error sin código propio |
| Formularios | React Hook Form + Zod | Formularios a mano | Valida antes de enviar y muestra el error junto al campo |
| Tipos entre API e interfaz | Generados desde OpenAPI de FastAPI | Escribirlos dos veces | Pydantic es la fuente de verdad de la API, como el SQL lo es de la base |
| Rutas entre pantallas | React Router | TanStack Router | El más conocido y documentado |
| Instalación en el celular | PWA instalable, siempre en línea | Solo página web | Se abre como app; no guarda datos en el teléfono |
| Color principal de la app | Tinta por defecto (negro en claro, blanco en oscuro), con grises neutros sin tinte; cada usuario elige su acento; el trigo queda fijo para la barra de ahorro | Un solo color fijo para todos (trigo, morado o azul) | Una base neutra se ve estándar y sobria, y cada persona le pone su color, como el acento de iOS o Android; elegido por Dany tras probar el trigo |
| Color de los avisos | Ámbar, como antes; se distingue del trigo por la forma: ícono y frase, nunca botón relleno | Azul, morado | Es el color que todos leen como «atención»; elegido por Dany al compararlo en pantalla |
| Acento elegible por el usuario | Paleta cerrada (tinta, trigo, morado, azul) en Ajustes › Apariencia, guardada en res\_users.ui\_accent junto con ui\_theme; los avisos no cambian | Cualquier color libre; guardarlo solo en el navegador | Verde, rojo y ámbar ya significan ingreso, gasto y aviso; en la cuenta se ve igual en todos los dispositivos |
| Navegación | Barra inferior de cinco botones: Inicio, Movimientos, +, Cuentas y Más; en pantalla ancha pasa a menú lateral | Seis o siete botones, con Recurrentes o Reportes en la barra | Cinco caben cómodos bajo el pulgar: lo de todos los días queda a un toque y lo del mes en Más; aprobado por Dany |
| Dónde van las personas | Personas (C6) dentro de Cuentas, y además una vista Personas en Reportes: cuánto debo y quién me debe | Una pestaña propia en la barra | Lo que me deben o debo es plata, como una cuenta más; el reporte da la foto de conjunto; pedido por Dany |
| Menú Más | Recurrentes y Reportes van en Más (X0, pantalla 22), junto a Mi cuenta, Categorías, Cierre, Ajustes y Tipo de cambio (solo administrador) | Ponerlos en la barra inferior | Se usan pocas veces al mes; aprobado por Dany |
| Cierre con pendientes | No se puede cerrar un periodo si en él quedan movimientos por confirmar o por clasificar | Solo avisar y dejar cerrar | Cerrar es sellar el cuaderno del mes; una hoja suelta quedaría fuera del sello y los saldos fijos estarían mal; elegido por Dany |
| Borrar categorías | Una categoría con movimientos no se borra: se archiva (no aparece al registrar y sus movimientos la conservan) | Borrarla y pasar sus movimientos a otra | No se pierde la historia de los reportes; para juntar dos queda fusionar; aprobado por Dany |
| Más tipos al registrar | Registrar tiene Gasto, Ingreso, Transferir y «Más»; Más abre un panel con: le presté a alguien, me prestaron, me pagaron lo que me debían, pagué lo que debía, me dio para guardar, le devolví o usé su plata, reembolso y asiento manual (avanzado). Cada opción usa el mismo formulario con sus campos; cuotas, dividir y otro tipo de cambio son interruptores que aparecen solo cuando aplican | Todos los tipos como pestañas visibles | Lo de todos los días queda a la vista y lo ocasional en un cajón aparte; aprobado por Dany |
| Plata que guardo de otros | Cuenta de pasivo propia en la plantilla (multimoneda, con persona, system\_role 'custody'); en Cuentas y Personas se lee «guardas», aparte de «debes»; en Registrar › Más se suma «Me dio para guardar», y devolver o pagar por ella baja el saldo | Registrarla en Por pagar como cualquier deuda | Contablemente es un pasivo (fondos de terceros), pero no un préstamo; separarla evita que infle lo que debes; elegido por Dany |
| Moneda base | Siempre la del país del usuario (Perú → soles); no se elige ni se cambia; setup\_user ya no recibe p\_currency | Dejar elegir otra moneda base (por ejemplo, llevar todo en dólares) | Es la moneda en que vives y en la que SUNAT da el tipo de cambio; evita invertir tasas; elegido por Dany |
| Con quién en Por clasificar | Al clasificar se puede elegir la persona (partner\_id del apunte): obligatoria si la cuenta la pide, opcional en una categoría | Clasificar solo la cuenta y poner la persona después, en el detalle | Un Yape a Juan casi siempre es un préstamo o un pago a alguien; se resuelve en un paso; elegido por Dany |
| Repositorio | Uno: ppm, con api/ (migraciones, FastAPI y pruebas) y web/ (React); Docker Compose en la raíz; la web genera sus tipos del /openapi.json de la API en el mismo CI | Dos repositorios (ppm-api y ppm-web), la decisión anterior | Con un solo dueño, dos repositorios obligaban a coordinar dos PR por cambio, a clonar la API en el CI de la web y a regenerar tipos a destiempo; cada carpeta puede salir a su propio repositorio con su historia si PPM crece; cambiada por Dany el 2026-10-25 |
| Orden de construcción | Por rebanadas, en el orden de Plan de construcción; el diseño final de cada pantalla se hace antes de su rebanada | Por capas: toda la base, luego toda la API, luego todas las pantallas | PPM se usa desde las primeras rebanadas y los errores salen temprano; elegido por Dany |
| Pruebas | pytest contra PostgreSQL 18 real; los 58 casos de uso como pruebas automáticas | Base simulada | Las reglas viven en la base (cuadre, aislamiento, cuentas de sistema); solo una base real las comprueba; elegido por Dany |
| Entorno de trabajo | Docker Compose local, código en GitHub y GitHub Actions en cada cambio | Instalar PostgreSQL y lo demás directo en la máquina | El entorno local es igual al del servidor y nada roto llega a la rama principal sin aviso; elegido por Dany |
| Migraciones | dbmate, con archivos SQL numerados (-- migrate:up / -- migrate:down) | Un script propio en Python | Herramienta madura y con deshacer; elegido por Dany |
| Sesión | Cookie httpOnly con un número al azar y tabla res\_users\_session (huella, vence a los 30 días) | JWT firmado, sin tabla | Como una pulsera con número en la lista de la puerta: se puede anular, y «cerrar sesión en todos lados» funciona al instante; elegido por Dany |
| Herramienta de Python | uv, con uv.lock | pip con requirements.txt | Rápida y con versiones exactas; elegido por Dany |
| Entrega de cada paso | Una rama y un pull request por paso; Dany aprueba con merge | Subir directo a la rama principal | El merge es la confirmación de Dany antes de avanzar; elegido por Dany |
| Con qué rol trabaja la API | Cada transacción hace SET LOCAL ROLE ppm\_app y fija app.user\_id (user\_transaction en app/db.py); ambas cosas se deshacen al terminar | Conectar directo como ppm\_app con su propia contraseña | El superusuario de la base se salta siempre la seguridad por fila; cambiarse de rol en cada transacción la activa sin manejar otra contraseña en desarrollo; tomada en el PR 2 |
| Nombre y configuración | El nombre se pide al crear la cuenta; setup\_user(p\_country, p\_other\_currencies, p\_lang, p\_tz) completa país, moneda base, idioma y zona; hasta entonces esos tres campos de res\_users quedan vacíos, juntos | Pedir el nombre en setup\_user | Coincide con las pantallas aprobadas (Crear cuenta y paso 1); tomada en el PR 2 |
| Código BIC del banco | text (8 u 11 caracteres) en lugar de char(11) | char(11) | char(11) rellena con espacios los BIC de 8 letras y la validación los rechazaba; error encontrado al migrar |
| Contraseñas | De 8 a 128 caracteres; si falla el correo o la contraseña, el mismo mensaje y el mismo tiempo de respuesta; cambiarla cierra las demás sesiones y recuperarla las cierra todas | Reglas de mayúsculas y símbolos; mensajes distintos por caso | La longitud protege más que los símbolos; no revelar qué correos tienen cuenta; tomada en el PR 3 |
| Duración de la sesión | 30 días fijos desde que inicias sesión; cookie ppm\_session httpOnly y SameSite=Lax | 30 días desde el último uso (se renueva sola) | Más simple y predecible; se puede pasar a renovable sin cambiar tablas; tomada en el PR 3 |
| Funciones de acceso | res\_users\_session y res\_users\_token solo se tocan con las funciones auth\_\* (SECURITY DEFINER); ppm\_app no tiene permisos directos sobre ellas | Seguridad por fila también en esas tablas | Se usan antes de saber quién es la persona (leer la cookie, iniciar sesión), cuando la regla por fila aún no tiene usuario; tomada en el PR 3 |
| Correo en desarrollo | Mailpit en Docker Compose atrapa los correos (http://localhost:8025); en producción, el mismo adaptador SMTP con otro servidor | Imprimir el enlace en el registro de la API | Se prueba el envío real por SMTP sin mandar nada fuera; tomada en el PR 3 |
| Cómo habla la web con la API | Mismo origen: la web llama a /api/… y un proxy lo reenvía a la API (Vite en desarrollo, el servidor web en producción) | Dominios separados con CORS y credenciales | La cookie de sesión funciona sola, sin CORS; elegido por Dany |
| Dónde corre la web en desarrollo | Dentro de Docker Compose, como la API; no se instala Node en la máquina | Node 22 instalado en WSL con nvm | Nada que instalar; si la recarga resulta lenta en WSL, se activa la vigilancia por sondeo de Vite; elegido por Dany |
| Gestor de paquetes de la web | pnpm | npm | Rápido y estricto: solo deja usar lo declarado; elegido por Dany |
| Tipos de la API en la web | openapi-typescript genera los tipos desde /openapi.json y openapi-fetch da el cliente; los hooks de TanStack Query se escriben a mano; el CI falla si los tipos generados no están al día | orval (genera también los hooks) | Poco código mágico; elegido por Dany |
| Diseño antes del código | Las pantallas de cada rebanada se diseñan en el lienzo (con el sistema de diseño, claro y oscuro) y se aprueban antes de programarlas; la primera tanda es Iniciar sesión, Crear cuenta y los 3 pasos | Programar desde los bocetos y ajustar en la app | Ajustar en el lienzo cuesta menos que en el código; elegido por Dany |
| Pruebas de la web | Vitest para componentes y Playwright para los recorridos clave contra la API real, levantada con Docker Compose en GitHub Actions | Solo Vitest con la API simulada | Detecta si web y API se desalinean; elegido por Dany |
| Paso 3 de la configuración en la rebanada 1 | Crea las primeras cuentas sin saldo; el campo de saldo de hoy se activa cuando la API tenga movimientos (el asiento contra «Saldos iniciales»). El diseño no cambia | Adelantar los saldos iniciales en la API antes de la web | Cierra la rebanada 1 completa y usable sin adelantar la de movimientos; elegido por Dany |
| Estilo de las pantallas de acceso | Dirección «Hacia mayo»: el refrán «Pan / para / mayo.» en grande (title-display) en Iniciar sesión y Crear cuenta, con el año a la vista; títulos grandes del mismo estilo en las demás; campos de una línea | Trigo (la marca llena la parte de arriba) o Libreta (una hoja de cuentas que cuadra) | La más memorable y con más aire; elegida por Dany |
| Papel del trigo | Sello de PPM, fijo: solo la palabra «mayo» del refrán y la barra «para mayo» del ahorro, como relleno con texto en on-trigo; nunca botones, enlaces ni texto pequeño. Las acciones van en el acento (tinta por defecto) | Trigo como color principal de las acciones | La tinta es con lo que se actúa y el trigo es la marca; usado poco y siempre igual, significa «esto es para mayo»; elegido por Dany |
| Dólares antes del importador de SUNAT | Desde la rebanada 2 hay cuentas en otras monedas; el saldo inicial pide el tipo de cambio de ese día (sugerencia fija 3.75 hasta la rebanada 5) | Solo cuentas en soles hasta la rebanada 5 | Quien marcó dólares en el paso 2 puede anotar su cuenta; el tipo de cambio ya era editable siempre; elegido por Dany |
| Fecha del saldo inicial | Hoy por defecto, editable (plegada bajo «Otra fecha») | Siempre hoy | Se puede empezar desde el 1 del mes y registrar lo de estos días; elegido por Dany |
| Persona en «Plata que guardo de otros» antes de Personas | Selector de persona con «+ Nueva persona» (solo el nombre) dentro del formulario; crea un res\_partner de verdad | Guardar sin persona hasta la rebanada 8 | No rompe partner\_required y la persona ya existe cuando llegue su pantalla; elegido por Dany |
| Montos en la API | Como texto decimal exacto ("1284.90"), desde Decimal en Python; la web solo los formatea | Números JSON | Nunca se pierde un céntimo por redondeo en JavaScript; elegido por Dany |
| Tipos en «Nueva cuenta» (rebanada 2) | Efectivo, banco (banco, tipo, número y CCI) y plata que guardo de otros; tarjeta y préstamo como «Muy pronto» | Tarjeta sin corte ni cuotas desde ya | Cada tipo llega completo en su rebanada, sin migrar después; elegido por Dany |
| Elegir de una lista | Campo de una línea que abre una hoja desde abajo con las opciones (nombre, ayuda corta y check en la elegida); sin logos ni iniciales de marcas. También en País, Idioma y Zona del paso 1 | El selector del navegador; iniciales del banco en un círculo | El selector nativo no sigue el sistema de diseño; elegido por Dany |
| Archivar una cuenta | Solo con saldo cero en todas sus monedas; las de sistema nunca | Archivar con saldo | Una cuenta archivada no aparece en los totales; con saldo, «lo que realmente tengo» mentiría; tomada en el PR de la API de la rebanada 2 |
| Íconos y colores de la plantilla | Cada categoría principal con su color de la paleta; cada subcategoría con su propio ícono y el color de su principal. Una migración los pone en la plantilla y en las cuentas existentes | Un ícono por grupo y un solo color | El color dice el grupo y el ícono qué es exactamente; elegido por Dany |
| Fecha futura al registrar | Con fecha futura queda por confirmar y no cuenta hasta confirmarlo; interruptor «Por confirmar» para cualquier fecha | Todo se confirma al guardar | Los saldos de hoy no incluyen plata que aún no se movió; elegido por Dany |
| Otras monedas en la rebanada 3 | Gasto o ingreso en otra moneda con tipo de cambio escrito (3.750 sugerido); transferencia entre monedas con los dos montos y el tipo de cambio implícito; la diferencia de cambio realizada llega en la rebanada 5 | Solo soles hasta la rebanada 5 | Las cuentas en dólares se usan desde ya y una transferencia guarda lo que de verdad se pagó; elegido por Dany |
| Alcance de Registrar en la rebanada 3 | Gasto, ingreso y transferencia, más «Dividir» en varias categorías; etiquetas y adjuntos en una rebanada corta propia; cuotas con Tarjetas | Todo junto, o solo lo simple | Lo que más se usa llega primero; dividir ya usa asientos de varias líneas; elegido por Dany |
| Lista de Movimientos | Por mes con selector arriba, días como separadores con su total, búsqueda y filtros por cuenta, categoría y tipo (gasto, ingreso, transferencia, por confirmar) | Lista infinita sin meses | Como se piensa la plata: por mes, con sus totales; elegido por Dany |
| Categorías de ingreso | Sueltas, sin subcategorías (10 en la plantilla), en verde | Agruparlas en Trabajo, Inversiones y Otros ingresos | Con pocas categorías, un grupo agrega un paso sin ganar claridad; cada quien puede agruparlas en Más › Categorías; elegido por Dany |
| Dividir un gasto con una persona | En la rebanada 8, junto con cobrarle y la pantalla de Personas | Adelantar solo dividir a la rebanada 3 | El ciclo de la deuda llega completo; una deuda que no se puede tachar confunde; elegido por Dany |
| Qué mide «para mayo» | Lo que entró menos lo que salió en el mes (solo confirmado) y qué parte de lo que entró es; en negativo, barra vacía y una frase sin dramatismo | Meta mensual propia; cuentas marcadas como de ahorro | Sale de lo que ya se registra, sin configurar nada; elegido por Dany |
| El mes en el Inicio | Selector de mes; «lo que realmente tengo» es siempre hoy; el mes cambia entró, salió, para mayo y en qué se va la plata | Siempre el mes actual | Mirar cómo fue otro mes sin esperar a Reportes; elegido por Dany |
| En qué se va la plata, en el Inicio | Las 3 categorías principales con más gasto del mes, con ícono, color, monto y barra proporcional | Solo en Reportes | Responde la pregunta de todos los días; elegido por Dany |
| «Más» en la rebanada 4 | Un Más mínimo con Mi cuenta (cerrar sesión, en todos lados, cambiar contraseña) y Apariencia (tema y acento); el resto aparece como «Muy pronto». El Inicio pasa a ser la primera pantalla | Cerrar sesión en el avatar del Inicio | Nada provisional que mover después; lo que la API ya tenía (contraseña, tema, acento) se usa; elegido por Dany |
| Cuándo se registra la diferencia de cambio realizada | Al cambiar de moneda: lo que sale de la cuenta en otra moneda sale a su costo promedio, y la diferencia con lo recibido va a «Ganancia por tipo de cambio» o «Costo del cambio» en el mismo movimiento. Gastos e ingresos en otra moneda van al tipo del día, sin diferencia | También en cada gasto en otra moneda; no registrarla nunca | Responde «¿gané o perdí al cambiar?» sin trabajo extra y sin una tercera línea en cada almuerzo; elegido por Dany |
| Cuánto valen los dólares en «lo que realmente tengo» | Al tipo de hoy (compra para lo que tienes, venta para lo que debes): «US$ 1,520 · son S/ 5,233.36 hoy». El valor en libros queda para reportes | Al valor de cuando entraron | Es lo que recibirías si cambias hoy y coincide con el banco; elegido por Dany |
| Fuente de euros y otras monedas | Dólares automáticos desde SUNAT; las demás monedas las carga a mano el administrador en Z1 | Una segunda fuente automática (SBS) | SUNAT solo publica dólares; casi nadie usa euros a diario y el formulario siempre deja escribir el tipo; elegido por Dany |
| Quién es el administrador | Lista de correos en la configuración del servidor (ADMIN\_EMAILS) | Columna is\_admin en res\_users | Nadie se vuelve administrador desde la app y no hay dato de permisos en la fila de la persona; elegido por Dany |
| Cuándo corre el importador de SUNAT | Una vez al día; si falla (sin respuesta o formato raro), hasta 5 reintentos. Escribe aunque el día se haya cargado a mano: manda el último que se cargó, como en Odoo. El administrador puede volver a corregirlo o traerlo de nuevo con «Traer de SUNAT ahora» | Revisar cada hora; no tocar los días cargados a mano | SUNAT publica un tipo al día; ya estaba decidido que manda el último que se cargó; elegido por Dany |
| Cómo se despliega | Una VPS con Docker Compose (docker-compose.prod.yml): PostgreSQL sin puertos publicados, la API en un solo proceso con el importador, y Caddy sirviendo la web y /api con HTTPS automático; respaldo diario con pg\_dump (14 días, copiar fuera del servidor). Guía en DESPLIEGUE.md y reglas para agentes en AGENTS.md | Nginx con certbot; una plataforma administrada (PaaS) | El mismo Docker que en desarrollo, un solo servidor barato y HTTPS sin configurar certificados; Dany pidió desplegar en una VPS |
| Orden: Personas antes que Tarjetas | La rebanada de Personas y las opciones de «Más» en Registrar (le presté, me prestaron, me pagaron, pagué) va sexta, antes de Tarjetas y de Importar extracto | Mantener el orden original (octava) | Dany necesita registrar préstamos para usar PPM con sus datos reales; no depende de tarjetas ni de extractos; elegido por Dany |
| Deudas con personas (rebanada 6) | Deuda por deuda: account\_partial\_reconcile, lo pendiente calculado y conciliación automática de la deuda más antigua a la más nueva; C6 muestra cada deuda abierta con su antigüedad | Solo el saldo por persona por ahora | Ya era el modelo aprobado (CON-03, CON-04) y evita rehacer C6 cuando llegue la conciliación; elegido por Dany |
| Devolver la plata que guardo | Una opción en Registrar › Más, «Le devolví o usé su plata», y un botón «Devolver» en el detalle de la persona | Dos opciones: «Le devolví su plata» y «Pagué algo con su plata» | Es el mismo movimiento con otra frase y el panel queda corto; elegido por Dany |
| Dividir y «alguien pagó por mí» | Entran en la rebanada 6: en Dividir una parte puede ser de otra persona (va a Me deben); en Gasto, «¿Quién pagó? Yo / Otra persona» (va a Debo) | Solo dividir, o ninguna de las dos | La cena a medias es la deuda más común y su ciclo queda completo; elegido por Dany |
| Líneas del asiento manual | Columnas «Entra a» y «Sale de», con la persona si la cuenta la pide y un aviso en vivo de cuánto falta para que cuadre | Debe y Haber literales | La app mantiene sus palabras aun en lo avanzado; elegido por Dany |
| Cobro o pago de más | No se permite: el monto llega hasta lo que se debe, y un aviso sugiere registrar el resto como «Me prestaron» o «Me dio para guardar» | Dejarlo y que lo de más quede como deuda al revés | Nunca queda un «me deben» en negativo ni se mezclan los dos cuadernos; elegido por Dany |
| Moneda del asiento manual | Solo en moneda base: cuentas en soles o multimoneda; las cuentas en dólares no se ofrecen | Cada línea con su moneda y su tipo de cambio | Es para casos raros; con varias monedas el cuadre se vuelve difícil de leer; tomada en el PR de la API de la rebanada 6 |
| Corregir una compensación o una deuda perdida | No se editan: se borran y se hacen de nuevo. Dar por perdido usa el valor en libros; compensar en dólares, el tipo de compra de hoy | Editarlas en el formulario de Registrar | Las arma la app desde lo que se debe; no tienen campos que la persona escriba; tomada en el PR de la API de la rebanada 6 |
| Usuario de conexión de la API | ppm\_api: no es dueño ni superusuario, sin rol no lee ninguna tabla (NOINHERIT) y solo puede asumir ppm\_app o ppm\_admin; el dueño ppm queda para migrar y respaldar. Igual en desarrollo y CI | Seguir con el dueño; dos usuarios (uno para el importador y Z1) | Quien robe la conexión de la API no tiene la llave maestra; Z1 y el importador viven en la misma API, así que un segundo usuario no protegía más; elegido por Dany |
| Contraseña de ppm\_api | La pone un servicio de un solo uso de Docker Compose (usuario-api) desde PPM\_API\_PASSWORD en .env, en cada arranque | Un comando a mano en el servidor | Nadie tiene que acordarse de nada al desplegar y la contraseña no queda en git; elegido por Dany |
| Monitoreo | UptimeRobot consulta https://\<dominio>/api/health cada 5 minutos (monitor HTTP(s)); avisa si la API cae, si no llega a la base o si el certificado vence | Sumar Healthchecks.io para los respaldos; Uptime Kuma en la misma VPS | Tiene que vigilar desde afuera y sin código; elegido por Dany |
| Permisos de ppm\_admin | Sin BYPASSRLS; solo res\_currency\_rate (leer y cargar), res\_currency y la vista res\_currency\_rate\_status, del dueño, que cuenta personas sin mostrarlas | Todas las tablas y saltarse la seguridad por fila (0003) | El importador y Z1 solo tocan el tipo de cambio; hallado en la revisión de Codex |
| Deudas con personas de antes de PPM | Saldo inicial con la persona (Por cobrar o Por pagar contra Saldos iniciales), con la fecha de la deuda, desde el detalle de la persona: «De antes de PPM» | Registrarla como «Le presté» con fecha vieja; en Cuentas › Nueva cuenta | Con fecha anterior al saldo inicial del banco, «Le presté» restaría dos veces y el banco no cuadraría; en la persona es donde ya se miran sus deudas; elegido por Dany |
| Cómo se llega a Personas y al saldo inicial con una persona | Botón fijo de Personas en la cabecera de Cuentas, y «De antes de PPM» también en Registrar › Más, con elegir o crear a la persona | Una fila «Personas» siempre visible en Cuentas; solo la opción en Más | Sin deudas no había puerta a Personas; el botón la deja siempre a mano sin mezclar una fila que no es cuenta, y Más es donde se busca para anotar; elegido por Dany |
| Deuda inicial de una tarjeta | El alta pide lo que toca pagar según el último estado de cuenta (soles y dólares) y la fecha de pago, opcional; las cuotas que faltan se agregan después en la tarjeta con «Cuotas de antes de PPM» (saldo inicial por el capital que falta + plan desde el próximo corte) | Pedir la deuda total; registrar las cuotas en curso dentro del alta | Con la deuda total, las cuotas viejas se contarían dos veces al agregarlas; el alta queda corta; elegido por Dany |
| Pagar una tarjeta bimoneda | Un bolsillo a la vez y solo desde cuentas de esa moneda; sin dólares, la app lleva a comprar dólares primero | Pagar dólares desde una cuenta en soles con tipo de cambio; un solo «a pagar» en soles | Así lo hace Dany con su banco: compra dólares y paga la deuda en dólares con dólares; elegido por Dany |
| Estado de la tarjeta | Función credit\_card\_status(p\_today), por defecto el hoy de la zona de la persona, con una fila por tarjeta y moneda que usa; solo lo confirmado, y las cuotas solo de compras confirmadas | Vista account\_credit\_card\_status con current\_date y todas las monedas activas | current\_date es el día del servidor, no el de Lima; con la fecha como parámetro se prueba cualquier día; una cuota de una compra en borrador no debe restar |
| Movimientos de una tarjeta por ciclo | Cada movimiento en el ciclo de su fecha (los pagos también, como en el estado de cuenta) y una compra en cuotas como sus cuotas, cada una en el ciclo de su corte; se muestran el ciclo actual, el que toca pagar y los 6 anteriores | Mostrar la compra en cuotas completa el día que se hizo; marcar cada ciclo como pagado | Así suma lo que dice el banco en cada estado de cuenta; saber si un ciclo quedó pagado exige repartir pagos entre ciclos, y el «a pagar» ya lo responde |
| Dónde se lee el extracto | En la API, con Python: el adaptador lee el CSV o el Excel, busca la fila de encabezados, propone las columnas (o las recordadas de esa cuenta) y muestra una vista previa antes de importar | En el navegador, como el simulador, mandando a la API las filas ya leídas | Un solo lugar entiende los formatos de cada banco y se prueba con pytest y extractos reales; elegido por Dany |
| Archivo del extracto | Se guarda desde la rebanada 8: ir\_attachment (res\_model 'account.bank.statement') y el archivo en la carpeta del usuario, con volumen de Docker y dentro del respaldo diario; la rebanada de adjuntos solo suma adjuntar a un movimiento | Guardarlo recién con la rebanada de adjuntos | Ya lo decía el modelo («el archivo queda como adjunto del extracto»); el extracto es la prueba de lo importado; elegido por Dany |
| A qué cuentas se importa (rebanada 8) | Solo cuentas de banco | Bancos y tarjetas desde ya | En PPM una compra en cuotas entra completa el día de la compra, pero el estado de cuenta trae «CUOTA 2/6» cada mes: caería en Por clasificar como gasto nuevo. Las tarjetas llegan después con su regla para reconocer cuotas; elegido por Dany |
| Deshacer una importación (IMP-04) | Borra los movimientos que el extracto creó y siguen en Por clasificar, y el extracto con sus líneas; lo clasificado y lo emparejado se queda | Permitirlo solo si nada del extracto se clasificó | No se pierde lo ya trabajado; si se vuelve a importar, lo que quedó se empareja por monto y fecha y no se duplica; elegido por Dany |
| Compra de otra persona con tu tarjeta | En Registrar › Más › «Le presté» se puede elegir la tarjeta (en su moneda) y «En cuotas»: Me deben contra la tarjeta, no es tu gasto. Con interés, la persona te debe el total de las cuotas, salvo «El interés lo pago yo» (va a tus Intereses) | Registrarlo desde Gasto como «de otra persona» | Es prestarle la tarjeta como se presta plata: el banco te cobra a ti y la persona te debe a ti; elegido por Dany |
| Fecha de vencimiento de las deudas | date\_maturity en el apunte (como Odoo), opcional y editable también en lo ya registrado; por defecto una fecha por deuda. Prestar la tarjeta en cuotas parte la deuda en una por cuota, todas con la fecha de la compra; cada parte recuerda su corte y vence con la fecha de pago de ese ciclo cuando se escribe en la tarjeta (antes: «vence con el pago del corte del …»); una fecha puesta a mano manda | Plazos libres en cualquier deuda; una sola fecha siempre | Simple por defecto y partida solo donde hace falta; la conciliación cobra de la parte más antigua a la más nueva; propuesto por Dany |
| Monto de la cuota | Se escribe la cuota del cronograma del banco; la compra es un solo movimiento: el precio a la categoría (o a Me deben), la diferencia (cuotas × n − precio) a «Intereses» el día de la compra y el total a la tarjeta; el plan de cuotas va por ese total. Sin interés, no hay línea de Intereses. Reemplaza «el plan de cuotas solo con capital» | Solo capital (como en la rebanada 7); el interés en cada corte con un proceso diario o como por confirmar | Lo que toca pagar en cada corte coincide con el banco, sin procesos automáticos; el interés cuenta el mes de la compra; propuesto por Dany |
| Elegir fechas | Calendario de shadcn/ui (react-day-picker) en una hoja desde abajo, con atajos Hoy y Ayer, en todas las fechas de la app | El calendario nativo del navegador; uno hecho a mano | Igual en todos los celulares y con los colores de PPM; elegido por Dany |
| Préstamos de banco (rebanada 9) | Entran junto con Recurrentes: Nueva cuenta › Préstamo (deja de ser «Muy pronto») y C4 con lo que debes, las cuotas pagadas y la cuota recurrente en borrador | Una rebanada corta propia después de Recurrentes | La cuota del préstamo es el caso típico del borrador; elegido por Dany |
| Dónde se crea una recurrencia | En Registrar, con un interruptor «Se repite»: el mismo formulario y abajo la regla y el modo; «Nuevo recurrente» en X1 abre ese formulario | Un formulario propio en Recurrentes | No hay otra pantalla que aprender y sirve para gasto, ingreso, transferencia y cuota; elegido por Dany |
| Recordatorios | Una funcionalidad global, no exclusiva de recurrentes: una bandeja «Pendientes» con los avisos que PPM calcula (vencimientos, pago de tarjeta, por confirmar, por clasificar) y recordatorios que escribe la persona, colgados de cualquier cosa como las actividades de Odoo (mail.activity). Rebanada propia después de Recurrentes; hasta entonces, el modo recordatorio de una recurrente usa su aviso simple (account\_recurring\_reminder) | Recordatorios solo de recurrentes; solo los avisos calculados o solo los propios | Un solo tablero de corcho para todo lo que espera algo de ti; propuesto por Dany |
| Crear categorías (adelantado) | Antes de la base de Recurrentes, solo crear: en Más › Categorías (X3) la lista de gastos e ingresos y «Nueva categoría» con nombre, dentro de qué grupo, ícono y color (o los del grupo). Un grupo nuevo nace junto con su primera categoría (nombre del grupo + nombre de la categoría; el ícono y el color van al grupo y ella los hereda): nunca hay grupos vacíos, porque la base no distingue un grupo vacío de una categoría suelta. Solo se ofrecen grupos sin movimientos propios. Las de ingreso, sueltas. Editar, archivar, mover y fusionar quedan para después | Crearla desde la hoja de categorías al registrar; esperar a la rebanada de Categorías completa; grupo vacío con una marca «es grupo» en la base; grupo nuevo como categoría suelta | Dany necesita sus propias categorías ya; elegido por Dany |
| Préstamo de banco: su ficha | Tabla account\_loan, como account\_credit\_card: la cuenta de pasivo (subtipo), el banco y su cuota recurrente (recurring\_id). Así se sabe qué cuenta es un préstamo y de qué banco, sin adivinarlo | Sin tabla: deducirlo de una recurrente con una línea en la deuda, sin guardar el banco | El detalle muestra «BCP · Préstamo en soles» y la app distingue un préstamo de otra deuda; elegido por Dany |
| Cuándo se generan las recurrentes | Al abrir la app (GET /me) y antes de mostrar Recurrentes o los avisos del Inicio; lo atrasado sale con su fecha. Sin programador nocturno | También cada noche, con una lista de personas para ppm\_admin (migración 0018) | ppm\_admin sigue sin ver a nadie (decisión de 0012) y en una app personal nadie mira tus cuentas antes que tú; elegido por Dany |
| Fecha de una compra con tarjeta | Una sola fecha: la de operación, la que sale en el estado de cuenta y en su Excel. Decide el ciclo con el corte inclusivo. Si el banco factura una compra en otro ciclo, Dany le cambia la fecha a mano | Dos fechas (operación y proceso), proceso = operación + 1 día hábil, aviso «pendiente de procesar» cerca del corte | La fecha de proceso es interna del banco: el estado de cuenta solo trae la de operación y los casos al borde del corte son pocos; elegido por Dany |
| Compra en cuotas: por cuánto se registra | Por el precio (monto original, ej. 693.00): es el gasto del día y el capital del plan. Opcional «¿Cuánto es cada cuota?» (262.02) da el interés total estimado (cuota × n − precio), repartido por igual. Sin cuota, interés 0 hasta el estado de cuenta. Reemplaza la regla de 0016 (plan por precio + intereses). Sin TEA ni interés diario | Plan por el total con intereses (0016); TEA con interés devengado diario | La línea del banco cuenta capital, no intereses futuros (S/ 487.72 vs 524.04); la TEA nunca cuadra al céntimo y el saldo según banco la reemplaza; elegido por Dany |
| Cuota facturada: capital e interés | Cada línea del plan guarda capital e interés. El capital facturado no es gasto nuevo (ya contó el día de la compra): solo pasa de por facturar a facturado. El interés es gasto nuevo en «Intereses y comisiones del banco». Al corregir una cuota con el Detalle plan cuotas, el capital que falta se reparte entre las cuotas que quedan (suma siempre el precio) | Capital otra vez a la categoría de la compra; gasto por cuota (mes a mes) | Contaría dos veces el gasto; el gasto por cuota cambia presupuesto y reportes; elegido por Dany |
| El interés de las cuotas en el corte | Se registra solo, confirmado, al abrir la app tras el corte, con la estimación; se corrige en la conciliación. Los cargos de monto desconocido (desgravamen, membresía) sí van por confirmar | También por confirmar, como el desgravamen | El interés sale del cronograma: si quedara sin confirmar, el total facturado y la línea quedarían cortos; elegido por Dany |
| Cuotas de otra persona | Ningún gasto tuyo. El capital por cobrar nace con la compra, una parte por cuota (se ve «por facturar»); en cada corte se le suma el interés de su cuota y queda «Unipiel · cuota 1/3 · S/ 262.02» por cobrar. El interés va a su deuda, no a tus intereses. En su ficha: por facturar, por cobrar y cobradas | El por cobrar nace recién al facturar cada cuota | El día de la compra la tarjeta ya debe el capital: el otro lado del asiento es lo que te debe ella; elegido por Dany |
| Compras en cuotas ya registradas con intereses | Sin migración de datos: se borran y se registran de nuevo por el precio. Las líneas de plan viejas quedan con interés 0 | Migración que adivine el capital | Es una sola compra y su capital no se puede deducir; elegido por Dany |
| Tipo de cambio de la tarjeta | La deuda en dólares no cambia; su valor en soles sí (mueve el patrimonio, no es gasto). El ciclo abierto usa el TC de venta del día, visible y editable; el ciclo cerrado guarda su foto (TC, línea usada) al corte y no se recalcula | Recalcular siempre con el TC del día | Un estado de cuenta emitido no cambia; elegido por Dany |
| Cargos del banco que se repiten | Recurrentes por confirmar marcadas bank\_charge (0019): desgravamen el día de cada corte, membresía cada año, otro cargo cada corte. Al confirmar uno, la plantilla toma su monto y el próximo lo sugiere. Se pide el último monto (o un estimado): un apunte no puede ir en 0. El Inicio avisa «Tienes N cargos del banco por confirmar» | Borrador en 0 sin historial | Reusa las recurrentes de la rebanada 9; un apunte necesita un lado con monto. Decidido al implementar el plan aprobado por Dany |
| Foto del ciclo cerrado | account\_credit\_card\_statement (0020): deuda por moneda, TC de venta del corte y línea usada. Se toma la primera vez que se ve el ciclo y se vuelve a tomar al guardar la conciliación (por lo registrado después con fecha vieja). El TC escrito a mano vale para el ciclo abierto hasta el próximo corte | Foto fija aunque se registre después; TC escrito solo por un día | Dany registra movimientos de días pasados; un TC del banco sirve todo el ciclo. Decidido al implementar |
| Conciliación del estado de cuenta | Por ciclo cerrado: subtotal por moneda, total facturado, línea disponible (la que muestra el banco) y saldo de compras en cuotas. Los movimientos se pegan del PDF o Excel y se emparejan por monto exacto, moneda y fecha ±2 días (la cuota también por su corte). Cargos del banco = categorías de Gastos financieros o recurrentes bank\_charge. El saldo de cuotas del banco reemplaza el de PPM en la línea hasta el siguiente corte: «Estimada» o «Cuadrada con banco» | Importar el estado como extracto; pedir la línea usada | Importar crea o enlaza asientos y no deja ver lo que falta; el banco muestra la disponible. Validado con el caso Qore (S/ 5,283.49). Decidido al implementar |
| Cuotas por mes (0021) | Una compra tuya en cuotas sube la tarjeta por todas las cuotas (cuota × n) y del otro lado quedan «Cuotas por venir» (cuenta de sistema, activo). En cada corte, la cuota del mes pasa de «Cuotas por venir» a la categoría de la compra. Con el «Detalle plan cuotas» del estado de cuenta, la cuota facturada se divide: capital a su categoría e interés a Intereses. Antes no hay reparto estimado. Una compra en cuotas va en una sola categoría | El precio como gasto el día de la compra y el interés estimado en partes iguales (0016 y 0018) | Dany eligió que cada cuota sea gasto en su mes. Así no hay montos negativos al pasar el interés y el patrimonio no cambia hasta que el banco factura. La deuda total con el banco sigue en la tarjeta |
| Cuotas de otra persona | Te debe todas las cuotas desde la compra (262.02 × 3 = 786.06), una parte por cuota que vence con su corte. No hay reparto de capital e interés | Te debe el precio y, con cada cuota facturada, su interés (0018) | No es gasto de Dany: la persona paga lo que el banco cobra |
| Estado de cuenta importado del PDF | Se extrae el texto con su disposición (pdfplumber) y lo lee un lector por banco, con texto y regex, sin IA. Lee BCP y BBVA; para otro banco se agrega un lector. La foto del corte es lo que dice el banco y no se recalcula: línea, utilizada, disponible, total facturado y saldo de cuotas por moneda. Sus fechas Del/Al mandan sobre el día de corte para ese ciclo y el anterior. También se toman la fecha de pago y la línea de crédito. La suma de los movimientos leídos se valida contra el subtotal y se muestran las líneas que no se pudieron leer. Reimportar reemplaza el estado del mismo corte | Escribir los totales y pegar los movimientos; una foto calculada con el tipo de cambio del corte (0020) | Pedido de Dany: lo del banco es la verdad. Validado con el caso Qore: disponible S/ 5,283.53, utilizada S/ 1,716.47 y cuota 1/3 = 221.43 + 40.59 |
| Línea entre cortes y «Por facturar» | Línea usada = la del último estado de cuenta + lo de después: compras y cargos suman, pagos restan. Una compra en cuotas ocupa su precio y las cuotas que se facturan no la cambian. Lo que no es en soles va al tipo del ciclo abierto (el del día o el escrito a mano). Se muestra «Cuadrada con banco» si no hubo nada después; si no, «Estimada». Sin estado de cuenta, la línea usada es toda la deuda. «Por facturar» muestra solo lo del próximo corte: las compras y las cuotas de ese corte. Se quitan el capital pendiente, el saldo de cuotas manual, las explicaciones por cuotas y la validación del tipo de cambio implícito | Restar las cuotas en curso que se facturan | La línea utilizada del banco ya incluye el capital de las cuotas: restarlas lo contaría dos veces. Dany aceptó que el interés de la siguiente cuota recién aparezca con el estado de cuenta |
| Pendientes: avisos que calcula PPM | Se calculan cada vez que se abre la bandeja (vistas SQL sobre el estado real), no se guardan: vencimientos, pago de tarjeta, por confirmar (incluidos los cargos del banco), por clasificar y las recurrentes en modo recordatorio (account\_recurring\_reminder sigue siendo la fuente, con «Registrar el pago» y «Ya lo hice»). Un aviso desaparece solo cuando se resuelve; se puede posponer hasta una fecha (solo se guarda el «pospuesto hasta») y vuelve si sigue sin resolverse. El pago de tarjeta y los vencimientos aparecen N días antes, un número que la persona elige en Ajustes | Guardar los avisos en una tabla; descartarlos para siempre; anticipación fija o solo el día | Una tabla se desfasa al editar movimientos y descartar puede esconder una deuda real. Dany eligió la anticipación configurable |
| Pendientes: recordatorios propios | Notas con fecha que escribe la persona, como las actividades de Odoo (mail.activity): colgadas de un movimiento, una persona, una cuenta o tarjeta, o sueltas. Son de una vez: lo que se repite y mueve plata va en Recurrentes. Al marcarlo hecho sale de la bandeja y queda con su fecha de hecho, visible en el registro del que cuelga | Recordatorios que se repiten; borrarlos al hacerlos | No tener dos sistemas de repetición y conservar la historia de lo que se hizo |
| Pendientes: dónde vive | Pantalla propia «Pendientes» con todo; Inicio cambia sus tarjetas sueltas (recordatorio de recurrente, cargos del banco por confirmar, por confirmar que ya llegaron a su día) por un solo resumen con los más urgentes | Todo en Inicio; contador en el menú | Inicio queda limpio sin perder nada; el menú ya tiene sus cinco entradas |
| Pendientes: base | res\_users.notice\_days (3 por defecto); vista mail\_notice que une los avisos calculados; tabla mail\_notice\_snooze con el «pospuesto hasta» de cada aviso; tabla mail\_activity con los recordatorios propios (fecha, texto, done\_date). Un recordatorio cuelga con llave foránea de move\_id, partner\_id o account\_id (como mucho uno); si se borra lo que lo sostiene, queda suelto. Posponer un recordatorio propio es cambiar su fecha | Enlace genérico res\_model + res\_id como Odoo; borrar el recordatorio con lo que lo sostiene | La base nunca apunta a algo que no existe y no se pierde una nota sin darse cuenta |
| Pendientes: agrupar avisos | Vencimientos: uno por persona, cuenta y moneda; pago de tarjeta: uno por tarjeta; recurrentes: uno por fecha; por confirmar y por clasificar: un aviso cada uno con su cantidad, que abre la lista filtrada | Un aviso por cada movimiento | Un extracto importado llenaría la bandeja con decenas de avisos |
| Pendientes: pantallas | La pantalla Pendientes ordena por urgencia (Vencidos, Hoy, Próximos días), mezclando avisos y recordatorios; tocar un aviso lleva a donde se resuelve. Posponer es un botón con atajos (Mañana, En 3 días, El lunes, Elegir fecha). Abajo: Pospuestos y «Avisarme N días antes». Los recordatorios se escriben en Pendientes (sueltos) y en el detalle de un movimiento, una persona o una cuenta, que muestra también los hechos. Inicio cambia sus tarjetas sueltas por una tarjeta con el número, los vencidos y los 3 más urgentes; Más tiene la entrada Pendientes con su número | Ordenar por tipo; menú ⋯ o deslizar para posponer; escribir recordatorios solo en Pendientes; una sola línea en Inicio | Lo urgente siempre arriba, posponer a la vista y accesible, y cada recordatorio junto a lo que corresponde |
| Gasto sin saber en qué fue | En Registrar, «Lo clasifico después» deja el movimiento en Por clasificar (baja la cuenta, no es gasto hasta clasificarlo y aparece en Pendientes); y una categoría de gasto «Ajuste» para lo que nunca se sabrá o un descuadre, que es gasto desde ya | Solo una de las dos | Cubre el «todavía no sé» y el «no sabré nunca». Elegido por Dany |
| Inicio a tu medida | En Más › Inicio: qué cuentas se ven en el Inicio y en qué orden (flechas ↑↓), y la cuenta predeterminada con la que arranca Registrar fuera de una cuenta. Modo privado: un ojito en el Inicio esconde todos los montos con «••••» y se recuerda. El + de la barra, dentro de una cuenta o tarjeta, registra con esa cuenta | Esconder solo los saldos de las tarjetas de cuentas; arrastrar para ordenar | Útil en público; las flechas son accesibles. Elegido por Dany |
| Ajustes de la web (nov-2026) | «Me deben» y «Debo a personas» abren Personas filtrada, con selector Me deben / Les debo / Guardo suyo. El calendario elige mes y año con una vista propia (sin selector del navegador). Elegir persona es un solo campo que busca por nombre mientras escribes, con «Nueva persona». Transiciones con la API View Transitions (deslizar al entrar y volver, fundido entre pestañas, hojas que suben), apagadas con «reducir movimiento» | Librería de animación motion; personas como etiquetas | Sin librerías y ligero; el selector con búsqueda sirve con muchas personas |
| Adjuntos antes de Reportes | Adjuntar una boleta o foto a un movimiento y verla o borrarla en su detalle, después de estos ajustes y antes de Reportes; las etiquetas quedan para después | Adjuntos y etiquetas juntos; adjuntos después de Reportes | El almacén de archivos ya existe; Dany lo necesita ya |
| Reportes: cuáles | Cinco reportes con Recharts (gráficos de shadcn): Gastos (dona por grupo y lista que se despliega con las hijas; en año, barras apiladas por mes), Ingresos (barras), Flujo (Sankey de lo que entró a lo que salió más lo guardado, y la línea del % guardado en 12 meses), Patrimonio (área de 12 meses al tipo de cada fin de mes, composición de hoy y diferencia de cambio no realizada) y Personas (totales y antigüedad de lo que te deben por tramos). Etiquetas llegó con las etiquetas (#88): lo gastado con cada una, por categoría; el presupuesto sigue fuera de alcance; el libro mayor ya está en el detalle de cada cuenta | Las cuatro pestañas del boceto gris; sin Flujo | Sale de REP-01, 02, 05 y CON-01 y del Sankey por el que se eligió Recharts; el boceto gris era solo orientativo. Elegido por Dany |
| Reportes: cómo se navegan | Más › Reportes abre un índice con una tarjeta por reporte (su cifra del mes y un mini gráfico); cada reporte tiene Mes / Año con ‹ ›. Una categoría principal se despliega ahí mismo con sus hijas; una hija abre Movimientos filtrado por ella y el periodo. Cada monto se compara con el periodo anterior. El patrimonio de cada mes va al tipo de cambio de su fin de mes. No entran transferencias, pagos de tarjeta ni lo por clasificar (se avisa cuántos); los reembolsos restan y se marcan; las cuotas cuentan en el mes que se facturan | Pestañas deslizables; solo mes o rango libre; comparar con el promedio de 3 meses; todo al tipo de hoy | Se ve el resumen de todo de un vistazo y la comparación se lee fácil. Elegido por Dany |
| Copias de los artefactos en el repositorio | Este documento y el sistema de diseño tienen una copia en el repo (docs/modelo-contable.md y design-system/). Para leer se usan las copias; las decisiones se escriben en el original de claude.ai y la copia se refresca en el mismo PR. Si no coinciden, manda el original. Los tokens que nacen en el código (age-0 a age-3, attention-soft, destructive-soft) se registran también en el sistema de diseño | Solo los originales en claude.ai; copias que se refrescan cuando alguien se acuerda | Claude Code los lee sin salir del repo y con grep, sin que la copia se vuelva un plano viejo. Elegido por Dany |
| Cortes del banco al realinear las cuotas | El calendario de cada compra se rehace desde su fecha con los cortes que se conocen, los del banco primero; las cuotas de antes de PPM parten del día siguiente a su asiento y las partes por cobrar siguen a su cuota (0025) | Pasar el corte viejo por card\_closing\_for (0021) | Si el banco cortaba antes del día de la tarjeta, la cuota saltaba al mes siguiente y ese mes quedaba con dos; una compra entre el día de la tarjeta y un corte del banco más tardío no entraba en ese ciclo. Hallado en la revisión de noviembre |
| Céntimo de las cuotas en otra moneda | La última cuota se lleva el residuo: lo que la compra dejó en soles menos lo que se llevaron las anteriores (0025) | Redondear cada cuota por separado | «Cuotas por venir» queda en cero al facturar todo; con 3 × US$ 87.35 a 3.451 sobraba S/ 0.01 |
| Valor de «Cuotas por venir» en otra moneda | Al tipo de venta, como la tarjeta que la compensa | Al tipo de compra, como lo que se tiene | Una compra en cuotas en dólares no cambia el patrimonio hasta que se factura; con compra 3.43 y venta 3.45, US$ 300 lo bajaban S/ 6 |
| Cuota del banco distinta a la de PPM | La conciliación avisa «La cuota del banco es distinta» con un botón «Usar la del banco», que ajusta el plan, la tarjeta y «Cuotas por venir»; «No es esta compra» descarta el emparejamiento | Tomarla sola al importar el PDF | Si el emparejamiento se equivoca, nada cambia sin que Dany lo vea; antes la cuota quedaba sin emparejar y el interés nunca entraba. Elegido por Dany |
| Devolver o adelantar una compra en cuotas | «Cancelar las cuotas que faltan» con dos salidas; las cuotas ya facturadas quedan. «Lo devolví»: la tarjeta y «Cuotas por venir» bajan por lo no facturado y no queda gasto. «Pagué lo que faltaba»: se escribe lo que cobró el banco, que va a la categoría de la compra ese día; «Cuotas por venir» baja por lo no facturado y la tarjeta, por el interés perdonado; la hoja pide de qué cuenta se pagó (o «Todavía no lo pago») y registra también el pago de la tarjeta. Borrar el asiento de la cancelación la deshace (0026) y se lleva también ese pago (0029). Se puede cancelar aunque la compra esté en un mes cerrado: la cancelación va con su propia fecha | Borrar la compra y registrarla de nuevo | Borrar se llevaba los gastos de los meses ya facturados. Devolver y adelantar no son lo mismo: al adelantar, el capital que faltaba sigue siendo gasto y solo desaparece el interés futuro. Elegido por Dany |
| Candado del cierre | Lee el cierre del dueño de la fila y mira solo lo que cambia saldos: fecha y estado del asiento; cuenta, montos, moneda y persona del apunte (0028) | El trigger del diseño: el cierre de la sesión y cualquier cambio | Borrar a una persona no choca con su cierre, y los vencimientos, los cortes de las cuotas y las conciliaciones siguen libres sin tocar saldos. Hallado en la revisión de Fable |
| Qué impide cerrar | Algo por confirmar o por clasificar hasta esa fecha, o una fecha que no ha pasado. Reabrir (mover atrás o quitar) siempre se puede. X4 propone el fin del mes pasado | Solo los borradores | Lo por clasificar tampoco cuenta como gasto ni ingreso: cerrarlo lo dejaría congelado a medias. Boceto aprobado por Dany |
| Estado de cuenta después del cierre | Se importa igual: la foto y la conciliación quedan; la cuota facturada en un periodo cerrado no se divide y la conciliación dice que se reabra y se vuelva a importar | Rechazar la importación | El PDF suele llegar después del corte; no se pierde la foto del banco por un mes cerrado. Elegido por Dany |
| Cuotas en un periodo cerrado | Realinear los cortes no mueve los asientos de cuota cerrados; la cuota de un corte cerrado se factura por confirmar al día siguiente del cierre; dividir, ajustar o cancelar en fechas cerradas pide reabrir | Saltarse el cierre para las tarjetas | El cierre es la promesa de que esos saldos no cambian: tampoco por la tarjeta |
| Arranque de una tarjeta en un mes cerrado | El alta con deuda, las cuotas de antes de PPM y corregir lo que tocaba pagar siguen fechados en el último corte; si cae en un mes cerrado, se pide reabrir | Fecharlos al día siguiente del cierre | Pasa poco y la deuda inicial conserva la fecha del estado de cuenta. Elegido por Dany |
| Logo e ícono de la app | La hogaza: un pan de trigo sobre tinta con dos cortes que son el «=» de la partida doble. PPM se instala como app (manifest con íconos normal y maskable, ícono de iPhone y favicon) | Monograma «p.»; libro abierto | Une el «pan para mayo» con la partida doble, que es lo que hace PPM. Elegido por Dany |
| Cómo se ven los adjuntos | Como el visor de Odoo 20: tira de miniaturas (la más reciente primero) y visor a pantalla completa con pasar, zoom, girar, descargar y borrar; en escritorio, la lista a la izquierda y teclado. El servidor hace una miniatura WebP de 360 px, convierte las HEIC a WebP y cada página de un PDF en imagen, una sola vez, guardadas junto al archivo (derived/); page\_count en ir\_attachment (0030) | La foto completa como miniatura; el PDF en un iframe | La miniatura pesaba hasta 5 MB, las HEIC no se veían en Chrome y el celular no muestra PDFs dentro de la página. Boceto aprobado por Dany |
| Fotos livianas al subirlas | Como Odoo (base.image_autoresize_max_px): una foto de más de 1920 px, de más de 500 KB o en HEIC se guarda girada según su EXIF, en WebP de hasta 1920 px y calidad 80, sin EXIF (tampoco la ubicación), y el nombre pasa a .webp; el original no se guarda. Una captura chica queda como está, y una foto que no se puede leer se guarda tal cual. Por eso una foto puede llegar de hasta 20 MB; un PDF sigue hasta 5 MB y no cambia. El visor muestra tal cual solo las fotos de hasta 500 KB: las pesadas subidas antes se ven en su WebP de 2000 px, y Descargar da lo guardado | Guardar el original y mostrar una copia liviana; achicarla también en el celular antes de subirla | Una foto de 1 a 4 MB tardaba en abrir. Como revelar en tamaño postal y no guardar el negativo gigante: una boleta se lee igual y pesa 200 a 400 KB, en el visor, en el servidor y en el ZIP de Exportar. Elegido por Dany (17-nov) |
| Fuentes e íconos | Tipografías de texto servidas por PPM (@fontsource). Íconos de Material Symbols desde Google con icon\_names: una fuente con los de la interfaz y las categorías de fábrica (ui-icons.json, ~76 KB), más los que la persona eligió (/me devuelve sus íconos); el catálogo completo (4,274) solo al abrir «Ver todos los íconos» al crear una categoría | La fuente completa en cada visita (1.4 MB, 7.8 s en 4G); íconos autoalojados recortados en el servidor | Era casi todo lo que tardaba una pantalla; Dany quiere poder elegir entre todos los íconos, pero solo al crear una categoría |
| Cómo carga la web | Cada pantalla, el calendario y los gráficos se descargan al abrirlos (JS inicial de 367 a 137 KB comprimido). Un service worker guarda los archivos de la app en el equipo; la API va siempre al servidor | Un solo archivo con toda la app; copia de los datos sin conexión | Medido con un año de datos en un celular con 4G: Inicio de ~11 s a 3.5 s la primera vez y 1.6 s después. Los datos siguen solo en el servidor, como se decidió |
| Reloj de pruebas | user_today() toma el día del ajuste de sesión ppm.today cuando está definido; si no, el día de verdad en la zona horaria de la persona (0040). Solo lo definen las pruebas: las de cancelar cuotas corren siempre el 12 nov 2026. La API nunca lo define, así que en producción nada cambia | Reescribir las pruebas con fechas relativas a hoy | Elegido por Dany el 20-nov: ese día se facturó una cuota que las pruebas daban por futura y fallaron 16 (también en main). Con el reloj fijo no se vuelven a romper con el calendario; con fechas relativas había que rehacer unos 20 asserts y costaba más leerlas |
| Escritorio | Desde 1024 px, un riel de íconos de 88 px a la izquierda con Registrar arriba y las secciones con su nombre corto. Movimientos, Cuentas (con tarjetas y préstamos), Personas y Reportes en dos paneles (la lista fija y el elegido al lado; sin nada elegido, una invitación a elegir; Reportes abre Gastos). Registrar como panel lateral sobre la pantalla en la que estabas. Las hojas se abren como ventana al centro; las demás pantallas van centradas junto al riel. Atajos: N, /, ↑ ↓, E, Esc, Ctrl ↵. En el celular no cambia nada | Barra lateral ancha como Odoo; barra superior con pestañas; lista y detalle en todas las secciones | Elegido por Dany el 13-nov: más espacio para el contenido. Las pantallas de escritorio se redibujan con la revisión de UI/UX del celular antes de programarlas |
| Mientras carga y sin datos | Siluetas con la forma de la pantalla (título, flecha y periodo al instante). Sin datos, la forma de Recurrentes: ícono, qué es, cómo empezar y un botón si hay algo que hacer; nunca ceros que parecen datos ni ayuda para tocar lo que no está. La tarjeta muestra un ciclo a la vez con ‹ › | Un círculo girando en una pantalla en blanco; gráficos vacíos con ceros; todo el historial de la tarjeta de una vez | Revisión con capturas reales (celular, oscuro, API lenta, cuenta nueva): la pantalla en blanco parecía rota y la tarjeta llegaba a 15,000 px con un año de uso |
| Títulos y lo elegido | Pestañas de abajo: etiqueta chica y el dato grande. Pantallas a las que entras: flecha y título, sin punto y sin etiqueta que repita adónde vuelves. Hojas: × y su título. La opción elegida de un selector usa el token selected (en oscuro, clara con letra oscura). El subtítulo de una cuenta no repite el banco si el nombre ya lo dice | Tres estilos de título a la vez; la elegida en un gris apenas distinto en oscuro | Una sola regla se aprende una vez; en oscuro la opción elegida no se distinguía |
| Rótulo con un dato, sin punto medio | Un rótulo ya no se une con su dato por un punto medio. Si se lee de corrido, va como frase: «Lo que realmente tengo hoy», «A pagar del ciclo que cerró el 5 nov», «Préstamo en soles del BCP», «Próxima cuota el 20 nov», «Últimos días del dólar», «Último extracto hasta el 31 oct», «Cuánto guardas para mayo», «La diferencia de cambio de tus dólares», «Quedan 5 cuotas». Una cantidad va en pastilla junto al rótulo: Adjuntos 3, Pendientes 3 y 1 vencido en ámbar, el paso 2 de 3 al importar, Te deben 31–60 días. Un dato aparte va a la derecha o en su propia línea: «3 de 120 filas» a la derecha de «Así lo leemos», «Cierra el 5 dic» debajo del monto de Por facturar. Si el dato ya está en la pantalla, se quita: «Para mayo» sin el mes, «Solo administrador» en Tipo de cambio. Caso 2 de «Sin punto como conector» | A: el dato siempre a la derecha; B: todo como frase | Elegido por Dany el 18-nov (opción C): cada rótulo queda en su forma más corta; con A la derecha ya estaba ocupada en varios rótulos, y con B las cantidades perdían fuerza |
| Campo opcional | Un campo que se puede dejar vacío lleva su rótulo solo y, a la derecha, «Opcional» en gris; ya no «· opcional», «(opcional)» ni el aviso dentro del texto de ejemplo. Vale para los campos de una línea, las fechas, el buscador de personas, las filas Con quién y Etiquetas de Registrar y Clasificar, y la nota junto a la fecha. En el detalle de un movimiento, Con quién deja de mostrarlo cuando ya tiene una persona. Lo que acompañaba al aviso pasa debajo como ayuda: «20 dígitos» del CCI. Caso 3 de «Sin punto como conector» | B: siempre «(opcional)» en el rótulo; C: sin marca, «Opcional» como texto de ejemplo | Elegido por Dany el 18-nov (opción A): el rótulo queda limpio y sigue la regla del caso 2, el dato aparte a la derecha; con B los rótulos angostos se cortaban y con C el aviso se borraba al escribir |
| Ayuda pegada al nombre | El nombre de un campo o de una sección ya no lleva su explicación pegada por un punto medio: el nombre va solo y la ayuda en su propia línea, en gris, debajo. «¿Cuánto debes hoy?» con «Solo el capital» en su ayuda; «La cuota» con «Se repite cada mes»; «Fijas» con «Las respeta todo programa»; «Foto del corte» con «Lo que dice el banco»; Capital, Interés y Seguro de la cuota con su ayuda debajo; «Sale de» con «Solo cuentas en soles» (SheetSelect acepta hint); en Importar, «.xlsx, .xls o .csv» y «Hasta 5 MB» en dos líneas, y cada columna con su segunda línea. Cuando la ayuda ya va en la línea gris de una fila, se escribe como frase: «Las de gasto y de ingreso, y crea las tuyas», «Cuenta de banco que se crea al empezar», «Tu parte es gasto en…», «Todo Comida y bebida», «Gasto dentro de…, con el color del grupo», «Fin del mes pasado, 31 oct». En Tipo de cambio, «Solo administrador» va a la derecha del nombre. El chip de fecha dice «Hoy» con su flecha. Caso 4 de «Sin punto como conector» | B: nombre y ayuda unidos en una frase; C: la ayuda entre paréntesis | Elegido por Dany el 18-nov (opción A): es lo que ya hacían los campos con ayuda y el nombre se lee de un vistazo; B obligaba a reescribir cada caso y C era el mismo pegote con otro signo |
| Estado y su detalle | Un estado ya no se une con su detalle por un punto medio: va con su ícono y, si pide algo de ti, en ámbar; el detalle queda al lado, en gris. En Movimientos, el día con todo sin confirmar dice «Hoy» y, al lado, Por confirmar con su reloj; en una recurrente, el estado (Pausada, Terminada) o el modo (Automático, Por confirmar, Recordatorio) con su ícono y, a la derecha, cada cuánto se repite; en Etiquetas, «Archivada» con su caja junto al número de movimientos; en una persona, cada cuota con Por cobrar o Por facturar y su vencimiento al lado; en el estado de cuenta de la tarjeta, lo que dice PPM de cada cuota en su propia línea («No está en PPM» y «En PPM la cuota es…» en ámbar; «Dividida en tu gasto» en gris). Cuando se cuentan varios estados va como frase: «6 cuotas: 2 por cobrar y 4 por facturar», «12 partes: 3 contaron y 1 cancelada». Componente Status y función listText en la web. Caso 5 de «Sin punto como conector» | A: el estado en pastilla; C: todo como una frase | Elegido por Dany el 20-nov (opción B), sobre un boceto de hoy y después lugar por lugar: es lo que ya hace «Por confirmar» en la fila de movimiento; con A, varias pastillas en una pantalla hacían que todo pareciera urgente, y con C el estado se perdía en el texto. Los casos 6 a 8 se resuelven igual: un boceto de hoy y después por cada lugar real |
| Varias monedas o cifras | Montos en varias monedas que se muestran solos van uno por línea, alineados a la derecha, sin signo que los una (componente Amounts): lo cargado en el ciclo y Cuotas por venir de la tarjeta, Guardo de otros en Cuentas, los montos de Personas y del detalle de una persona. Dentro de una frase siguen con «+». Una cuenta en otra moneda lleva debajo del saldo, en gris, cuánto es en soles; debajo del nombre queda solo su banco. Más › Monedas y formato dice «Soles y dólares» y debajo «Así: 1,284.90». Al registrar una transferencia entre monedas, SUNAT va en su línea y debajo Compra y Venta, cada una en la suya. En el detalle de una transferencia entre monedas, lo que entró va a la derecha de la fila. Las cuotas pagadas de un préstamo: «Capital 450.00 + interés 65.00 + seguro 5.00». Para elegir una moneda, solo su nombre; en una lista larga, el símbolo en gris debajo (currencyOption). Caso 6 de «Sin punto como conector» | A: unir las monedas con «+» en una línea; para Más y SUNAT, una frase en una línea | Elegido por Dany el 20-nov (opción B para el ciclo, Cuotas por venir y Guardo, y lo mismo para Más y SUNAT): se lee como la columna de montos de un estado de cuenta y no se corta en filas angostas; soles más dólares no se suman de verdad, así que «+» confundía. El resto del caso se aprobó como se propuso |
| Datos sueltos: etiqueta y valor | Dos o más datos que iban pegados por un punto medio van como una ficha chica: el nombre arriba, en mayúsculas y gris, y el dato abajo, lado a lado (componente Facts; el lector de pantalla lee «Faltan: 3 días, …»). Así van la fecha de pago y cuántos días faltan en la tarjeta (en ámbar si ya es hoy o pasó), el ciclo que cerró y hasta cuándo se paga (en la tarjeta, al pagarla y en el estado de cuenta), la tarjeta sin fecha de pago en Cuentas (en ámbar), los cargos del banco y el tipo de cambio de la tarjeta, al registrar un cobro o un pago a una persona (te debe y quedará en) y cada deuda al elegirla, el resumen de cada persona y cada deuda (del, era y te pagó), el Inicio (tienes, guardas y debes; tus dólares, cuánto son y a cuánto el dólar), Recurrentes (próxima y dónde; categoría, sale de y desde; movida del y monto; solo esta vez), se repite y desde al registrar, las cuotas y su total o precio, lo repartido en el tiempo y cancelar lo que falta, los extractos importados, los adjuntos al exportar (el botón dice «Descargar ZIP (3.2 MB)»), Mi cuenta (correo y monedas), un cargo que no cuadra en el estado de cuenta y el porcentaje de cada grupo en Reportes. Con su propia forma: las cuotas por venir de la tarjeta llevan encima una barra de una rayita por cuota (Segments); un préstamo muestra un punto por cuota, lleno si está pagada, hasta 36 cuotas (más, la barra de siempre) y debajo «3 de 12 cuotas»; en Pendientes, el dato que corre va en pastilla («Sin registrar», «Ya es su día», la fecha de un recordatorio); en Tipo de cambio, compra y venta de SUNAT en grande, cada una en su casilla, y en Monedas cada dato con su ícono; el formato de números y fechas se muestra como una fila de Movimientos (FormatSample) y la bienvenida con íconos; en Reportes, el cambio con su flecha (Trend). Caso 7 de «Sin punto como conector» | A: una frase con coma, «y» o punto; B: un dato por línea; D: la frase con una pastilla; E: una idea propia de cada lugar (calendario, línea de tiempo, íconos, cuenta con × e =) | Elegido por Dany el 20-nov, grupo por grupo sobre un boceto de hoy y después con cinco opciones: C en casi todo porque se escanea como un marcador y no se parte en filas angostas; C con la barra de cuotas de E en la tarjeta y con la flecha de crecimiento de E en Reportes; E en el préstamo, Tipo de cambio y Monedas, y el formato con la bienvenida; D en Pendientes, donde lo que corre tiene que resaltar |
| Marca y teclas | El nombre de la app y las teclas tampoco se unen con punto medio. En el riel de escritorio, el botón de teclado muestra al pasar el mouse el mismo globo oscuro de «Registrar», con la tecla en su cajita, y el logo se lee «Inicio de PPM». En Privacidad, sobre el título, va el logo chico al lado de «PAN PARA MAYO». En Crear cuenta, sobre el refrán, «CREAR CUENTA EN PPM». En el visor de adjuntos, la ayuda de abajo pone cada tecla en su cajita con lo que hace al lado, separadas por aire (← → Pasar, + − Zoom, Doble clic acerca, Esc Cerrar). Caso 8 de «Sin punto como conector» | A: coma o paréntesis; C: quitar la sigla o partir en dos líneas; D: dos puntos o un botón «Teclas»; E: la tecla siempre visible, la sigla en pastilla o una leyenda en columnas | Elegido por Dany el 21-nov sobre un boceto de hoy y después con cinco opciones: las recomendadas, porque repiten piezas que ya existen (el globo de Registrar, la cajita de Atajos) y la marca se ve como firma sin leer la sigla |
| Los últimos sin punto | Lo que quedó del caso 1. Por clasificar se agrupa por día, como Movimientos, con el encabezado «VIERNES 12 DE NOVIEMBRE» (con el mes, porque la bandeja junta varios); en la fila quedan la cuenta y la operación («BCP soles, op. 123456»). La hoja para clasificar muestra Día, Cuenta y Monto como etiqueta y valor. Al elegir una cuenta, el tipo va debajo del nombre y el saldo a la derecha, como en Cuentas. El teléfono y el correo de una persona van en pastillas con su ícono: tocarlas llama o abre el correo. Un adjunto por subir dice «Foto» o «PDF» en pastilla y al lado cuánto pesa. En el visor, arriba va solo el nombre y un botón «Detalles» abre la ficha (movimiento, monto, subido, pesa, tipo y páginas); en la lista de la izquierda queda solo el peso. Los avisos de Pendientes (en Pendientes, el Inicio y Pospuestos) dicen qué hacer a la izquierda y el monto a la derecha, uno por moneda. En un asiento, la persona va en pastilla al lado de la cuenta. Una deuda en partes dice «Parte 1 de 3» y el monto a la derecha. En el estado de cuenta, cada cuota lleva la barra de rayitas y «3 de 12». En Reportes, el globo de cada mes pone el mes y el total en una fila. Caso 9 de «Sin punto como conector» | A: comas o dos puntos; B o D: etiqueta y valor, dos líneas, pastillas o frases según el lugar; E: ideas propias (la miniatura real, botones Llamar y Escribir, la inicial de la persona) | Elegido por Dany el 21-nov, grupo por grupo sobre un boceto de hoy y después con cinco opciones: casi siempre la C, que reusa piezas que ya existen (el encabezado de día, la pastilla, la barra de cuotas, el monto a la derecha); B en la hoja para clasificar; D en el adjunto por subir; E en el visor, para que arriba se vea limpio |
| Entrar con Google | «Continuar con Google» en Iniciar sesión y Crear cuenta, y «Vincular con Google» en Mi cuenta (puede ser otro correo). OpenID Connect con redirección desde el servidor (state, nonce y PKCE en una cookie httpOnly de 10 minutos), solo openid, email y profile. Como auth\_oauth de Odoo: auth\_oauth\_provider y oauth\_provider\_id, oauth\_uid (el sub de Google) y oauth\_email en res\_users; nunca se guardan tokens de Google. Correo nuevo: se crea la cuenta sin contraseña y sigue la bienvenida. Correo con cuenta: se une solo con la contraseña de esa cuenta (una unión pendiente de 15 minutos en res\_users\_token). Sin contraseña no se desvincula (la base exige contraseña o Google). Sin GOOGLE\_CLIENT\_ID el botón no aparece. Migración 0032 | Botón oficial de Google (ventanita o One Tap); unir automáticamente porque Google verificó el correo; pedir también una contraseña al crear la cuenta con Google | Elegido por Dany el 14-nov (1A, 2A, 3A): la redirección funciona en la app instalada y el secreto queda en la API; como PPM no verifica correos, unir solo con la contraseña evita el pre-secuestro de cuentas; la contraseña es opcional, como en la mayoría de apps |
| Monedas y formato | Más › Monedas y formato. Catálogo completo de ISO 4217 (sin fondos, metales ni retiradas; nombres y decimales de CLDR, hasta 2 decimales). Cada persona agrega las que usa y quita las que no tienen cuentas ni movimientos; la moneda principal queda fija (un trigger impide quitarla). El formato de números y fechas se elige de res_lang, cada uno con su ejemplo. Los montos se escriben con el símbolo de res_currency_format o con el código, y sin céntimos en las monedas sin decimales. Migración 0031 | Solo dólar y euro; separadores y orden de la fecha por separado; poder cambiar la moneda principal | Elegido por Dany el 14-nov: cualquier moneda para viajes o cuentas afuera; un formato con ejemplo evita mezclas confusas; cambiar la principal obligaría a recalcular todo el historial. SUNAT solo publica el dólar: las demás tienen tipo de cambio a mano |
| Privacidad | Página pública /privacidad (se abre sin sesión), enlazada al pie de Iniciar sesión, Crear cuenta y Más. Dice lo que PPM hace de verdad: qué guarda, que no lee Gmail ni Drive, que no hay publicidad, analítica ni rastreadores (la única cookie es la de la sesión), con quién se comparte (el correo y Google), dónde está y cómo borrar tus datos. El correo de contacto sale del entorno (PRIVACY\_EMAIL, GET /privacy); sin él no se muestra. Es lo que Google pide, con el dominio verificado en Search Console, para verificar la marca y mostrar el logo | Publicar sin logo (sin verificar); escribir el correo de contacto en el código | Elegido por Dany el 14-nov: con el dominio ya en producción (ppm.danychavezdev.com), la página es lo único que faltaba para verificar; el correo en el entorno se cambia sin tocar el código |
| Eliminar mi cuenta | Más › Mi cuenta › Eliminar mi cuenta (CFG-07). Muestra lo que se va (cuentas, movimientos, adjuntos, recurrentes) y se confirma con la contraseña o, si la cuenta se creó con Google y no tiene, escribiendo el correo. Se borra al instante: auth\_account\_delete() borra la fila de res\_users y la cascada se lleva todo (las tablas con user\_id tienen ON DELETE CASCADE; el cierre de periodo y la moneda principal no lo frenan porque la persona ya no está), luego la API borra su carpeta del filestore y la sesión. Vuelve a Iniciar sesión con «Tu cuenta se eliminó.». Los respaldos diarios se renuevan solos en 14 días. Migración 0033 | Papelera de 30 días (desactivar y borrar después con un proceso); escribir «ELIMINAR» para confirmar; pedir el borrado por correo | Elegido por Dany el 14-nov: para uso personal una papelera no vale lo que cuesta; la contraseña prueba que eres tú, y quien solo tiene Google confirma con su correo |
| Exportar mis datos | Más › Mi cuenta › Exportar mis datos (CFG-06), y «¿Te llevas tus datos?» en Eliminar mi cuenta. Un ZIP armado al momento, que no queda en el servidor: datos.json con todas las tablas que tienen seguridad por fila (una tabla nueva entra sola), fila por fila tal como las guarda PPM, sin la huella de la contraseña y con los catálogos a los que apuntan (res\_currency, res\_bank, res\_country, res\_lang); csv/ con una tabla por archivo y nombres en vez de ids (cuentas, una fila por cuenta y moneda; categorías; movimientos, una fila por línea; personas; recurrentes; tipos de cambio; adjuntos), en UTF-8 con BOM; y adjuntos/ con los archivos como se subieron, que se pueden dejar fuera con un interruptor. Montos con punto decimal y fechas ISO (2026-11-15). Se lee en la transacción de la persona, que solo ve lo suyo. GET /me/export (lo que va y cuánto pesan los adjuntos) y GET /me/export/zip?attachments=. Sin migración | Solo CSV para Excel; solo un JSON; montos y fechas con el formato de Ajustes; preparar el ZIP en segundo plano y avisar por correo | Elegido por Dany el 15-nov (opción C): los CSV sirven para mirar los datos y el JSON es el respaldo completo, y uno sale del otro; el formato fijo se lee igual en cualquier programa; para uso personal el ZIP se arma en segundos |
| Filtros de Movimientos recordados | Los filtros de Movimientos (mes, cuenta, categoría, tipo, búsqueda, por confirmar) siguen en la dirección y además se anotan en sessionStorage, por persona: la pestaña Movimientos de la barra y del riel abre la lista con los últimos que usaste. Al cerrar la app se empieza limpio. Cada filtro activo se ve como chip con su ✕; quitarlos todos deja la pestaña otra vez en la lista completa. Sin cambios en la API | Recordarlos siempre (localStorage o en el servidor); no recordarlos | Como un separador en un libro: vuelves donde estabas. Recordados para siempre, un día ves un mes «incompleto» sin darte cuenta de que filtrabas; elegido por Dany |
| Cobrar o pagar en otra moneda | «Me pagaron» y «Pagué lo que debía» aceptan una cuenta en otra moneda que la deuda, con dos montos: lo que entró o salió de la cuenta y cuánto de la deuda cancela (debt\_currency y debt\_amount en POST /moves; la deuda que se elige si la persona tiene en varias monedas). El apunte de la persona va en la moneda de la deuda, a su valor en libros (promedio de lo que se debe en esa moneda; si se cancela todo, el exacto), y concilia como siempre; el de la cuenta, en la suya. La diferencia entre lo que entró (o lo que costó lo que salió) y lo que valía la deuda es la realizada, en «Ganancia por tipo de cambio» o «Costo del cambio», como en una transferencia entre monedas. Guardar plata de otro y devolverla siguen en una sola moneda. Sin migración | También guardar y devolver en otra moneda; registrar el yape y el cambio por separado como si la persona hubiera dado dólares | Como una casa de cambio que cancela tu deuda: así pasó con los vuelos de Paul (le prestó la tarjeta por US$ 133.38 y le yapeó soles). Cubre el caso real con poco cambio; elegido por Dany |
| Reportes sin filas en cero | Gastos e Ingresos no listan un grupo ni una categoría que en el periodo quedó en cero (solo tuvo movimientos el periodo anterior), salvo que tenga reembolsos. Lo de antes sí cuenta en lo anterior del grupo y del total, y en el año los totales de cada mes siguen completos. Sin migración | Mostrarlas con «—» en vez de «−100 %» | Como un recibo: no imprime lo que no compraste. «S/ 0.00 · −100 %» no dice nada; la baja ya se ve en el grupo. Pedido por Dany |
| Ingresos y gastos diferidos | Un gasto o un ingreso (una sola categoría, pagado por ti, sin cuotas ni repetir) se puede «Repartir en el tiempo». El pago va de la cuenta a «Pagos por adelantado» (activo, system\_role prepaid) o el cobro de «Cobrado por adelantado» (pasivo, unearned), en moneda base. Por días: una parte por mes según los días que cubre, con fecha el primer día que cubre (de 2 partes a cinco años); por meses: partes iguales el mismo día de cada mes (2 a 60). La última cierra el redondeo. El calendario se guarda (account\_deferral y account\_deferral\_line, 0034) y cada parte se vuelve un asiento confirmado al llegar su fecha (post\_deferrals, al abrir la app, como las cuotas); en un mes cerrado queda por confirmar. Ni el original ni sus partes se editan; borrar el original se lleva todo. «Cancelar lo que falta»: lo que te devolvieron (o devolviste) entra a (o sale de) una de tus cuentas (desde #90 también en otra moneda) y el resto cuenta ese día en la categoría; las partes que faltaban ya no se generan y borrar la cancelación las devuelve | Solo por meses; partes en borrador para confirmar cada mes; una vista en Reportes que reparte sin tocar la contabilidad; incluir los ingresos cobrados por adelantado aparte | Como «Cuotas por venir», pero sin tarjeta: el seguro anual o la suscripción no inflan un mes y los adelantos de un cliente no son tuyos hasta ganarlos. La plata ya se movió: confirmar cada parte sería trabajo de más. Opción B, por días o por meses y con fecha de inicio, elegidas por Dany |
| Corregir lo de antes de PPM con una persona | «Editar» en su detalle abre el mismo formulario de «De antes de PPM» (con quién, de qué lado, moneda, monto, fecha y nota) y lo guarda en el mismo movimiento (PUT /moves/{id}/opening), así sus adjuntos se quedan. Los cobros o pagos que ya tenía se vuelven a conciliar; si quedarían de más (bajar el monto de lo ya cobrado, otra persona u otra moneda), no se guarda. Reemplaza «se corrige borrándolo» de 0013. El saldo inicial de una cuenta sigue corrigiéndose desde la cuenta | Un botón «Corregir» que borra y abre el formulario lleno; seguir solo con borrar | Como corregir con borrador sobre la misma hoja en vez de arrancarla y copiarla: es lo natural y no pierde adjuntos ni enlaces. Opción A, elegida por Dany |
| Etiquetas | Van en el movimiento entero (account_move_account_tag_rel, migración 0035), no en cada línea. Lo que se arma solo (las cuotas de una compra, las partes repartidas y sus cancelaciones) lleva las de su compra: tag_source y la vista account_move_tag_v las resuelven al leer, y en esas partes no se cambian. Se ponen al registrar («Etiquetas · opcional») o desde el detalle de cualquier movimiento, también en un mes cerrado porque no cambian saldos; se crean ahí mismo escribiendo el nombre, con el siguiente color de la paleta. Hasta 10 por movimiento, nombre único por persona sin importar mayúsculas. Movimientos tiene el filtro «Etiqueta»; Reportes, «Etiquetas»: lo gastado con cada una en el mes o el año (líneas de gasto, los reembolsos restan, la parte de otra persona no cuenta), desplegado por categoría; un gasto con dos etiquetas cuenta en las dos y una vez en el total. Más › Etiquetas: renombrar, color, archivar (ya no se ofrece, los movimientos la conservan) o eliminar (sale de sus movimientos). Salen en la exportación | En cada línea, como la analítica de Odoo (lo que proponía el modelo); copiar las etiquetas a cada cuota o parte al generarla | Un post-it va en el sobre, no en cada recibo: editar un movimiento rehace sus líneas y la etiqueta se habría perdido, y la interfaz siempre etiquetaba el movimiento entero. Resolver al leer evita tocar las funciones que generan cuotas y partes. Decidido por Claude con la autorización de Dany (16-nov); bocetos en el lienzo «Etiquetas» |
| Etiquetas en las recurrentes | La recurrente guarda sus etiquetas (account_recurring_account_tag_rel, migración 0036) y cada movimiento que genera nace con ellas: un trigger las copia al insertarlo. Se eligen en Registrar con «Se repite» y al cambiar la recurrente; cambiarlas vale desde la próxima, como el monto, y cada movimiento ya registrado se cambia suelto. «Registrar el pago» de un recordatorio arranca con ellas | Heredarlas al leer, como las cuotas | Un movimiento de una recurrente es tuyo como cualquier otro: debe poder llevar otra etiqueta esa vez. Copiar es como fotocopiar el formulario con el sello ya puesto. Decidido por Claude con la autorización de Dany (16-nov) |
| Con quién (informativo) | En un gasto o un ingreso, «Con quién · opcional» anota con quién fue, sin crear deuda: va como partner_id en las líneas de categoría. Se elige al registrar (no en cuotas, repartido ni recurrente) y al clasificar; en el detalle se cambia o se quita (PUT /moves/{id}/with-partner). Al editar, si el formulario no lo manda, se queda aunque cambie la categoría. Para que te deban su parte siguen «Dividir» y «Pagó otra persona» | Solo al clasificar; que «Con quién» cree una deuda | Es una nota a lápiz en el recibo: debe poder escribirse, corregirse y borrarse venga de donde venga el gasto. Pedido por Dany (16-nov) |
| Cancelar un reparto con lo devuelto en otra moneda | «Cancelar lo que falta» acepta cualquier cuenta tuya: en otra moneda se escribe lo devuelto en ella y su tipo de cambio (el de SUNAT del día, editable). Si es la moneda en que pagaste (o cobraste), lo devuelto vale lo que costó, al tipo de entonces: eso baja lo que falta y la diferencia con el tipo de hoy va a «Ganancia por tipo de cambio» o «Costo del cambio». En otra moneda distinta vale al tipo de hoy. No puede pasar de lo que falta medido así. El detalle muestra lo devuelto en su moneda y la diferencia del cambio. Sin migración | Todo al tipo de hoy (la diferencia caería en el gasto de la categoría, o no se podría devolver todo si el dólar subió); seguir solo con cuentas en moneda base | Como una casa de cambio: los dólares que vuelven son los mismos que salieron, y si hoy valen más soles, eso es ganancia del cambio, no un seguro más barato. Igual que al cobrar a una persona en otra moneda (#81). Pedido por Dany (16-nov) |
| Atajos de teclado: mostrarlos y cambiarlos | Los tres a la vez, leyendo una sola lista (lib/shortcuts.ts). A: la tecla ? o el botón de teclado abajo en el riel abren una hoja con todos. B: pistas donde se usan (el globito del + con su tecla, la tecla en el buscador, en Editar y una franja abajo del detalle), con un interruptor para apagarlas. C: Más › Atajos de teclado (solo en escritorio) con la lista; en cada tecla de una letra o símbolo la tecla misma es el botón (opción A, 17-nov: al tocarla dice «Aprieta una tecla…» y espera la nueva; las fijas van aparte, más tenues y con candado) (registrar, buscar, editar, ver los atajos), el interruptor de las pistas y «Volver a los de fábrica». Esc, Ctrl + Enter y las flechas son fijas. Se guardan en la cuenta (res_users.ui_shortcuts solo con lo cambiado y ui_shortcut_hints, migración 0037); dos atajos no comparten tecla | Solo uno de los tres; teclas fijas; guardarlas en el navegador | Como los botones de una máquina: con rótulo (B), con una tarjeta con la leyenda al costado (A) y con su manual (C). En la cuenta valen en cualquier computadora. Elegido por Dany (16-nov), con bocetos en el lienzo «Atajos de teclado» |
| Fecha de cada cuota en la tarjeta | En el detalle de la tarjeta, la cuota 1 muestra la fecha de la compra y las demás el día después del corte anterior (el primer día del ciclo que la cobra). Solo cambia cómo se muestra: el gasto de cada cuota sigue con la fecha de su corte y cuenta en el mes en que se factura. Una compra con la parte de otra persona se nombra con tu categoría, no «Varias categorías» | Mover también la fecha del gasto de la cuota (cambiaría el mes en que cuenta y los reportes pasados); seguir mostrando la fecha de la compra | Un recibo de este mes no debe llevar impresa la fecha de hace dos meses. Opción A, elegida por Dany (16-nov) |
| Después de registrar | Si abriste Registrar (o Reembolso) desde una cuenta, una tarjeta o un préstamo, al guardar vuelves ahí, con su lista ya al día; si no, a Movimientos. En escritorio vale lo mismo para el panel | Siempre a Movimientos; siempre a la pantalla anterior | Si anotas en la libreta de una cuenta, sigues en esa libreta. Pedido por Dany (16-nov) |
| Compartido (gastos entre varios) | En un gasto, un bloque «Compartido» con su interruptor, bajo «En qué»: quién pagó (yo, una de las personas u otra), entre quiénes (tú y una o varias personas), partes iguales (el céntimo que sobra es tuyo) o por montos, y una frase con cómo queda. Prendido, el monto de arriba es el total. Si pagaste tú: tu parte va a la categoría y la de cada persona queda como lo que te debe (los splits con partner_id de siempre). Si pagó otro: no sale nada de tus cuentas, el gasto es tu parte y se la debes (paid_by_partner_id). Reemplaza «¿Quién pagó? Yo / Otra persona» de arriba y «Parte de alguien» dentro de Dividir, que queda solo para tus categorías (deben sumar tu parte). No va con cuotas, repartido, «Lo clasifico después» ni «Se repite»; prendido, «Con quién» se esconde. Al editar, lo que pagó otro o la parte de alguien vuelven al bloque. Sin migración. De paso, Etiquetas pasa al final de las opciones de Registrar | A: «Con quién» con «¿Te debe una parte?» (una sola persona, y «Pagó otra persona» aparte) | Como la cuenta del restaurante que se reparte en la mesa: primero quién pagó, luego entre quiénes. Junta en un lugar las tres formas de compartir que estaban dispersas. Opción B, elegida por Dany (16-nov), con bocetos de Registrar completo en el lienzo |
| Recurrentes compartidas e ingreso compartido | «Compartido» va también en un ingreso y en lo que se repite. Gasto: si pagas tú, la parte de cada persona queda en Por cobrar (te debe); si paga otra persona, de tus cuentas no sale nada y tu parte queda en Por pagar (le debes). Ingreso, el espejo: si cobras tú, entra todo a tu cuenta, tu parte es ingreso y la de cada persona queda en Por pagar (le debes); si cobra otra persona, no entra nada y tu parte queda en Por cobrar (te debe). En una recurrente, el molde guarda la persona de cada parte (account\_recurring\_line.partner\_id) y, si paga o cobra otra persona, va primero su Por pagar o Por cobrar, en moneda base. Al confirmarse sola, un trigger (0039) concilia lo que se deben, como al registrar a mano. Con monto variable, las partes se ajustan en la misma proporción. El detalle de la recurrente muestra «Compartido» y la persona, «Se repite con…» | Ingreso compartido como «Guardas su plata» (custodia); solo cuando pagas o cobras tú | Pedido por Dany el 19-nov (1A y 2B), boceto aprobado en el lienzo: es el espejo exacto del gasto compartido y se salda con «Le pagué» o «Me pagó»; la custodia es para plata que te encargan, no para una parte que tienes que entregar |
| Foco en el monto al registrar | En la computadora (desde 1024 px), Registrar empieza con el cursor en el monto: gasto, ingreso, transferencia, los de personas y el reembolso, también al cambiar de tipo dentro del panel. En el celular no, para que no salte el teclado | El foco en el panel (había que hacer clic en el monto); también en el celular | Como una calculadora que ya está prendida: escribes la cifra de una. Pedido de Dany (16-nov) |
| Estado de cuenta BBVA en PDF | Un segundo lector (card\_pdf/bbva.py) para «Estado de cuenta de tu tarjeta de crédito» del BBVA Perú: periodo, último día de pago, línea, utilizada y disponible, pago total por moneda, compras y pagos (cada fila trae S/ y $; la moneda es la que no es cero), el desgravamen y los intereses del periodo anterior como cargos del banco, las cuotas del periodo (que también son un movimiento del ciclo, en su corte) y el saldo de las cuotas de los próximos meses. El BBVA no imprime subtotal: se calcula como pago total − saldo del periodo anterior − cargos del banco − pagos, que son las compras y cuotas del ciclo, y así se valida la lectura. Las líneas leídas distinguen el pago (kind 'payment', migración 0038): se empareja con tu pago en PPM pero no entra en la suma ni explica diferencias del subtotal | Sin subtotal (sin validar la lectura); el subtotal con los pagos incluidos (no se compara con el de PPM, que no los cuenta) | Como un traductor más en la oficina: cada banco arma su estado a su manera. Validado con el estado de Dany del 11/10 al 10/11/26: S/ 755.51 = 1,169.68 + 7.19 + 1,240.00 de compras + 112.93 de cuota − 1,780 + 5.71, al céntimo |
| Versiones de PPM | Una sola versión para todo PPM (api y web), con etiquetas de git vX.Y.Z: el número del medio sube con cada función nueva y el último con cada arreglo. Mientras PPM sea beta va en 0.x; v1.0.0 será el lanzamiento al público. v0.1.0 = primer despliegue (#18); v0.14.0 = main al 17-nov-2026 (#96). La versión vive en api/pyproject.toml, en la de FastAPI y en web/package.json. Se muestra al pie de Más, bajo Privacidad: v0.x.y y una etiqueta BETA mientras sea 0.x. Si la api y la web salen a repositorios propios o llega una app móvil, lo que las une es el contrato de la API (/api/v1), no el número | Una versión para la api y otra para la web; v1.0.0 al terminar la fase 1 (13-nov) | Para quien usa PPM es un solo producto, como WhatsApp tiene un solo número aunque por dentro tenga servidores y apps; además siempre se despliegan juntas y la web toma sus tipos de la API. El 1.0 dice «listo para otros» y PPM todavía es beta. Elegido por Dany |
| Listas largas | Toda lista de opciones con más de 8 trae un buscador arriba (sin importar tildes), la elegida va primero y la lista se desliza dentro de su hoja o tarjeta; el buscador queda a la vista. Va en el componente de las hojas de opciones, así que llega a todas: país, cuentas de Registrar, Reembolso, Pagar tarjeta, Préstamos, Diferidos e Inicio a tu medida, el filtro de cuenta de Movimientos y el asiento manual. Los meses no, porque su orden es el dato. En la bienvenida, las monedas van en una tarjeta con buscador, las marcadas primero, y el título y «Siguiente» no se mueven. «Guardo de otros» usa el buscador de personas de Registrar cuando hay más de 8 personas | Las listas completas, con la pantalla entera deslizándose; un buscador solo donde ya había (personas, categorías, etiquetas, Agregar moneda) | Como los contactos del celular: si son pocos los ves todos, si son muchos escribes y se filtran. Con 150 monedas o muchas cuentas, bajar hasta encontrar una cansa y esconde el botón para seguir. Una sola regla para toda la app. Elegido por Dany |
| Pagar tarjeta: cuánto pagas | Como en la app del BCP, dos opciones sin el monto al costado: «Total del mes» (elegida si hay estado de cuenta por pagar; debajo, en grande, el monto y lo que cubre) y «Otro monto» (abre el campo; debajo, «Pagar toda la deuda» lo llena con todo lo que debes, incluidas las cuotas que vienen). Sin estado de cuenta por pagar, «Total del mes» queda apagada y se usa «Otro monto». El botón dice cuánto pagas. Reemplaza las pastillas «Lo del mes» y «Toda la deuda» con su monto | Las pastillas con el monto al costado sobre un campo ya lleno | Pedido por Dany el 18-nov, boceto aprobado en el lienzo: elegir primero qué pagas y ver el monto después se lee más claro |
| Entrar en la computadora | Desde 1024px, Entrar, Crear cuenta, Recuperar y Restablecer se parten en dos: a la izquierda un panel oscuro (tokens panel, panel-foreground, panel-muted, panel-line y panel-chip) con el refrán que crece con la ventana hasta 176px, el año entero, la frase y tres líneas de lo que hace PPM (Todo en un lugar, En qué se va la plata y Nada se te pasa, desde el 17-nov en lugar de Soles y dólares y Tarjetas claras); a la derecha el formulario con su título grande. El panel queda fijo si el formulario es más alto que la ventana. En el celular no cambia nada | La columna del celular sola en medio de la pantalla (antes); una tarjeta flotante al centro sobre el refrán | Es la portada de PPM, la primera impresión de quien llega: como la vitrina de una panadería, tiene que llenar el ancho y mostrar qué hay adentro. Elegido por Dany |
| Recurrentes, Más y Pendientes en la computadora | Desde 1024 px ninguna sección del riel queda con la columna del celular. Recurrentes va en dos paneles como Cuentas: la lista con los próximos 30 días a la izquierda y la elegida al lado, con Cambiar, Pausar y Terminar arriba y sus próximas fechas y lo ya registrado lado a lado. Más va en dos paneles como los Ajustes de la computadora: el índice a la izquierda (sin Pendientes, Reportes ni Recurrentes, que ya están en el riel; Instalar PPM, Privacidad, la versión y BETA al pie) y el ajuste elegido al lado; sin elegir nada abre Mi cuenta, que muestra dos tarjetas: Cómo entras y Tus datos. Pendientes va a lo ancho, en tres columnas que siempre están (Vencidos, Hoy y Próximos días), con «Avisarme N días antes» y «Escribir un recordatorio» arriba y el monto de cada aviso a la derecha. ↑ ↓ y Esc funcionan en las listas nuevas. Los formularios siguen en columna. En el celular no cambia nada | Dejarlas centradas junto al riel (decisión «Escritorio», 13-nov) | Al lado de Movimientos, Cuentas, Personas y Reportes, la columna sola se veía como un papelito en una mesa grande. Pedido por Dany (17-nov), bocetos aprobados en el lienzo |
| Una sola fila de movimiento | Todas las listas de movimientos (Movimientos, Inicio, una cuenta y una tarjeta) usan la misma fila. El nombre es la nota, o la categoría si no hay nota; la categoría es el ícono de color y no se escribe abajo. La línea chica lleva, en este orden y solo si aplica: Por confirmar en ámbar; la fecha, donde no hay rótulo de día ni columna; la cuota y su interés; la cuenta con su propio ícono (dentro de una cuenta o tarjeta no se repite: en una transferencia va la otra, «A Visa BBVA»); en un cambio de moneda, lo que llegó y a cuánto («US$ 100.00 a 3.750»); el clip si tiene adjunto; y las etiquetas. Cada dato empieza con su ícono o su punto de color, así no hace falta separador. En la fila angosta (el celular y la lista de Movimientos en la computadora) las etiquetas van debajo como chips; en la ancha (la tabla de una cuenta o tarjeta en la computadora) van en la misma línea. Cuenta y tarjeta quedan iguales en la computadora: Fecha, Movimiento, Monto (y Saldo en la cuenta), sin las columnas Categoría ni Detalle. La lista trae el ícono de la cuenta, las etiquetas y cuántos adjuntos tiene cada movimiento | «Categoría · cuenta» debajo de cada fila, y una tabla distinta en la cuenta y en la tarjeta | Sin nota la categoría salía dos veces, como una etiqueta de frasco que dice «Mermelada» y abajo «Mermelada, de la despensa». Cada lista contaba lo mismo a su manera. Pedido por Dany (18-nov), bocetos aprobados en el lienzo |

Preguntas para las siguientes sesiones:

- [x] ¿Cuentas jerárquicas desde ya (Gastos > Comida > Restaurantes) o planas?
- [x] ¿Cómo modelar cuentas en USD y transferencias PEN ↔ USD?
- [x] ¿Estados de transacción (borrador / confirmada), como `state` en `account.move`?
- [x] ¿Cómo se corrige un error: editar, borrar o registrar un reverso?
- [x] ¿Tarjetas de crédito con fecha de corte y fecha de pago?
- [x] ¿Cómo se verá cada tipo de cuenta en la interfaz, sin lenguaje contable? Resuelto con las pantallas del lienzo: «Lo que tengo» y «Lo que debo», cuentas, tarjetas, personas y categorías, sin Debe ni Haber.
- [x] ¿De dónde saca la app el tipo de cambio SUNAT diario: una API o carga manual?
- [x] ¿Pago mínimo: anotarlo desde el estado de cuenta o estimarlo? Cada banco usa su propia fórmula.
- [x] Descartado: meses de gracia y disposición de efectivo. Las tarjetas se quedan en lo mínimo indispensable: corte, vencimiento y cuotas.
- [x] ¿Conciliación de deudas (emparejar cada cobro con la deuda que cancela, como en Odoo) o basta el saldo por persona?
- [ ] Pendiente futuro: elegir framework y tecnologías cuando la lógica de negocio esté completa.
- [x] ¿Separar los datos de demostración (tipos de cambio y movimientos de muestra del simulador) de la plantilla inicial, como la opción de datos demo de Odoo?
- [x] Confirmar un borrador recurrente de monto variable cuando el extracto importado traiga un movimiento que coincida: resuelto en la importación (borradores de dos líneas).
- [ ] Pendiente futuro: presupuesto como capa sobre las categorías (no es una clasificación nueva ni toca los movimientos); elegir entre base cero (YNAB) o plan contra real (Odoo, Wallet). Van con él la edad del dinero y la memoria de categoría por comercio.
- [ ] Pendiente: otros países. La moneda base es la del país; para abrir uno que no use soles hará falta una fuente de tipo de cambio en su moneda, porque SUNAT publica en soles por unidad.
- [x] Al clasificar un movimiento de «Por clasificar», ¿se puede elegir también el contacto? Sí: «Con quién · opcional» en la categoría, desde la rebanada de importaciones; desde #88 se ve en el detalle («Con quién») y no se pierde al editar.
- [x] Pendiente al terminar la rebanada 6: del despliegue, un usuario de conexión a PostgreSQL que no sea el dueño de las tablas, y monitoreo externo de /api/health.

## Bitácora de cambios

| Fecha | Cambio |
| --- | --- |
| 2026-11-17 | Versiones: una sola para todo PPM, beta en 0.x hasta el lanzamiento al público (v1.0.0). Etiquetas v0.1.0 (#18, primer despliegue) y v0.14.0 (#96). Listas largas: buscador y la elegida primero en toda lista de más de 8; las monedas de la bienvenida en una tarjeta con buscador. Entrar, Crear cuenta y Recuperar en la computadora: el panel oscuro con el refrán a la izquierda y el formulario a la derecha. La versión al pie de Más, con la etiqueta BETA. Recurrentes y Más en dos paneles en la computadora y Pendientes en tres columnas; en Entrar, los reportes y los avisos en lugar del tipo de cambio y las tarjetas. Las fotos adjuntas se guardan livianas, como en Odoo |
| 2026-11-16 | #79: el + arranca con la cuenta predeterminada en cualquier pantalla, no solo en el Inicio (como decía «Inicio a tu medida»). #80: filtros de Movimientos recordados mientras la app esté abierta. #81: cobrar o pagar a una persona en otra moneda, con la diferencia de cambio realizada. Dany autorizó el merge propio de #80 y #81. #82: la cuenta predeterminada también en Me pagaron, Le presté, Reembolso y al cambiar de tipo; Reportes no lista lo que quedó en cero. #83 (0034): ingresos y gastos diferidos, «Repartir en el tiempo» por días o por meses, con «Cancelar lo que falta». #84: «De antes de PPM» también se abre en el panel de Registrar en escritorio (antes no salía nada). #85: lo de antes de PPM con una persona se corrige con «Editar». #86: la prueba del tipo de cambio en Inicio no depende de que SUNAT publique hoy; resuelta la pregunta de cómo se ve cada tipo de cuenta sin lenguaje contable. #87: Gastos e Ingresos empiezan en general (plegar un grupo vuelve al total; cambiar de periodo o de reporte también). #88 (0035): etiquetas en el movimiento entero, heredadas por cuotas y partes repartidas, con filtro en Movimientos, reporte Etiquetas y Más › Etiquetas; con quién fue un gasto clasificado se ve en su detalle y ya no se pierde al editar. Dany autorizó el merge propio de #86 a #88. #89 (0036): etiquetas en las recurrentes (cada movimiento nace con ellas) y «Con quién» informativo al registrar, que se cambia o se quita desde el detalle. #90: cancelar un reparto con lo devuelto en otra moneda, con la diferencia del cambio. Dany autorizó el merge propio de #89 y #90. #91 (0037): atajos de teclado a la vista (? y el botón del riel, pistas con interruptor, Más › Atajos) y editables. #92: en la tarjeta cada cuota con la fecha de su ciclo y la compra dividida con otra persona con tu categoría; al registrar desde una cuenta vuelves a esa cuenta. #93: «Compartido» en Registrar (quién pagó, entre quiénes, partes iguales o por montos) y Etiquetas al final. #94: en la computadora Registrar empieza con el foco en el monto. #95 (0038): lector del estado de cuenta BBVA en PDF, con el subtotal calculado del pago total. #96: en Más › Atajos la tecla es el botón para cambiarla (opción A) |
| 2026-11-15 | Exportar mis datos: un ZIP con datos.json, csv/ y adjuntos/ (opcionales), desde Mi cuenta y desde Eliminar mi cuenta. Antes, #76: el lector del PDF BCP vuelve a leer con el ancho de la letra del PDF si la lectura normal no cuadra; #77: Esc cierra el panel de Registrar aunque la hoja de tipos todavía se esté yendo, y los e2e esperan el paso 2 de la bienvenida. Dany autorizó el merge propio de #76 y #77 |
| 2026-11-14 | Privacidad y Eliminar mi cuenta (#75, 0033): la página pública /privacidad para verificar la marca en Google, y eliminar la cuenta con todo lo suyo al instante, confirmando con la contraseña o el correo |
| 2026-11-14 | Entrar con Google (#74, 0032): Continuar con Google, unir con la contraseña una cuenta que ya existe, vincular, desvincular y crear contraseña en Mi cuenta. Una Google falsa (google-falsa) para desarrollo y e2e |
| 2026-11-14 | Monedas y formato (#73, 0031): catálogo ISO 4217, agregar y quitar monedas, la principal fija y el formato Perú o España. «Muy pronto» desaparece de Más. Dany autorizó el merge propio de #72 y #73 |
| 2026-11-14 | Fechas y cierre (#72): toda fecha que crea un asiento (saldo inicial, pagos, préstamos, reembolsos, asiento manual, lo que ya debía, plata que guardo, recurrentes) bloquea los días cerrados y lo explica en el calendario; los atajos «Hoy» y «Ayer» también. A pedido de Dany, «Instalar PPM» sale de la lista de Más a su propia sección, «En este equipo» |
| 2026-11-14 | Versión de escritorio (#71): desde 1024 px el riel reemplaza la barra de abajo; Movimientos, Cuentas, Personas y Reportes en lista y detalle; el Inicio en tres columnas; los movimientos de la cuenta y el ciclo de la tarjeta en tabla; Registrar en panel lateral; atajos N, /, ↑ ↓, E, Esc y Ctrl ↵. Dany aprueba las hojas como ventana al centro, sin flecha de volver en los paneles y que al guardar desde el panel se llegue a Movimientos. En el celular las capturas salen idénticas a las de main |
| 2026-11-13 | Dany elige el riel de íconos (B) para escritorio y aprueba los 16 cambios de la revisión UI/UX del celular (#70): la tarjeta por ciclo, «Confirmar» en el aviso, la cuenta con sus movimientos arriba, los totales de Personas en una fila, una regla de títulos, la pestaña de donde llegaste, el dólar en claro, el token selected para oscuro, siluetas al cargar y vacíos al estilo de Recurrentes |
| 2026-11-13 | Rendimiento (#69): la API ya era rápida (menos de 110 ms con un año de datos); lo lento era la fuente de íconos completa y la app en un solo archivo. Íconos a la medida, tipografías propias, pantallas bajo demanda y service worker |
| 2026-11-13 | Bocetos aprobados: «Instalar PPM» en Más y adjuntos estilo Odoo 20. Adjuntos: miniaturas y vistas del servidor (Pillow, pillow-heif y pypdfium2), GET /attachments/{id}/thumb y /view con caché de un año, orden del más reciente al más antiguo y el visor nuevo en celular y escritorio (0030) |
| 2026-11-13 | Nueva etapa tras la fase 1, en este orden: logo e ícono, adjuntos estilo Odoo 20, rendimiento, y UI/UX con versión de escritorio. Dany elige la hogaza como logo; PPM se puede instalar como app |
| 2026-11-13 | #65 en main (0028). Ajustes de la revisión final: se pueden cancelar las cuotas de una compra de un mes cerrado (la fecha mínima es el día siguiente al cierre o al último corte facturado); 0029 liga el pago de «Pagué lo que faltaba» a su cancelación y deshacerla lo borra (elegido por Dany); el arranque de una tarjeta en un mes cerrado sigue pidiendo reabrir (elegido por Dany) |
| 2026-11-13 | Rebanada 13 · Cierre de periodo: boceto de X4 aprobado por Dany. #64 en main (0027, con el asiento de una cancelación que ya no pasa a por confirmar). 0028: candado por dueño de la fila y solo sobre lo que cambia saldos, lock\_blockers, solo días pasados, realinear sin mover lo cerrado; GET y PUT /closing, lock\_date en /me y locked en el detalle; X4 en Más, el candado en el detalle y Registrar sin fechas cerradas. Con esto termina el plan de construcción de la fase 1 |
| 2026-11-13 | Dany autoriza a Claude a terminar solo (merge incluido) la revisión de tarjetas y la rebanada 13. #63 en main (0026). La cuota del banco es distinta (0027): la conciliación propone la compra tuya que sería esa cuota salvo por el monto; «Usar la del banco» reescribe la compra (tarjeta y Cuotas por venir por todas las cuotas), sus líneas y lo ya facturado con set\_installment\_amount, y divide la cuota con su detalle; «No es esta compra» guarda el plan en rejected\_plan\_ids |
| 2026-11-13 | Dany aprueba los bocetos de la revisión de tarjetas (M2 con «Cancelar las cuotas que faltan», su hoja y «La cuota del banco es distinta») y elige que «Pagué lo que faltaba» pida la cuenta y registre el pago. #62 en main (0025). Cancelar las cuotas (0026): cancel\_installment\_plan, asiento ligado al plan (cancel\_move\_id) y las cuotas que faltaban guardadas en canceled\_lines; borrar el asiento las devuelve con los cortes de hoy; POST /plans/{id}/cancel |
| 2026-11-13 | Revisión de las tarjetas antes del Cierre de periodo. 0025: al importar un estado de cuenta, el calendario de cada compra en cuotas se rehace desde su fecha con los cortes del banco (antes, si el banco cortaba antes del día de la tarjeta, la cuota saltaba un mes); la última cuota en otra moneda se lleva el céntimo del redondeo; «Cuotas por venir» se valora a la venta, como la tarjeta. Decididos por Dany, con boceto pendiente: «Usar la del banco» en la conciliación y «Cancelar las cuotas que faltan» con dos salidas, «Lo devolví» y «Pagué lo que faltaba». La sección Tarjetas de crédito y la decisión Compras en cuotas se ponen al día con 0021 |
| 2026-11-06 | Copias en el repo (#60): docs/modelo-contable.md y design-system/, con la tabla de artefactos en el README. Se sincronizan: el sistema de diseño recibe destructive-soft, attention-soft y age-0 a age-3, que ya usaba el código; CLAUDE.md dice leer las copias y escribir en el original |
| 2026-11-05 | Reportes terminado: #57 API (/reports/expenses, income, flow, net-worth, people y summary; sin migración, todo sale de account\_move\_line) y #58 web, llevada a main con #59 porque #58 se fusionó primero en la rama de la API. Recharts 3.10.1: dona y barras apiladas en Gastos, barras en Ingresos, Sankey y línea del % guardado en Flujo, área de 12 cierres en Patrimonio y tramos de antigüedad en Personas. La paleta de categorías no separa bien colores vecinos (validador de gráficos): el color va siempre con ícono y nombre |
| 2026-11-05 | Ajustes antes de Reportes terminados (Dany autorizó a Claude a hacer el merge; solo revisó los diseños): #52 + desde la cuenta, Personas filtrada, calendario y selector de persona; #53 «Lo clasifico después» y la categoría Ajuste (0023); #54 Inicio a tu medida y modo privado (0024); #55 transiciones con View Transitions y hojas animadas; #56 adjuntos a movimientos (ir\_attachment 'account.move', foto o PDF de hasta 5 MB). Los bocetos de la propuesta se rehicieron sobre los bocetos finales del lienzo; regla: toda pantalla pasa por el lienzo antes del código |
| 2026-11-05 | Pendientes terminado (#49 base, #50 API, #51 web). Ajustes pedidos por Dany antes de Reportes: gasto sin clasificar y categoría Ajuste; Inicio a tu medida con modo privado; + desde una cuenta; Personas filtrada; calendario de mes y año propio; selector de persona con búsqueda; transiciones suaves; y adjuntos a movimientos |
| 2026-11-04 | Decisiones de la rebanada Pendientes: avisos calculados y posponibles, con anticipación configurable; recordatorios propios de una vez, colgados de un movimiento, una persona, una cuenta o sueltos, que quedan como hechos con su fecha; pantalla propia con resumen en Inicio; las recurrentes en modo recordatorio pasan a la bandeja |
| 2026-10-28 | Simplificar cuotas y línea e importar el estado de cuenta en PDF (pedido de Dany; merge autorizado): #48 (0021). Cada cuota es gasto en su corte desde «Cuotas por venir»; la de otra persona te la debe completa; lector BCP del PDF con validación contra el subtotal; la foto del banco manda sobre la línea y las fechas del ciclo. Se quitaron el reparto estimado, el saldo de cuotas manual y la validación del tipo de cambio implícito |
| 2026-10-28 | Correcciones de la tarjeta (observaciones de Dany tras conciliar su Visa Qore; Dany autorizó hacer el merge sin esperarlo): #44 menos «Te debe» repetido y vencimiento solo si existe; #45 cuotas con capital e interés y compras en cuotas de otra persona (0018); #46 cargos del banco por confirmar (0019); #47 foto del ciclo, TC editable y conciliación del estado de cuenta (0020), validada con el caso Qore. Descartado: la fecha de proceso |
| 2026-10-28 | Rebanada 9: base #41 y API #42 en main; web en el PR #43 (Registrar con «Se repite», Recurrentes y su detalle con «solo esta vez», el aviso del recordatorio en el Inicio, y el préstamo: crearlo, verlo y pagar la cuota). Dos ajustes al diseño aprobados por Dany: Nuevo préstamo pregunta de qué cuenta se paga la cuota también al «ya lo venía pagando», y el detalle dice «Pagaste N cuotas · faltan M» (no se guarda el total de cuotas) |
| 2026-10-28 | Crear categorías ya en main (API #38, web #40). Base de la rebanada 9 (0017\_recurrentes): account\_recurring, account\_recurring\_line y account\_recurring\_exception con user\_id y seguridad por fila; recurring\_id y recurring\_date en account\_move; account\_loan (la cuenta de pasivo, el banco y su cuota); nth\_weekday, account\_recurring\_dates, account\_recurring\_run (marca terminada la que llegó a su fin; alias t en el UPDATE final porque r es la variable del bucle), la vista account\_recurring\_reminder con user\_today() y account\_recurring\_forecast. import\_statement\_line enlaza un borrador de una recurrencia de monto variable de dos líneas, a 3 días o menos: toma el monto y la fecha del banco y se confirma |
| 2026-10-28 | Diseño final de la rebanada 9 aprobado (Registrar con «Se repite», Recurrentes, una recurrente, solo esta vez, nuevo préstamo, detalle del préstamo, pagar la cuota y el aviso de un recordatorio). Se adelanta crear categorías desde Más › Categorías, antes de la base de Recurrentes |
| 2026-10-28 | Decisiones de la rebanada 9: los préstamos de banco entran con Recurrentes; la recurrencia se crea en Registrar con «Se repite»; los recordatorios pasan a ser globales (Pendientes) en una rebanada propia después. Plan de construcción: se suman la rebanada 8b y Pendientes |
| 2026-10-28 | Web de la rebanada 8b: el calendario de shadcn/ui (react-day-picker 9.14.0) en una hoja con atajos y saltos de mes y año reemplaza las 12 fechas del navegador; «¿De cuánto cada una?» en las cuotas con su resumen de intereses; «Le presté» con la tarjeta, su moneda, «En cuotas» y «El interés lo pago yo»; en una persona, cada deuda con su vencimiento (vencida en ámbar y el total vencido arriba) y las partes de una compra juntas; la hoja para poner, cambiar o quitar la fecha desde la persona o desde el detalle del movimiento. Arreglo aparte (PR #36): la búsqueda de Movimientos ya no reescribe la URL al abrir |
| 2026-10-28 | API de la rebanada 8b: en /moves, installment\_amount (la cuota del cronograma; lo que pasa del precio va a Intereses y la tarjeta carga las cuotas) e interest\_mine; «Le presté» acepta una tarjeta y «En cuotas» (una parte de Por cobrar por cuota, con set\_plan\_maturities); un préstamo en partes se lee como préstamo. El detalle de una persona da date\_maturity, maturity\_manual, maturity\_closing, part y parts de cada deuda, ordenadas por vencimiento; el de un movimiento, el vencimiento de cada línea. PUT /move-lines/{id}/maturity pone o quita la fecha y vuelve a conciliar |
| 2026-10-28 | Diseño de la rebanada 8b aprobado (cuota con interés, Le presté con tarjeta en cuotas, compra con intereses, vencimientos en Personas, hoja de vencimiento y calendario). Base (0016\_vencimientos): account\_move\_line.date\_maturity (a mano) y maturity\_closing (el corte de cada parte); account\_move\_line\_residual da el vencimiento efectivo (el de a mano o la fecha de pago del ciclo de su corte); set\_plan\_maturities reparte los cortes, una parte por cuota; reconcile\_partner cobra primero lo que vence antes. La cuota con interés no cambia el modelo: el plan va por el total que se le debe al banco |
| 2026-10-28 | Decisiones de ajustes a tarjetas y personas (antes de Recurrentes): «Le presté» con tarjeta y en cuotas; date\_maturity opcional en las deudas, partida por cuota al prestar la tarjeta en cuotas (cada parte vence con la fecha de pago del ciclo de su corte, cuando se escribe); la cuota se escribe y el interés va a «Intereses» el día de la compra en el mismo movimiento; calendario de shadcn/ui en una hoja |
| 2026-10-28 | Web de la rebanada 8: en C2 de un banco, el último extracto (si cuadra) con «Importar extracto» y cuántos faltan clasificar; C7 en tres pasos en /cuentas/:id/importar (subir con los extractos anteriores, qué columna es qué con monto o cargo y abono, formato de fecha, decimales y el saldo del banco, y antes de importar con el control de saldo); /extractos/:id con el archivo y deshacer; M3 /por-clasificar con «Elegir varios» y la hoja para clasificar (categoría con persona opcional, mis cuentas o una persona); M2 con «Lo que dice el banco» y Clasificar; el Inicio avisa en ámbar y M1 filtra Por clasificar. Los movimientos por clasificar no se editan en Registrar: se clasifican |
| 2026-10-28 | API de la rebanada 8: el adaptador lee .xlsx (openpyxl), .xls (xlrd) y .csv (separador y codificación detectados), busca la fila de encabezados, adivina las columnas o usa las recordadas de la cuenta, y salta las filas sin fecha (títulos y totales). POST /accounts/{id}/statements/preview importa y deshace para decir qué pasaría (nuevos, enlazados, ya importados, sin monto, con problemas y si el saldo cuadra); POST /accounts/{id}/statements lo guarda con su archivo y recuerda las columnas; GET de los extractos de una cuenta y de uno con lo que sigue por clasificar; GET /statements/{id}/file; DELETE /statements/{id} deshace. GET /unclassified y POST /unclassified/classify (varios a la vez; categoría, cuenta o persona con role; un cobro, pago o devolución no pasa de lo que se debe; concilia). Los movimientos en Por clasificar son kind unclassified con incoming; M2 trae lo que dijo el banco; C2 trae cuántos faltan y el último extracto; el Inicio cuántos faltan. Archivos de hasta 5 MB en el volumen filestore (FILESTORE\_DIR), con un recolector al deshacer; el respaldo diario guarda también los adjuntos y DESPLIEGUE.md dice cómo restaurarlos |
| 2026-10-27 | Base de la rebanada 8 (0015\_importar): account\_import\_template(\_column), account\_bank\_statement y account\_bank\_statement\_line con user\_id, seguridad por fila y la huella única por usuario; la línea guarda move\_created (si la importación creó el asiento o lo enlazó) para que deshacer borre solo lo creado. ir\_attachment con user\_id para asientos y extractos, y sus dos triggers (el registro existe; se borra con él). import\_statement\_line devuelve duplicate, matched, created, o locked / future si la fecha cae en un periodo cerrado o no llega; enlaza también borradores ya vencidos; el enlace con borradores de recurrencias llega con Recurrentes. classify\_move(p\_move, p\_account, p\_partner) pone la persona y rechaza una cuenta en otra moneda (es un cambio), Por clasificar y Saldos iniciales. undo\_bank\_statement borra lo creado que sigue por clasificar y el extracto. Vista account\_bank\_statement\_check |
| 2026-10-27 | Diseño final de la rebanada 8 (Importar extracto y Por clasificar) aprobado en el lienzo: C2 con «Importar extracto» y lo que falta clasificar, C7 en tres pasos (subir, columnas, antes de importar con control de saldo), un extracto con deshacer, M3 Por clasificar (uno o varios), la hoja para clasificar (categoría, mis cuentas o una persona) y M2 de un movimiento traído del banco |
| 2026-10-27 | Decisiones de la rebanada 8 (Importar extracto y Por clasificar): el extracto se lee en la API con Python; el archivo se guarda desde ya como ir\_attachment en la carpeta del usuario, con su volumen y respaldo; en esta rebanada solo se importa a cuentas de banco (las tarjetas, después, por las líneas de cuota); deshacer borra solo lo que sigue en Por clasificar |
| 2026-10-27 | Web de la rebanada 7: Nueva cuenta › Tarjeta de crédito (ya no «Muy pronto»), C1 con lo que toca pagar y «falta la fecha de pago», C3 /tarjetas/:id con su menú (renombrar, corte y línea, fecha de pago, archivar), Pagar tarjeta por bolsillo (desde el banco por defecto; sin plata en esa moneda lleva a comprarla), Cuotas de antes de PPM, en Registrar la moneda de la tarjeta y «En cuotas» con sus cortes, y en M2 el calendario de una compra en cuotas, sin Editar. La API suma closing\_day al resumen de la tarjeta |
| 2026-10-27 | API de la rebanada 7: POST /cards (lo que toca pagar por moneda y la fecha de pago), GET /cards/{id} (estado por moneda, línea usada y disponible, cuotas que faltan y movimientos por ciclo: cada compra en su ciclo y cada cuota en el suyo), PATCH /cards/{id}, PUT /cards/{id}/opening y /due-date, POST /cards/{id}/installments (cuotas de antes de PPM). En /moves: currency para la moneda de la tarjeta e installments (2 a 60) en un gasto con tarjeta; pagar es una transferencia a la tarjeta en la moneda de la cuenta de donde sale. Una tarjeta no recibe ingresos ni presta; C1 muestra lo que toca pagar y la fecha |
| 2026-10-27 | Base de la rebanada 7 (0014\_tarjetas): account\_credit\_card, account\_credit\_card\_cycle, account\_installment\_plan y sus líneas, todas con seguridad por fila; day\_in\_month, card\_closing\_for, card\_last\_closing, create\_credit\_card, post\_card\_opening (lo que toca pagar, con fecha del último corte), set\_card\_due\_date, create\_installment\_plan (2 a 60 cuotas), post\_card\_installments\_opening (cuotas de antes de PPM) y credit\_card\_status(p\_today). Una compra en cuotas no cambia de montos, cuenta ni fecha ni vuelve a borrador; se borra con su plan |
| 2026-10-27 | Diseño final de la rebanada 7 (Tarjetas y cuotas) aprobado en el lienzo: C1 con la tarjeta, C5 tarjeta, C3 detalle con movimientos por ciclo, gasto en cuotas, pagar tarjeta por bolsillo, cuotas de antes de PPM y el detalle de una compra en cuotas |
| 2026-10-26 | Acceso a Personas sin deudas (web): botón fijo de Personas en la cabecera de Cuentas, junto a «+»; «De antes de PPM» también en Registrar › Más › Con otra persona (/registrar/saldo-inicial), que elige o crea a la persona ahí mismo. Antes solo se llegaba a Personas desde las filas Me deben y Debo a personas, que se esconden en cero |
| 2026-10-26 | Saldo inicial con una persona (base, API y web): 0013 post\_partner\_opening; POST /partners/{id}/opening; en el detalle de la persona, «De antes de PPM» (me debía / le debía, moneda, monto, desde cuándo y nota). Va contra Saldos iniciales, no mueve tus cuentas y se corrige borrándolo |
| 2026-10-26 | Correcciones de la revisión de Codex al despliegue: 0012\_admin\_minimo deja a ppm\_admin sin BYPASSRLS y solo con el tipo de cambio; /health responde a HEAD y la guía pide https:// y GET (UptimeRobot cuenta 200 a 399 como arriba) o el monitor Keyword; las pruebas de la API entran como ppm\_api también en el CI. ppm\_api no protege los datos de las personas si alguien usa su conexión: la API declara app.user\_id |
| 2026-10-26 | Pendiente del despliegue resuelto (rama despliegue-usuario-api): 0011\_usuario\_api crea ppm\_api (NOINHERIT, solo puede asumir ppm\_app o ppm\_admin); el servicio usuario-api le pone la contraseña de PPM\_API\_PASSWORD; la API entra así también en desarrollo y CI. DESPLIEGUE.md: los dos usuarios, el paso único para un servidor ya desplegado y el monitoreo con UptimeRobot sobre /api/health |
| 2026-10-26 | PR de la web de la rebanada 6: C6 Personas y el detalle de una persona (pagos, compensar, devolver, dar por perdido, editar); el panel «Más tipos de movimiento» con el formulario con otra persona, reembolso y asiento manual; «¿Quién pagó?» y la parte de otra persona al dividir; C1 lleva a Personas. En las listas, prestar, cobrar o guardar van en gris con su signo: no son ingreso ni gasto |
| 2026-10-26 | PR de la API de la rebanada 6: Registrar acepta los ocho tipos de «Más», dividir con una persona y el gasto que pagó otra; un cobro, pago o devolución no pasa de lo que se debe; se concilia al guardar, editar, confirmar o borrar (o primero la deuda elegida); rutas /partners/overview, /partners/{id}, compensar, dar por perdido y /manual-accounts. El asiento manual va en moneda base; compensar y dar por perdido no se editan, se borran |
| 2026-10-26 | PR de la base de la rebanada 6 (0010\_personas): account\_partial\_reconcile, account\_move\_line\_residual, res\_partner\_balance y reconcile\_partner (de lo más antiguo a lo más nuevo, por moneda); un movimiento que vuelve a por confirmar, se borra o cambia de monto pierde sus conciliaciones; Deudas incobrables pasa a cuenta de sistema (bad\_debt) |
| 2026-10-26 | Diseño de la rebanada 6 aprobado (C1 con personas, C6 Personas y el detalle de una persona, el panel «Más tipos de movimiento», Registrar con otra persona, Dividir con una persona y «pagó otra persona», Reembolso y Asiento manual); un cobro o pago no puede pasar de lo que se debe |
| 2026-10-26 | Decisiones de la rebanada 6: deuda por deuda con conciliación automática; «Le devolví o usé su plata» en Registrar › Más; dividir con una persona y «alguien pagó por mí» entran ya; asiento manual con «Entra a» y «Sale de». Caso de uso CON-07 Guardar plata de otros (58 casos). Lo pendiente del despliegue queda para después de la rebanada 6 |
| 2026-10-26 | Plan de construcción: Personas y las opciones de «Más» en Registrar se adelantan al sexto lugar, antes de Tarjetas |
| 2026-10-26 | Despliegue documentado en el repo (rama despliegue): docker-compose.prod.yml, web/Dockerfile y web/Caddyfile, deploy/.env.example, deploy/respaldo.sh, DESPLIEGUE.md y AGENTS.md. Probado en local, incluido restaurar un respaldo. Pendiente: un usuario de conexión a PostgreSQL que no sea el dueño, y monitoreo externo de /api/health |
| 2026-10-26 | PR de la web de la rebanada 5: el tipo del día (SUNAT, editable) en Registrar, cuentas, saldo inicial, plata que guardo y el paso 2; al vender dólares la tarjeta del costo del cambio o la ganancia (antes de guardar y en el detalle); el Inicio dice con qué tipo cuentan tus dólares y avisa a los 3 días; Z1 en Más solo para el administrador. GET /rates sugiere también antes de configurar (todas las monedas con tipo). Ya no queda la sugerencia fija de 3.750 |
| 2026-10-26 | PR de la API de la rebanada 5: importador de SUNAT dentro de la API (al arrancar si hoy no se cargó nada y a las 09:00 de Lima; 5 reintentos cada 30 min); Z1 en /admin/rates para ADMIN\_EMAILS; GET /rates con el tipo del día; al cambiar de moneda lo que sale va a su costo promedio (lo confirmado hasta ese día, sin el movimiento que se edita; si se va todo, su valor exacto) y la diferencia a fx\_gain o fx\_loss, que cuentan en el mes; gastos e ingresos sin tipo usan el del día; saldos en otra moneda al tipo de hoy (book guarda el de libros) |
| 2026-10-26 | Diseño de la rebanada 5 aprobado. PR de la base (0009\_tipo\_de\_cambio): res\_currency\_rate; set\_currency\_rate carga un día (manda el último, solo ppm\_admin, el sol no lleva tipo); get\_rate falla con «Falta el tipo de cambio» si no hay ninguno anterior; res\_currency\_rate\_status usa la fecha de Lima y cuenta cuántas personas usan cada moneda. account\_unrealized\_fx queda para Reportes |
| 2026-10-26 | Importador de SUNAT: una vez al día con hasta 5 reintentos si falla; pisa lo cargado a mano porque manda el último que se cargó |
| 2026-10-26 | Decisiones de la rebanada 5 (tipo de cambio y dólares): diferencia realizada al cambiar de moneda contra el costo promedio; dólares al tipo de hoy en «lo que realmente tengo»; euros a mano por el administrador; administradores por ADMIN\_EMAILS. Fuente de SUNAT verificada: fecha\|compra\|venta\|, solo dólares |
| 2026-10-26 | PR de la web de la rebanada 4: el Inicio es la primera pantalla (para mayo en trigo, en qué se va la plata, cuentas y lo último, con selector de mes); Más mínimo con Mi cuenta y Apariencia (tema y acento al instante); la barra de abajo queda completa |
| 2026-10-26 | Diseño de la rebanada 4 aprobado (Inicio, Más, Mi cuenta y Apariencia). PR de la API: GET /home y PATCH /me; sin cambios en la base. «Para mayo» cuenta solo lo confirmado; su % se redondea al entero y no se muestra si no entró nada |
| 2026-10-25 | PR de la web de la rebanada 3: Registrar (con hoja de categorías, Dividir, entre monedas y Por confirmar), Movimientos por mes con búsqueda y filtros en la URL, y el detalle con editar, confirmar y borrar; la barra activa Movimientos y el + |
| 2026-10-25 | PR de base (0008: íconos y colores, nada futuro confirmado) y PR de API de la rebanada 3: registrar, editar, confirmar y borrar movimientos; lista por mes con filtros y búsqueda; categorías para la hoja. Al dividir en otra moneda, la última parte absorbe el redondeo; los saldos iniciales no aparecen en Movimientos (se ven y corrigen en su cuenta) |
| 2026-10-25 | Diseño de la rebanada 3 aprobado: R1 Registrar (con la hoja de categorías según gasto o ingreso), M1 Movimientos, M2 Detalle y la paleta de íconos y colores de las categorías |
| 2026-10-25 | PR de la web de la rebanada 2: Cuentas, detalle, nuevas cuentas, plata que guardo de otros y la hoja de selección; el paso 3 guarda saldos y bancos al final; configurado lleva a /cuentas (Inicio sigue provisional hasta la rebanada 4) |
| 2026-10-25 | PR de la API de la rebanada 2: rutas de cuentas, saldo inicial, plata que guardo de otros y personas; montos como texto exacto; archivar solo con saldo cero; limpieza automática de las cuentas de prueba de e2e |
| 2026-10-25 | Diseño de cuentas aprobado (C1, C2, C5 en tres pantallas). PR de la base de la rebanada 2: 0006\_asientos y 0007\_altas, con user\_id y seguridad por fila; «Saldos iniciales» se busca por system\_role; el cuadre usa la moneda base del dueño del asiento; post\_opening\_balance acepta persona; set\_opening\_balance corrige el saldo inicial |
| 2026-10-25 | Pantallas de acceso en web/ conectadas a la API (rutas /entrar, /crear-cuenta, /recuperar, /restablecer, /bienvenida/1-3 e /inicio provisional), con Playwright contra la API real en el CI. Pendiente en la web hasta que la API lo tenga: el tipo de cambio del día en el paso 2 y agregar bancos y tarjetas en el paso 3 |
| 2026-10-25 | Diseño final de acceso aprobado (dirección «Hacia mayo», 7 pantallas); sistema de diseño con title-display, title-hero, input-line y trigo como sello. Esqueleto de web/: Vite, React, Tailwind con los tokens, proxy /api, tipos generados y CI «Web» |
| 2026-10-25 | Repositorio único ppm (api/ y web/) en lugar de dos; seis decisiones de la web: mismo origen con proxy, web en Docker, pnpm, openapi-typescript + openapi-fetch, diseño antes del código, Vitest + Playwright |
| 2026-10-25 | PR 3 de ppm-api: 0005\_acceso (sesiones, enlaces y funciones auth\_\*), rutas /auth, /me, /me/setup y /catalog, Mailpit para los correos |
| 2026-10-25 | PR 2 de ppm-api: migraciones 0002 a 0004 (catálogos, usuarios y aislamiento, cuentas y setup\_user); BIC pasa a text; setup\_user sin p\_name y con idioma y zona |
| 2026-10-25 | Herramientas de construcción: dbmate, sesión con cookie y res\_users\_session, uv, un pull request por paso |
| 2026-10-25 | Repositorio corregido: dos (ppm-api y ppm-web) en lugar de uno |
| 2026-10-25 | Sección Plan de construcción: un repositorio, rebanadas en 11 pasos, pytest con PostgreSQL 18 real, Docker Compose y GitHub Actions |
| 2026-10-25 | Moneda base fija por país (setup\_user sin p\_currency; el pendiente pasa a ser «otros países»); con quién se elige al clasificar |
| 2026-10-25 | Cuenta Plata que guardo de otros (system\_role 'custody') y la opción «Me dio para guardar» en Registrar › Más |
| 2026-10-25 | Opciones de «Más» en Registrar aprobadas; bocetos completos de las 22 pantallas, con Iniciar sesión y Crear cuenta separados y los 3 pasos de configuración |
| 2026-10-25 | Mapa de pantallas aprobado (22, con el menú Más); vista Personas en Reportes; el cierre exige no tener pendientes; las categorías con movimientos se archivan |
| 2026-10-25 | Sección Interfaz con el mapa de 21 pantallas y los 57 casos de uso repartidos (propuesta); CTA-02 corregido: ya no menciona la regla de pago |
| 2026-10-24 | Grises neutros sin tinte (antes cálidos, pensados para el trigo) en el sistema de diseño y las pantallas |
| 2026-10-24 | Tinta por defecto y acento elegible (tinta, trigo, morado, azul): res\_users.ui\_theme y ui\_accent; sistema de diseño con tokens acento-\* y trigo fijo para ahorro; pantallas con selector de acento y avisos fijos en ámbar |
| 2026-10-24 | Avisos en ámbar; regla de forma en el sistema de diseño para no confundirlos con el trigo |
| 2026-10-24 | Color principal: trigo (sistema de diseño y pantallas actualizados, grises cálidos, primary-strong para texto); pendiente el color de los avisos, que chocaba con el trigo |
| 2026-10-24 | Primera base del sistema de diseño de PPM (propuesta para revisar): tokens con nombres de shadcn en tema claro y oscuro, morado como color principal, trigo para ahorro, paleta de 12 colores de categoría, Bricolage Grotesque e IBM Plex, Material Symbols Rounded; componentes Amount, CategoryChip y Button |
| 2026-10-24 | Herramientas de la interfaz: TypeScript, Vite, shadcn/ui + Tailwind, Material Symbols, Recharts, TanStack Query, React Hook Form + Zod, tipos desde OpenAPI, React Router, PWA; tecnologías completas |
| 2026-10-24 | Interfaz en React como app aparte sobre la API (descartados Jinja + HTMX, Vue y Svelte) |
| 2026-10-24 | Pydantic solo en la API; SQL directo con psycopg 3 sin ORM (descartado SQLModel); migraciones en archivos SQL numerados |
| 2026-10-24 | Servidor en Python + FastAPI (descartados Django, NestJS, Odoo como framework y Rust) |
| 2026-10-24 | Tecnologías: PostgreSQL 18 sin pgvector; hosting libre con condiciones (PostgreSQL 18, disco persistente, SMTP, tareas programadas) |
| 2026-10-24 | Inicio de sesión (login, huella Argon2id, res\_users\_token), tz y user\_today(), respaldos diarios de 30 días, caídas; tabla de puertos y adaptadores (disco para adjuntos, SMTP para correo) |
| 2026-10-24 | Dany aprueba los 57 casos de uso |
| 2026-10-24 | Varios usuarios en una base: tablas globales y de usuario, current\_user\_id(), user\_id con FK compuestas, UNIQUE por usuario, políticas RLS, roles ppm\_app y ppm\_admin, res\_users\_currency (sale res\_currency.active), carpeta de adjuntos por usuario; setup\_user completa la fila del registro; las funciones leen el usuario de la sesión; get\_rate recibe el lado también en import\_statement\_line y account\_recurring\_run |
| 2026-10-24 | Aislamiento con user\_id y RLS en una sola base; tipo de cambio global mantenido por PPM; TC-02 y TC-03 pasan al administrador |
| 2026-10-24 | Se retoma el importador automático de SUNAT (TC-01) con la fuente https://www.sunat.gob.pe/a/txt/tipoCambio.txt, formato fecha\|compra\|venta\| de un solo día |
| 2026-10-24 | Importador automático de SUNAT postergado (TC-01, más adelante); el contacto en la bandeja se decide con las importaciones; confirmado system\_role como marca de las cuentas de sistema |
| 2026-10-24 | Tipo de cambio del día: manda el último que se cargó; el importador pasa de ON CONFLICT DO NOTHING a DO UPDATE; TC-01 y TC-02 actualizados |
| 2026-10-24 | Tipo de cambio según la cuenta: get\_rate sin lado por defecto y rate\_side (compra para activos, venta para pasivos); el tipo de un movimiento no toca res\_currency\_rate; «Pérdida por tipo de cambio» pasa a «Costo del cambio»; casos MOV-11 y TC-04 |
| 2026-10-22 | Sin feriados ni días hábiles: se quitan resource\_calendar\_leaves, is\_business\_day, shift\_business\_day, nth\_business\_day y account\_recurring.holiday\_shift; account\_recurring\_dates devuelve solo occurrence\_date |
| 2026-10-22 | Tarjeta simplificada: se quitan due\_rule, due\_day, due\_days, holiday\_shift y card\_due\_for; nueva tabla account\_credit\_card\_cycle con la fecha de pago de cada ciclo; las cuotas pierden date\_maturity |
| 2026-10-22 | Caso de uso CON-06 Compensar deudas; tabla de acciones en lenguaje cotidiano y glosario para la interfaz final |
| 2026-10-22 | Se quita la casilla «Lleva contacto» del alta de cuentas; partner\_required queda solo en Por cobrar y Por pagar |
| 2026-10-22 | CRUD de categorías: icon (Material Symbols) y color (0 a 11) en account\_account y en la plantilla; vista account\_account\_look con herencia; trigger account\_type\_locked; función account\_merge; caso de uso CTA-07 Fusionar categorías |
| 2026-10-09 | Sección de arquitectura: requisitos no funcionales (usuarios aislados, cualquier dispositivo, siempre en línea, datos en el servidor) y reparto de la lógica entre aplicación y base |
| 2026-10-09 | Importación probada con extractos reales de dos bancos: detección de la fila de encabezados, filas vacías, montos con símbolo, líneas en cero omitidas y saldo final escrito al importar |
| 2026-10-09 | Importación de extractos: account\_import\_template(\_column), account\_bank\_statement, account\_bank\_statement\_line con unique\_import\_id; funciones import\_statement\_line y classify\_move; vista account\_bank\_statement\_check; ir\_attachment acepta account.bank.statement |
| 2026-10-09 | PPM no calcula intereses: se quitan tea e interest del plan de cuotas, interest\_move\_id, revolving\_tea y el método francés; el calendario de cuotas es solo capital. Préstamos de banco como cuenta de pasivo con recurrencia; préstamos entre personas en Por cobrar y Por pagar |
| 2026-10-09 | Presupuesto anotado como pendiente futuro; meses de gracia y disposición de efectivo descartados |
| 2026-10-09 | Categorías iniciales generales (árbol basado en Wallet) con account\_account\_template jerárquica; system\_role y trigger trg\_account\_system; cuenta Por clasificar; reembolsos como abono al gasto; account\_tag y account\_move\_line\_account\_tag\_rel con vista account\_tag\_expense; ir\_attachment polimórfica con triggers de destino y limpieza; naturaleza descartada |
| 2026-10-09 | Datos demo como cuarta capa, separada de la configuración inicial; el simulador arranca sin tipos de cambio y getRate ya no inventa uno |
| 2026-10-06 | Transacciones recurrentes: account\_recurring (regla, modo y generated\_until), account\_recurring\_line, account\_recurring\_exception; recurring\_id y recurring\_date en account\_move; funciones nth\_weekday, nth\_business\_day, account\_recurring\_dates, account\_recurring\_run y account\_recurring\_forecast; vista account\_recurring\_reminder |
| 2026-10-05 | Tipo de cambio: source SUNAT o manual, CHECK de compra y venta, importador con ON CONFLICT DO NOTHING, función get\_rate (último anterior) y vista res\_currency\_rate\_status |
| 2026-10-04 | Formato de montos como datos: res\_lang y res\_currency\_format (símbolo por moneda e idioma; es-PE usa US$); se quitan symbol y position de res\_currency; lang\_id en res\_country y res\_users; función format\_amount; principio de desacople de librerías |
| 2026-10-04 | Estándares ISO en res\_currency (numérico, posición del símbolo, USD = $), res\_country (alfa-3, numérico) y res\_bank (BIC); configuración inicial con account\_account\_template y setup\_user; conciliación con account\_partial\_reconcile, account\_move\_line\_residual, reconcile\_partner y account\_aged\_partner |
| 2026-10-04 | res\_country y res\_partner; country\_id en res\_users, res\_bank (cci\_code solo en Perú) y resource\_calendar\_leaves; account\_account.partner\_required y account\_move\_line.partner\_id; trigger trg\_line\_partner y vista res\_partner\_balance |
| 2026-10-04 | account\_type vuelve a los 5 grupos (sin internal\_group; el detalle lo dan los subtipos); res\_company se reemplaza por res\_users con currency\_id y lock\_date |
| 2026-10-04 | Nomenclatura Odoo: account\_account, account\_move, account\_move\_line, account\_account\_type (con internal\_group), res\_currency, res\_currency\_rate, res\_company (moneda base y fiscalyear\_lock\_date), res\_bank, res\_partner\_bank, account\_credit\_card, account\_installment\_plan(\_line), resource\_calendar\_leaves; display\_name pasa a la vista account\_account\_v |
| 2026-10-04 | Normalización: catálogo banks con código de CCI; bank\_accounts y credit\_cards como subtipos con la clave de su cuenta y FK (account\_id, type\_code); se eliminan credit\_cards.id, credit\_cards.name y accounts.card\_id; installment\_plans apunta a credit\_cards |
| 2026-10-04 | Cuentas multimoneda (currency NULL): la tarjeta bimoneda es una sola cuenta; vista account\_balances\_by\_currency; card\_status, unrealized\_fx y plan de cuotas por moneda de línea |
| 2026-10-04 | Vencimiento de tarjetas: regla por tarjeta (día fijo o N días tras el corte), corrimiento por día no hábil, tabla holidays y funciones is\_business\_day y shift\_business\_day |
| 2026-10-04 | Alta de cuentas: bank\_accounts (banco, número, CCI), datos de tarjeta (banco, marca, últimos 4, vencimiento), funciones post\_opening\_balance, create\_bank\_account y create\_credit\_card; pago mínimo descartado |
| 2026-10-04 | Tarjetas de crédito: credit\_cards, accounts.card\_id, installment\_plans, installments; funciones de corte y vencimiento; cronograma francés; vista card\_status |
| 2026-10-04 | Cierre de periodo: tabla settings con lock\_date, triggers de bloqueo en transactions y transaction\_lines, y regla de no cerrar con borradores |
| 2026-10-04 | transactions.state (borrador / confirmada); el trigger de cuadre solo valida confirmadas y corre también al confirmar; saldos y vistas filtran confirmadas; corrección por edición o borrado, sin reversos |
| 2026-10-04 | accounts.display\_name generado (nombre + ISO de moneda); unicidad por (parent\_id, name, currency) |
| 2026-10-04 | Multimoneda tipo Odoo: currency y amount\_currency en transaction\_lines, tabla exchange\_rates, trigger valida moneda de la cuenta; reglas de tipo de cambio y diferencia de cambio |
| 2026-10-04 | Cuentas jerárquicas: triggers de tipo heredado y movimientos solo en hojas; consulta de totales por grupo; principio "contable por dentro, intuitivo por fuera" |
| 2026-10-04 | `transaction_lines.balance`: columna generada `debit - credit`, como en Odoo; el libro mayor la usa |
| 2026-10-04 | Fase 1: tablas `account_types`, `accounts`, `transactions`, `transaction_lines`; trigger de cuadre; vista `account_balances` |
