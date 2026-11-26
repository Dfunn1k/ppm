# Sistema del frontend (Fase 2)

Este documento es el plano de la remodelación. Dice qué medidas tiene la casa (los tokens), cómo se acomoda en cada tamaño de pantalla, qué muebles se fabrican una sola vez y se reusan (los componentes) y qué reglas evitan que se vuelva a parchar. La Fase 3 lo construye y la Fase 4 lo aplica pantalla por pantalla.

- **Fuentes:** `design-system/README.md`, `tokens.json`, `docs/modelo-contable.md` y [AUDITORIA.md](AUDITORIA.md). Los números de «hoy» salen de la auditoría.
- **Decisiones de Dany del 25-nov (A a H):** están en [PROGRESO.md](PROGRESO.md) y aquí se aplican.
- **Aprobado por Dany el 25-nov** (⏸ punto de control 2), con la opción recomendada en S1 a S8. Lo marcado «Te toca» queda como registro de las opciones. Está escrito en `design-system/` y en `docs/modelo-contable.md`.
- **Las medidas** se escriben en px para leerlas fácil. En el código van en `rem` (ver 1.1), así que a tamaño normal miden exactamente eso.

## 1. Tokens

**La analogía.** Hoy PPM pinta mezclando a ojo cada vez («un poco más grande que el otro»). Un token es el frasco con nombre: «título de pantalla», «fila de lista». Si mañana quieres el título más chico, cambias el frasco y cambian las 34 pantallas juntas.

### 1.1 La base: la regla de PPM mide 15 en vez de 16

**Hallazgo nuevo de esta fase.** `styles.css` fija la letra de la página en 15 px (`html { font-size: 15px }`). Tailwind mide todos sus espacios y tamaños en `rem`, que es «la letra de la página». Por eso cada paso de Tailwind mide 3.75 px en vez de 4:

| Clase | Debería medir | Mide hoy |
|---|---|---|
| `size-11` (el botón «Volver») | 44 px | 41.25 px |
| `h-10` (el selector segmentado) | 40 px | 37.5 px |
| `min-h-14` (filas) | 56 px | 52.5 px |
| `p-4` (margen lateral) | 16 px | 15 px |

Es como una cinta métrica que marca 4 cm donde hay 3.75. Explica casi todos los «menos de 44 px» de la auditoría (c6): las piezas se pidieron de 44 y salieron de 41. También explica por qué la regla de 4 px de la auditoría (a2) no cuadraba.

Hay un segundo efecto. Como el 15 está escrito en px, el navegador no puede cambiarlo. Si alguien sube el tamaño de letra de su teléfono, PPM no se entera (AUDITORIA d2).

> **Te toca (S1). ¿Arreglamos la regla?**
> - **Opción 1 (recomendada): la base vuelve a 16 px y la letra pasa a `rem`.** Cada paso vuelve a medir 4 px. Las áreas táctiles llegan a 44 sin tocarlas una por una, y quien sube la letra del teléfono ve PPM más grande. Los tamaños de letra no cambian: 15 px se escribe como 0.9375 rem. Lo que se nota es que los espacios crecen un 6.7 %, y también 85 altos de línea escritos con clases de Tailwind: un poco más de aire y algo menos de filas por pantalla.
>   Foto de antes (izquierda) y después (derecha): `/home/dfunn1k/ppm/web/capturas-salida/raiz/cuenta-banco-comparar.png` y `inicio-comparar.png`, en la misma carpeta.
> - **Opción 2: dejar la regla en 15.** Nada se mueve, pero la escala de 4 px no existe en la práctica. Habría que arreglar las áreas táctiles una por una, y la letra del teléfono tendría que pasar igual a `rem`, con la base al 93.75 %.

El resto de esta sección supone la opción 1.

### 1.2 Letra

Hoy hay 9 estilos en el sistema y 21 tamaños escritos a mano. La propuesta deja **17 estilos con nombre**, cada uno con su uso. Cada tamaño de hoy cae en uno de ellos. Los que bajan o suben 1 o 2 px se ven en las capturas de antes y después de la Fase 4.

**Títulos (Bricolage Grotesque)**

| Token | Tamaño / alto de línea | Peso | Para qué | Hoy |
|---|---|---|---|---|
| `title-display` | 84 / 76 (crece hasta 176 en el panel del acceso) | 800 | El refrán de la portada | Sin cambio |
| `title-hero` | 48 / 46; **36 / 38 por debajo de 360 px** | 800 | El título de la pantalla a la que entras (decisión C) y los de acceso y configuración | 40 usos; ya es así |
| `title-1` | 28 / 32 | 700 | Pasos internos de un flujo largo (Importar) y títulos de formulario | 4 usos más los 30 px de CuentaForm y NuevaTarjeta |
| `title-2` | 20 / 26 | 600 | Títulos de sección, de hojas y de un estado vacío | 6 usos más los 18 a 24 px en Bricolage que no son montos (EmptyState 22, Privacidad 22, Más 22 y 24, Paso2 18) |

