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

> **Corrección de la Fase 4:** esos 11 tamaños no se aplicaban. La regla `.icon` de `styles.css` está fuera de las capas de Tailwind y le gana a cualquier `text-[…]`, así que todos los íconos medían 20 px.

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

> **Corrección de la Fase 2:** como la letra base de la página está fija en 15 px, cada paso de Tailwind mide en realidad 3.75 px y no 4 (`p-4` = 15 px, `size-11` = 41.25 px). Las medidas en px de esta tabla son las nominales. Ver `SISTEMA.md` 1.1.

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

## b) Componentes

**La analogía.** Un componente compartido es un molde de galletas: haces el molde una vez y todas salen iguales. Hoy, muchas pantallas recortan su galleta a mano con cuchillo. Se parecen, pero una sale 4 px más ancha, otra sin el anillo de foco, otra con un nombre distinto para el lector de pantalla. Si mañana cambias la receta, hay que ir galleta por galleta.

### Lo que ya está bien unificado

- **Lista y detalle en escritorio** (`Split`): ninguna copia a mano.
- **`Sheet`** (35 archivos), **`PrimaryButton`** (33), **`LineField`** (23), **`Segmented`** (16), **`SheetSelect`** (15) y **`Icon`** (88) se usan bien en casi todos lados.

### Mismo patrón, código distinto (las 10 de más impacto)

| # | Patrón | Molde que existe | Copias a mano | En qué difieren |
|---|---|---|---|---|
| 1 | **Fila de lista** (círculo, título, subtítulo y monto) | Ninguno general; solo versiones de un dominio (`PostRow`, `MoveLine`, `NoticeItem`, `DebtCard`) | 91 en 41 archivos | Alto de 52, 56, 60, 68 o 72 px; separación de 12 o 14 px; la marca de la fila elegida en escritorio, copiada 8 veces |
| 2 | **Encabezado de sección** («LO QUE TENGO ───») | `Heading`, escondido en `pages/presupuesto/common.tsx` (2 usos) | 61 en 35 archivos | Ninguno es un encabezado de verdad (`<h2>`): el lector de pantalla no los ofrece para saltar de sección en sección (ver d) |
| 3 | **Contenedor de la pantalla** | `Screen` (`ui.tsx`, 19 archivos, y 15 le cambian el relleno) | 41 páginas lo escriben a mano, en 17 combinaciones | El espacio de abajo es de 24, 32, 40 o 112 px según la página |
| 4 | **Botón «Volver» y cabecera de formulario** | `FormHeader`, atrapado en `pages/cuentas/Nueva.tsx` (8 usos); además `ReportHeader`, `StepHeader` y `Back` | 36 flechas en 33 archivos; 5 formularios copian `FormHeader` | 12 nombres accesibles distintos («Volver a Más», «Volver», «Volver a cuentas»…); 6 son botón y no enlace |
| 5 | **Círculo de ícono** | `CategoryChip`, `Avatar` y `MoveIcon`, que reciben el tamaño en `style` | 46 en 22 archivos (12 solo en Más) | 7 tamaños (32 a 64 px) y 4 fondos |
| 6 | **Montos** | `money.ts` formatea bien, pero no hay un componente de monto | `useMoney` está definido dos veces (Presupuesto y Reportes); unas 22 funciones `money` repetidas | El campo grande de Registrar está copiado 3 veces (48 px), más versiones de 44, 34 y 30 px; solo una marca el error con `aria-invalid` |
| 7 | **Botones fuera de `PrimaryButton`** | `PrimaryButton` | 9 principales de 56 px hechos a mano, 3 de 52 px con el texto al centro, 4 de borrar, 6 de contorno | Deshabilitado con opacidad de 50, 60 o 70 %; no hay un botón secundario ni uno de borrar compartidos |
| 8 | **Chips de filtro y pastillas** | `Pill` (9 archivos) | 38 chips en 28 archivos y 9 pastillas sueltas | Alto de 20 a 40 px; letra de 11 o 12 px; solo 13 dicen si están elegidos (`aria-pressed`) |
| 9 | **Barras de avance** | `Segments` (2 usos) y `ShareBar` (Reportes) | 11 hechas a mano | 5 altos (6 a 16 px); para el lector de pantalla, 4 tratos distintos (oculta, imagen, medidor, barra de progreso) |
| 10 | **Buscador y selector segmentado** | El buscador de `OptionList` y `Segmented` | 8 buscadores copiados (2 sin anillo de foco: Etiquetas y Clasificar); la barra Gasto / Ingreso / Transferir / Más está duplicada en `Registrar.tsx` y `MasTipos.tsx` | Alto de 40 o 44 px; la barra duplicada mide 38 px y `Segmented`, 40 |

