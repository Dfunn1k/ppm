# Auditoría del frontend (Fase 1, solo lectura)

Medido sobre `main` en 0.40.4 (25-nov-2026). Nada de esto cambia código: es la libreta del inspector. Los números salen de scripts que recorren `web/src` (cómo se midió, al final de cada sección), no de una lectura a ojo.

## a) Inventario de estilos

**La analogía.** Un sistema de diseño es como la caja de pinturas de una casa: cada color, tamaño y espacio tiene su nombre («azul cielo», «brocha mediana»). Un valor escrito a mano (`text-[22px]`) es pintar mezclando a ojo cada vez: queda casi igual, pero no igual, y si mañana cambias el azul cielo, esa pared no se entera.

### Resumen

| Qué | Cuántos | Lo que dice |
|---|---|---|
| Valores arbitrarios de Tailwind (`algo-[…]`) | **1,027** | Sin contar `aria-[current=page]` (20), que es un selector y no un valor: 1,007 |
| De ellos, tamaños de letra (`text-[Npx]`) | 582 | **293 son íconos** y 289 son texto |
| Estilos del sistema en uso (`text-caption`, `text-title-1`…) | 712 | `text-caption` 505, `text-label` 129, `text-title-hero` 40, `text-amount` 20, `text-title-2` 6, `text-amount-hero` 5, `text-title-1` 4, `text-body` 2, `text-title-display` 1 |
| `style={{…}}` en línea | 47 | 41 son de verdad dinámicos (ancho de una barra, color de una categoría); 6 no |
| Colores hex dentro de componentes | 32 | 4 del logo de Google, 27 del visor de adjuntos y 1 en las miniaturas de adjuntos |
| Colores de Tailwind fuera del tema (`bg-black/40`, `text-white`…) | 14 | El visor de adjuntos, las hojas y el panel de Registrar |
| Mezclas de color a mano (`color-mix(…)`) | 3 | Fondos suaves de ingreso y de acento |
| `!important` | 3 | Los tres en «reducir movimiento»: es su uso correcto |
| Puntos de quiebre | 2 | `lg:` (1024 px) 324 veces y `xl:` una vez; nada entre 360 y 1023 px |

### 1. Tamaños de letra

El sistema define 9 estilos de texto (`tokens.json` › `type`). El código usa **21 tamaños distintos** escritos a mano, casi siempre junto con su `leading-[…]` (46) y su `tracking-[…]` (41).

**Íconos (293).** El README dice «20 px en filas y 24 px en la navegación», pero el código usa 11 tamaños: 14, 15, 16, 18 (64 veces), 20 (46), 22 (96), 24 (56), 26, 28, 32 y 40. No hay token de tamaño de ícono. → **Token nuevo**: una escala corta de íconos (Fase 2).

**Texto (289), agrupado por el token que debería ser:**

| Tamaño de hoy | Veces | Dónde se usa | Debería ser |
|---|---|---|---|
| 10 y 11 px | 10 | Etiquetas mínimas en mayúsculas (Facts, Tipo de cambio, visor), la insignia del riel, las letras de los meses del refrán | `text-label` (12 px). 10 px está por debajo del mínimo de la escala → **error** |
| 12 px | 32 | Pastillas y textos de chip (Tarjeta, MasTipos, Personas) | No hay token de 12 px sin mayúsculas → ¿**token nuevo** («caption pequeño») o pasar a `text-caption` (13)? Fase 2 |
| 13 px | 14 | Igual que `text-caption` | `text-caption` → **error** |
| 14 px | ~70 | Botones secundarios, filas de Conciliar, ayudas de la hoja de instalar | Ningún estilo. Es el hueco más grande de la escala → **token nuevo** probable («botón» o «cuerpo pequeño») |
| 15 px | ~10 | Igual que `text-body` / `text-amount` | `text-body` o `text-amount` → **error** |
| 16 y 17 px | ~25 | Monto destacado de una fila (17 semibold), el campo de cuotas | **Token nuevo** («monto grande de fila») o `text-amount` |
| 18, 20, 22 y 24 px (sans) | ~50 | Totales de tarjetas y reportes, el campo de tasa y de otras monedas | Escala de montos: hoy solo hay `amount` (15) y `amount-hero` (40) → **token nuevo** intermedio |
| 26 px (sans, apagado) | 5 | El símbolo de la moneda junto al monto que escribes | Va con el monto del campo (fila de abajo) |
| 48 px (sans) | 3 | El monto que escribes en Registrar, Registrar con persona y Reembolso, idéntico en los tres | **Token nuevo** («monto que escribes») |
| 22 a 48 px (Bricolage, extrabold) | ~35 | Títulos y montos grandes de Inicio, Cuentas, Presupuesto, Sobre, Reportes y Tu plata, cada uno con su tamaño (26, 30, 32, 34, 36, 40 y 48) y casi siempre con un salto en `lg:` | `title-hero` (48) y `title-1` (28) cubren dos; el resto son variantes del mismo «número grande en Bricolage» → **token nuevo** con su versión de escritorio (Fase 2). Ver también e): el README dice que Bricolage es solo para títulos |

