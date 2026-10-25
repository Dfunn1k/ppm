# PPM

**PPM (pan para mayo)** es una app de finanzas personales con contabilidad de partida doble y nombres al estilo Odoo. Todo vive en este repositorio:

| Carpeta | Qué hay |
|---|---|
| [`api/`](api/README.md) | la base de datos (PostgreSQL 18), sus migraciones y la API (FastAPI) |
| `web/` | la app web (React + TypeScript), en camino |

Están juntas mientras PPM es pequeño: un cambio en la API y su pantalla van en el mismo pull request. Si un día crece, cada carpeta puede salir a su propio repositorio sin perder su historia.

La fuente de verdad del diseño es el documento «PPM — Modelo contable y base de datos». Si algo aquí lo contradice, manda el documento.

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
| `mailpit` | atrapa los correos que envía la API (por ejemplo, recuperar contraseña): <http://localhost:8025> |

Comprueba que todo está vivo en <http://localhost:8000/health>. La documentación interactiva de la API está en <http://localhost:8000/docs>.

Para empezar de cero (borra los datos): `docker compose down -v`.

## Pruebas

```bash
docker compose run --rm pruebas
```

Más detalles en [`api/README.md`](api/README.md).

## Cómo se trabaja

Cada paso llega en una rama con su pull request. Se aprueba con merge cuando las pruebas están en verde.