También están casi repetidos:
- `ArchiveSheet`, en el detalle de cuenta y en el de tarjeta.
- El botón «Cancelar» subrayado, 6 veces.
- El estado vacío, con 2 copias fuera de `EmptyState`.
- La carga: 20 pantallas usan el círculo que gira (`Spinner`) y otras 20 usan esqueletos.

### Moldes que viven en el lugar equivocado

Se comparten, pero están dentro de una página y no en `components/`: `FormHeader`, `AmountField`, `Heading`, `PostChip`, `AvailablePill`, `ShareBar`, `ReportHeader`, `StepHeader` y `useMoney`. Para usarlos, otra página tiene que importar de una página hermana, y eso invita a copiarlos.

### Qué documenta `design-system/`

`design-system/components/` tiene Amount, Button, CategoryChip y Cover. De ellos:
- **CategoryChip** es el único que coincide con el código.
- **Button** dice «alto 40 px, `radius-md`», pero el README general y `PrimaryButton` dicen 56 px y radio 14. **Se contradicen.**
- **Amount** describe un componente que no existe con ese nombre; lo hacen a medias `MoveAmount` y `Amounts`.
- **Cover** solo tiene la vista previa, sin README.

El README general describe en palabras `LineField`, `PrimaryButton` y la hoja con buscador. **Sin documentar**, y con más de 5 usos:
- `ErrorAlert` (67 archivos);
- `Spinner` (21);
- `Screen` (19);
- `Facts` (18);
- `Segmented` (16);
- `DateField` (13);
- `Optional` y `Pill` (9 cada uno);
- `RateField` (9);
- `Avatar` (8);
- `PersonPicker` (7);
- los esqueletos;
- `EmptyState` (6);
- `Status` y `Kbd` (5 cada uno).

### shadcn y cva

- **No hay `components/ui/` de shadcn.** Hay un `components.json` y la función `cn()`, pero ninguna pieza de shadcn instalada: Sheet, Segmented, SheetSelect, Pill y los esqueletos son propios. No es malo, porque están hechos a la medida de PPM, pero la regla de `CLAUDE.md` («componentes de shadcn/ui») no describe lo que hay. → Fase 2: decidir si la regla cambia o si se adoptan piezas de shadcn.
- **`class-variance-authority` está instalado y no se usa en ningún archivo.** Las variantes se arman con condiciones dentro de las clases. La skill `ppm-interfaz` pide `cva` para las variantes: es la herramienta para los moldes de la Fase 3.

### Cómo se midió

Un ayudante recorrió `web/src` con grep y un script que cuenta los imports, también los que ocupan varias líneas. Verifiqué a mano estas cifras:
- `cva` sin usos;
- `useMoney` en dos archivos;
- el README de Button con 40 px;
- 61 encabezados de sección con la misma receta exacta.

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

## d) Accesibilidad

**La analogía.** La accesibilidad es como una casa con rampa, pasamanos e interruptores a la altura de la mano: hace la casa usable para quien va en silla de ruedas, para quien carga bolsas y para quien entra a oscuras. En PPM eso es poder usarlo solo con el teclado, con un lector de pantalla que lee en voz alta, con letra grande o con poca vista para los colores.

**Cómo se revisó:**
- **axe:** las 70 pantallas, a 390 y a 1440 px, en claro y en oscuro.
- **Contraste:** calculé cada par de colores de los tokens, en los dos temas y con los cuatro acentos.
- **Teclado:** una prueba nueva (`web/capturas/teclado.spec.ts`) aprieta Tab en cada pantalla hasta dar la vuelta. En 67 pantallas fueron 1,180 paradas en celular y 1,744 en escritorio. En cada parada anota si el foco se ve, si algo fijo lo tapa y si cayó en algo invisible.
- **Código:** revisé los nombres de los botones de solo ícono, las imágenes, los encabezados, el foco y «reducir movimiento».

### Lo que pasa bien

