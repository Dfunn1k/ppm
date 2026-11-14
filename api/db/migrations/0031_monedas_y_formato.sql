-- migrate:up
-- Monedas, idioma y formato (Más): el catálogo completo de ISO 4217 para que cada persona agregue las
-- que usa (res_users_currency). Los nombres en español y los decimales salen de Unicode CLDR; PPM guarda
-- montos con hasta 2 decimales, así que las monedas de 3 (el dinar kuwaití) quedan en 2. Se dejan fuera
-- los fondos, los metales y los códigos de prueba (XAU, XDR, XTS…) y las monedas ya retiradas.
INSERT INTO res_currency (name, numeric_code, full_name, decimal_places) VALUES
  ('AED', '784', 'Dírham de los Emiratos Árabes Unidos', 2),
  ('AFN', '971', 'Afgani afgano', 0),
  ('ALL', '008', 'Lek albanés', 0),
  ('AMD', '051', 'Dram armenio', 2),
  ('AOA', '973', 'Kuanza angoleño', 2),
  ('ARS', '032', 'Peso argentino', 2),
  ('AUD', '036', 'Dólar australiano', 2),
  ('AWG', '533', 'Florín arubeño', 2),
  ('AZN', '944', 'Manat azerbaiyano', 2),
  ('BAM', '977', 'Marco convertible de Bosnia y Herzegovina', 2),
  ('BBD', '052', 'Dólar barbadense', 2),
  ('BDT', '050', 'Taka bangladesí', 2),
  ('BHD', '048', 'Dinar bareiní', 2),
  ('BIF', '108', 'Franco burundés', 0),
  ('BMD', '060', 'Dólar bermudeño', 2),
  ('BND', '096', 'Dólar bruneano', 2),
  ('BOB', '068', 'Boliviano', 2),
  ('BRL', '986', 'Real brasileño', 2),
  ('BSD', '044', 'Dólar bahameño', 2),
  ('BTN', '064', 'Gultrum butanés', 2),
  ('BWP', '072', 'Pula botsuano', 2),
  ('BYN', '933', 'Rublo bielorruso', 2),
  ('BZD', '084', 'Dólar beliceño', 2),
  ('CAD', '124', 'Dólar canadiense', 2),
  ('CDF', '976', 'Franco congoleño', 2),
  ('CHF', '756', 'Franco suizo', 2),
  ('CLP', '152', 'Peso chileno', 0),
  ('CNY', '156', 'Yuan renminbi', 2),
  ('COP', '170', 'Peso colombiano', 2),
  ('CRC', '188', 'Colón costarricense', 2),
  ('CUP', '192', 'Peso cubano', 2),
  ('CVE', '132', 'Escudo de Cabo Verde', 2),
  ('CZK', '203', 'Corona checa', 2),
  ('DJF', '262', 'Franco yibutiano', 0),
  ('DKK', '208', 'Corona danesa', 2),
  ('DOP', '214', 'Peso dominicano', 2),
  ('DZD', '012', 'Dinar argelino', 2),
  ('EGP', '818', 'Libra egipcia', 2),
  ('ERN', '232', 'Nakfa eritreo', 2),
  ('ETB', '230', 'Bir etíope', 2),
  ('FJD', '242', 'Dólar fiyiano', 2),
  ('FKP', '238', 'Libra malvinense', 2),
  ('GBP', '826', 'Libra esterlina', 2),
  ('GEL', '981', 'Lari georgiano', 2),
  ('GHS', '936', 'Cedi ghanés', 2),
  ('GIP', '292', 'Libra gibraltareña', 2),
  ('GMD', '270', 'Dalasi gambiano', 2),
  ('GNF', '324', 'Franco guineano', 0),
  ('GTQ', '320', 'Quetzal guatemalteco', 2),
  ('GYD', '328', 'Dólar guyanés', 2),
  ('HKD', '344', 'Dólar hongkonés', 2),
  ('HNL', '340', 'Lempira hondureño', 2),
  ('HTG', '332', 'Gurde haitiano', 2),
  ('HUF', '348', 'Forinto húngaro', 2),
  ('IDR', '360', 'Rupia indonesia', 2),
  ('ILS', '376', 'Nuevo séquel israelí', 2),
  ('INR', '356', 'Rupia india', 2),
  ('IQD', '368', 'Dinar iraquí', 0),
  ('IRR', '364', 'Rial iraní', 0),
  ('ISK', '352', 'Corona islandesa', 0),
  ('JMD', '388', 'Dólar jamaicano', 2),
  ('JOD', '400', 'Dinar jordano', 2),
  ('JPY', '392', 'Yen japonés', 0),
  ('KES', '404', 'Chelín keniano', 2),
  ('KGS', '417', 'Som kirguís', 2),
  ('KHR', '116', 'Riel camboyano', 2),
  ('KMF', '174', 'Franco comorense', 0),
  ('KPW', '408', 'Won norcoreano', 0),
  ('KRW', '410', 'Won surcoreano', 0),
  ('KWD', '414', 'Dinar kuwaití', 2),
  ('KYD', '136', 'Dólar de las Islas Caimán', 2),
  ('KZT', '398', 'Tengue kazajo', 2),
  ('LAK', '418', 'Kip laosiano', 0),
  ('LBP', '422', 'Libra libanesa', 0),
  ('LKR', '144', 'Rupia esrilanquesa', 2),
  ('LRD', '430', 'Dólar liberiano', 2),
  ('LSL', '426', 'Loti lesotense', 2),
  ('LYD', '434', 'Dinar libio', 2),
  ('MAD', '504', 'Dírham marroquí', 2),
  ('MDL', '498', 'Leu moldavo', 2),
  ('MGA', '969', 'Ariari malgache', 0),
  ('MKD', '807', 'Dinar macedonio', 2),
  ('MMK', '104', 'Kiat de Myanmar', 0),
  ('MNT', '496', 'Tugrik mongol', 2),
  ('MOP', '446', 'Pataca macaense', 2),
  ('MRU', '929', 'Uguiya mauritano', 2),
  ('MUR', '480', 'Rupia mauriciana', 2),
  ('MVR', '462', 'Rufiya maldiva', 2),
  ('MWK', '454', 'Kuacha malauí', 2),
  ('MXN', '484', 'Peso mexicano', 2),
  ('MYR', '458', 'Ringit malasio', 2),
  ('MZN', '943', 'Metical mozambiqueño', 2),
  ('NAD', '516', 'Dólar namibio', 2),
  ('NGN', '566', 'Naira nigeriano', 2),
  ('NIO', '558', 'Córdoba oro', 2),
  ('NOK', '578', 'Corona noruega', 2),
  ('NPR', '524', 'Rupia nepalí', 2),
  ('NZD', '554', 'Dólar neozelandés', 2),
  ('OMR', '512', 'Rial omaní', 2),
  ('PAB', '590', 'Balboa panameño', 2),
  ('PGK', '598', 'Kina papú', 2),
  ('PHP', '608', 'Peso filipino', 2),
  ('PKR', '586', 'Rupia pakistaní', 2),
  ('PLN', '985', 'Esloti polaco', 2),
  ('PYG', '600', 'Guaraní paraguayo', 0),
  ('QAR', '634', 'Rial catarí', 2),
  ('RON', '946', 'Leu rumano', 2),
  ('RSD', '941', 'Dinar serbio', 0),
  ('RUB', '643', 'Rublo ruso', 2),
  ('RWF', '646', 'Franco ruandés', 0),
  ('SAR', '682', 'Rial saudí', 2),
  ('SBD', '090', 'Dólar salomonense', 2),
  ('SCR', '690', 'Rupia seychellense', 2),
  ('SDG', '938', 'Libra sudanesa', 2),
  ('SEK', '752', 'Corona sueca', 2),
  ('SGD', '702', 'Dólar singapurense', 2),
  ('SHP', '654', 'Libra de Santa Elena', 2),
  ('SLE', '925', 'Leona sierraleonesa', 2),
  ('SOS', '706', 'Chelín somalí', 0),
  ('SRD', '968', 'Dólar surinamés', 2),
  ('SSP', '728', 'Libra sursudanesa', 2),
  ('STN', '930', 'Dobra santotomense', 2),
  ('SVC', '222', 'Colón salvadoreño', 2),
  ('SYP', '760', 'Libra siria', 0),
  ('SZL', '748', 'Lilangeni esuatiní', 2),
  ('THB', '764', 'Bat tailandés', 2),
  ('TJS', '972', 'Somoni tayiko', 2),
  ('TMT', '934', 'Manat turcomano', 2),
  ('TND', '788', 'Dinar tunecino', 2),
  ('TOP', '776', 'Paanga tongano', 2),
  ('TRY', '949', 'Lira turca', 2),
  ('TTD', '780', 'Dólar de Trinidad y Tobago', 2),
  ('TWD', '901', 'Nuevo dólar taiwanés', 2),
  ('TZS', '834', 'Chelín tanzano', 2),
  ('UAH', '980', 'Grivna ucraniana', 2),
  ('UGX', '800', 'Chelín ugandés', 0),
  ('UYU', '858', 'Peso uruguayo', 2),
  ('UZS', '860', 'Sum uzbeko', 2),
  ('VES', '928', 'Bolívar venezolano', 2),
  ('VND', '704', 'Dong vietnamita', 0),
  ('VUV', '548', 'Vatu vanuatense', 0),
  ('WST', '882', 'Tala samoano', 2),
  ('XAD', '396', 'XAD', 2),
  ('XAF', '950', 'Franco CFA de África Central', 0),
  ('XCD', '951', 'Dólar del Caribe Oriental', 2),
  ('XCG', '532', 'Florín caribeño', 2),
  ('XOF', '952', 'Franco CFA de África Occidental', 0),
  ('XPF', '953', 'Franco CFP', 0),
  ('YER', '886', 'Rial yemení', 0),
  ('ZAR', '710', 'Rand sudafricano', 2),
  ('ZMW', '967', 'Kuacha zambiano', 2),
  ('ZWG', '924', 'ZWG', 2)
