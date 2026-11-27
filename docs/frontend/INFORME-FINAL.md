# Informe final de la misión del frontend

La misión está en [MISION.md](MISION.md), el paso a paso en [PROGRESO.md](PROGRESO.md), lo que se encontró al principio en [AUDITORIA.md](AUDITORIA.md) y el sistema aprobado en [SISTEMA.md](SISTEMA.md). Este informe cuenta cómo terminó: qué se hizo, qué queda y qué reglas evitan que el frontend vuelva a ser un Frankenstein.

Del 25 al 26-nov-2026, PR #129 a #152 (24 PRs), versión 0.40.3 a 0.42.4.

## En una frase

Antes, cada pantalla era un cuarto que alguien amobló con lo que tenía a mano: puertas de 7 medidas, 11 tamaños de enchufe y la pintura mezclada en el momento. Ahora la casa tiene un catálogo (los tokens), muebles de fábrica (los moldes) y un inspector que no deja entrar un clavo de otra medida (`estilo.test.ts`).

## Antes y después

| Qué | 24/25-nov | 26-nov |
|---|---|---|
| Valores escritos a mano (`text-[22px]`, `min-h-[60px]`…) en `web/src` | 1,027 | **0** |
| Colores hex en componentes | 32 | **4**: el logo de Google, la única excepción |
| `style={{…}}` | 47 | **21**, todos de verdad dinámicos: un ancho en %, `var(--cat-N)` o un número de columnas |
| Cortes de pantalla | 1 (1024 px) | 768 (riel), 1024, 1280 y 1440 (anchos de la lista) y `narrow` para lo muy angosto |
| Moldes documentados en `design-system/components/` | 4 | 9 (Amount, Avatar, Button, CategoryChip, Chip, Cover, PageHeader, Row y SectionHeading) |
| Lo que se toca y mide menos de 44×44 px, toda la matriz | 17,330 | **0** |
| Textos cortados sin «…» | 14 | **0** |
| Violaciones de axe (WCAG 2.0 a 2.2, A y AA), claro y oscuro | 34 | **0** |
| Foco tapado por la barra de abajo o sin anillo | 39 | **0** |
| Scroll horizontal, toda la matriz | 0 | **0** |
| Lighthouse, accesibilidad | sin medir | **100** en las 11 pantallas medidas, celular y escritorio |
| Lighthouse, saltos al cargar (CLS; lo bueno es menos de 0.1) | 0.41 Inicio, 0.54 Por clasificar | **0 a 0.04** |
| Pantallas en las capturas, axe y teclado | 67 | 72 (entraron Conciliar, el extracto y Por clasificar con datos) |
| Pruebas | Vitest 32, Playwright 94 | Vitest 34, Playwright 95 |

«Toda la matriz» son los 16 tamaños de la misión, de 280×653 a 2560×1440, más zoom al 200 %, texto grande y teclado abierto, en claro y en oscuro. Los cuatro acentos (tinta, trigo, morado y azul) se revisaron en Inicio, Registrar, Apariencia y Gastos.

## Lo que se hizo

