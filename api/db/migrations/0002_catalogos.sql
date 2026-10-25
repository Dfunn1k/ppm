-- migrate:up
-- Catálogos globales: vienen con la app, son iguales para todos y solo PPM los mantiene.
-- Por ahora solo Perú (otros países quedan pendientes: necesitan su fuente de tipo de cambio).

-- Monedas (res.currency), ISO 4217
CREATE TABLE res_currency (
  id             smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           char(3) NOT NULL UNIQUE,         -- ISO 4217 alfabético: 'PEN', 'USD'
  numeric_code   char(3) NOT NULL UNIQUE,         -- ISO 4217 numérico: '604', '840'
  full_name      text NOT NULL,                   -- 'Sol'
  decimal_places smallint NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4)
);

INSERT INTO res_currency (name, numeric_code, full_name, decimal_places) VALUES
  ('PEN', '604', 'Sol',                  2),
  ('USD', '840', 'Dólar estadounidense', 2),
  ('EUR', '978', 'Euro',                 2);

-- Idiomas y su formato de números y fechas (res.lang)
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

-- Cómo se escribe cada moneda en cada idioma (de Unicode CLDR)
CREATE TABLE res_currency_format (
  currency_id smallint NOT NULL REFERENCES res_currency (id),
  lang_id     smallint NOT NULL REFERENCES res_lang (id),
  symbol      text NOT NULL,                     -- 'US$'
  position    text NOT NULL DEFAULT 'before' CHECK (position IN ('before', 'after')),
  space       boolean NOT NULL DEFAULT true,     -- 'S/ 10' o 'S/10'
  PRIMARY KEY (currency_id, lang_id)
);

INSERT INTO res_currency_format (currency_id, lang_id, symbol, position)
SELECT c.id, l.id, v.symbol, v.position
  FROM (VALUES ('PEN', 'es-PE', 'S/',  'before'), ('USD', 'es-PE', 'US$', 'before'),
               ('EUR', 'es-PE', '€',   'before'),
               ('EUR', 'es-ES', '€',   'after'),  ('USD', 'es-ES', 'US$', 'after')
       ) AS v (currency, lang, symbol, position)
  JOIN res_currency c ON c.name = v.currency
  JOIN res_lang l     ON l.code = v.lang;

-- Países (res.country), ISO 3166-1; su moneda es la moneda base de quien vive ahí
CREATE TABLE res_country (
  id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         char(2) NOT NULL UNIQUE,                  -- alfa-2: 'PE'
  code_alpha3  char(3) NOT NULL UNIQUE,                  -- alfa-3: 'PER'
  numeric_code char(3) NOT NULL UNIQUE,                  -- '604'
  name         text NOT NULL,                            -- 'Perú'
  currency_id  smallint NOT NULL REFERENCES res_currency (id),
  phone_code   smallint,                                 -- 51
  lang_id      smallint NOT NULL REFERENCES res_lang (id) -- idioma por defecto
);

INSERT INTO res_country (code, code_alpha3, numeric_code, name, currency_id, phone_code, lang_id)
SELECT 'PE', 'PER', '604', 'Perú', c.id, 51, l.id
  FROM res_currency c, res_lang l WHERE c.name = 'PEN' AND l.code = 'es-PE';

-- Bancos (res.bank); en Perú, el código es el que encabeza el CCI
CREATE TABLE res_bank (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id smallint NOT NULL REFERENCES res_country (id),
  name       text NOT NULL,                                          -- 'BCP'
  bic        text UNIQUE                                             -- 8 u 11 caracteres
             CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),   -- ISO 9362 (SWIFT)
  cci_code   char(3) UNIQUE CHECK (cci_code ~ '^[0-9]{3}$'),        -- '002'
  UNIQUE (country_id, name),
  UNIQUE (id, cci_code)                                              -- para la FK del CCI
);

INSERT INTO res_bank (country_id, name, bic, cci_code)
SELECT c.id, v.name, v.bic, v.cci_code
  FROM res_country c,
       (VALUES ('BCP',        'BCPLPEPL', '002'), ('Interbank', 'BINPPEPL', '003'),
               ('Scotiabank', 'BSUDPEPL', '009'), ('BBVA',      'BCONPEPL', '011'))
       AS v (name, bic, cci_code)
 WHERE c.code = 'PE';

-- Los 5 grupos contables, con su lado normal
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

-- migrate:down
DROP TABLE account_account_type, res_bank, res_country, res_currency_format, res_lang, res_currency;
