# Misión: unificar el frontend de PPM (diseño y código)

## Antes de empezar
- El PR #127 («El repo pasa a ser la única fuente de verdad») debe estar en `main`. Si no lo está, avísame y no empieces.
- Trabaja solo en esta sesión. Si ves otra rama abierta que toca `web/`, avísame antes de tocar lo mismo.

## Quién eres
Trabaja como un equipo completo. Cada fase pasa por cuatro miradas, y en cada entregable indica qué revisó cada rol:
- **Diseñador/a de producto UX/UI**: jerarquía, consistencia, flujos y cómo se reorganiza cada pantalla según el tamaño.
- **Especialista en accesibilidad**: WCAG 2.2 nivel AA.
- **Desarrollador/a frontend senior**: arquitectura de estilos, componentes, mantenibilidad y rendimiento.
- **QA**: verifica con evidencia (capturas, pruebas, mediciones), nunca con suposiciones.

Tómate el tiempo que haga falta. Prefiero lento y correcto a rápido y parchado.

## Reglas
- `CLAUDE.md` y `AGENTS.md` mandan sobre este prompt.
- **La única fuente de verdad está en el repo:** `docs/modelo-contable.md` (decisiones con fecha) y `design-system/` (voz, montos, color, tipografía y tokens). Lo de claude.ai es archivo, y el lienzo «Pantallas de PPM» es un cuaderno de bocetos: si contradice al repo, manda el repo.
- **Sigue la skill `ppm-interfaz`** (`.claude/skills/ppm-interfaz/SKILL.md`) en cada cambio visible.
- Toda decisión nueva se registra en `docs/modelo-contable.md` con su fecha (y, si es visual, en `design-system/`) en el mismo PR que la implementa. Un token nuevo cambia `tokens.json` y `styles.css` juntos.
- Node no está en mi máquina: todo corre en Docker.
- Una rama y un PR por paso; yo apruebo con merge; cada PR sube la versión según `CLAUDE.md`.

## Cómo trabajo yo
1. **No sé de frontend.** Antes de aplicar cada decisión o buena práctica, explícamela con una analogía cotidiana y sin jerga sin explicar.
2. **No avances de fase sin mi confirmación explícita** (puntos de control ⏸).
3. **Si hay varias opciones**, muéstrame 2–3 con sus pros y contras y tu recomendación. Yo elijo.
4. **No reabras lo que ya decidí.** Lo que está en el documento como «Elegido por Dany» se respeta. Si crees que tiene un problema de accesibilidad o de uso, dímelo con evidencia y propón; no lo cambies por tu cuenta.
5. No agregues dependencias sin pedirme permiso.
6. Si encuentras errores funcionales, anótalos en `PROGRESO.md` («Fuera de alcance») y no los arregles sin preguntarme.

## Alcance
Unificar el frontend en lo visual (consistencia, responsive, accesibilidad) y en lo técnico (estilos sin parches, componentes reutilizables).

**Fuera de alcance:** funcionalidades nuevas, `api/`, la base de datos, la lógica de negocio, las llamadas a la API, los tipos generados y el texto visible (salvo que yo lo apruebe).

### Diagnóstico inicial (medido el 24-nov; vuelve a medirlo, `main` avanzó)
- Unos 1,000 valores arbitrarios de Tailwind en `web/src`, sobre todo tamaños de letra (`text-[22px]` ×127, `text-[18px]` ×79, `text-[14px]` ×73…), además de `min-h-[60px]`, `rounded-[12px]` y `tracking-[-0.02em]`, mientras el sistema define 11 estilos de texto.
- 47 `style={{…}}` en línea y 31 colores hex dentro de componentes.
- Un solo punto de quiebre en `styles.css` (1024 px).
- `design-system/` documenta solo Amount, Button y CategoryChip; el código tiene muchos más componentes compartidos (Status, Facts, Amounts, Segments, Trend, Sheet, Pill, Rail, EmptyState, Skeleton…).
- Lo que **sí** está al día: los colores de `styles.css` coinciden con `tokens.json`, y las decisiones visuales están en el documento (escritorio y riel, «Sin punto como conector», cuánto pesa cada grupo, presupuesto, Reportes, Flujo…).

## Skills
- **`ppm-interfaz`** (del repo): siempre.
- Si la sesión tiene las de diseño, úsalas en su fase y dime cuál usaste:
  - **design-system**: inventario de tokens y valores escritos a mano (Fase 1) y documentación de componentes (Fase 2).
  - **accessibility-review**: Fases 1 y 5.
  - **design-critique**: pantalla por pantalla (Fases 1 y 4).
  - **design-handoff**: especificación de breakpoints, estados y componentes (Fase 2).
  - **frontend-design**: solo para el acabado; PPM ya tiene su dirección visual.
- Si no tienes las de diseño, dímelo al empezar y sigue con `ppm-interfaz`.

## Fases

### Fase 0 — Preparación
- Rama de trabajo. Guarda este prompt en `docs/frontend/MISION.md` y crea `docs/frontend/PROGRESO.md`.
- El repo ya tiene Playwright (`docker compose run --rm e2e`, con los proyectos «celular» y «escritorio») y Vitest. Prepara, en Docker, capturas de todas las pantallas en toda la matriz (claro y oscuro) y una auditoría automática de accesibilidad (por ejemplo axe). Si hace falta una dependencia nueva, pídeme permiso explicando para qué sirve.

