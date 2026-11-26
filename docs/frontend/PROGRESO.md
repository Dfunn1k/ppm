# Progreso de la misión del frontend

La misión completa está en [MISION.md](MISION.md). Este archivo es el punto de guardado: al retomar, léelo junto con `git status` y `git log` y sigue desde «Siguiente paso».

## Dónde estamos

- **Fase actual:** 2, sistema (en curso, `docs/frontend/SISTEMA.md`).
- **Rama:** `frontend/fase-2`
- **Último commit:** ver `git log -1 frontend/fase-2`

## Checklist

### Fase 0 — Preparación
- [x] #127 en `main` (b2b2d82) y sin otras ramas abiertas que toquen `web/` (25-nov).
- [x] Diagnóstico medido otra vez el 25-nov: 1,027 valores arbitrarios (`text-[22px]` ×127, `text-[18px]` ×79, `text-[14px]` ×73), 47 `style={{…}}`, 32 colores hex en `.ts/.tsx`, un solo punto de quiebre (1024 px), `design-system/components/` con Amount, Button, CategoryChip y Cover.
- [x] `@axe-core/playwright` 4.14.0 (solo para pruebas; aprobado por Dany el 25-nov).
- [x] Capturas de toda la matriz en Docker (`web/capturas/`, `web/playwright.capturas.config.ts`, `pnpm capturas`).
- [x] Auditoría automática con axe en 390×844 y 1440×900, claro y oscuro.
- [x] Resumen de medidas y axe (`web/capturas/resumen.mjs`).
- [x] PR de la Fase 0 aprobado por Dany (#129, 25-nov).

### Fase 1 — Auditoría (en curso, `docs/frontend/AUDITORIA.md`)
- [x] a) Inventario de estilos
- [x] b) Componentes
- [x] c) Recorrido visual
- [x] d) Accesibilidad
- [x] e) Código contra decisiones
- [x] f) Hallazgos priorizados