**Montos protagonistas (Bricolage Grotesque, decisión B)**

| Token | Tamaño / alto | Peso | Para qué | Hoy |
|---|---|---|---|---|
| `amount-display` | 48 / 50; **40 / 44 por debajo de 360 px** | 800, cifras tabulares, −0.03em | El monto principal de una pantalla: patrimonio, saldo, disponible del sobre, por asignar, total del reporte | 48, 40 y el `lg:40` de hoy |
| `amount-display-2` | 30 / 34 | 800, cifras tabulares, −0.02em | Un monto grande que no es el principal: los totales de Presupuesto, Categorías, Etiquetas, Flujo y Patrimonio, el de Repartir y el de una deuda | 24, 26, 30, 32 y 34 |

> **Te toca (S2). Una corrección mía sobre la decisión B.** En la pregunta B puse «el saldo de una cuenta» entre los montos que ya van en Bricolage. No es así. El detalle de una cuenta, el de una tarjeta, el de una persona y el de un movimiento usan `amount-hero`, en la letra del texto (Plex). Puedes compararlo en la foto de BCP sueldo.
> - **Opción 1 (recomendada): esos 4 también pasan a `amount-display`.** Una sola regla: el monto principal de cualquier pantalla va en Bricolage. Es un cambio visible en esas 4 pantallas, y `amount-hero` desaparece.
> - **Opción 2: dos reglas.** Bricolage en los resúmenes (Inicio, Cuentas, Presupuesto, Reportes) y Plex en el detalle de una sola cosa. No cambia nada en pantalla, pero son dos reglas para lo mismo.

**Montos en el texto (IBM Plex Sans, siempre con cifras tabulares)**

| Token | Tamaño / alto | Peso | Para qué | Hoy |
|---|---|---|---|---|
| `amount-input` | 48 / 56 | 600, −0.02em | El monto que escribes en Registrar, Registrar con persona y Reembolso | 3 copias exactas |
| `amount-input-symbol` | 28 / 32 | 500, `muted-foreground` | El «S/» junto a ese monto | 26 |
| `amount-xl` | 22 / 28 | 600 | Totales dentro de una tarjeta o un reporte; el campo de la tasa | 18, 20, 22 y 24 |
| `amount-lg` | 17 / 24 | 600 | El monto destacado de una fila (lo que pagas, el total del día) | 16 y 17 |
| `amount` | 15 / 22 | 500 | Montos en listas y tablas | Sin cambio |

**Texto (IBM Plex Sans)**

| Token | Tamaño / alto | Peso | Para qué | Hoy |
|---|---|---|---|---|
| `body` | 15 / 22 | 400 | Texto corriente | Sin cambio |
| `body-strong` | 15 / 22 | 600 | El nombre de una fila | Sin cambio |
| `body-sm` (**nuevo**) | 14 / 20 | 400 o 600 | Botones secundarios, ayudas largas, filas de Conciliar | ~70 `text-[14px]`, el hueco más grande de hoy |
| `caption` | 13 / 18 | 400 | Fecha, cuenta y glosa debajo del nombre | Más los 14 `text-[13px]` |
| `caption-sm` (**nuevo**) | 12 / 16 | 500 | Texto de pastillas y chips, sin mayúsculas | 32 `text-[12px]` |
| `label` | 12 / 16 | 600, mayúsculas, +0.04em | Encabezados de sección y estados | Más los 10 de 10 y 11 px, que son demasiado chicos |
| `code` | 13 / 18 | 400, Plex Mono | CCI, número de operación | Sin cambio |

**Reglas de la letra**
- Todo en `rem`, nada en px.
- Nada por debajo de 12 px.
- Un título de pantalla y un monto principal por pantalla.
- `title-hero` y `amount-display` bajan solos por debajo de 360 px, así que la pantalla no necesita escribir nada para eso.
- `lg:text-[40px]` y parecidos desaparecen: el tamaño lo decide el token y no la pantalla.
- **Por revisar en la Fase 3:** si Bricolage tiene cifras tabulares. Si no las tiene, un monto que cambia (un total que se recalcula al escribir) puede «bailar».

### 1.3 Íconos

Hoy hay 11 tamaños (14 a 40). La propuesta deja 5:

| Token | Tamaño | Para qué | Absorbe |
|---|---|---|---|
| `icon-sm` | 16 | Dentro de una pastilla, junto a un `caption` | 14, 15 y 16 |
| `icon` | 20 | Filas, botones y campos (README) | 18 (64 veces) y 20 |
| `icon-md` | 24 | Navegación y «Volver» (README) | 22 (96 veces, incluida la barra de abajo, que hoy incumple el README) y 24 |
| `icon-lg` | 32 | Ícono de una tarjeta destacada o de una opción grande | 26, 28 y 32 |
| `icon-xl` | 40 | Estado vacío | 40 |

