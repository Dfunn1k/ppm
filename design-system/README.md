> **Esta carpeta es el original del sistema de diseño de PPM** desde el 24-nov-2026 (antes lo era el artefacto de claude.ai, que quedó como archivo). Los tokens viven en `tokens.json` y se implementan en `web/src/styles.css`: un token nuevo o cambiado toca los dos en el mismo pull request, y la regla nueva se anota en este README.

> **Escalas aprobadas el 25-nov-2026** (misión del frontend, `docs/frontend/SISTEMA.md`). Este README ya dice cómo debe quedar. `tokens.json` y `styles.css` las implementan juntos en la Fase 3; hasta entonces, el código va migrando pantalla por pantalla.

PPM ayuda a una persona a saber cuánto tiene, cuánto debe y en qué se le va la plata, sin saber contabilidad. Por dentro es partida doble; por fuera habla como habla la gente. Esta guía dice cómo se ve y cómo suena.

## Voz y contenido

- Habla de tú y en frases cortas: «Registraste un gasto de S/ 35.50 en Restaurantes».
- Usa las palabras de la gente, nunca las del contador: «Lo que tengo» y «Lo que debo» (no Activo y Pasivo), «Movimiento» (no asiento ni apunte), «Por confirmar» (no borrador), «Me deben» y «Debo a personas» (no por cobrar ni por pagar), «Costo del cambio» (no diferencia de cambio). Dos excepciones aprobadas: «Asiento manual» en el menú «más» de Registrar (el camino avanzado) y «Por cobrar» como estado de una cuota en el detalle de una persona.
- Escribe en mayúscula solo la primera letra: «Nueva cuenta», no «Nueva Cuenta». Sin signos de exclamación ni emoji.
- Un botón dice lo que hace: «Registrar gasto», «Confirmar», «Archivar categoría». El aviso de después lo repite en pasado: «Gasto registrado».
- Un error dice qué pasó y cómo seguir: «Ese periodo está cerrado hasta el 30/09. Elige una fecha posterior».

## Montos

- Escribe el símbolo antes del número, con espacio y separador de miles: `S/ 1,234.50`, `US$ 300.00` (formato es-PE de `res_currency_format`).
- **En las filas de una lista, tu moneda va sin símbolo** (`− 35.50`) y las otras con el suyo (`− US$ 20.00`): como en un estado de cuenta, lo normal no se marca y lo distinto resalta. Totales, saldos y el monto principal llevan siempre su símbolo.
- Todo monto va con cifras tabulares (`font-variant-numeric: tabular-nums`) y alineado a la derecha en listas y tablas. Un monto nunca se parte en dos líneas: lo que cede es el texto de al lado, que se corta con «…».
- Lo que entra lleva `+` y `income` con el ícono `south_west`; lo que sale lleva `−` (signo menos, no guion) y `expense` con el ícono `north_east`; una transferencia entre tus cuentas usa `transfer` con `sync_alt` y no lleva signo. Nunca distingas entrada y salida solo por el color.
- El monto principal de una pantalla (patrimonio, saldo de una cuenta, de una tarjeta o de una persona, disponible del sobre, total del reporte) va en `amount-display`, en Bricolage. Un monto grande que no es el principal, en `amount-display-2`. Los demás, en Plex Sans: `amount-xl`, `amount-lg` y `amount` (ver Tipografía).
- Siempre con `web/src/lib/money.ts` o el componente `Amount`: nunca `toFixed` ni `toLocaleString` a mano.

## Color

