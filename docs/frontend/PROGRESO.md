# Progreso de la misión del frontend

La misión completa está en [MISION.md](MISION.md). Este archivo es el punto de guardado: al retomar, léelo junto con `git status` y `git log` y sigue desde «Siguiente paso».

## Dónde estamos

- **Fase actual:** 5, QA final (en curso).
- **Rama:** `frontend/fase-5-limpieza`
- **Último commit:** ver `git log -1 frontend/fase-5-limpieza`

## Checklist

### Fase 0 — Preparación
- [x] #127 en `main` (b2b2d82) y sin otras ramas abiertas que toquen `web/` (25-nov).
- [x] Diagnóstico medido otra vez el 25-nov: 1,027 valores arbitrarios (`text-[22px]` ×127, `text-[18px]` ×79, `text-[14px]` ×73), 47 `style={{…}}`, 32 colores hex en `.ts/.tsx`, un solo punto de quiebre (1024 px), `design-system/components/` con Amount, Button, CategoryChip y Cover.
- [x] `@axe-core/playwright` 4.14.0 (solo para pruebas; aprobado por Dany el 25-nov).
- [x] Capturas de toda la matriz en Docker (`web/capturas/`, `web/playwright.capturas.config.ts`, `pnpm capturas`).
- [x] Auditoría automática con axe en 390×844 y 1440×900, claro y oscuro.
- [x] Resumen de medidas y axe (`web/capturas/resumen.mjs`).
- [x] PR de la Fase 0 aprobado por Dany (#129, 25-nov).

### Fase 1 — Auditoría (en curso, `docs/frontend/AUDITORIA.md`)
- [x] a) Inventario de estilos
- [x] b) Componentes
- [x] c) Recorrido visual
- [x] d) Accesibilidad
- [x] e) Código contra decisiones
- [x] f) Hallazgos priorizados