El ícono toma su tamaño de la pieza que lo contiene (`Icon size="md"`), no de una clase suelta.

### 1.4 Espacio

`tokens.json` tiene 4, 8, 12, 16, 24 y 32. El código usa además 2, 6, 10 y 14 (482 veces) y 20, 28, 40, 48, 56 y más (176).

**La escala nueva:** 4, 8, 12, 16, 20, 24, 32, 40, 48 y 64 (`space-1` a `space-16`, como Tailwind). Se suman 20, 40, 48 y 64, que hoy se usan mucho.

> **Te toca (S3). ¿Qué hacemos con los medios pasos?**
> - **Opción 1 (recomendada): se aceptan 2 y 6 px como «pasos finos», solo dentro de piezas chicas** (el espacio entre una etiqueta y su valor, el interior de una pastilla). Son como los milímetros de la regla: para el detalle, no para separar bloques. 10 y 14 se redondean a 8, 12 o 16 según el caso, y la Fase 4 deja capturas de antes y después.
> - **Opción 2: nada fuera de los múltiplos de 4.** Es más simple de vigilar. Pero las pastillas y los pares etiqueta y valor quedarían o muy pegados (4) o muy sueltos (8).

**Reglas del espacio**
- Margen lateral: 24 en el celular y la tablet, 40 en un panel de escritorio (el que ya usa `.pane-detail`). Ver S7.
- Entre secciones: 32. Dentro de una sección: 12 o 16.

> **Te toca (S7). El margen del celular.** El README dice «en el celular el margen lateral es `space-4`» (16 px). Las pantallas usan `px-6` en 88 lugares: 24 px pedidos, 22.5 de verdad (por la regla de 15).
> - **Opción 1 (recomendada):** se escribe lo que se ve, 24 px, y se corrige el README. Como en A: la casa ya se construyó así.
> - **Opción 2:** se baja a 16 px como dice el README. Entra más en cada fila, pero cambian todas las pantallas.

### 1.5 Alturas y áreas que se tocan

| Token | Medida | Para qué |
|---|---|---|
| `target` | 44 × 44 mínimo | Todo lo que se toca. Si el dibujo es más chico (un «Ver todo»), el área se agranda por dentro sin cambiar cómo se ve |
| `control` | 44 | Campo de una línea, selector segmentado, «Volver», buscador |
| `button` | 56 | El botón principal (README) |
| `button-sm` | 44 | Botón secundario o dentro de una tarjeta |

> **Te toca (S4). Alturas de fila.** Hoy, con la regla de 15, las filas miden en realidad unos 52 y unos 60 px, en 5 clases distintas.
> - **Opción 1 (recomendada): lo que se ve hoy, con nombre.** `row-sm` de 52 (una línea: ajustes, el menú Más), `row` de 60 (dos líneas con ícono: movimientos, cuentas) y `row-option` de 56 (la opción de una hoja, como dice el README). Casi nada cambia de alto.
> - **Opción 2: escalones de 8 (48, 56 y 64).** Es más «redondo», pero cada lista cambia de alto: las de movimientos crecen 4 px por fila.

**Círculos y avatares:** hoy el círculo del ícono de una fila mide 36, 40 o 44 según la pantalla. La propuesta es uno solo, `avatar` de 40, más `avatar-sm` de 24 para personas dentro de un texto (hoy 22 y 26).

### 1.6 Radios

Hoy: 4 (de Tailwind, sin token), 6, 10, 12 (a mano, 21 veces), 14 (`xl`, que es **más chico** que `lg`) y 16.

> **Te toca (S5).**
> - **Opción 1 (recomendada): los mismos valores, con nombres en orden.** `radius-xs` 4 (barras de los reportes, marcas), `radius-sm` 6 (chips de texto), `radius-md` 10 (filas que se tocan, campos con fondo), `radius-lg` 14 (botones, como dice el README del botón principal), `radius-xl` 16 (tarjetas y hojas) y `radius-full`. Las tarjetas pasan de `lg` a `xl` solo de nombre. Los 21 `rounded-[12px]` se reparten entre 10 y 14 según lo que sean. En pantalla casi nada cambia.
> - **Opción 2: escalera de 4 en 4 (4, 8, 12 y 16).** Es más fácil de recordar, pero los botones y las filas cambian de radio, aunque sea apenas (10 → 12, 14 → 16), y hay que corregir el README del botón.

### 1.7 Bordes y sombras

- **Bordes:** `border` de 1 px (separadores, tarjetas) y `border-2` de 2 px (la línea del campo, lo elegido). Los 13 `border-[1.5px]` pasan a 1 o 2.
- **Sombras:** solo `shadow-sm` (una tarjeta sobre el fondo) y `shadow-lg` (lo que flota: hojas, menús y el botón de registrar). Los `shadow` y `shadow-md` de Tailwind (12) pasan a `shadow-sm`.
- **La fila elegida en escritorio:** una utilidad con nombre, `mark-selected` (la raya de 3 px a la izquierda), en lugar de 9 copias de `shadow-[inset_3px_…]`. Su pariente `mark-selected-below` pone la misma raya abajo, para la parte elegida de una barra de totales (Personas).