- Los nombres de los tokens son los de shadcn/ui (`background`, `card`, `primary`, `muted-foreground`, `border`, `ring`…), para que el tema pase al código tal cual.
- `primary` es el **acento** que elige cada persona en Ajustes › Apariencia; por defecto, tinta (negro en claro, blanco en oscuro). Marca la única acción principal de cada pantalla (el botón +, «Registrar gasto»), la pestaña activa y lo seleccionado, con texto en `primary-foreground`.
- El acento sale de una **paleta cerrada**: `acento-tinta`, `acento-trigo`, `acento-morado` y `acento-azul`, cada uno con sus variantes `-on`, `-suave`, `-suave-on` y `-texto`, probadas en los dos temas. Elegir un acento copia esas cinco en `primary`, `primary-foreground`, `secondary`, `secondary-foreground` y `primary-strong` (en código, un atributo `data-accent` en la raíz). Nunca se ofrecen verdes, rojos ni ámbar: ya significan ingreso, gasto y aviso.
- Para texto o enlaces en el acento usa `primary-strong`; `secondary` es el acento suave para la pestaña activa, los avatares y el fondo de los íconos de cuenta.
- `trigo` es el **sello de PPM**, fijo para todos y sea cual sea el acento. Va solo en dos lugares: la palabra «mayo» del refrán en la portada de acceso y la barra «para mayo» del ahorro. Siempre como relleno, con el texto en `on-trigo`; nunca en botones, enlaces ni texto pequeño. Así significa siempre lo mismo: «esto es para mayo». La tinta (el acento) es con lo que se actúa; el trigo, la marca.
- `attention` señala lo que pide una acción: movimientos por clasificar, tipo de cambio desactualizado, una tarjeta por vencer. Es ámbar, fijo para todos, y no cambia con el acento. Como es pariente del trigo, se distingue por la forma: siempre con ícono y una frase («3 movimientos por clasificar»), como texto o fondo suave (`attention` sobre su fondo tenue), nunca como botón relleno. Un relleno de trigo es la marca (o una acción, si la persona eligió el acento trigo); un texto ámbar con ícono es un aviso.
- `destructive` es solo para borrar, archivar y errores. `destructive-soft`, `attention-soft` e `income-soft` son los fondos tenues de un error, un aviso y un ingreso, con el texto en su color (al menos 4.5:1).
- `overlay` es el único velo detrás de una hoja o del panel de Registrar.
- El visor de adjuntos es siempre oscuro y usa los tokens `panel-*`.
- Nada de hex, `rgb()`, `color-mix()` ni colores de Tailwind fuera del tema en el código. La única excepción son los 4 colores del logo de Google.
- `cat-0` a `cat-11` son los 12 colores de categoría, el índice de `account_account.color`. Se usan solo como fondo del chip de categoría, con el ícono en `on-category`.
- `age-0` a `age-3` son los tramos de antigüedad de lo que te deben (0–30, 31–60, 61–90 y más de 90 días): un solo tono que se intensifica con los días. Van siempre con la etiqueta del tramo; el tramo vencido se marca además con `attention` e ícono.
- `panel`, `panel-foreground`, `panel-muted`, `panel-line` y `panel-chip` son el panel de la portada de acceso en la computadora (desde 1024px): siempre oscuro, a la izquierda, con el refrán, el año y lo que hace PPM. En el tema oscuro el panel es un negro tibio para separarse del fondo. No se usan en ningún otro lugar.
- Los grises son neutros, sin tinte: el color lo ponen el acento, los montos, las categorías y el trigo, nunca el fondo.
- Hay un tema claro y uno oscuro con los mismos tokens; el oscuro no es el claro invertido. Comprueba cada combinación en los dos.

## Tipografía

`title-display` es el refrán de la portada: «Pan / para / mayo.» en tres líneas, Bricolage Grotesque a 84px, con «mayo.» sobre un relleno de `trigo`. Solo en la portada de acceso. En la computadora crece con la ventana (hasta 176px) dentro del `panel`, y el formulario de la derecha lleva su título en `title-hero`.

Toda la letra va en `rem`, para que crezca si la persona sube el tamaño de letra de su teléfono (a tamaño normal, 1rem = 16px). Nada por debajo de 12px. El tamaño lo da el estilo, nunca la pantalla.

