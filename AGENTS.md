# Para agentes que trabajan en este repositorio

PPM («pan para mayo») es una app de finanzas personales con partida doble. Su dueño es Dany; escríbele en español.

## Si tu tarea es desplegar

Sigue **[DESPLIEGUE.md](DESPLIEGUE.md)** al pie de la letra. En resumen:

- Producción usa **solo** `docker-compose.prod.yml` y un `.env` hecho a partir de `deploy/.env.example`. `docker-compose.yml` es de desarrollo y nunca va al servidor.
- Antes de actualizar, siempre corre `deploy/respaldo.sh`.
- **Nunca** corras `docker compose down -v`: borra todos los datos.
- **Nunca** publiques los puertos de la base (5432) ni de la API (8000); solo Caddy (80 y 443).
- No cambies código, migraciones ni la configuración de producción para «hacer que funcione». Si algo de la guía no calza con el servidor, detente y cuéntale a Dany qué pasó, con el comando y su salida.
- No inventes valores de `.env` (dominio, SMTP, correos de administrador): pídeselos a Dany.

## Si tu tarea es cambiar código

- La única fuente de verdad está en este repo: `docs/modelo-contable.md` (las decisiones) y `design-system/` (voz, color, tipografía y tokens). Toda decisión nueva se registra ahí en el mismo PR que la implementa. Si algo aquí lo contradice, manda la fuente. Lo que está en claude.ai (el documento, el sistema de diseño y el lienzo «Pantallas de PPM») es archivo o bocetos, no fuente.
- Migraciones: `api/db/migrations/NNNN_nombre.sql` para dbmate, con `-- migrate:up` y `-- migrate:down`. Nunca se edita una migración que ya está en `main`: se crea otra.
- API: Python con dataclasses y `Decimal`; Pydantic solo en el borde; SQL directo con psycopg 3, sin ORM. Pruebas con pytest contra PostgreSQL real: `docker compose run --rm pruebas`.
- Web: React + TypeScript (Vite), Tailwind con los tokens de `design-system/tokens.json` implementados en `web/src/styles.css`, TanStack Query. Antes de tocar algo visible, sigue la skill `ppm-interfaz` (`.claude/skills/ppm-interfaz/SKILL.md`). La API se llama solo con `web/src/api/client.ts` y los tipos de `src/api/schema.d.ts`, que se generan (`docker compose exec web corepack pnpm gen:api`) y nunca se escriben a mano.
- Nombres al estilo Odoo: `account_move`, `res_users`, `res_currency`…
- Cada cambio va en una rama con su pull request; Dany aprueba con merge.
- Versión única para todo PPM (beta en 0.x; v1.0.0 = lanzamiento al público). Cada PR que entra a main la sube en `api/pyproject.toml`, `api/uv.lock`, `api/app/main.py` y `web/package.json`: función nueva, el número del medio (0.15.0); arreglo, el último (0.14.1). El CI revisa que coincidan y, al entrar a main, crea la etiqueta `vX.Y.Z`.
