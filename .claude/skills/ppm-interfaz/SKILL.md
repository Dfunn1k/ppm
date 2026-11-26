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

Si lo que vas a hacer no está decidido en esas fuentes, **no lo decidas tú**: propón 2 o 3 opciones a Dany, con pros y contras y una analogía, y espera que elija.

**Boceto antes del código.** Toda pantalla nueva o cambio visible se dibuja primero en el lienzo «Pantallas de PPM» de claude.ai, y Dany lo aprueba antes de programarlo. Si ajusta algo que ya existe, el boceto pone la pantalla de hoy al lado de cómo quedaría, con el cambio marcado. El lienzo es un cuaderno de bocetos, no una fuente: lo elegido se escribe en `docs/modelo-contable.md` y, si contradice al documento, manda el documento.

## 2. Reglas que no se rompen

**Estilos**
- Solo tokens. Nada de colores hex, `rgb()` ni clases de color de Tailwind que no sean del tema (`bg-background`, `text-muted-foreground`, `bg-primary`…).
- No agregues valores arbitrarios de Tailwind (`text-[22px]`, `min-h-[60px]`, `rounded-[12px]`). Hoy el código tiene muchos; **no sumes más**. Si falta un valor en la escala, propón un token nuevo: va en `tokens.json`, en `styles.css` y en `design-system/README.md`, en el mismo PR.
- Nada de `style={{…}}` salvo valores realmente dinámicos (el ancho de una barra según un porcentaje), ni `!important`.
- Antes de crear un componente, busca si ya existe en `web/src/components/` (sobre todo en `ui.tsx`: Screen, Amounts, Status, Facts, Segments, Optional, LineField, Note…). Si existe uno parecido, agrégale una variante (con `class-variance-authority`) en vez de copiarlo. Los moldes viven en `components/`, nunca dentro de una página.
- Íconos: solo Material Symbols Rounded (`Icon` o `<span className="icon">`). Las tipografías se sirven con `@fontsource`: Bricolage Grotesque solo para títulos, IBM Plex Sans para el resto e IBM Plex Mono para códigos.

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

Además:
- Mira la pantalla que cambiaste en al menos 360 px, 390 px, 768 px, 1024 px y 1440 px de ancho, en claro y en oscuro, y deja capturas de antes y después en el PR.
- No subiste la cantidad de valores arbitrarios, colores hex ni `style={{…}}` en `web/src`.
- Si decidiste algo nuevo con Dany, quedó escrito en `docs/modelo-contable.md` con su fecha (y, si es un token o una regla visual, en `design-system/`), en este mismo PR.
- La versión sube según `CLAUDE.md`.

## 4. Cómo hablarle a Dany

Dany no es frontend. Explica cada decisión con una analogía antes de proponerla, no avances sin su confirmación y, cuando haya opciones, muéstralas con sus pros y contras para que él elija.