### 1.8 Capas

**La analogía.** Las capas son los pisos de un edificio: el contenido en la planta baja, la barra en el primer piso y las hojas en el segundo. Hoy hay pisos «45» y «60» metidos a martillazos.

| Token | Valor | Qué va ahí | Hoy |
|---|---|---|---|
| `z-raised` | 10 | Algo que se pega arriba al bajar (el encabezado de un día) | `z-[1]`, `z-10` |
| `z-dropdown` | 20 | La lista que se abre bajo un campo (PersonPicker) | `z-30` |
| `z-nav` | 30 | La barra de abajo y el riel | `z-40` y la barra |
| `z-panel` | 40 | El panel de Registrar y la barra de acciones de Por clasificar | `z-[45]` |
| `z-sheet` | 50 | Hojas y ventanas, el visor de adjuntos | `z-50` |
| `z-toast` | 60 | El aviso que confirma algo («Gasto registrado») | `z-[60]` |

### 1.9 Movimiento

| Token | Valor | Para qué | Hoy |
|---|---|---|---|
| `duration-fast` | 150 ms | Salir: una hoja que se cierra, un fundido | 150 |
| `duration-base` | 200 ms | Fundidos y cambios de pestaña | 180 y 200 |
| `duration-slow` | 280 ms | Entrar: una pantalla, una hoja, el panel | 240 y 280 |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Lo que entra | El de hoy |
| `ease-in` | `ease-in` | Lo que sale | El de hoy |

> **Te toca (S6). «Reducir movimiento».** Hoy apaga las transiciones, pero no los círculos que giran (17) ni las siluetas que laten (2).
> - **Opción 1 (recomendada):** las siluetas dejan de latir y el círculo que gira se queda, porque es la única señal de que algo está pasando. Se anota en el README como la excepción.
> - **Opción 2:** se apaga todo. El círculo se reemplaza por un reloj de arena quieto y la palabra «Cargando».

### 1.10 Colores que faltan o sobran

Los colores de los temas y de los acentos no cambian. Lo que se ordena:

- **`income-soft` (nuevo):** el fondo suave del ingreso, como ya existen `destructive-soft` y `attention-soft`. Reemplaza los 3 `color-mix`. Se calibra para que el texto verde encima pase 4.5:1, porque hoy da 4.49 (AUDITORIA d8).
- **`overlay` (nuevo):** el velo detrás de una hoja o del panel, uno solo. Hoy son `bg-black/40` y `bg-black/30`.
- **El visor de adjuntos** usa los tokens `panel-*` (siempre oscuro), en lugar de 27 hex. Si falta un gris, se suma al grupo `panel`.
- **Las categorías en «Oscuro» elegido a mano** (AUDITORIA a10): el bloque `[data-theme="dark"]` recibe los `cat-0` a `cat-11`, y se borran las líneas repetidas.
- **Las muestras de acento** leen `var(--acento-*)`, en lugar de repetir los 12 hex.
- **`radius-xl`, las fuentes y las secciones nuevas** (íconos, alturas, capas, movimiento) pasan a `tokens.json`, para que los dos archivos digan lo mismo.
- **`input`** deja de usarse como borde de campo (decisión A): los campos son de línea, en `input-line`. Si algún control lleva borde, usa `input-line`, que pasa 3:1.
- **El acento como única señal:** lo elegido nunca se marca solo con el color del acento. Va con `selected`, un ícono de check o un borde de 2 px. Así el trigo en claro, con 1.87:1 contra el fondo, no deja nada invisible (AUDITORIA d10).
- **Sobre colores de categoría** no se escribe texto chico, como el % dentro de la barra de Ingresos. El texto va al lado de la barra (AUDITORIA d8).
- **Excepción documentada:** los 4 colores del logo de Google.

## 2. Tamaños de pantalla

**La analogía.** Una pantalla es una mesa. En el celular comes en un individual: un plato a la vez. En la tablet la mesa es más grande, pero sigues comiendo un plato a la vez, ahora con espacio para el pan y el vaso. En la computadora pones dos platos lado a lado: la lista y lo elegido. Lo que no se hace es estirar el individual hasta cubrir la mesa, que es lo que pasa hoy en la tablet.

### 2.1 Los cortes

Se diseña primero el celular y se agrega hacia arriba. Hoy hay un solo corte (1024); quedan cuatro, más un ajuste para lo muy angosto:

| Ancho | Nombre en el código | Qué es | Navegación | Contenido |
|---|---|---|---|---|
| 280–359 | `narrow` (por debajo de 360) | Plegable cerrado, celulares chicos | Barra de abajo | Una columna. `title-hero` y `amount-display` bajan solos (1.2). Los nombres se cortan con «…» y los montos nunca se parten |
| 360–767 | (base) | Celular, también en horizontal hasta 767 | Barra de abajo | Una columna de hasta 448 px (como hoy) |
| 768–1023 | `md` | Tablet en vertical, celular grande en horizontal (844×390) | **Riel** (decisión G1) | Una columna de hasta 640 px, centrada en lo que queda junto al riel. Registrar como panel lateral; las hojas como ventana al centro |
| 1024–1279 | `lg` | Laptop chica, tablet en horizontal | Riel | **Dos paneles: lista de 320 px** y el detalle al lado (decisión G2) |
| 1280–1439 | `xl` | Laptop | Riel | Lista de 400 px |
| 1440 en adelante | `2xl` (se cambia a 1440, Tailwind trae 1536) | Monitor | Riel | Lista de 440 px. El detalle no pasa de 52 rem (832 px) y se centra |

**Qué cambia en cada corte, nada más:**
- **`md`:** la barra de abajo se va y aparece el riel. Lo que hoy se activa en `lg` por ser «escritorio» se divide en dos:
  - desde `md`: el riel, el panel de Registrar y las hojas al centro;
  - desde `lg`: los dos paneles (`Split`) y las pantallas de escritorio propias (Inicio en 3 columnas, Pendientes en 3, Más con índice).
  - `useDesktop()` se parte en `useRail()` (768) y `useSplit()` (1024).
- **`lg`, `xl` y `2xl`:** solo cambia el ancho de la lista. El detalle se adapta solo (2.2).
- **El riel con poco alto** (1024×768, el celular en horizontal) ya manda lo que no cabe a «Más» (`useRailSpill`). Así está pensado y se mantiene.

### 2.2 Que cada pieza se adapte a su lugar, no a la ventana

**La analogía.** Hoy cada mueble mira el tamaño de la casa para decidir cómo se acomoda. Pero el detalle de una cuenta puede estar en una casa grande y aun así en una pieza chica (el panel de la derecha a 1024 px). Por eso a 1024 se corta «BBVA dól…» aunque la ventana sea ancha.

**La regla:** la pantalla decide con los cortes de 2.1 (`md:`, `lg:`) solo dónde va cada panel. Lo de adentro (una tabla, una tarjeta con datos lado a lado, un gráfico) se adapta al ancho de su panel, con *container queries* (`@container` y `@md:` en Tailwind 4, que ya viene incluido: no es una dependencia nueva). Ejemplos:
- **La tabla de movimientos de una cuenta:** con menos de 560 px de panel, el saldo baja debajo del monto en lugar de ser una columna, y la descripción se corta con «…».
- **Los datos de Inicio** («Tienes / Debes / Tus dólares»): de a 3 si hay lugar y de a 2 si no, en vez de partirse.
- **Un monto nunca se parte en dos líneas** (`whitespace-nowrap` en la pieza `Amount`). Lo que cede es el nombre de al lado, que se corta con «…».

### 2.3 Lo que tapa: barra, notch, barra de gestos y teclado

- **La barra de gestos y el notch** (`safe-area-inset`). La página ya pide ocupar toda la pantalla (`viewport-fit=cover`), pero nada se corre para dejarles lugar.
  - La barra de abajo suma `env(safe-area-inset-bottom)` a su alto.
  - El contenido suma el mismo espacio abajo.
  - En horizontal, el riel y el contenido suman `safe-area-inset-left` y `-right`, por el notch al costado.
  - Arriba, la primera fila suma `safe-area-inset-top` cuando PPM está instalada.
  - Esto no se puede ver en Playwright: va con la prueba en un iPhone real (PROGRESO).
- **El foco escondido detrás de la barra** (AUDITORIA d1). Se resuelve con `scroll-padding-bottom` en la página, igual al alto de la barra más la barra de gestos. Cuando el teclado lleva el foco a algo, el navegador lo deja por encima de la barra. Pasa lo mismo arriba con lo que se pega al bajar (`scroll-padding-top`).
- **El teclado del celular.** Las hojas y el panel usan `dvh` (el alto que de verdad queda, que se achica con el teclado), no `vh`. El botón principal de un formulario largo queda al final del formulario y no fijo abajo, para que el teclado no lo tape. Hoy ya es así y se escribe como regla.
- **Alto de pantalla:** `min-h-dvh` en las pantallas (ya está). `svh` para lo que no debe saltar cuando aparece o se esconde la barra del navegador (la portada de acceso).

### 2.4 Dedo, mouse y teclado

- **El hover** (lo que cambia al pasar el mouse) solo existe con mouse. Tailwind 4 ya lo hace así (`hover:` va dentro de `@media (hover: hover)`), así que en el celular no queda nada «pegado» después de tocar.
- **Las áreas táctiles** son de 44 px con dedo y con mouse. No se achican con mouse: es una sola regla y nadie pierde.
- **Los atajos de teclado** (N, /, ↑ ↓, E, Esc, Ctrl ↵) funcionan en todos los tamaños. Su ayuda (el botón del riel y «Atajos» en Más) se muestra solo con mouse (`pointer: fine`), porque en una tablet sin teclado no sirve.