- [x] PR de la Fase 1 aprobado por Dany (#130, 25-nov).

### Fase 2 — Sistema (en curso, `docs/frontend/SISTEMA.md`)
- [x] Decisiones A a H de Dany (25-nov, abajo)
- [x] 1. Tokens (base, letra, íconos, espacio, alturas, radios, bordes, sombras, capas, movimiento, colores)
- [ ] 2. Estrategia responsive
- [ ] 3. Componentes compartidos, con variantes y estados
- [ ] 4. Reglas de código
- [ ] ⏸ Punto de control 2; con el OK, registrar en `design-system/` y en `docs/modelo-contable.md`

### Fases 3 a 5 (pendientes)

## Siguiente paso

Escribir `SISTEMA.md` sección 2 (responsive), luego 3 y 4, con un commit por sección. Después, ⏸ punto de control 2.

## Decisiones de Dany

Tomadas el 25-nov (todas las recomendadas). Se escriben en `design-system/` y en `docs/modelo-contable.md` al cerrar la Fase 2:
- **A. Formularios:** la línea de abajo en toda la app; se corrige el README («caja con borde» queda fuera).
- **B. Montos protagonistas:** en Bricolage, con 2 tamaños en lugar de 7.
- **C. Título de las pantallas a las que entras:** `title-hero` (48 px) como hoy; más chico entre 280 y 359 px.
- **D. Palabras:** «Asiento manual» y «Por cobrar» de las cuotas quedan como excepciones aprobadas; en Presupuesto › Cuentas, «Por pagar» y «Por cobrar» pasan a «Debo a personas» y «Me deben» (Fase 4).
- **E. Símbolo:** en las filas, tu moneda va sin símbolo y las otras con el suyo; totales y saldos siempre con símbolo.
- **F. README de Button:** se reescribe con lo que hay (56 px).
- **G1. Tablet (768–1023 px):** el riel y una columna ancha (~640 px).
- **G2. Laptop chica (1024–1279 px):** lista de 320 px y detalle que se adapta a su ancho; desde 1280 px, 400 px.
- **H. Por asignar:** «Siempre cuadra: cada sol está en un solo lugar.» (Fase 4).

Pendientes:
- Las que salgan de `SISTEMA.md` (punto de control 2).
- Revisar en un iPhone, con PPM instalada, si la barra de abajo queda bajo la barra de gestos.

## Fuera de alcance (errores funcionales encontrados, sin arreglar)

- `/mas/tipo-de-cambio` lleva a `/mas` si no eres administrador. Así está pensado (Z1), no es un error; se anota para que la auditoría no lo cuente como pantalla rota.

## Cómo se toman las capturas

Todo corre en Docker, en el contenedor `e2e` (Playwright 1.55):

```bash
# Toda la matriz (16 tamaños y 3 casos especiales, claro y oscuro), los acentos y axe: ~20 min, ~3,700 fotos, 130 MB
docker compose run --rm e2e corepack pnpm capturas
# Una parte: tamaños, temas o pantallas
docker compose run --rm -e PPM_TAMANOS=390x844,1440x900 -e PPM_TEMAS=dark -e PPM_PANTALLAS=inicio,movimientos e2e corepack pnpm capturas
# El resumen (scroll horizontal, lo que se toca < 44 px, posibles cortes, axe por regla)
docker compose run --rm e2e node capturas/resumen.mjs
```

- **La persona de muestra** (`capturas/datos.ts`) se crea por la API antes de cada corrida: efectivo, banco en soles y en dólares, tarjeta con una compra en cuotas, préstamo, tres meses de ingresos y gastos, una persona que te debe, una recurrente, una etiqueta y el presupuesto empezado. Hay una segunda solo para los acentos, para no cambiarle el color a la primera mientras se fotografía.
- **Pantallas** (`capturas/pantallas.ts`): las 67 que se abren con esa persona, más la bienvenida (pasos 1 a 3) con una cuenta nueva. Las que necesitan un dato que la muestra no tiene (un extracto importado, el estado de cuenta de un corte, el aviso de una recurrente, Google o un enlace del correo) están en `SKIPPED` con su motivo.
- **Dos fotos por pantalla:** `<pantalla>.jpg` es lo que se ve al abrir; `<pantalla>-entera.jpg`, la página entera con la ventana estirada a su alto (así la barra de abajo queda abajo y no flotando a media página).
- **Medidas por pantalla** (`capturas/medir.ts`): cuánto se pasa de ancho (scroll horizontal), lo que se toca y mide menos de 44×44 px y los textos que no caben en su caja.
- **Casos especiales, aproximados:**
  - zoom al 200 %: 640×400 (una ventana de 1280×800 con el doble de zoom);
  - texto grande: 390×844 con la letra base del navegador a 20 px en vez de 16 (como subirla en el sistema);
  - teclado abierto: 390×508 (390×844 menos el teclado), solo en formularios y con el foco en el primer campo.
- **Acentos:** tinta, trigo, morado y azul en Inicio, Registrar, Apariencia y Gastos, a 390×844 y 1440×900, claro y oscuro.
- **axe** revisa WCAG 2.0, 2.1 y 2.2, niveles A y AA, en cada pantalla a 390×844 y 1440×900, claro y oscuro.
- **Teclado** (`capturas/teclado.spec.ts`, desde la Fase 1): en cada pantalla aprieta Tab hasta dar la vuelta y anota si el foco se ve, si lo tapa algo fijo y si cae en algo invisible. Sale en `capturas-salida/teclado/<tamaño>.json`. Solo esto: `-g "teclado|preparar"`.
- **Ojo con «texto grande»:** hoy sale idéntica a 390×844, porque PPM tiene toda la letra en px (ver AUDITORIA d, punto 2). Servirá para comparar cuando eso cambie.
- La salida queda en `web/capturas-salida/` (no se sube al repo).

## Comandos para verificar

```bash
docker compose exec web corepack pnpm typecheck
docker compose exec web corepack pnpm test
docker compose run --rm e2e
```