- **Botones de solo ícono:** todos tienen nombre (0 sin `aria-label`). Las imágenes tienen `alt` y la página dice que está en español (`lang="es"`).
- **Texto:** el principal y el secundario superan 4.5:1 en los dos temas: `muted-foreground` va de 6.0 a 7.8:1, y `income`, `expense`, `attention` y `destructive`, de 4.8 a 9.7:1.
- **Acentos:** con los cuatro, el texto sobre el acento y el texto en el acento pasan 4.5:1, en los dos temas.
- **Foco:** el anillo de 2 px está en todo el sitio, y 1,160 de las 1,180 paradas en celular lo muestran.
- **Zoom del navegador al 200 %:** funciona, sin scroll horizontal.
- **Teclado:** no hay trampas: el recorrido siempre da la vuelta.
- **«Reducir movimiento»** apaga las transiciones de pantalla y las hojas.

### Lo que falla

| # | Qué pasa | Dónde | Norma (WCAG 2.2) | Gravedad |
|---|---|---|---|---|
| 1 | **El foco se esconde detrás de la barra de abajo.** Al bajar con Tab, el elemento con foco queda debajo de la barra de navegación: 19 veces en 9 pantallas (Inicio, Cuentas, Presupuesto, Movimientos, Tarjeta, Más…) | Celular y tablet | 2.4.11 Foco no tapado (AA) | Importante |
| 2 | **La letra grande del sistema no hace nada.** Toda la letra está en px fijos (`font-size: 15px` en `html`), así que si alguien sube el tamaño de letra del navegador, PPM no cambia. La foto «texto grande» de la fase 0 es idéntica byte a byte a la normal. El zoom del navegador sí funciona, por eso no rompe la norma, pero quien ve poco y sube la letra de su teléfono no recibe nada | Toda la app | 1.4.4 Cambiar el tamaño del texto (se cumple por el zoom); buena práctica | Importante |
| 3 | **Los bordes de los campos con caja casi no se ven:** `input` sobre `card` da 1.48:1 en claro y 1.73:1 en oscuro (se pide 3:1). Los campos de una línea (`input-line`, 4.5:1) sí pasan | Formularios dentro de la app | 1.4.11 Contraste de lo que no es texto | Importante |
| 4 | **Los encabezados de sección no son encabezados.** Los 61 «LO QUE TENGO ───» son `<div>` o `<span>`, y en todo `web/src` hay 4 `<h2>`. Quien usa lector de pantalla no puede saltar de sección en sección | Casi todas las pantallas | 1.3.1 Información y relaciones | Importante |
| 5 | **Gráficos que reciben el foco pero no se ven** (axe: 32 elementos). Las miniaturas de Reportes están ocultas para el lector de pantalla (`aria-hidden`), pero el gráfico de adentro (recharts) se puede enfocar: el teclado se detiene 3 veces en algo que nadie oye ni ve | Reportes y sus 6 reportes, en escritorio | 4.1.2 Nombre, función y valor | Importante |
| 6 | **Un botón dentro de otro** (axe). La barra «Desde cuándo te deben» es una imagen (`role="img"`) con botones adentro | Reporte de Personas | 4.1.2 | Importante |
| 7 | **El nombre no coincide con lo que se ve** (axe). La tarjeta de presupuesto de Inicio se llama «Presupuesto de noviembre 2026» y tapa todo lo que muestra. El lector de pantalla no dice «Por asignar S/ 18,524.60» ni los sobres en rojo | Inicio | 2.5.3 Etiqueta en el nombre | Importante |
| 8 | **Contraste justo debajo del mínimo** (axe). La pastilla de disponible en verde da 4.49:1 (`income` sobre `income` al 12 %). El porcentaje dentro de la barra de Ingresos usa `on-category` blanco sobre colores claros de categoría (hasta 3.6:1 con `cat-3`) | Presupuesto, Sobre, Por asignar y reporte de Ingresos, en claro | 1.4.3 Contraste | Importante |
| 9 | **Áreas táctiles menores de 24 px** en 17 lugares (ver c, punto 6): «VER TODO», «ELEGIR CUÁLES», «Privacidad», las etiquetas de «¿A quién?», «Elige la cuenta» y «Otra línea» | Inicio, Más, Registrar | 2.5.8 Tamaño del objetivo, mínimo (AA) | Importante |
| 10 | **El acento trigo en claro no se distingue del fondo:** 1.87:1 contra los 3:1 que se piden. Afecta lo que se marca solo con el color del acento, como la opción elegida o el borde de lo seleccionado. El texto sobre trigo sí pasa (8.4:1) | Acento trigo, tema claro | 1.4.11 | Menor (hay que ver en la Fase 2 qué se marca solo con `primary`) |
| 11 | **Dos buscadores sin anillo de foco:** Etiquetas (`Tags.tsx:85`) y Clasificar | Hojas de etiqueta y de clasificar | 2.4.7 Foco visible | Menor |
| 12 | **El foco de «¿A quién?» solo oscurece la línea de abajo,** de gris a negro, sin anillo. Fueron 15 paradas en los Registrar con persona y el saldo inicial | `PersonPicker` | 2.4.7 (se cumple, pero es distinto al resto) | Menor |
| 13 | **Lo que gira no respeta «reducir movimiento»:** 17 `animate-spin` y 2 `animate-pulse` siguen moviéndose. El README dice que las animaciones lo respetan | Botones que cargan y esqueletos | Regla del README (2.3.3 es nivel AAA) | Menor |
| 14 | **Las categorías en oscuro elegido a mano** muestran los colores del tema claro (ver a, punto 10). El contraste pasa, pero no es el color decidido | Si el teléfono está en claro y PPM en Oscuro | — | Menor |