### 2.5 Cómo se comprueba

La matriz de la misión (16 tamaños, más zoom, texto grande y teclado) se fotografía con `pnpm capturas`. Se miden:
- cero scroll horizontal;
- nada de menos de 44 px;
- montos sin partir;
- cero paradas de teclado tapadas (`teclado.spec.ts`);
- y, desde la Fase 3, que **texto grande** (raíz a 20 px) ya no sea idéntica a 390×844.

## 3. Componentes compartidos

**La analogía.** Hoy muchas pantallas recortan su galleta a mano (AUDITORIA b). Aquí van los moldes: cada uno se hace una vez en `web/src/components/`, con sus variantes y sus estados, y la Fase 4 reemplaza las galletas a mano por el molde.

### 3.1 Estados que todo molde tiene

| Estado | Cómo se ve | Detalle |
|---|---|---|
| Normal | Como en las tablas de abajo | — |
| Hover (solo con mouse) | Fondo `muted` | Las filas, los botones de contorno y los de solo ícono. El botón principal se oscurece apenas. Con dedo no existe (2.4) |
| Presionado | Fondo `muted` más oscuro, sin moverse | La misma regla en todos lados; hoy hay 3 maneras |
| Foco | Anillo de 2 px en `ring`, separado 2 px (README) | **En el elemento que recibe el foco o en la caja que lo envuelve, nunca solo un cambio de color** (AUDITORIA d11 y d12: los buscadores sin anillo y PersonPicker) |
| Elegido | `selected` en filas y opciones; `mark-selected` en la lista del escritorio; `aria-pressed`, `aria-selected` o `aria-current` según el caso | Nunca solo el color del acento (1.10) |
| Deshabilitado | Opacidad 50 %, sin hover y sin cursor de mano | Una sola opacidad (hoy 50, 60 y 70). Un botón principal deshabilitado lleva una ayuda que dice por qué, si no es obvio |
| Cargando | En un botón: el círculo que gira en lugar de la flecha, mismo ancho, `aria-busy`. En una pantalla: la silueta con su forma (decisión «Mientras carga», 13-nov) | Una pantalla nunca muestra solo el círculo. Las 20 que lo hacen pasan a silueta |
| Vacío | `EmptyState`: ícono, qué es, cómo empezar y un botón si hay algo que hacer (13-nov) | Nunca ceros que parecen datos |
| Error | `ErrorAlert` arriba de lo que falló, en `destructive-soft` con ícono y frase. En un campo: la línea en `destructive`, el mensaje debajo, `aria-invalid` y `aria-describedby` | Hoy solo uno de los campos de monto marca `aria-invalid` |

### 3.2 Los moldes

Las variantes se arman con `cva`, que ya está instalado. **Nuevo** = hoy no existe; **Mover** = existe dentro de una página y pasa a `components/`; **Ajustar** = existe y cambia.