| Estilo | Tamaño / alto | Letra | Para qué |
| --- | --- | --- | --- |
| `title-display` | 84 / 76 | Bricolage 800 | El refrán de la portada |
| `title-hero` | 48 / 46; 36 / 38 por debajo de 360px | Bricolage 800 | El título de la pantalla a la que entras («BCP sueldo», «Categorías») y los de acceso y configuración. Uno por pantalla |
| `title-1` | 28 / 32 | Bricolage 700 | Pasos internos de un flujo largo (Importar) y títulos de formulario |
| `title-2` | 20 / 26 | Bricolage 600 | Títulos de sección, de hojas y de un estado vacío |
| `amount-display` | 48 / 50; 40 / 44 por debajo de 360px | Bricolage 800, tabulares | El monto principal de una pantalla. Uno por pantalla |
| `amount-display-2` | 30 / 34 | Bricolage 800, tabulares | Un monto grande que no es el principal |
| `amount-input` | 48 / 56 | Plex 600, tabulares | El monto que escribes; su símbolo en `amount-input-symbol` (28 / 32, `muted-foreground`) |
| `amount-xl` | 22 / 28 | Plex 600, tabulares | Totales dentro de una tarjeta o un reporte |
| `amount-lg` | 17 / 24 | Plex 600, tabulares | El monto destacado de una fila |
| `amount` | 15 / 22 | Plex 500, tabulares | Montos en listas y tablas |
| `body` / `body-strong` | 15 / 22 | Plex 400 / 600 | Texto corriente / el nombre de una fila |
| `body-sm` | 14 / 20 | Plex 400 o 600 | Botones secundarios y ayudas largas |
| `caption` | 13 / 18 | Plex 400 | Fecha, cuenta y glosa debajo del nombre |
| `caption-sm` | 12 / 16 | Plex 500 | Texto de pastillas y chips, sin mayúsculas |
| `label` | 12 / 16 | Plex 600, mayúsculas | Encabezados de sección y estados |
| `code` | 13 / 18 | Plex Mono 400 | CCI, número de operación |

- Las pestañas de abajo llevan una etiqueta chica (`label`) y el dato grande; las pantallas a las que entras, flecha y título en `title-hero`; las hojas, × y su título en `title-2` (regla de títulos, 13-nov).
- Las tres familias las sirve PPM con `@fontsource`, no Google Fonts (decisión «Fuentes e íconos» en `docs/modelo-contable.md`).

## Espacio, radios y sombras

- **Espacio:** pasos de 4px: 4, 8, 12, 16, 20, 24, 32, 40, 48 y 64 (`space-1` a `space-16`). 2 y 6px solo como pasos finos dentro de piezas chicas (entre una etiqueta y su valor, dentro de una pastilla), nunca para separar bloques.
- **Márgenes:** 24px a los costados en el celular y la tablet, 40px en un panel de escritorio. Entre secciones, 32px; dentro de una sección, 12 o 16px.
- **Alturas:** todo lo que se toca mide al menos 44×44px (si se dibuja más chico, el área crece por dentro). Controles (campo, segmentado, «Volver», buscador) de 44px; botón principal de 56px y secundario de 44px. Filas de lista: `row-sm` 52px (una línea), `row` 60px (dos líneas con ícono) y `row-option` 56px (la opción de una hoja). El círculo de una fila mide 40px (`avatar`) y el de una persona dentro de un texto, 24px (`avatar-sm`).
- **Radios, de menor a mayor:** `radius-xs` 4px (barras de reportes), `radius-sm` 6px (chips de texto), `radius-md` 10px (filas que se tocan, campos con fondo), `radius-lg` 14px (botones), `radius-xl` 16px (tarjetas y hojas) y `radius-full` (chips de categoría, avatares, el botón flotante de registrar).
- **Bordes:** 1px para separar y 2px para la línea del campo y lo elegido.
- **Sombras:** `shadow-sm` separa una tarjeta del fondo; `shadow-lg` solo para lo que flota: hojas, menús y el botón de registrar. La fila elegida de una lista de escritorio lleva `mark-selected`, una raya de 3px a la izquierda.
- **Capas, de abajo arriba:** `z-raised` (lo que se pega al bajar), `z-dropdown` (una lista bajo un campo), `z-nav` (la barra y el riel), `z-panel` (el panel de Registrar), `z-sheet` (hojas, ventanas y el visor) y `z-toast` (el aviso que confirma algo).
- **Movimiento:** `duration-fast` 150ms para salir, `duration-base` 200ms para fundidos y `duration-slow` 280ms para entrar; lo que entra con `ease-out` (`cubic-bezier(0.2, 0.8, 0.2, 1)`) y lo que sale con `ease-in`.

