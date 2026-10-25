# ppm-api

Servidor de **PPM (pan para mayo)**, una app de finanzas personales con contabilidad de partida doble y nombres al estilo Odoo. Aquí viven la base de datos (PostgreSQL 18), sus migraciones y la API (FastAPI). La app web está en [`ppm-web`](https://github.com/Dfunn1k/ppm-web).

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
| `migrate` | dbmate aplica las migraciones pendientes de `db/migrations/` y termina |
| `api` | FastAPI en <http://localhost:8000>; se recarga sola al editar `app/` |

Comprueba que todo está vivo en <http://localhost:8000/health>. La documentación interactiva de la API está en <http://localhost:8000/docs>.

Para empezar de cero (borra los datos): `docker compose down -v`.

## Estructura

```
db/migrations/   0001_base.sql, 0002_….sql: se aplican en orden y nunca se editan una vez en main
app/             la API: rutas, lógica (dataclasses + Decimal) y adaptadores
tests/           pytest contra un PostgreSQL de verdad
```

Cada migración tiene su parte `-- migrate:up` y su `-- migrate:down` (para deshacerla).

## Pruebas

Las pruebas corren contra un PostgreSQL real, nunca contra una base simulada: las reglas importantes (cuadre de asientos, aislamiento entre usuarios, cuentas de sistema) viven en la base.

Con `docker compose up` corriendo, en otra terminal:

```bash
uv sync
uv run pytest
```

GitHub Actions corre lo mismo en cada pull request, con PostgreSQL 18, y además prueba que cada migración se puede deshacer.

## Cómo se trabaja

Cada paso llega en una rama con su pull request. Se aprueba con merge cuando las pruebas están en verde.