ON CONFLICT (name) DO NOTHING;

-- Cómo se escribe el euro en Perú y el sol en España; las demás monedas se escriben con su código (CLP 1,234)
INSERT INTO res_currency_format (currency_id, lang_id, symbol, position)
SELECT c.id, l.id, v.symbol, v.position
  FROM (VALUES ('EUR', 'es-PE', '€', 'before'), ('PEN', 'es-ES', 'S/', 'after')) AS v (currency, lang, symbol, position)
  JOIN res_currency c ON c.name = v.currency
  JOIN res_lang l     ON l.code = v.lang
ON CONFLICT DO NOTHING;

-- La persona cambia su formato de números y fechas (el idioma) y las monedas que usa; quitar una
-- moneda que tiene cuentas o movimientos lo impide la API, y la base nunca se quita
CREATE FUNCTION protect_base_currency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.currency_id = (SELECT currency_id FROM res_users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'La moneda principal no se quita' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_base_currency BEFORE DELETE ON res_users_currency
  FOR EACH ROW EXECUTE FUNCTION protect_base_currency();

-- migrate:down
DROP TRIGGER trg_base_currency ON res_users_currency;
DROP FUNCTION protect_base_currency();
DELETE FROM res_currency_format f USING res_currency c, res_lang l
 WHERE c.id = f.currency_id AND l.id = f.lang_id AND (c.name, l.code) IN (('EUR', 'es-PE'), ('PEN', 'es-ES'));
DELETE FROM res_currency WHERE name NOT IN ('PEN', 'USD', 'EUR');