- **Fase 0, preparación (#129).** Capturas de toda la matriz en Docker (`pnpm capturas`), axe (`@axe-core/playwright`, aprobado por Dany), la vuelta con el teclado y un resumen que cuenta los problemas.
- **Fase 1, auditoría (#130).** El inventario de lo escrito a mano, los componentes repetidos, el recorrido visual, la accesibilidad y dónde el código no cumplía lo decidido.
- **Fase 2, sistema (#131).** Las escalas (letra, íconos, espacio, alturas, radios, capas, movimiento, colores), los cortes de pantalla (la tablet con el riel y una columna de 640 px; la laptop chica con la lista de 320 px), los moldes con sus estados y las reglas de código. Dany eligió las decisiones A a H y S1 a S8.
- **Fase 3, cimientos (#132).** Los tokens en `tokens.json` y `styles.css`, la letra en `rem` sobre una base de 16 px, los moldes con `cva` y el inspector automático, con un tope por archivo que solo podía bajar.
- **Fase 4, migración (#133 a #149).** 16 lotes, pantalla por pantalla, sin cambiar textos ni comportamiento salvo lo que Dany aprobó. Al terminar, el tope del inspector quedó vacío en todo `web/src`. Aparte, Por clasificar en escritorio (boceto Caso17, opción A).
- **Fase 5, QA final (#150 a #153).**
  - Código muerto: `ButtonLink`, `tagColor` y `useRecurringPending`, quitados. El CSS no tiene clases sin uso.
  - La persona de muestra trae un estado de cuenta y un extracto importados.
  - Lighthouse, que encontró los saltos al cargar. Se arreglaron sin cambiar cómo se ve.
  - Botones y pastillas: un solo molde de cada uno (boceto Caso18Botones, pastilla A).
  - Este informe.

## Qué miró cada rol

- **Diseño UX/UI.** Lo que es lo mismo ahora se ve igual en toda la app: los títulos de pantalla, los montos protagonistas, los botones, las pastillas, los campos y las filas de movimiento. La tablet y la laptop chica tienen diseño decidido, y nada se cambió sin un boceto aprobado en el lienzo.
- **Accesibilidad.** axe da 0 y Lighthouse da 100. El foco se ve y no queda tapado, y todo lo que se toca mide 44 px. El contraste es AA en claro y en oscuro con cada acento, y lo elegido se distingue por algo más que el color, como un check o un borde. Falta probar con un lector de pantalla de verdad (ver «Lo que queda»).
- **Frontend.** Todos los valores salen de tokens y los moldes viven en `components/`. El inspector falla si alguien escribe una medida a mano, y no se sumó ninguna dependencia aparte de axe, que solo se usa en las pruebas. Lighthouse corre con `npx` sin quedar en el proyecto.
- **QA.** Cada cifra de este informe sale de una corrida: `capturas/resumen.mjs`, `teclado.spec.ts`, axe, Lighthouse, Vitest y Playwright. Cada lote dejó fotos de antes y después.

## Lo que queda

En orden de importancia:

1. **La prueba en un iPhone (Dany).** Hay que ver, con PPM instalada, si la barra de abajo queda bien sobre la barra de gestos. Docker simula el tamaño, pero no el `safe-area` real de un iPhone.
2. **Un lector de pantalla de verdad.** axe y la vuelta con el teclado revisan nombres, roles, orden y foco, pero no cómo suena la app. El 27-nov se recorrió lo que el lector recibe (el árbol de accesibilidad) en Inicio, Registrar, Movimientos y el detalle, y se arreglaron 5 cosas (#157). Falta escucharlo con VoiceOver (en el mismo iPhone) o NVDA: es lo único de la misión que no se pudo medir en Docker.
3. **Piezas que se ven bien pero siguen hechas a mano** (recuento del 26-nov). Cumplen los tokens y el inspector, pero no usan el molde. Si mañana cambia el molde, estas no cambian solas:
   - ~33 títulos de sección (`SectionHeading`);
   - 15 cabeceras con «Volver» (`PageHeader`);
   - 7 buscadores (`SearchField`);
   - ~45 filas (`Row`);
   - y, a propósito, porque son otra pieza: «Editar» del movimiento (lleva su tecla), las acciones chicas en pastilla de Movimiento y Pendientes, y los filtros de Movimientos (abren una lista).

   Cada grupo pide su boceto de «hoy y después» y su PR, como se hizo con los botones.
4. **La velocidad en el celular.** Lighthouse simula un 4G lento y da entre 82 y 94. La que más tarda en mostrar lo principal es Reportes, con un LCP de 4.7 s. En escritorio da 99 a 100. Se mejora cargando menos de una vez, y eso es trabajo aparte.
5. **Buenas prácticas, 79.** Es solo porque en local no hay HTTPS. En producción lo pone Caddy, así que no hay nada que arreglar en el código.
6. **Una duda chica del lote 6.** El monto que escribes en Nuevo préstamo pasó de 30 a 48 px (`amount-input`). Si Dany lo quiere más chico, falta un token «monto de formulario».

## Las reglas para que no vuelva a ser un Frankenstein

Las reglas en detalle están en SISTEMA.md (sección 4) y en la skill `ppm-interfaz`. Lo importante es que casi todas se revisan solas:

| Regla | Quién la cuida |
|---|---|
| Solo tokens: ni valores escritos a mano, ni hex, ni colores fuera del tema, ni `color-mix` | `web/src/estilo.test.ts` falla el PR. Las excepciones están en `estilo-excepciones.ts`, cada una con su motivo, y la lista solo se achica |
| `style={{…}}` solo para lo dinámico | El mismo inspector |
| Un token nuevo cambia `tokens.json`, `styles.css` y el README juntos | La revisión del PR, con la skill |
| Moldes antes que copias: Button, FilterChip, Row, SectionHeading, PageHeader, Avatar, Amount, SearchField… Si no alcanza, se le suma una variante `cva` | La skill y la revisión; los moldes tienen sus pruebas en `moldes.test.tsx` |
| Nada se toca con menos de 44 px, nada se corta sin «…», sin scroll horizontal, el foco se ve y no queda tapado | `pnpm capturas` y `node capturas/resumen.mjs`, en toda la matriz |
| axe en 0 | Las capturas (390×844 y 1440×900, claro y oscuro) |
| Todo se usa con teclado | `capturas/teclado.spec.ts` |
| Que la página no salte al cargar | Lighthouse, a mano, cuando una pantalla cambia cómo carga |
| Nada visible sin boceto aprobado, con «hoy» al lado de «después» y textos reales | La skill y Dany |
| Lo decidido se escribe en `docs/modelo-contable.md` en el mismo PR | La skill y Dany |

## Lo aprendido (ya está en la skill)

- **Una regla de CSS sin capa le gana a las utilidades.** Por eso todos los íconos medían 20 px aunque el código pidiera 11 tamaños. Lo que da la base de una pieza va en `@layer base`.
- **Cada ícono reserva su cuadrado** (`.icon` con `width: 1em`) mientras llega la fuente. Si no, el nombre del ícono se lee como texto un instante y empuja todo. Era la mitad de los saltos al cargar.
- **La silueta espera todo lo que la pantalla muestra.** Si Inicio aparece antes de que lleguen Pendientes y el presupuesto, lo que llega tarde empuja lo demás.
- **Lo chico se agranda por dentro, no por fuera.** `hit-area` da los 44 px de área sin cambiar cómo se ve.
- **Un texto que se corta necesita espacio para encogerse.** En una fila flexible, `min-w-0` o `shrink` y `truncate`; si no, se sale o se corta de golpe.
- **Las pantallas se prueban con datos.** Con un extracto importado aparecieron 6 problemas que la muestra vacía escondía. Una pantalla nueva entra a `capturas/pantallas.ts`, y si necesita un dato, a `capturas/datos.ts` o `capturas/archivos.ts`.
- **Cada `docker compose run e2e` borra la persona de muestra.** Antes de medir algo aparte, como Lighthouse o una foto suelta, hay que volver a crearla (`-g preparar`).

## Cómo se verifica todo

```bash
docker compose exec web corepack pnpm typecheck
docker compose exec web corepack pnpm test                 # Vitest, con el inspector
docker compose run --rm e2e                                # Playwright, celular y escritorio
docker compose run --rm e2e corepack pnpm capturas         # toda la matriz, axe y teclado (~20 min)
docker compose run --rm e2e node capturas/resumen.mjs      # el resumen en capturas-salida/RESUMEN.md
```

Lighthouse: ver «Lighthouse» en PROGRESO.md.