Lo que más se repite como receta completa:
- `text-[10px] leading-[14px] font-semibold tracking-[0.05em] uppercase`: 3 copias de una «etiqueta mínima».
- `font-display text-[48px] leading-[50px] font-extrabold tracking-[-0.03em] tabular-nums`: el patrimonio de Inicio y de Cuentas, igual al «monto grande» del acceso.
- `text-[48px] leading-[56px] font-semibold tracking-[-0.02em] tabular-nums`: 3 copias del campo del monto.

### 2. Espaciado

`tokens.json` define 6 pasos: 4, 8, 12, 16, 24 y 32 px. El README dice «pasos de 4 px». El código usa la escala de Tailwind entera:

| Paso de Tailwind | px | Veces | Encaja |
|---|---|---|---|
| 0.5 | 2 | 75 | No (no es múltiplo de 4) |
| 1.5 | 6 | 172 | No |
| 2.5 | 10 | 157 | No |
| 3.5 | 14 | 78 | No |
| 5 | 20 | 94 | Múltiplo de 4, pero no está en la escala |
| 7, 10, 11, 12, 14, 16, 20, 28 | 28 a 112 | 82 | Múltiplos de 4, fuera de la escala |
| 1, 2, 3, 4, 6, 8 | 4 a 32 | 1,651 | Sí |

**482 usos (2, 6, 10 y 14 px) rompen la regla de los 4 px.** Además hay 9 espaciados arbitrarios (`p-[3px]`, `gap-[3px]`, `px-[7px]`, tres `clamp()` en el acceso). → **Decisión de Fase 2**: ¿ampliar la escala (20, 40, 48…) y prohibir los medios pasos, o aceptar algunos medios pasos con nombre?

### 3. Alturas de fila y áreas que se tocan

No hay ningún token de alto. Las filas de lista usan cinco alturas: `min-h-[60px]` (29, en 19 archivos), `min-h-[52px]` (28, en 17 archivos), `min-h-14` (56 px, 43), `min-h-16` (64 px, 20) y `min-h-12` (48 px, 22). Los círculos de ícono usan `size-9`, `size-10` y `size-11` (36, 40 y 44 px) para lo mismo: 12 copias exactas de `grid size-9 … rounded-full bg-secondary` y 12 de `size-10`. Hay además 30 `h-[…]`, 20 `size-[…]`, 14 `w-[…]` y 15 `max-w-[…]` sueltos (avatares de 22 y 26 px, gráficos de 148 a 320 px). → **Token nuevo**: alturas de fila y tamaños de avatar (Fase 2).

### 4. Radios

| En el código | px | Veces | Token |
|---|---|---|---|
| `rounded-full` | — | 266 | `radius-full` ✓ |
| `rounded-md` | 10 | 82 | `radius-md` ✓ |
| `rounded` (de Tailwind) | 4 | 61 | **Ninguno** |
| `rounded-xl` | 14 | 60 | Está en `styles.css` pero **no en `tokens.json`** |
| `rounded-lg` | 16 | 45 | `radius-lg` ✓ |
| `rounded-2xl` (de Tailwind) | 16 | 6 | Igual que `rounded-lg` → **error** |
| `rounded-[12px]` | 12 | 21 | **Ninguno** |
| `rounded-[10px]` | 10 | 11 | `radius-md` escrito a mano → **error** (8 en el visor de adjuntos) |
| `rounded-[4px]`, `[3px]`, `[5px]` | 3–5 | 14 | Las barras de los reportes |
| `rounded-[8px]`, `[9px]`, `[14px]`, `[16px]`, `[0.18em]` | — | 13 | Sueltos |

