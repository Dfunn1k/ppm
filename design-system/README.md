PPM ayuda a una persona a saber cuánto tiene, cuánto debe y en qué se le va la plata, sin saber contabilidad. Por dentro es partida doble; por fuera habla como habla la gente. Esta guía dice cómo se ve y cómo suena.

## Voz y contenido

- Habla de tú y en frases cortas: «Registraste un gasto de S/ 35.50 en Restaurantes».
- Usa las palabras de la gente, nunca las del contador: «Lo que tengo» y «Lo que debo» (no Activo y Pasivo), «Movimiento» (no asiento ni apunte), «Por confirmar» (no borrador), «Me deben» y «Debo» (no por cobrar ni por pagar), «Costo del cambio» (no diferencia de cambio).
- Escribe en mayúscula solo la primera letra: «Nueva cuenta», no «Nueva Cuenta». Sin signos de exclamación ni emoji.
- Un botón dice lo que hace: «Registrar gasto», «Confirmar», «Archivar categoría». El aviso de después lo repite en pasado: «Gasto registrado».
- Un error dice qué pasó y cómo seguir: «Ese periodo está cerrado hasta el 30/09. Elige una fecha posterior».

## Montos

- Escribe el símbolo antes del número, con espacio y separador de miles: `S/ 1,234.50`, `US$ 300.00` (formato es-PE de `res_currency_format`).
- Todo monto va con cifras tabulares (`font-variant-numeric: tabular-nums`) y alineado a la derecha en listas y tablas.
- Lo que entra lleva `+` y `income` con el ícono `south_west`; lo que sale lleva `−` (signo menos, no guion) y `expense` con el ícono `north_east`; una transferencia entre tus cuentas usa `transfer` con `sync_alt` y no lleva signo. Nunca distingas entrada y salida solo por el color.
- El saldo principal de una pantalla va en `amount-hero`; los montos de una fila, en `amount`.

## Color

- Los nombres de los tokens son los de shadcn/ui (`background`, `card`, `primary`, `muted-foreground`, `border`, `ring`…), para que el tema pase al código tal cual.
- `primary` es el **acento** que elige cada persona en Ajustes › Apariencia; por defecto, tinta (negro en claro, blanco en oscuro). Marca la única acción principal de cada pantalla (el botón +, «Registrar gasto»), la pestaña activa y lo seleccionado, con texto en `primary-foreground`.
- El acento sale de una **paleta cerrada**: `acento-tinta`, `acento-trigo`, `acento-morado` y `acento-azul`, cada uno con sus variantes `-on`, `-suave`, `-suave-on` y `-texto`, probadas en los dos temas. Elegir un acento copia esas cinco en `primary`, `primary-foreground`, `secondary`, `secondary-foreground` y `primary-strong` (en código, un atributo `data-accent` en la raíz). Nunca se ofrecen verdes, rojos ni ámbar: ya significan ingreso, gasto y aviso.
- Para texto o enlaces en el acento usa `primary-strong`; `secondary` es el acento suave para la pestaña activa, los avatares y el fondo de los íconos de cuenta.
- `trigo` es el **sello de PPM**, fijo para todos y sea cual sea el acento. Va solo en dos lugares: la palabra «mayo» del refrán en la portada de acceso y la barra «para mayo» del ahorro. Siempre como relleno, con el texto en `on-trigo`; nunca en botones, enlaces ni texto pequeño. Así significa siempre lo mismo: «esto es para mayo». La tinta (el acento) es con lo que se actúa; el trigo, la marca.
- `attention` señala lo que pide una acción: movimientos por clasificar, tipo de cambio desactualizado, una tarjeta por vencer. Es ámbar, fijo para todos, y no cambia con el acento. Como es pariente del trigo, se distingue por la forma: siempre con ícono y una frase («3 movimientos por clasificar»), como texto o fondo suave (`attention` sobre su fondo tenue), nunca como botón relleno. Un relleno de trigo es la marca (o una acción, si la persona eligió el acento trigo); un texto ámbar con ícono es un aviso.
- `destructive` es solo para borrar, archivar y errores. `destructive-soft` y `attention-soft` son sus fondos tenues: la tarjeta de un error o de un aviso, con el texto en su color.
- `cat-0` a `cat-11` son los 12 colores de categoría, el índice de `account_account.color`. Se usan solo como fondo del chip de categoría, con el ícono en `on-category`.
- `age-0` a `age-3` son los tramos de antigüedad de lo que te deben (0–30, 31–60, 61–90 y más de 90 días): un solo tono que se intensifica con los días. Van siempre con la etiqueta del tramo; el tramo vencido se marca además con `attention` e ícono.
- `panel`, `panel-foreground`, `panel-muted`, `panel-line` y `panel-chip` son el panel de la portada de acceso en la computadora (desde 1024px): siempre oscuro, a la izquierda, con el refrán, el año y lo que hace PPM. En el tema oscuro el panel es un negro tibio para separarse del fondo. No se usan en ningún otro lugar.
- Los grises son neutros, sin tinte: el color lo ponen el acento, los montos, las categorías y el trigo, nunca el fondo.
- Hay un tema claro y uno oscuro con los mismos tokens; el oscuro no es el claro invertido. Comprueba cada combinación en los dos.

