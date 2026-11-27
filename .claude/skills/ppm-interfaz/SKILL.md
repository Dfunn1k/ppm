---
name: ppm-interfaz
description: Cómo se diseña y se programa la interfaz de PPM (web/). Úsala antes de crear, cambiar o revisar cualquier pantalla, componente, estilo o texto visible, y antes de abrir un PR que toque web/.
---

# Interfaz de PPM

PPM es contable por dentro e intuitivo por fuera. Esta skill dice dónde está lo decidido, qué reglas no se rompen y qué se revisa antes de un PR. No repite las reglas: te manda a leerlas en su fuente.

## 1. Lee antes de tocar

1. `design-system/README.md`: voz, montos, color y tipografía. Es corto; léelo entero.
2. `design-system/tokens.json`: los tokens (color, tipografía, espaciado, radios, sombras).
3. `docs/modelo-contable.md`: las decisiones con fecha. Busca las de la pantalla que vas a tocar (por su nombre, su código como C1, M2 o R1, o «Elegido por Dany»). Las de interfaz incluyen el escritorio, el riel, «Sin punto como conector» (casos 5 a 10), Reportes y el presupuesto.
4. `web/src/styles.css` y `web/src/components/ui.tsx`: cómo están implementados los tokens y las piezas compartidas.
5. `docs/frontend/SISTEMA.md`: las escalas, los cortes de pantalla, los moldes (Row, SectionHeading, PageHeader, Avatar, Amount, Button, Chip…) y las reglas de código aprobadas el 25-nov.
6. `docs/frontend/INFORME-FINAL.md`: cómo quedó el frontend al terminar la misión (26-nov), qué piezas siguen hechas a mano y qué queda pendiente.

Si lo que vas a hacer no está decidido en esas fuentes, **no lo decidas tú**: propón 2 o 3 opciones a Dany, con pros y contras y una analogía, y espera que elija.

**Boceto antes del código.** Toda pantalla nueva o cambio visible se dibuja primero en el lienzo «Pantallas de PPM» de claude.ai, y Dany lo aprueba antes de programarlo. Si ajusta algo que ya existe, el boceto pone la pantalla de hoy al lado de cómo quedaría, con el cambio marcado. El lienzo es un cuaderno de bocetos, no una fuente: lo elegido se escribe en `docs/modelo-contable.md` y, si contradice al documento, manda el documento.

## 2. Reglas que no se rompen

**Estilos**
- Solo tokens. Nada de colores hex, `rgb()` ni clases de color de Tailwind que no sean del tema (`bg-background`, `text-muted-foreground`, `bg-primary`…).
- Nada de valores arbitrarios de Tailwind (`text-[22px]`, `min-h-[60px]`, `rounded-[12px]`). `web/src` está en cero desde el 26-nov y el inspector (`web/src/estilo.test.ts`) hace fallar el PR si aparece uno. Las excepciones viven en `estilo-excepciones.ts`, cada una con su motivo; la lista solo se achica, y sumar una pide el OK de Dany. Si falta un valor en la escala, propón un token nuevo: va en `tokens.json`, en `styles.css` y en `design-system/README.md`, en el mismo PR.
- Nada de `style={{…}}` salvo valores realmente dinámicos (el ancho de una barra según un porcentaje), ni `!important`.
- **Moldes antes que copias.** Un botón es `Button` (`primary`, `secondary` con `start` para el ícono de la izquierda, `ghost` para «Cancelar» y «Volver», `destructive`; `size` `md` o `sm`; `pending`), o `PrimaryLink` y `buttonVariants` si es un enlace. Una pastilla para elegir es `FilterChip` (`radio` en los grupos de una opción). Una fila es `Row`, un título de sección `SectionHeading`, una cabecera con «Volver» `PageHeader`, un buscador `SearchField`, un círculo `Avatar`, un monto `Amount`, un botón de solo ícono `IconButton`, una fila con interruptor `SwitchRow` (el lector la dice en una sola parada). Antes de crear otro, busca en `web/src/components/` (y en `ui.tsx`: Screen, Amounts, Status, Facts, Segments, Optional, LineField, Note, SwitchRow…). Si uno parecido no alcanza, agrégale una variante con `cva` y su prueba en `components/moldes.test.tsx`; no lo copies. Los moldes viven en `components/`, nunca dentro de una página. Las piezas que todavía están hechas a mano están en `INFORME-FINAL.md`: si tocas una, pásala al molde.
- Íconos: solo Material Symbols Rounded, con `Icon` y su `size` (no con clases de tamaño). Las tipografías se sirven con `@fontsource`: Bricolage Grotesque solo para títulos, IBM Plex Sans para el resto e IBM Plex Mono para códigos.