Además, el `xl` (14 px) es **más chico** que el `lg` (16 px): el nombre engaña. `radius-sm` (6 px) está definido y casi no se usa. → Fase 2: fijar 4 o 5 radios con nombres que vayan de menor a mayor.

### 5. Sombras, bordes y la marca de «seleccionado»

- **Sombras:** los tokens son `shadow-sm` y `shadow-lg`. El código usa también `shadow` (11) y `shadow-md` (1) de Tailwind, que no son del sistema → **error**.
- **La marca de la fila elegida en escritorio** es `shadow-[inset_3px_0_0_var(--foreground)]`, copiada 9 veces, más dos variantes (abajo y alrededor) → **token nuevo** o utilidad con nombre.
- **Bordes:** `border-[1.5px]` (13 veces) y `ring-[1.5px]` conviven con los de 1 y 2 px, más `border-[6px]`, `[10px]` y `[26px]` (los triángulos y anillos de los gráficos). No hay token de grosor → Fase 2.

### 6. Colores

- **Visor de adjuntos** (`AttachmentViewer.tsx`): 27 hex y 9 colores de Tailwind (`bg-black/60`, `text-white`…). Es siempre oscuro, como el panel del acceso, pero no usa tokens: **repite a mano** los grises del tema oscuro (`#0a0a0a`, `#2e2e2e`, `#a3a3a3`, `#d4d4d4`, `#fafafa`) y el trigo (`#e8b04b`); `#8a8a8a`, `#737373` y `#ddd` no están en ningún token. → **Error**: que use los tokens `panel-*` o unos «siempre oscuros» con nombre.
- **Logo de Google** (`GoogleButton.tsx`): 4 hex. Son los colores de la marca de Google y no deben cambiar → **excepción documentada**.
- **Hojas y panel de Registrar:** el fondo oscurecido es `bg-black/40` y `bg-black/30` → **token nuevo** («velo»), uno solo.
- **Fondos suaves con `color-mix`:** ingreso al 12 % (Importar y Extracto) y acento al 14 % (DebtCard). `destructive-soft` y `attention-soft` ya existen; falta `income-soft` → **token nuevo**. El del acento, ¿`secondary`?
- **Muestras de acento** (`styles.css`, `.swatch-*`): repiten a mano los 12 hex de los acentos en lugar de leer `acento-*`. Funciona, pero si cambia un acento hay que cambiarlo en dos lugares.

### 7. Capas (z-index)

Siete niveles sin escala: `z-[1]` (2), `z-10` (2), `z-30` (1), `z-40` (2), `z-[45]` (2), `z-50` (4) y `z-[60]` (1). El 45 existe para meterse entre el riel (40) y las hojas (50), y el 60 para pasar por encima de todo. Es el síntoma de que cada capa se puso a mano. → **Token nuevo**: una escala con nombre (contenido, barra, panel, hoja, aviso).

### 8. Movimiento

Las duraciones (150, 180, 200, 240 y 280 ms) y las dos curvas viven solo en `styles.css`; `tokens.json` no tiene una sección de movimiento. «Reducir movimiento» apaga bien las transiciones de pantalla y las hojas, pero no `animate-spin` (17) ni `animate-pulse` (2); eso se mira en d). → **Token nuevo**: 2 o 3 duraciones y una curva.

### 9. Estilos en línea

De los 47 `style={{…}}`, 41 son dinámicos y están bien: el ancho de una barra según un porcentaje, el color de una categoría o una etiqueta (`var(--cat-N)`), las columnas según cuántas opciones hay. Los 6 que no son dinámicos:

| Dónde | Qué hace | Debería ser |
|---|---|---|
| `reportes/Reportes.tsx:92` | `height: "100%"` con `catColor(10)` | `h-full` y la clase del color |
| `reportes/Flujo.tsx:99` | `cursor` según si se puede tocar | `cursor-pointer` / `cursor-default` |
| `MoveBits.tsx:15` | Ancho, alto y tamaño de letra del avatar según `size` | Variantes de tamaño del avatar |
| `reportes/Patrimonio.tsx:90 y 96` | Opacidad fija por cada parte | Clases de opacidad |
| `InstallSheet.tsx:8` | Radio proporcional al ícono | Aceptable (es una proporción), o un radio fijo |