| Molde | Qué es | Variantes | Reemplaza |
|---|---|---|---|
| **`Row`** (nuevo) | La fila de lista: algo a la izquierda, título y subtítulo, algo a la derecha | `size`: `sm` (52, una línea), `md` (60, dos líneas), `option` (56). `leading`: `avatar`, `category`, `icon`, ninguno. `trailing`: monto, chevron, interruptor, check, texto. `as`: enlace, botón o fila quieta. `selected` | 91 filas a mano en 41 archivos. `PostRow`, `MoveLine`, `NoticeItem` y `DebtCard` se arman encima de `Row` |
| **`SectionHeading`** (Mover `Heading`) | «LO QUE TENGO ───», con una acción opcional a la derecha («Ver todo») | Con o sin línea; con o sin acción | 61 copias. Es un `<h2>` de verdad (AUDITORIA d4). La acción mide 44 px de alto aunque se vea chica (d9) |
| **`Screen`** (Ajustar) | El contenedor de la pantalla | `width`: `phone` (448), `wide` (640, la tablet), `full` (escritorio propio: Inicio, Pendientes). Arma solo el espacio de la barra y de la barra de gestos | 41 páginas a mano en 17 combinaciones |
| **`PageHeader`** (Mover `FormHeader`, `ReportHeader` y `StepHeader`) | Flecha, título y acciones (⋮) | `back`: a dónde vuelve, que da el nombre «Volver a Cuentas». `title` en `title-hero`. `eyebrow`: la etiqueta de arriba («AHORROS EN SOLES»). `actions` | 36 flechas con 12 nombres accesibles distintos. Siempre un enlace, nunca un botón, salvo que cierre algo |
| **`Avatar`** (Ajustar `Avatar`, `CategoryChip` y `MoveIcon`) | El círculo de una fila | `kind`: `category` (`cat-N` con `on-category`), `account` (`secondary`), `person` (iniciales), `status` (`muted`, `attention`). `size`: `md` 40, `sm` 24 | 46 círculos a mano en 7 tamaños, y el tamaño en `style` |
| **`Amount`** (nuevo; lo que el README de Amount ya describe) | Un monto con su signo, ícono y símbolo | `size`: `display`, `display-2`, `xl`, `lg`, el de fila. `direction`: entra, sale, transferencia, ninguna. `symbol`: el de la regla E (sin símbolo en filas de tu moneda). Nunca se parte (`nowrap`) | `MoveAmount`, `Amounts`, las ~22 funciones `money` repetidas y los dos `useMoney` |
| **`AmountField`** (Mover) | El campo grande del monto que escribes | Con o sin selector de moneda; error | 3 copias exactas y versiones de 44, 34 y 30 px |
| **`Button`** (Ajustar `PrimaryButton`, reemplaza el README de Button: decisión F) | Un botón | `variant`: `primary` (56, `radius-lg`, texto a la izquierda y `arrow_forward`), `secondary` (contorno), `ghost` (solo texto, como «Cancelar»), `destructive` (borrar, archivar). `size`: `md` (56), `sm` (44). `pending` | 9 principales hechos a mano, 3 centrados, 4 de borrar, 6 de contorno y los 6 «Cancelar» subrayados |
| **`IconButton`** (nuevo) | Un botón de solo ícono (⋮, ×, el ojo de ocultar) | `size` 44 siempre. `label` obligatorio, porque sin él no compila | Hoy cada uno pone su tamaño |
| **`Chip`** (Ajustar `Pill`) | Un filtro que se elige o una pastilla que informa | `kind`: `filter` (se toca, `aria-pressed`, 44 de área), `info` (no se toca). `tone`: neutro, `attention`, `income`, `selected` | 38 chips y 9 pastillas; solo 13 dicen si están elegidos |
| **`ProgressBar`** (Ajustar `Segments` y `ShareBar`) | Una barra de avance o de proporción | `tone`: categoría, trigo (solo «para mayo», regla del trigo), `expense` (pasado del límite). `size`: `sm` 6, `md` 10. Un solo trato para el lector de pantalla: `role="meter"` con su valor en palabras | 11 barras a mano, 5 altos y 4 tratos |
| **`SearchField`** (nuevo, sale de `OptionList`) | El buscador | Con o sin «limpiar» | 8 copias, 2 sin anillo de foco |
| **`Segmented`** (Ajustar) | Elegir una entre 2 a 4 opciones | 44 de alto. `Registrar` y `MasTipos` usan el mismo | La barra duplicada de Gasto / Ingreso / Transferir / Más |
| **`LineField`, `SheetSelect`, `DateField`, `PersonPicker`, `RateField`** (Ajustar) | Los campos de línea (decisión A) | 44 de alto mínimo; foco con anillo en la caja que los envuelve | PersonPicker con su foco distinto |
| **`ArchiveSheet`** (Mover) | Confirmar archivar o borrar | — | 2 copias (cuenta y tarjeta) |

**Se documentan como están**, porque ya se usan bien:
- `Sheet` y `OptionList`;
- `Split`;
- `Rail` y `AppNav`;
- `EmptyState`;
- los esqueletos;
- `ErrorAlert`, `Note`, `Status`, `Facts`, `Optional` y `Kbd`.

### 3.3 Dónde quedan escritos

- **El código:** `web/src/components/`, una pieza por archivo, sin moldes dentro de `pages/`.
- **La guía para personas:** `design-system/components/<Molde>/README.md`, con qué es, cuándo se usa, variantes, estados, accesibilidad y qué no hacer. Al aprobarse este documento se escriben los de Row, SectionHeading, PageHeader, Avatar, Amount, Button y Chip, y se corrigen los de Amount y Button. Los demás, cuando la Fase 3 los construya.

> **Te toca (S8). shadcn/ui.** `CLAUDE.md` dice «componentes de shadcn/ui», pero no hay ninguno instalado. Las piezas de PPM son propias y a la medida (AUDITORIA b).
> - **Opción 1 (recomendada):** se ajusta la regla: «componentes propios en `web/src/components/`, con variantes `cva`, al estilo de shadcn (nombres de tokens y API)». No suma dependencias, y lo que ya funciona (Sheet, Segmented) no se rehace.
> - **Opción 2: adoptar las piezas de shadcn** (Dialog, Switch, Tabs…). Traen accesibilidad probada, pero suman Radix como dependencia nueva y hay que rehacer piezas que ya andan.

## 4. Reglas de código

**La analogía.** Es el reglamento de la obra: no basta con dejar la casa ordenada, hay que impedir que el próximo arreglo vuelva a traer el martillo y los clavos de cualquier tamaño. Y como nadie lee el reglamento en la obra, un inspector automático revisa cada PR.

### 4.1 Las reglas

