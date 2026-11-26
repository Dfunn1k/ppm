# Sistema del frontend (Fase 2)

Este documento es el plano de la remodelación. Dice qué medidas tiene la casa (los tokens), cómo se acomoda en cada tamaño de pantalla, qué muebles se fabrican una sola vez y se reusan (los componentes) y qué reglas evitan que se vuelva a parchar. La Fase 3 lo construye y la Fase 4 lo aplica pantalla por pantalla.

- **Fuentes:** `design-system/README.md`, `tokens.json`, `docs/modelo-contable.md` y [AUDITORIA.md](AUDITORIA.md). Los números de «hoy» salen de la auditoría.
- **Decisiones de Dany del 25-nov (A a H):** están en [PROGRESO.md](PROGRESO.md) y aquí se aplican.
- **Lo marcado «Te toca»** es una propuesta con opciones: se decide en el ⏸ punto de control 2. Al aprobarse, todo se escribe en `design-system/` y en `docs/modelo-contable.md`.
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
- Margen lateral: 16 en el celular, 24 en la tablet y 40 en un panel de escritorio (el que ya usa `.pane-detail`).
- Entre secciones: 32. Dentro de una sección: 12 o 16.

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
- **La fila elegida en escritorio:** una utilidad con nombre, `mark-selected` (la raya de 3 px a la izquierda), en lugar de 9 copias de `shadow-[inset_3px_…]`.

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