### 10. `styles.css` contra `tokens.json`

1. **Las categorías no cambian si eliges «Oscuro» a mano.** El tema oscuro está escrito dos veces: uno para cuando el sistema lo pide y otro para cuando lo eliges en Apariencia. El segundo no tiene `cat-0` a `cat-11`. Si tu teléfono está en claro y eliges Oscuro, los chips de categoría se ven con los colores del claro (`#c0392b` en vez de `#ee7b6f`) y el ícono en `#0a0a0a`. El contraste sigue pasando (de 3.2 a 5.5:1), pero el color no es el decidido. → **Error de estilo**, para d) y f).
2. **Líneas repetidas** en el bloque oscuro del sistema: `--selected`, `--selected-foreground` y los 12 `--cat-N` están dos veces, una de ellas mal sangrada. Es la cicatriz de un arreglo a medias, la misma que causa el punto 1.
3. **`radius-xl` (14 px, el botón principal)** está en `styles.css` y en el README, pero no en `tokens.json`.
4. **Las fuentes:** `tokens.json` dice `"Bricolage Grotesque"` y `styles.css` sirve `"Bricolage Grotesque Variable"` primero. No se nota en pantalla, pero la fuente no está completa.
5. **En `tokens.json` faltan secciones** que el código ya necesita: tamaños de ícono, alturas, capas, movimiento y grosor de borde.

Fuera de eso, todos los colores de los dos temas y de los cuatro acentos son idénticos en los dos archivos.

### Cómo se midió

- Clases arbitrarias: la expresión `prefijo-[valor]` en cada `.ts` y `.tsx` de `web/src`, agrupada por prefijo y valor.
- Íconos contra texto: el `text-[Npx]` cuenta como ícono si la misma cadena tiene la clase `icon` o está en un `<Icon>`.
- Colores: comparación de cada token de `tokens.json`, ya resuelto, con la variable de `styles.css` en claro, en oscuro del sistema y en oscuro elegido.
- Los scripts están en el historial de la sesión. Si hacen falta otra vez, pasan a `web/capturas/` en la Fase 3, como parte de la regla automática.

## c) Recorrido visual

**La analogía.** La medición automática es la balanza: dice cuánto pesa cada cosa, pero no si la torta se ve bien. Esta sección es mirar la torta: las fotos de la fase 0 en los 16 tamaños, en claro y oscuro, más los casos especiales. Lo que dice cada punto se ve en la foto que lo acompaña (`web/capturas-salida/<tema>/<tamaño>/<pantalla>.jpg`; se regeneran con `pnpm capturas`).

### Lo que pasa bien

- **Cero scroll horizontal** en las 70 pantallas, en los 16 tamaños, en los dos temas y en zoom 200 %, texto grande y teclado.
- **El riel se adapta a la altura** (1024×768): lo que no cabe pasa a «Más» (Reportes, en esa foto). Así está pensado en `Rail.tsx`; no es un error.
- **Los acentos** (tinta, trigo, morado y azul) se aplican igual en Inicio, Registrar, Apariencia y Gastos, en los dos temas. axe no marca contraste en ninguno de ellos (el detalle de contraste está en d).
- **Nada queda tapado por la barra de abajo** al final de la página en las fotos revisadas: las pantallas con barra dejan su espacio (`pb-28`).

### 1. A 1024 px, el escritorio queda apretado (importante)

Desde 1024 px aparecen el riel y los dos paneles. Pero a 1024 el espacio que queda no alcanza para lo que se diseñó a 1280 o más:

| Pantalla | Qué pasa a 1024×768 | A 1280×800 |
|---|---|---|
| Detalle de cuenta (`cuenta-banco`) | La tabla corta los nombres: «Plaza …», «Entra…», «Saldo i… Lo q» | Se leen enteros |
| Inicio | «BBVA dól…», el monto de «Comida y bebida» se parte en dos líneas («S/» arriba y «599.20» abajo), la cuenta de los últimos movimientos queda en «B…» | Todo cabe |
| Detalle de cuenta (dólares) | Igual que el de soles | Bien |

Un monto partido en dos líneas rompe la regla de los montos del README: cifras que se leen de un vistazo. → **Fase 2**: decidir qué hace cada pantalla entre 1024 y ~1200 px (una columna menos, la tabla como lista o el riel más angosto).