### Lo que no se pudo medir aquí

- **Lector de pantalla de verdad** (VoiceOver o TalkBack): queda para la Fase 5, con una lista de pruebas a mano.
- **Notch y barra de gestos del iPhone:** la página pide ocupar toda la pantalla (`viewport-fit=cover`), pero el código no usa `safe-area-inset` en ningún lado, y Playwright no simula el notch. Instalada como app, la barra de abajo puede quedar debajo de la barra de gestos del iPhone. → Revisarlo en un iPhone real (Dany) y decidirlo en la Fase 2.
- **Lighthouse:** se pide en la Fase 5 y necesita tu permiso.

## e) Código contra decisiones

**La analogía.** Es comparar la casa con los planos aprobados. A veces la casa está mal construida: se arregla la casa. Otras veces el dueño cambió de idea en obra y nadie corrigió el plano: se corrige el plano. Aquí hay de las dos, y en las segundas decides tú cuál manda.

Fuentes: `design-system/README.md` (DS), `tokens.json`, `design-system/components/`, `docs/modelo-contable.md` (MC) y la skill `ppm-interfaz`. Un ayudante hizo la revisión. Verifiqué a mano:
- que no hay `border-input` en ningún campo;
- «el debe y el haber» en Por asignar;
- el monto sin símbolo de `MoveAmount`;
- la fila del 13-nov de MC.

### Lo que cumple

- **«Sin punto como conector»:** ningún «·» en texto visible. Los casos 5 a 10 usan `Status`, `Facts`, `Amounts`, `Pill` y `Optional`.
- **Montos:** el signo menos es «−» y no un guion; entrada y salida llevan ícono y signo además del color; las cifras son tabulares (218 usos).
- **Selectores:** no hay `<select>` nativos ni selectores de fecha del navegador. Elegir de una lista siempre abre una hoja.
- **Íconos:** solo Material Symbols, sin emoji. El único SVG es el logo de Google.
- **Voz:** sin «¡», sin «usted» y sin mayúsculas de título.
- **Escritorio (13-nov):** riel de 88 px, lista y detalle en Movimientos, Cuentas, Presupuesto, Personas, Reportes, Recurrentes y Más. Registrar es un panel lateral de 480 px y las hojas se abren como ventana al centro.

### Donde el código no cumple (se arregla el código)

