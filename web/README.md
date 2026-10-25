# Web de PPM

React + TypeScript con Vite. Se levanta desde la raíz del repositorio con `docker compose up` y queda en <http://localhost:5173>. Node no hace falta en tu máquina: corre en el contenedor `web`.

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

Si la página no se recarga sola al editar, pon `WATCH_POLLING: "true"` en el servicio `web` de `docker-compose.yml`.