### 2. La tablet es un celular estirado (importante, sin diseño decidido)

A 768×1024 y 820×1180 se ve el diseño del celular: una columna de ~375 px al centro, con la barra de abajo de lado a lado. Con 820 px queda más de la mitad de la pantalla vacía. No se rompe nada, pero desaprovecha el espacio, y en horizontal (1024×768) salta de golpe al escritorio apretado del punto 1. La misión ya lo dice: la tablet no tiene diseño decidido. → **Fase 2**, con opciones.

### 3. El plegable de 280 px (menor)

- El patrimonio de Inicio y de Cuentas se parte: «S/» en una línea y «9,003.48» en la otra. Pasa con el monto en Bricolage de 48 px.
- El mes del encabezado se va a dos líneas («Noviembre / 2026»).
- En la barra de abajo, «Inicio» y «Movimientos» quedan pegados.
- La medición encontró 3 textos cortados sin «…»: «25 nov Lo que tenía al empezar» en las cuentas de banco y de dólares, y «21 nov Cuota 2 de 6» en la tarjeta. También a 320 px.

280 px es el tamaño más chico de la matriz y pocos lo usan, pero un monto partido es justo lo que PPM no debería hacer. → Que el monto grande se achique en vez de partirse (Fase 2).

### 4. Teclado abierto (menor)

Con el teclado (390×508) el campo con foco se ve siempre, y nada queda tapado. El botón «Registrar gasto» queda al final del formulario y no a la vista: hay que bajar después de escribir. Es así en el celular sin teclado también (390×844). Es una decisión de diseño, no un error, pero conviene confirmarla en la Fase 2: ¿botón fijo abajo o al final?

### 5. Zoom al 200 % (menor)

Funciona: el diseño de celular, sin scroll horizontal. La barra de abajo ocupa el 20 % del alto (80 de 400 px) y el contenido que queda a la vista es poco, pero no se corta nada.

### 6. Lo que se toca y mide menos de 44 px

**Una aclaración sobre la fase 0:** los ~400 de la tabla son la suma de las 70 pantallas, no de cada una (unos 6 por pantalla). En celular (390×844), 69 de 70 pantallas tienen al menos uno.

| Qué es | Veces (390×844) | Mide |
|---|---|---|
| Opciones de un selector segmentado (Gasto / Ingreso…, colores e íconos de Categoría nueva) | 159 | 38 de alto; los colores, 30×30 |
| Volver y Cerrar (la flecha de arriba) | 57 | 41×41 |
| Selectores de una línea («Efectivo ⌄») | 34 | 41 de alto |
| Campos de una línea («Nota») | 13 | 38 de alto |
| Otros (chips «Hoy», enlaces de «Ver todo», «Elegir cuáles»…) | 138 | Varios |

**Menos de 24 px, el mínimo de la norma (WCAG 2.5.8), en 17 lugares:**
- «VER TODO», «ELEGIR CUÁLES» y «VER TODOS» de Inicio: 16 px de alto.
- «Privacidad»: 18 px.
- Las etiquetas «¿A quién?», «¿Quién te prestó?» y parecidas de Registrar con persona: 23 px.
- «Elige la cuenta» y «Otra línea» de Registrar manual: 22 px.

En escritorio se suman, en las 63 pantallas con riel, el logo (36×36), el botón de atajos (41×41) y el de tu cuenta (38×38). Casi todo sale de 3 o 4 piezas compartidas, así que arreglarlas en la Fase 3 resuelve cientos de casos de una vez.

### 7. Un mismo elemento se ve distinto

Lo que se nota al pasar de una pantalla a otra (el detalle de componentes está en b):

- **El título de la lista en escritorio:** Cuentas usa una etiqueta chica en mayúsculas («CUENTAS») y Reportes usa un título enorme en Bricolage («Reportes»). Son el mismo lugar con dos tratamientos.
- **Los números grandes en Bricolage** tienen 7 tamaños según la pantalla: patrimonio 48, sobre 32/40, por asignar 26/40, reportes 30 o 40 (ver a).
- **En Registrar,** la fila «Etiquetas» no se alinea con las de arriba: su ícono y su texto empiezan unos 4 px más a la izquierda.
- **Los círculos de ícono** de las filas miden 36, 40 o 44 px según la pantalla (ver a, punto 3).