**Trampas que ya costaron (fase 5)**
- Una regla de CSS fuera de capa le gana a cualquier utilidad. Lo que da la base de una pieza va en `@layer base`; así los íconos dejaron de medir todos 20 px.
- Lo chico que se toca lleva `hit-area` (44 px de área sin cambiar cómo se ve), no un padding que lo agranda.
- Un texto que puede cortarse dentro de una fila flexible necesita `min-w-0` o `shrink` y `truncate`, para que termine en «…» y no se salga.
- Mientras carga, la silueta espera **todo** lo que la pantalla muestra; si una parte llega después, empuja lo demás y Lighthouse lo marca como salto (CLS).
- Una fila de botones que puede quedar angosta lleva `flex-wrap`, o a 280 px se aplastan.

**Texto**
- La voz del README del sistema de diseño: de tú, frases cortas, palabras de la gente (nunca «Debe/Haber», «asiento» ni «pasivo»), mayúscula solo en la primera letra, sin exclamaciones ni emoji.
- Nada se une con «·». Usa la forma que ya se decidió para cada caso: Status, Facts, Amounts, pastilla o frase (ver «Sin punto como conector» en el documento).
- Montos: con `web/src/lib/money.ts`, cifras tabulares, alineados a la derecha en listas; entrada y salida nunca se distinguen solo por el color.

**Tamaños de pantalla**
- Se diseña primero para el celular y se amplía hacia arriba.
- Desde 768 px: el riel de 88 px en lugar de la barra de abajo, una columna de hasta 640 px, Registrar en panel lateral y las hojas como ventana al centro. Desde 1024 px: lista y detalle en dos paneles (lista de 320 px; 400 desde 1280 y 440 desde 1440). En el celular eso no cambia nada (decisiones «Escritorio», 13-nov, y «Tablet y laptop chica», 25-nov).
- Los cortes (`md:`, `lg:`…) deciden dónde va cada panel; lo de adentro se acomoda al ancho de su panel con `@container`. Un monto nunca se parte en dos líneas.
- Ningún tamaño puede tener scroll horizontal, y nada puede quedar tapado por la barra de abajo, el notch o el teclado.
- Áreas táctiles de al menos 44×44 px.

**Accesibilidad (WCAG 2.2 AA, ver «Foco y accesibilidad» en `design-system/README.md`)**
- Contraste 4.5:1 en texto normal y 3:1 en texto grande, íconos y bordes de controles, en claro y en oscuro, con cada acento (tinta, trigo, morado, azul).
- Todo se puede usar con teclado y el foco se ve siempre.
- Los botones de solo ícono llevan nombre accesible (`aria-label`).
- Las animaciones respetan `prefers-reduced-motion`.
- HTML semántico antes que ARIA.

## 3. Qué revisar antes del PR

Todo corre en Docker; Node no está en la máquina de Dany.

```bash
docker compose exec web corepack pnpm typecheck
docker compose exec web corepack pnpm test
docker compose run --rm e2e        # Playwright: proyecto «celular» (Pixel 7) y «escritorio» (1440×900)
```

Además, con las capturas (ver «Cómo se toman las capturas» en `docs/frontend/PROGRESO.md`):

```bash
docker compose run --rm -e PPM_PANTALLAS=inicio,movimientos e2e corepack pnpm capturas   # o toda la matriz, sin filtro (~20 min)
docker compose run --rm e2e node capturas/resumen.mjs                                    # capturas-salida/RESUMEN.md
```

- El resumen tiene que dar 0 en scroll horizontal (cuenta también la caja de adentro que se pasa, como la columna de la lista en la computadora), lo que se toca con menos de 44 px, textos cortados, axe y foco tapado o sin anillo, en claro y en oscuro.
- Mira las fotos de la pantalla que cambiaste en al menos 280, 360, 390, 768, 1024 y 1440 px, y deja las de antes y después en el PR.
- Las fotos no dicen a dónde lleva cada botón. Si tocaste un enlace a `/registrar` (o a editar un movimiento), lleva `state={usePanel()}` (`components/AppNav.tsx`), para que en la computadora se abra en el panel y no en la vista del celular. Pruébalo con un clic en el proyecto «escritorio».
- Una pantalla nueva entra a `web/capturas/pantallas.ts`. Si necesita datos que la persona de muestra no tiene, agrégalos en `capturas/datos.ts` o `capturas/archivos.ts`: sin datos, los problemas no aparecen.
- Cada `docker compose run e2e` borra la persona de muestra. Para medir algo aparte (una foto suelta, Lighthouse), vuelve a crearla con `-g preparar`.
- Si cambiaste cómo carga una pantalla, pásale Lighthouse (ver «Lighthouse» en `PROGRESO.md`): accesibilidad 100 y CLS menor que 0.1.
- El inspector pasa (va dentro de `pnpm test`) y no sumaste `style={{…}}` que no sea dinámico.
- Si decidiste algo nuevo con Dany, quedó escrito en `docs/modelo-contable.md` con su fecha (y, si es un token o una regla visual, en `design-system/`), en este mismo PR.
- La versión sube según `CLAUDE.md`.

## 4. Cómo hablarle a Dany

Dany no es frontend. Explica cada decisión con una analogía antes de proponerla, no avances sin su confirmación y, cuando haya opciones, muéstralas con sus pros y contras para que él elija.
