# Web de PPM

React + TypeScript con Vite. Se levanta desde la raíz del repositorio con `docker compose up` y queda en <http://localhost:5173>. Node no hace falta en tu máquina: corre en el contenedor `web`.

## Pantallas

| Ruta | Pantalla |
|---|---|
| `/entrar` · `/crear-cuenta` | la portada con el refrán: iniciar sesión y crear cuenta |
| `/recuperar` · `/restablecer?token=…` | pedir el enlace por correo · poner la contraseña nueva (el enlace del correo) |
| `/bienvenida/1` · `2` · `3` | la configuración inicial; lo elegido (y los saldos del paso 3) se manda a la API una sola vez, al final |
| `/cuentas` · `/cuentas/:id` | C1 y C2: lo que realmente tengo, y el detalle con número, CCI y movimientos |
| `/cuentas/nueva` · `/banco` · `/efectivo` · `/guardo` | C5: el tipo, y luego solo sus datos |
| `/registrar` · `/movimientos/:id/editar` | R1: gasto, ingreso o transferencia, con «Dividir» y «Por confirmar» |
| `/movimientos` · `/movimientos/:id` | M1 y M2: el mes por días con búsqueda y filtros (en la URL), y el detalle |
| `/inicio` | provisional, hasta la rebanada 4; ahí está «Cerrar sesión» |

Cada ruta sabe quién puede estar ahí (`Guard` en `src/App.tsx`): sin sesión vas a `/entrar`, sin configurar a `/bienvenida/1`, y ya configurado a `/cuentas`.

Elegir de una lista usa siempre la hoja que sube desde abajo (`SheetSelect` en `src/components/Sheet.tsx`), nunca el selector del navegador. Los montos llegan de la API como texto exacto y se formatean con `src/lib/money.ts`, sin pasar por números de coma flotante.

## Cómo habla con la API

La web y la API parecen «la misma casa»: el navegador pide `/api/…` y Vite lo reenvía a la API sin el prefijo (`/api/me` → `/me`). Así la cookie de sesión viaja sola, sin CORS. En producción, el servidor web hará el mismo reenvío.

Las llamadas pasan siempre por `src/api/client.ts` (openapi-fetch), con los tipos de `src/api/schema.d.ts`. Ese archivo se **genera** desde el contrato de la API; nunca se edita a mano:

```bash
docker compose exec web corepack pnpm gen:api
```

GitHub Actions lo vuelve a generar en cada pull request y falla si quedó desactualizado.

## Tema

`src/styles.css` tiene los tokens del sistema de diseño «PPM» con los nombres de shadcn/ui, en claro y oscuro, y los cuatro acentos (`data-accent` en `<html>`: tinta, trigo, morado, azul). Se usan como clases de Tailwind: `bg-background`, `text-muted-foreground`, `bg-primary`, `bg-trigo`, `text-title-hero`… Los íconos son Material Symbols Rounded: `<span className="icon">arrow_back</span>`.

## Comandos

| Comando (dentro de `docker compose exec web corepack pnpm …`) | Qué hace |
|---|---|
| `test` | pruebas de componentes con Vitest |
| `typecheck` | revisa los tipos con TypeScript |
| `build` | arma la versión de producción en `dist/` |
| `gen:api` | regenera los tipos de la API |

Los recorridos completos (crear cuenta y configurarla, entrar y salir, recuperar la contraseña con el correo de Mailpit) corren con Playwright en su propio contenedor, contra la API y la base de verdad:

```bash
docker compose run --rm e2e
```

Si la página no se recarga sola al editar, pon `WATCH_POLLING: "true"` en el servicio `web` de `docker-compose.yml`.