| # | Regla | Qué hace el código | Dónde | Gravedad |
|---|---|---|---|---|
| 1 | Skill: nunca «Debe/Haber» | «Siempre cuadra, como el debe y el haber.» | `presupuesto/PorAsignar.tsx:69` | Importante (es texto visible: necesita tu OK para cambiarlo) |
| 2 | MC, 13-nov: «ninguna sección del riel queda con la columna del celular» | Por clasificar no tiene versión de escritorio | `movimientos/PorClasificar.tsx:58` | Importante |
| 3 | DS: montos con `money.ts`, símbolo y separador de miles | Los totales del asiento manual son `(inn / 100).toFixed(2)`: sin separador ni símbolo | `movimientos/AsientoManual.tsx:112-113` | Importante |
| 4 | DS: el trigo solo en «mayo.» y en la barra «para mayo», como relleno | El trigo también pinta el nodo Patrimonio y la línea del % guardado en Flujo | `reportes/Flujo.tsx:27, 150-154` | Menor |
| 5 | DS: tipos de cambio con `rateText` | 7 `toFixed(3)` o `toLocaleString` a mano | Tarjeta, Registrar, RegistrarPersona, Detalle, MoveBits | Menor |
| 6 | DS: íconos rellenos solo en la pestaña activa y en el check de la opción elegida | 13 rellenos más: casillas, radios y avisos de éxito | Tags, PorClasificar, Pending, Entrar, MiCuenta… | Menor |
| 7 | DS: íconos a 24 px en la navegación | La barra de abajo y el riel los ponen a 22 px | `AppNav.tsx:52`, `Rail.tsx:104` | Menor |
| 8 | DS: el botón principal mide 56 px, radio 14, flecha a la derecha | Unas 18 acciones principales hechas a mano en 6 formas (48 px redondo, 44 px redondo, 52 px centrado…), sobre todo en Presupuesto | `presupuesto/*`, Tags, WithPartner, Etiquetas, Préstamos, Conciliar… | Importante (b, punto 7) |
| 9 | CLAUDE.md: un token nuevo cambia `tokens.json` y `styles.css` juntos | `radius-xl` solo en `styles.css` | — | Menor (a, punto 10) |

### Donde el plano quedó atrás (decides tú cuál manda)