1. **Solo tokens.** Nada de valores arbitrarios de Tailwind (`text-[22px]`, `min-h-[60px]`, `rounded-[12px]`, `z-[45]`), colores hex, `rgb()`, colores de Tailwind fuera del tema (`bg-black/40`, `text-white`) ni `color-mix` en componentes. Si falta un valor, se propone un token: `tokens.json`, `styles.css` y README en el mismo PR.
2. **Estilos en línea** (`style={{…}}`) solo para lo de verdad dinámico: un ancho en %, `var(--cat-N)` o un número de columnas. Nada de `!important`, salvo en «reducir movimiento».
3. **Letra en `rem`**, con los estilos de 1.2. El tamaño lo da el token, no la pantalla: nada de `lg:text-[40px]`.
4. **Moldes antes que copias.** Antes de escribir una fila, un encabezado o un botón, se usa el molde de 3.2. Si no alcanza, se le suma una variante con `cva`; no se copia. Un molde que usan dos pantallas vive en `components/`, nunca dentro de una página.
5. **Cortes de pantalla:** solo `md:`, `lg:`, `xl:` y `2xl:` para dónde va cada panel, y `narrow:` para lo muy angosto. Lo de adentro de un panel se adapta con `@container`. Nada de `max-[…]` ni `min-[…]` sueltos.
6. **Montos:** siempre con `Amount` o `money.ts`. Nada de `toFixed` ni `toLocaleString` (AUDITORIA e3 y e5).
7. **Accesibilidad:**
   - un `<h1>` por pantalla y `<h2>` en las secciones (con `SectionHeading`);
   - `IconButton` exige su nombre;
   - todo lo que se toca mide 44 px;
   - el foco se ve en el elemento o en su caja;
   - nada que se pueda enfocar dentro de algo con `aria-hidden` (los gráficos de Reportes);
   - nada que se toque dentro de un `role="img"` (Personas);
   - el nombre accesible empieza con lo que se lee en pantalla (Inicio).
8. **Íconos:** con `Icon` y su tamaño (`sm`, `md`…), relleno solo en la pestaña activa y en el check de lo elegido (README).
9. **Cada PR que toca algo visible** deja fotos de antes y después (de `pnpm capturas`) y no sube la cuenta del inspector.

### 4.2 El inspector automático (Fase 3)

**Una prueba de Vitest**, sin dependencias nuevas: `web/src/estilo.test.ts`. Lee todos los `.tsx` y `.css` de `web/src` y falla si encuentra:
- valores arbitrarios de Tailwind (`algo-[…]`), salvo los selectores como `aria-[current=page]`;
- colores hex, `rgb(`, `color-mix(` o colores de Tailwind fuera del tema;
- `style={{` con algo que no sea un %, una `var(--…)` o una cuenta;
- `text-[`, `leading-[`, `tracking-[`, `z-[` o `rounded-[`.

**Las excepciones** van en una lista, `web/src/estilo-excepciones.ts`, cada una con su archivo y su motivo (el logo de Google, el `clamp()` del refrán). La lista solo puede achicarse. Hoy no se puede (hay ~1,000), así que la prueba empieza con **un tope por archivo** igual a lo que hay. Cada lote de la Fase 4 baja el tope de sus pantallas a cero, y al final de la Fase 4 el tope desaparece.

No hay ESLint en el proyecto. Agregarlo sería una dependencia nueva, y una prueba de Vitest alcanza para esto.

### 4.3 Qué se actualiza con esto

- **La skill `ppm-interfaz`:** apunta a este documento y a los moldes de 3.2, y suma la regla 5 (container queries) y el inspector.
- **`CLAUDE.md`:** la línea de shadcn, según S8.

## Resumen de lo que te toca (⏸ punto de control 2)

| # | Qué | Recomendación |
|---|---|---|
| S1 | La regla de 15 px: ¿la base vuelve a 16 y la letra pasa a `rem`? | Sí (fotos en 1.1) |
| S2 | El monto principal del detalle de cuenta, tarjeta, persona y movimiento: ¿también en Bricolage? | Sí, una sola regla |
| S3 | Medios pasos de espacio (2, 6, 10 y 14 px) | 2 y 6 solo dentro de piezas chicas; 10 y 14 se redondean |
| S4 | Alturas de fila | 52, 60 y 56 (lo que se ve hoy) |
| S5 | Radios | Los mismos valores con nombres en orden |
| S6 | «Reducir movimiento» y el círculo que gira | El círculo se queda; las siluetas dejan de latir |
| S7 | Margen lateral del celular | 24 px, como se ve; se corrige el README |
| S8 | shadcn/ui en `CLAUDE.md` | Moldes propios con `cva`, al estilo shadcn |

Y además, todo el documento: la escala de letra (1.2), íconos (1.3), capas (1.8), movimiento (1.9), colores (1.10), los cortes (2), los moldes (3) y las reglas (4).

Con tu OK:
1. Se escribe en `design-system/` (README, `tokens.json` y los README de los moldes) y en `docs/modelo-contable.md`, en este mismo PR.
2. Después empieza la Fase 3, los cimientos.