## Tamaños de pantalla

Se diseña primero el celular y se agrega hacia arriba:

| Ancho | Navegación | Contenido |
| --- | --- | --- |
| 280–359px | Barra de abajo | Una columna; el título y el monto principal bajan solos |
| 360–767px | Barra de abajo | Una columna de hasta 448px |
| 768–1023px (tablet) | Riel | Una columna de hasta 640px; Registrar como panel lateral y las hojas al centro |
| 1024–1279px | Riel | Dos paneles: lista de 320px y lo elegido al lado |
| 1280–1439px | Riel | Lista de 400px |
| 1440px o más | Riel | Lista de 440px; el detalle hasta 832px, centrado |

- Lo de adentro de un panel se acomoda al ancho de su panel (container queries), no al de la ventana.
- La barra de abajo, el riel y el contenido dejan lugar a la barra de gestos y al notch (`safe-area-inset`).
- El foco nunca queda tapado por la barra: la página reserva su alto al desplazarse (`scroll-padding`).
- Lo que cambia al pasar el mouse solo existe con mouse.

## Campos y botones

- Los campos son de una sola línea en toda la app (acceso, configuración y formularios): la etiqueta arriba y una línea de 2px en `input-line` abajo, sin caja (decisión del 25-nov: es lo que la app ya usaba y pasa 3:1; la caja con borde `input` daba 1.48:1). Si un control lleva borde, usa `input-line`.
- El botón principal mide 56px de alto, con radio de 14px, el texto a la izquierda y `arrow_forward` a la derecha.
- Los pasos 2 y 3 de la configuración llevan `arrow_back` arriba a la izquierda para volver; el paso 1 no, porque la cuenta ya existe.
- Elegir de una lista (país, idioma, banco…) nunca usa el selector del navegador: el campo de una línea muestra lo elegido con `expand_more`, y al tocarlo sube una hoja desde abajo (`radius-xl` arriba, `shadow-lg`) con un título en `title-2` y una fila de 56px por opción: nombre, una ayuda corta debajo y `check_circle` relleno en la elegida, sobre `muted`. Con más de 8 opciones, la hoja lleva un buscador fijo arriba (fondo `muted`, ícono `search`) y la elegida va primero; los meses no, porque su orden es el dato. Sin logos ni iniciales de marcas.

## Íconos

- Material Symbols Rounded, peso 400, sin relleno (`FILL 0`). Cinco tamaños: `icon-sm` 16px (dentro de una pastilla), `icon` 20px (filas, botones y campos), `icon-md` 24px (navegación y «Volver»), `icon-lg` 32px (una tarjeta destacada) e `icon-xl` 40px (estado vacío).
- El relleno (`FILL 1`) va solo en la pestaña activa y en el check de lo elegido.
- El nombre del ícono es el mismo que guarda `account_account.icon` (`restaurant`, `shopping_cart`, `home`).
- Un ícono que actúa solo, sin texto, lleva su nombre accesible: «Registrar gasto».

## Foco y accesibilidad

- El foco de teclado es un anillo de 2px sólido en `ring`, separado 2px del elemento.
- El texto cumple al menos 4.5:1 sobre su fondo en los dos temas; íconos, bordes de campo y el anillo de foco, al menos 3:1. Vale con cada acento (tinta, trigo, morado y azul) y para el texto grande basta 3:1.
- La meta es WCAG 2.2 AA.
- Todo se puede usar con teclado y el foco siempre se ve.
- Las animaciones respetan `prefers-reduced-motion`: se apagan las transiciones y las siluetas dejan de latir. La única excepción es el círculo que gira mientras algo se guarda, porque es la única señal de que algo está pasando.
- Lo elegido nunca se marca solo con el color del acento: lleva `selected`, un check o un borde de 2px (con el acento trigo en claro, el color solo no se distingue del fondo).
- Sobre los colores de categoría no se escribe texto chico: va al lado.
- Los encabezados son encabezados de verdad: un `<h1>` por pantalla y `<h2>` en las secciones.
- HTML semántico antes que ARIA.