### Fase 1 — Auditoría (solo lectura) → `docs/frontend/AUDITORIA.md`
a) **Inventario de estilos**: cada valor arbitrario, hex, estilo en línea, `!important`, CSS duplicado, tamaño de letra, espaciado, radio, sombra y z-index, agrupado por el token que debería ser. Para lo que no tenga token: ¿token nuevo o error?
b) **Componentes**: los que hacen lo mismo con código distinto, y los compartidos que no están documentados en `design-system/`.
c) **Recorrido visual**: capturas de cada pantalla en toda la matriz, claro y oscuro, y cada acento (tinta, trigo, morado, azul) en al menos una pantalla. Señala scroll horizontal, desbordes, textos cortados, cosas tapadas por la barra, el notch o el teclado, botones chicos y saltos al cambiar de tamaño (sobre todo entre 768 y 1023 px).
d) **Accesibilidad**: contraste, foco visible, teclado, etiquetas, nombre accesible en botones de solo ícono, zoom al 200 %, `prefers-reduced-motion`, orden de lectura.
e) **Código contra decisiones**: dónde el código no cumple lo que dicen el documento o `design-system/`.
f) **Hallazgos priorizados**: crítico / importante / menor.

⏸ **Punto de control 1.**

### Fase 2 — Sistema → `docs/frontend/SISTEMA.md`
Con alternativas y analogías donde aplique:
- **Escala completa de tokens**: tipografía (mapear los ~20 tamaños de hoy a la escala), espaciado, radios, alturas de fila y área táctil, elevación, z-index y movimiento.
- **Estrategia responsive**: mobile-first; qué pasa entre 360, 768 y 1024 px; media queries o container queries; `dvh`/`svh`; `safe-area-inset`; `pointer: coarse/fine` y `hover`. **La tablet (768–1023 px) no tiene diseño decidido: dame opciones.**
- **Componentes compartidos** que faltan en el sistema de diseño, con variantes y estados (cargando, vacío, error, deshabilitado, foco, hover, presionado).
- **Reglas de código** para que no vuelva a parcharse.

⏸ **Punto de control 2**: lo apruebo y se registra en `design-system/` y en el documento.

### Fase 3 — Cimientos (PR propio)
Tokens en `tokens.json` y `styles.css` como utilidades de Tailwind (`text-title-1` en vez de `text-[28px]`); primitivas compartidas ajustadas, con variantes `cva`; una regla automática (lint o prueba) que falle si aparecen valores arbitrarios o colores fuera de tokens, con las excepciones documentadas. Capturas base para comparar después.

⏸ **Punto de control 3.**

### Fase 4 — Migración por lotes
Lotes de 1–3 pantallas: un commit por pantalla y un PR por lote. Migrar a tokens y primitivas, **borrar el estilo viejo**, revisar toda la matriz en claro y oscuro y adjuntar capturas de antes y después. Sin cambios de comportamiento ni de texto. Al cerrar cada lote espero mi visto bueno.

### Fase 5 — QA final → `docs/frontend/INFORME-FINAL.md`
Eliminar CSS y componentes muertos; axe y Lighthouse; teclado y lector de pantalla; repaso de toda la matriz. El informe dice lo hecho, lo pendiente y las reglas para que el frontend no vuelva a ser un Frankenstein (actualiza `ppm-interfaz` con lo aprendido).

## Matriz de dispositivos (ancho × alto)
- 280×653 (plegable cerrado)
- 320×568
- 360×800
- 375×667
- 390×844 y 393×852
- 412×915
- 430×932
- 844×390 (celular en horizontal)
- 768×1024 y 820×1180 (tablet)
- 1024×768 (riel con poco alto)
- 1280×800, 1440×900, 1920×1080, 2560×1440

Además: zoom al 200 %, texto grande del sistema y formularios con el teclado virtual abierto.

## Criterios de «terminado» (medibles)
- Cero scroll horizontal en toda la matriz.
- Cero valores arbitrarios y colores fuera de tokens (salvo excepciones documentadas), verificado automáticamente.
- Contraste AA en claro y oscuro con cada acento: 4.5:1 en texto normal, 3:1 en texto grande, íconos y bordes de controles.
- Áreas táctiles de al menos 44×44 px.
- Foco visible y uso completo con teclado.
- Nada tapado por la barra, el notch o el teclado.
- axe sin violaciones serias ni críticas; Lighthouse Accesibilidad ≥ 95.
- Typecheck, Vitest, Playwright y build pasan en Docker.
- Un mismo elemento se ve igual en todas las pantallas.

## Límites de uso y continuidad
La misión es larga y puede cortarse. Trabaja como en un videojuego con puntos de guardado:
- **Unidades pequeñas** (una sección de la auditoría, un componente, una pantalla). Al cerrar cada una: commit + actualizar `PROGRESO.md`.
- `PROGRESO.md` siempre tiene: fase actual; checklist (hecho / en curso / pendiente); **siguiente paso exacto**; decisiones que me tocan; rama y último commit; comandos para verificar.
- Si la sesión se alarga o el contexto se llena, **detente en un punto limpio**, guarda y avísame. Nunca dejes algo a medias sin anotarlo.
- Usa subagentes para las lecturas amplias (auditar un grupo de pantallas, buscar patrones en todo `web/`) y tú integras los resultados.
- **Al retomar**: lee `MISION.md` y `PROGRESO.md`, revisa `git status` y `git log`, confirma que el estado coincide y continúa desde el «siguiente paso». No rehagas lo hecho.

## Cómo me reportas
Al final de cada fase o lote: qué se hizo (breve), capturas de antes y después, qué opinó cada rol, qué skills usaste, las decisiones que me tocan (con opciones y una analogía) y el siguiente paso.

## Empieza así
1. Confirma que el #127 está en `main` y lee las fuentes.
2. Dime, en no más de 15 líneas, qué entendiste, si el diagnóstico sigue siendo cierto, qué skills tienes y cómo vas a tomar las capturas en Docker.
3. Espera mi confirmación antes de la Fase 1.
