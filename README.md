# PPM

**PPM (pan para mayo)** es una app de finanzas personales con contabilidad de partida doble y nombres al estilo Odoo. Todo vive en este repositorio:

| Carpeta | Qué hay |
|---|---|
| [`api/`](api/README.md) | la base de datos (PostgreSQL 18), sus migraciones y la API (FastAPI) |
| [`web/`](web/README.md) | la app web (React + TypeScript, Vite, Tailwind) |

Están juntas mientras PPM es pequeño: un cambio en la API y su pantalla van en el mismo pull request. Si un día crece, cada carpeta puede salir a su propio repositorio sin perder su historia.

La fuente de verdad del diseño es el documento «PPM — Modelo contable y base de datos». Si algo aquí lo contradice, manda el documento.

## Artefactos en claude.ai

El diseño de PPM vive en claude.ai. Dos de esos artefactos tienen una copia en este repositorio para que Claude Code los lea sin salir de aquí:

| Artefacto | Copia en el repo | Original |
|---|---|---|
| PPM — Modelo contable y base de datos | [`docs/modelo-contable.md`](docs/modelo-contable.md) | <https://claude.ai/artifact/NGkKr1NvteSf7cUBRwN3dH> |
| Sistema de diseño «PPM» (tokens, voz, componentes) | [`design-system/`](design-system/README.md) | <https://claude.ai/artifact/KQXtCjxNsoonM9d9uob6oM> |
| Libro de PPM: simulador de partida doble | — | <https://claude.ai/artifact/A26CRpbuQbk6AWK6bMWTEe> |
| Pantallas de PPM | — | <https://claude.ai/artifact/WcHcG4APSNSqSFM2KngD6E> |

Las copias son una foto del 6 de noviembre de 2026. Si una copia y su original no coinciden, manda el original; vuelve a copiarlo cuando cambie.

## Levantarlo

Necesitas Docker Desktop.

```bash
docker compose up
```

Eso levanta tres piezas, en orden:

| Servicio | Qué hace |
|---|---|
| `db` | PostgreSQL 18; los datos quedan en el volumen `pgdata` |
| `migrate` | dbmate aplica las migraciones pendientes de `api/db/migrations/` y termina |
| `api` | FastAPI en <http://localhost:8000>; se recarga sola al editar `api/app/` |
| `web` | la app web en <http://localhost:5173>; lo que pide a `/api/…` lo reenvía a la API |
| `mailpit` | atrapa los correos que envía la API (por ejemplo, recuperar contraseña): <http://localhost:8025> |

Comprueba que todo está vivo en <http://localhost:8000/health>. La documentación interactiva de la API está en <http://localhost:8000/docs>.

Para empezar de cero (borra los datos): `docker compose down -v`.

## Pruebas

```bash
docker compose run --rm pruebas          # la API, contra PostgreSQL
docker compose exec web corepack pnpm test   # la web (con docker compose up corriendo)
```

Más detalles en [`api/README.md`](api/README.md) y [`web/README.md`](web/README.md).

## Producción

Para desplegar en un servidor, sigue [`DESPLIEGUE.md`](DESPLIEGUE.md). Usa `docker-compose.prod.yml` (Caddy con HTTPS, la API y PostgreSQL) y nunca el `docker-compose.yml` de desarrollo.

## Cómo se trabaja

Cada paso llega en una rama con su pull request. Se aprueba con merge cuando las pruebas están en verde.