| # | Lo que dice la fuente | Lo que hace el código (y quizá decidiste) | Opciones |
|---|---|---|---|
| A | **DS: «dentro de la app, los formularios usan caja con borde `input`»** | Ningún campo usa caja: toda la app usa la línea de 2 px del acceso (`LineField`, 42 veces fuera del acceso, más 30 subrayados a mano). No hay una decisión que lo cambie | Registrar «la línea en toda la app» y corregir DS, o pasar los formularios a caja. Es el choque más grande entre fuente y código |
| B | **DS: Bricolage solo para títulos; los montos van en Plex Sans (`amount-hero`)** | 17 montos grandes en Bricolage extrabold (el patrimonio de Inicio y de Cuentas, Presupuesto, Sobre, los reportes, DebtCard…) y solo 5 con `amount-hero`. Ninguna decisión lo permite | Registrar «los montos protagonistas en Bricolage» con su token, o pasarlos a `amount-hero`. Se ve en la portada de casi cada sección |
| C | **DS: `title-hero` solo en recuperar la contraseña y en la configuración** | Se usa 40 veces en unas 34 pantallas de la app, y `title-1` (el título de pantalla) solo 4. El 13-nov aprobaste «una regla de títulos» (#70), pero no quedó escrita | Escribir la regla que aprobaste (se reconstruye desde el PR #70) y ajustar DS |
| D | **DS: «movimiento (no asiento)», «no por cobrar ni por pagar»** | «Asiento manual» (en el mapa R1 de MC), «Por cobrar» en las cuotas (MC, aprobado) y «Por pagar / Por cobrar» en Presupuesto › Cuentas (no aprobado) | Ajustar DS con las excepciones aprobadas y decidir «Por pagar» de Presupuesto |
| E | **DS: el monto lleva su símbolo antes del número** | En las filas, la moneda principal va sin «S/» («− 35.50») y las otras con su símbolo. Seguramente es «el dólar en claro» del 13-nov, pero no quedó escrito | Escribirlo en DS (filas sin el símbolo de tu moneda) o volver a poner el símbolo |
| F | **`components/Button/README.md`: 40 px, `radius-md`** | `PrimaryButton` (56 px, radio 14) en 44 lugares; nada usa la variante de 40 px | Reescribir el README de Button con lo que hay, en la Fase 2 |

Esto no se arregla en la auditoría: va a la Fase 2, donde te traigo cada uno con opciones.

## f) Hallazgos priorizados

**Cómo se ordena:**
- **Crítico:** impide usar algo o pierde datos.
- **Importante:** rompe una norma AA, una decisión tuya, o se repite en muchas pantallas.
- **Menor:** es puntual o de pulido.

**No encontré nada crítico.** Todas las pantallas cargan, nada se sale de ancho, el teclado nunca queda atrapado y ningún botón queda sin nombre.

### Importante

| # | Hallazgo | Sección | Se resuelve en |
|---|---|---|---|
| 1 | El foco se esconde detrás de la barra de abajo (19 veces en 9 pantallas) | d1 | Fase 3: un margen de desplazamiento (`scroll-padding`) en la base |
| 2 | La letra está en px fijos: subir el tamaño de letra no hace nada | d2 | Fase 2 (escala en `rem`) y Fase 3 |
| 3 | A 1024 px el escritorio queda apretado: nombres cortados y montos partidos en dos líneas | c1 | Fase 2: qué pasa entre 1024 y ~1200 px |
| 4 | La tablet no tiene diseño: es el celular estirado | c2 | Fase 2, con opciones |
| 5 | Los encabezados de sección no son encabezados (61 copias, 4 `<h2>` en todo el código) | b2, d4 | Fase 3: un molde `SectionHeading` |
| 6 | Filas de lista, contenedor de pantalla, cabecera con «Volver» y círculos de ícono copiados a mano (91, 41, 36 y 46 copias) | b1, b3–b5 | Fases 2 y 3: moldes con `cva`; Fase 4: pantalla por pantalla |
| 7 | 1,027 valores escritos a mano: 21 tamaños de letra, 11 de ícono, 5 altos de fila, 7 radios y 7 capas sin escala | a | Fase 2 (escalas) y Fase 3 (tokens y una regla automática) |
| 8 | Fuente y código no coinciden en formularios (caja o línea), montos en Bricolage, `title-hero` y el README de Button | e, A–F | Fase 2: tú decides cuál manda |
| 9 | Bordes de los campos con caja con 1.48:1 | d3 | Va con la decisión de e, A |
| 10 | Gráficos de Reportes que reciben el foco sin verse, un botón dentro de otro en Personas, y un nombre que tapa el contenido en Inicio | d5–d7 | Fase 4, en sus lotes |
| 11 | Contraste justo debajo del mínimo: la pastilla verde (4.49:1) y el % dentro de la barra de Ingresos | d8 | Fase 2: el token `income-soft`; Fase 4 |
| 12 | Áreas táctiles menores de 24 px (17) y de 44 px en las piezas compartidas (Volver, segmentado, selectores) | c6, d9 | Fase 3, en las piezas compartidas |
| 13 | Botones principales en 6 formas y sin un botón secundario ni uno de borrar compartidos | b7, e8 | Fases 2 y 3 |
| 14 | «Como el debe y el haber» en Por asignar | e1 | Necesita tu OK (es texto) |
| 15 | Por clasificar sin versión de escritorio | e2 | Fase 4 |
| 16 | Totales del asiento manual sin `money.ts` | e3 | Fase 4 |
| 17 | El visor de adjuntos, con 27 hex y sin tokens | a6 | Fase 2 (tokens «siempre oscuro») y Fase 4 |
| 18 | No se usa `safe-area-inset`: la barra de abajo puede quedar bajo la barra de gestos del iPhone | d | Verificar en un iPhone real; Fase 2 |

### Menor

| # | Hallazgo | Sección |
|---|---|---|
| 19 | Las categorías no cambian de color con «Oscuro» elegido a mano, y hay líneas repetidas en `styles.css` | a10, d14 |
| 20 | `radius-xl` sin token, y `xl` más chico que `lg` | a4, a10 |
| 21 | Textos cortados sin «…» y montos partidos a 280 px | c3 |
| 22 | El acento trigo en claro tiene 1.87:1 contra el fondo cuando marca algo solo con color | d10 |
| 23 | Dos buscadores sin anillo de foco, y «¿A quién?» con un foco distinto | d11, d12 |
| 24 | Lo que gira no respeta «reducir movimiento» | d13, a8 |
| 25 | Trigo en Flujo, 13 íconos rellenos de más, íconos de la navegación a 22 px y tipos de cambio formateados a mano | e4–e7 |
| 26 | `cva` instalado y sin usar; moldes compartidos que viven dentro de páginas | b |
| 27 | La fila «Etiquetas» de Registrar, 4 px fuera de línea | c7 |
| 28 | Seis estilos en línea que no son dinámicos | a9 |