## Tipografía

- `title-display` es el refrán de la portada: «Pan / para / mayo.» en tres líneas, Bricolage Grotesque a 84px, con «mayo.» sobre un relleno de `trigo`. Solo en la portada de acceso. En la computadora crece con la ventana (hasta 176px) dentro del `panel`, y el formulario de la derecha lleva su título en `title-hero`.
- `title-hero` (48px) es el título grande de las pantallas de un solo propósito: recuperar la contraseña y los pasos de la configuración. Mismo estilo que el refrán, sin trigo.
- `title-1` y `title-2` usan Bricolage Grotesque, solo para títulos: uno por pantalla y los de sección.
- Todo lo demás va en IBM Plex Sans: `body`, `body-strong`, `caption`, `label`, `amount-hero` y `amount`.
- Los códigos que se copian (CCI, número de operación) van en `code`, con IBM Plex Mono.
- Las tres familias se cargan desde Google Fonts.

## Espacio, radios y sombras

- Trabaja en pasos de 4px: `space-1` a `space-8`. En el celular el margen lateral es `space-4`.
- `radius-md` para botones y filas, `radius-lg` para tarjetas y hojas, `radius-full` para chips de categoría, avatares y el botón flotante de registrar.
- `shadow-sm` separa una tarjeta del fondo; `shadow-lg` solo para lo que flota: hojas, menús y el botón de registrar.

## Campos y botones de acceso

- En acceso y configuración los campos son de una sola línea: la etiqueta arriba y una línea de 2px en `input-line` abajo, sin caja. Dentro de la app, los formularios usan caja con borde `input`.
- El botón principal mide 56px de alto, con radio de 14px, el texto a la izquierda y `arrow_forward` a la derecha.
- Los pasos 2 y 3 de la configuración llevan `arrow_back` arriba a la izquierda para volver; el paso 1 no, porque la cuenta ya existe.
- Elegir de una lista (país, idioma, banco…) nunca usa el selector del navegador: el campo de una línea muestra lo elegido con `expand_more`, y al tocarlo sube una hoja desde abajo (`radius-lg` arriba, `shadow-lg`) con un título en `title-2` y una fila de 56px por opción: nombre, una ayuda corta debajo y `check_circle` relleno en la elegida, sobre `muted`. Con más de 8 opciones, la hoja lleva un buscador fijo arriba (fondo `muted`, ícono `search`) y la elegida va primero; los meses no, porque su orden es el dato. Sin logos ni iniciales de marcas.

## Íconos

- Material Symbols Rounded, peso 400, sin relleno (`FILL 0`), a 20px en filas y 24px en la navegación. La pestaña activa usa `FILL 1`.
- El nombre del ícono es el mismo que guarda `account_account.icon` (`restaurant`, `shopping_cart`, `home`).
- Un ícono que actúa solo, sin texto, lleva su nombre accesible: «Registrar gasto».

## Foco y accesibilidad

- El foco de teclado es un anillo de 2px sólido en `ring`, separado 2px del elemento.
- El texto cumple al menos 4.5:1 sobre su fondo en los dos temas; íconos, bordes de campo y el anillo de foco, al menos 3:1.