- [x] PR de la Fase 1 aprobado por Dany (#130, 25-nov).

### Fase 2 — Sistema (en curso, `docs/frontend/SISTEMA.md`)
- [x] Decisiones A a H de Dany (25-nov, abajo)
- [x] 1. Tokens (base, letra, íconos, espacio, alturas, radios, bordes, sombras, capas, movimiento, colores)
- [x] 2. Estrategia responsive
- [x] 3. Componentes compartidos, con variantes y estados
- [x] 4. Reglas de código
- [x] ⏸ Punto de control 2: Dany aprueba el documento y S1 a S8 como se recomendaron (25-nov)
- [x] Registrado en `design-system/` (README y los README de Button, Amount, Row, SectionHeading, PageHeader, Avatar, Chip y CategoryChip), en `docs/modelo-contable.md` (8 decisiones y la bitácora), en `CLAUDE.md` (S8) y en la skill `ppm-interfaz`
- [x] Merge del PR #131 (Dany, 25-nov)

### Fase 3 — Cimientos (en curso, un PR)
- [x] Fotos base de toda la matriz, antes de tocar nada (`web/capturas-base/`, no se suben)
- [x] Tokens en `tokens.json` y `styles.css` (base en 16 px y letra en `rem`, escalas, colores nuevos, categorías en oscuro)
- [x] El inspector (`web/src/estilo.test.ts`, `estilo-tope.json`, `estilo-excepciones.ts`)
- [x] Moldes con `cva`: Button, IconButton, SectionHeading, PageHeader, Avatar, Row, Amount, Chip, ProgressBar, SearchField; ajustar PrimaryButton, Pill, Segmented, Icon
- [x] Cortes de pantalla: el riel desde 768 px, la lista de 320/400/440 px, safe-area y el foco tapado por la barra
- [x] Fotos después, comparadas con las base; typecheck, Vitest (32), Playwright (94) y build pasan en Docker
  - Scroll horizontal: 0 antes y 0 después, en toda la matriz.
  - Lo que se toca y mide menos de 44 px (390×844, 70 pantallas): 401 → 225. Menos de 24 px: 17 → 12. En escritorio: 618 → 388.
  - Foco tapado por la barra de abajo (390×844): 19 → 0. Foco sin anillo: 15 → 5.
  - axe: las mismas 4 reglas (aria-hidden-focus, label-content-name-mismatch, color-contrast, nested-interactive), que se arreglan pantalla por pantalla en la Fase 4.
  - «Texto grande» ya no es idéntica a 390×844: la letra crece, y aparecen 18 posibles cortes que la Fase 4 debe resolver.
  - `teclado.spec.ts` ahora reconoce la vuelta por el elemento y no por su posición. La de antes contaba paradas repetidas cuando la página se movía: las 1,180 paradas de la Fase 1 eran 783 sin repetir.
- [x] PR de la Fase 3 aprobado por Dany (#132, 25-nov)

### Fase 4 — Migración por lotes (en curso)
Cada lote: tokens y moldes, borrar el estilo viejo, tope del inspector a 0 en sus archivos, axe y teclado limpios en sus pantallas, toda la matriz en claro y oscuro, fotos de antes y después.
- [x] Lote 1: Inicio (y las piezas de las filas que usa: CategoryChip, Avatar, MoveIcon, MoveLine y Facts). PR #133, aprobado por Dany (25-nov).
  - Inicio: 20 valores escritos a mano → 0; lo que se toca < 44 px: 0 en toda la matriz (antes «Ver todo», el ojo, Mi cuenta y el mes); axe sin violaciones (antes label-content-name-mismatch); foco tapado 5 → 0; sin cortes con texto grande.
  - Hallazgo: todos los íconos medían 20 px. La regla `.icon` le ganaba a las clases de tamaño, así que el código pedía 11 tamaños y ninguno se aplicaba. Ahora solo valen los tamaños del sistema, y cada pantalla los adopta al migrar.
- [x] Lote 2: Cuentas y Detalle de cuenta. PR #134, aprobado por Dany (25-nov).
  - Cuentas 7 y Detalle 22 valores escritos a mano → 0; lo que se toca < 44 px: 0 en toda la matriz (antes Copiar, Importar extracto y el interruptor «En el presupuesto»); axe sin violaciones; foco tapado 2 → 0; «Lo que tenía al empezar» se corta con «…» y no de golpe.
  - El saldo de una cuenta pasa a Bricolage (decisión S2).
- [x] Lote 3: Movimientos y Registrar (y la barra de tipo de MasTipos). PR #135, aprobado por Dany (25-nov).
  - Token nuevo `body-lg` (17 px) para lo que escribes y las opciones de una hoja (elegido por Dany, 25-nov).
  - Movimientos 15, Registrar 48 y MasTipos 10 valores escritos a mano → 0; axe sin violaciones; foco tapado 1 → 0 y sin anillo 15 → 5 (los 5 son de PersonPicker, en Registrar con persona).
  - Lo que todavía mide < 44 px en esas rutas es de RegistrarPersona, AsientoManual, Reembolso y PersonPicker: van en el lote 4.
- [x] Lote 4: Registrar con persona, Asiento manual y Reembolso (con PersonPicker). PR #136, aprobado por Dany (25-nov).
  - 58 valores escritos a mano → 0; lo que se toca < 44 px en esas 8 rutas: 0 (antes «¿A quién?», «Elige la cuenta», «Otra línea», Hoy y las celdas de monto); axe sin violaciones; foco sin anillo 15 → 0 (AUDITORIA d12).
  - Los totales del asiento manual ya usan money.ts (AUDITORIA e3).
- [x] Lote 5: Detalle de movimiento y Por clasificar (con ClassifySheet). PR #137, aprobado por Dany (26-nov).
  - 46 valores escritos a mano → 0; nada que se toque < 44 px; axe sin violaciones; foco tapado 1 → 0; el buscador de Clasificar con anillo de foco (AUDITORIA d11).
  - Dany eligió (26-nov) migrar sin cambiar el diseño y hacer la versión de escritorio de Por clasificar aparte, con boceto en el lienzo antes (AUDITORIA e2).
- [x] Lote 6: Tarjeta, Pagar tarjeta y Préstamo (con Nuevo préstamo). PR #138, aprobado por Dany (26-nov).
  - 61 valores escritos a mano → 0; lo que se toca < 44 px: 0 (antes Ciclo anterior y siguiente, Hoy y Pagar toda la deuda); axe sin violaciones; foco tapado 1 → 0.
  - El monto que escribes en Nuevo préstamo pasa de 30 a 48 px (amount-input). Si Dany lo prefiere más chico, falta un token «monto de formulario».
- [x] Lote 7: Personas, Persona y De antes de PPM (con DebtCard, que también usan Me pagó y Le pagué). PR #139, aprobado por Dany (26-nov).
  - 53 valores escritos a mano → 0; lo que se toca < 44 px: 0 (antes los datos de contacto, el vencimiento, las cuotas y Prestarle); axe sin violaciones; foco tapado 2 → 0.
  - El nombre de la persona pasa a title-hero (40 → 48 px) y lo que queda entre ustedes a amount-display, en Bricolage (decisiones C y S2). La tarjeta elegida usa el acento al 15 % en lugar de una mezcla a mano; utilidad nueva `mark-selected-below` para el total elegido de Personas.
- [x] Lote 8: el presupuesto entero (Presupuesto con Empezar, Sobre, Por asignar, Repartir y Cuentas del presupuesto, con sus hojas). PR #140, aprobado por Dany (26-nov).
  - 80 valores escritos a mano → 0; lo que se toca < 44 px: 0; axe 4 → 0 (el verde de lo que queda en un sobre, ahora income-soft); foco tapado 2 → 0.
  - Textos de las decisiones D y H: «Debo a personas» y «Me deben» en Cuentas del presupuesto; «Siempre cuadra: cada sol está en un solo lugar.» en Por asignar.
  - Sobre y Por asignar pasan a title-hero (decisión C) y su monto principal a amount-display (S2). Los botones redondos de la sección se mantienen, ahora con tokens (`PILL_PRIMARY`, `PILL_SECONDARY` en common.tsx); Dany eligió (26-nov) pasarlos al botón de la app, en el lote 9.
- [x] Lote 9: Reportes (el índice, Gastos, Ingresos, Flujo con Tu plata, Patrimonio, Personas y Etiquetas), más los botones del presupuesto pasados al botón de la app. PR #141, aprobado por Dany (26-nov).
  - 127 valores escritos a mano → 0; lo que se toca < 44 px: 0; axe 22 → 0 (los gráficos chicos del índice recibían foco dentro de algo escondido, el % blanco dentro de la barra verde no llegaba a 4.5:1 y los tramos de Personas eran una imagen con botones adentro); foco tapado 2 → 0.
  - Los colores de las series pasan a clases (catBg, bg-trigo…) en vez de estilos en línea; utilidad nueva `grid-cols-cash-line`; los ejes de los gráficos suben de 11 a 12 px (nada por debajo de 12).
- [x] Lote 10: Recurrentes, el detalle de una recurrente y Pendientes (con la pieza de recordatorios, que también sale en Persona y en el detalle de una cuenta). PR #142, aprobado por Dany (26-nov).
  - 46 valores escritos a mano → 0; lo que se toca < 44 px: 4 a 10 por pantalla → 0 (el aviso de Pendientes, − y +, Traer ahora, Posponer); axe sin violaciones; foco sin tapar.
  - El monto de una recurrente pasa a amount-display-2 (S2); su título en escritorio usa title-hero como el resto. Los botones de guardar, pausar y terminar usan el botón de la app (decisión del 26-nov). Utilidad nueva `grid-cols-title-amount`.
- [x] Lote 11: Más y sus ajustes (Mi cuenta, Exportar, Eliminar cuenta, Tu Inicio, Apariencia, Atajos, Categorías y Nueva categoría, Etiquetas, Cierre, Monedas y Tipo de cambio). PR #143, aprobado por Dany (26-nov; el CI no corrió hasta que el repo pasó a público, porque se acabaron los minutos de Actions del mes).
  - 145 valores escritos a mano → 0; lo que se toca < 44 px: 5 a 82 por pantalla → 0; axe sin violaciones; foco tapado 2 → 0.
  - La grilla de íconos de Nueva categoría pasa de 7 columnas fijas a las que quepan, ninguna de menos de 44 px (6 en el celular). Tu Inicio usa el mismo interruptor que el presupuesto. `formatCount` en money.ts para contar filas. Utilidades nuevas `grid-cols-rates` y `grid-cols-icons`.
- [x] Lote 12: acceso (la portada de la computadora, Entrar, Crear cuenta, Recuperar, Restablecer, Unir Google) y la bienvenida (3 pasos). PR #144, aprobado por Dany (26-nov).
  - 47 valores escritos a mano → 0; lo que se toca < 44 px: 2 a 6 por pantalla → 0 (los enlaces «Crea tu cuenta», «Inicia sesión», «¿Olvidaste tu contraseña?», Privacidad y el campo de efectivo); axe sin violaciones; foco sin tapar.
  - El panel de «Pan para mayo» crece con la ventana igual que antes, ahora con utilidades con nombre (`text-poster`, `mark-mayo`, `px-access`, `gap-access`, `pt-access`, `text-access-lead`, `grid-cols-access`). La vista previa de la bienvenida usa amount-display, como el Inicio.
- [x] Lote 13: Importar extracto (los 3 pasos) y el detalle de un extracto importado. PR #145, aprobado por Dany (26-nov).
  - 29 valores escritos a mano → 0; lo que se toca < 44 px: 4 → 0 (la pastilla de cada columna del archivo); axe sin violaciones; foco sin tapar.
  - «El saldo cuadra» usa income-soft en vez de un color-mix; Deshacer la importación usa el botón de la app (secundario y de borrar). Los íconos recuperan el tamaño que pedían (el de subir archivo, 32 px), que antes no se aplicaba.
- [x] Lote 14: lo que quedaba de cuentas y tarjetas (Nueva cuenta, el formulario de banco y efectivo, Guardo de otros, Editar banco, Nueva tarjeta, Cuotas de antes y Conciliar). PR #146, aprobado por Dany (26-nov).
  - 49 valores escritos a mano → 0; lo que se toca < 44 px: 4 a 14 por pantalla → 0; axe sin violaciones; foco sin tapar.
  - El campo de monto que comparten los formularios (AmountField: cuenta nueva, Guardo, Nueva tarjeta, De antes de PPM, saldo inicial) pasa de 34 a 40 px (amount-hero, el token más cercano). El nombre de una cuenta o tarjeta nueva pasa de 30 a 28 px (title-1). La diferencia de la cuota en Conciliar se calcula con money.ts. Utilidad nueva `grid-cols-currency-table`.
  - Conciliar no salía en las capturas (necesita un estado de cuenta importado). Corrección del 26-nov: sí lo abre una prueba e2e (`cuota-banco.spec.ts`, «Usar la del banco»). En la Fase 5 entra a las capturas y a axe.
- [x] Lote 15: adjuntos (el visor de fotos y PDF y la lista de adjuntos del movimiento). PR #147, aprobado por Dany (26-nov).
  - 113 valores escritos a mano → 0, entre ellos 28 colores hex y 11 colores de Tailwind fuera del tema; lo que se toca < 44 px: 0; axe sin violaciones.
  - Dany eligió (26-nov) que el visor use la paleta siempre oscura del panel (`panel-*`), con `panel-border` (#707070, 3:1) y `panel-danger` (#ff7b6e) nuevos. El fondo pasa de #0a0a0a a #171717. Utilidad nueva `aspect-a4`.
  - El visor no sale en las capturas: se fotografió con una prueba temporal (celular), antes y después.
- [x] Lote 16: las piezas compartidas (riel, barra de abajo, hojas, calendario, ayuda de atajos, categorías, etiquetas, las piezas de un movimiento, cuotas, diferidos, compartidos, esqueleto, refrán, vacío, instalar y Privacidad). PR #148, aprobado por Dany (26-nov).
  - 129 valores escritos a mano → 0. **Todo `web/src` queda en cero**: estilo-tope.json vacío; solo valen las excepciones de estilo-excepciones.ts (el logo de Google y «reducir movimiento»).
  - Toda la app (70 pantallas, toda la matriz): lo que se toca < 44 px 17 330 → 0; textos cortados 14 → 0; axe 34 → 0; foco tapado 39 → 0; scroll horizontal 0.
  - Los colores de etiqueta pasan a clases (catBg); las alturas de la hoja a utilidades con nombre (`max-h-sheet`, `max-h-sheet-dialog`, `top-sheet`); el globo del riel se corre 2 px; los números de las insignias suben de 10 a 12 px.
- [x] Por clasificar en escritorio: boceto Caso17 en el lienzo, Dany eligió A, lista y panel (26-nov). PR #149. Prueba nueva en `e2e/escritorio.spec.ts`.

### Fase 5 — QA final (en curso)
- [x] Código muerto: `ButtonLink`, `tagColor` y `useRecurringPending` sin uso, quitados. El CSS no tiene clases ni variables sin uso. Los tipos de la API sin uso en `api/hooks.ts` se quedan: nombran las respuestas.
- [x] La persona de muestra trae un estado de cuenta de tarjeta y un extracto de banco importados (`capturas/archivos.ts`): Conciliar («tarjeta-estado»), Extracto y Por clasificar con movimientos entran a las capturas, a axe y al teclado (72 pantallas).
- [x] Toda la matriz, claro y oscuro (26-nov): scroll horizontal 0; lo que se toca < 44 px 0; cortes 0; axe 0; foco tapado o sin verse 0.
  - Con los datos nuevos aparecieron 4 y se arreglaron sin cambiar cómo se ve: el nombre en las filas de Por clasificar (22 px de alto, ahora con `hit-area`), los dos botones de «La cuota del banco es distinta» a 280 px (ahora bajan de línea), «Por clasificar» cortado sin «…» en Inicio a 1024 px, y en Por clasificar de escritorio el botón fijo tapaba la categoría con el foco (`scroll-pb-32`).
- [ ] Piezas hechas a mano en vez del molde (recuento del 26-nov): 10 botones principales, 18 de contorno, 6 de borrar y 8 «Cancelar»; 13 pastillas para elegir; ~33 títulos de sección; 15 cabeceras con «Volver»; 7 buscadores; ~45 filas. Dany decide el alcance.
- [ ] Lighthouse (necesita permiso de Dany).
- [ ] La prueba en un iPhone (Dany).
- [ ] `docs/frontend/INFORME-FINAL.md` y la skill `ppm-interfaz` con lo aprendido.

## Siguiente paso

Dany elige el alcance de las piezas hechas a mano (1: botones y pastillas, con boceto; 2: todo; 3: solo anotarlo) y si da permiso para Lighthouse. Luego el informe final.

## Decisiones de Dany

Tomadas el 25-nov (todas las recomendadas). Se escriben en `design-system/` y en `docs/modelo-contable.md` al cerrar la Fase 2:
- **A. Formularios:** la línea de abajo en toda la app; se corrige el README («caja con borde» queda fuera).
- **B. Montos protagonistas:** en Bricolage, con 2 tamaños en lugar de 7.
- **C. Título de las pantallas a las que entras:** `title-hero` (48 px) como hoy; más chico entre 280 y 359 px.
- **D. Palabras:** «Asiento manual» y «Por cobrar» de las cuotas quedan como excepciones aprobadas; en Presupuesto › Cuentas, «Por pagar» y «Por cobrar» pasan a «Debo a personas» y «Me deben» (Fase 4).
- **E. Símbolo:** en las filas, tu moneda va sin símbolo y las otras con el suyo; totales y saldos siempre con símbolo.
- **F. README de Button:** se reescribe con lo que hay (56 px).
- **G1. Tablet (768–1023 px):** el riel y una columna ancha (~640 px).
- **G2. Laptop chica (1024–1279 px):** lista de 320 px y detalle que se adapta a su ancho; desde 1280 px, 400 px.
- **H. Por asignar:** «Siempre cuadra: cada sol está en un solo lugar.» (Fase 4).

Del punto de control 2 (25-nov, todas las recomendadas): S1 base en 16 px y letra en `rem`; S2 el monto principal de los detalles también en Bricolage; S3 2 y 6 px solo dentro de piezas chicas; S4 filas de 52, 60 y 56 px; S5 radios 4, 6, 10, 14 y 16 con nombres en orden; S6 con «reducir movimiento» solo gira el círculo; S7 margen de 24 px en el celular; S8 moldes propios con `cva`.

Pendientes:
- Revisar en un iPhone, con PPM instalada, si la barra de abajo queda bajo la barra de gestos.

## Fuera de alcance (errores funcionales encontrados, sin arreglar)

- `/mas/tipo-de-cambio` lleva a `/mas` si no eres administrador. Así está pensado (Z1), no es un error; se anota para que la auditoría no lo cuente como pantalla rota.

## Cómo se toman las capturas

Todo corre en Docker, en el contenedor `e2e` (Playwright 1.55):

```bash
# Toda la matriz (16 tamaños y 3 casos especiales, claro y oscuro), los acentos y axe: ~20 min, ~3,700 fotos, 130 MB
docker compose run --rm e2e corepack pnpm capturas
# Una parte: tamaños, temas o pantallas
docker compose run --rm -e PPM_TAMANOS=390x844,1440x900 -e PPM_TEMAS=dark -e PPM_PANTALLAS=inicio,movimientos e2e corepack pnpm capturas
# El resumen (scroll horizontal, lo que se toca < 44 px, posibles cortes, axe por regla)
docker compose run --rm e2e node capturas/resumen.mjs
```

- **La persona de muestra** (`capturas/datos.ts`) se crea por la API antes de cada corrida: efectivo, banco en soles y en dólares, tarjeta con una compra en cuotas, préstamo, tres meses de ingresos y gastos, una persona que te debe, una recurrente, una etiqueta y el presupuesto empezado. Hay una segunda solo para los acentos, para no cambiarle el color a la primera mientras se fotografía.
- **Pantallas** (`capturas/pantallas.ts`): las 67 que se abren con esa persona, más la bienvenida (pasos 1 a 3) con una cuenta nueva. Las que necesitan un dato que la muestra no tiene (un extracto importado, el estado de cuenta de un corte, el aviso de una recurrente, Google o un enlace del correo) están en `SKIPPED` con su motivo.
- **Dos fotos por pantalla:** `<pantalla>.jpg` es lo que se ve al abrir; `<pantalla>-entera.jpg`, la página entera con la ventana estirada a su alto (así la barra de abajo queda abajo y no flotando a media página).
- **Medidas por pantalla** (`capturas/medir.ts`): cuánto se pasa de ancho (scroll horizontal), lo que se toca y mide menos de 44×44 px y los textos que no caben en su caja.
- **Casos especiales, aproximados:**
  - zoom al 200 %: 640×400 (una ventana de 1280×800 con el doble de zoom);
  - texto grande: 390×844 con la letra base del navegador a 20 px en vez de 16 (como subirla en el sistema);
  - teclado abierto: 390×508 (390×844 menos el teclado), solo en formularios y con el foco en el primer campo.
- **Acentos:** tinta, trigo, morado y azul en Inicio, Registrar, Apariencia y Gastos, a 390×844 y 1440×900, claro y oscuro.
- **axe** revisa WCAG 2.0, 2.1 y 2.2, niveles A y AA, en cada pantalla a 390×844 y 1440×900, claro y oscuro.
- **Teclado** (`capturas/teclado.spec.ts`, desde la Fase 1): en cada pantalla aprieta Tab hasta dar la vuelta y anota si el foco se ve, si lo tapa algo fijo y si cae en algo invisible. Sale en `capturas-salida/teclado/<tamaño>.json`. Solo esto: `-g "teclado|preparar"`.
- **Ojo con «texto grande»:** hoy sale idéntica a 390×844, porque PPM tiene toda la letra en px (ver AUDITORIA d, punto 2). Servirá para comparar cuando eso cambie.
- La salida queda en `web/capturas-salida/` (no se sube al repo).

## Comandos para verificar

```bash
docker compose exec web corepack pnpm typecheck
docker compose exec web corepack pnpm test
docker compose run --rm e2e
```
