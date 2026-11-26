# Instrucciones para trabajar en ppm

Repositorio único: `api/` (PostgreSQL, dbmate, FastAPI) y `web/` (React + TypeScript).

- El dueño es Dany. Escribe en español y explica cada decisión con una analogía antes de proponerla.
- No avances al siguiente paso sin su confirmación. Si hay varias opciones, muéstralas con sus pros y contras y deja que él elija.
- La única fuente de verdad está en este repo: `docs/modelo-contable.md` (las decisiones, con su fecha) y `design-system/` (voz, montos, color, tipografía y tokens). Toda decisión nueva se registra ahí en el mismo PR que la implementa. Si el código y la fuente no coinciden, manda la fuente.
- Desde el 24-nov-2026 no hay originales en claude.ai: el documento y el sistema de diseño de claude.ai quedaron como archivo y no se actualizan. El lienzo «Pantallas de PPM» es un cuaderno de bocetos: sirve para dibujar y elegir opciones, pero no es fuente de nada; lo elegido se escribe en `docs/modelo-contable.md`.
- Nombres al estilo Odoo: `account_account`, `account_move`, `account_move_line`, `res_users`, `res_partner`, `res_currency`…
- Migraciones: archivos `api/db/migrations/NNNN_nombre.sql` para dbmate, con `-- migrate:up` y `-- migrate:down`. Nunca edites una migración que ya está en main: crea otra.
- Lógica en Python con dataclasses y `Decimal`; Pydantic solo en el borde de la API; SQL directo con psycopg 3, sin ORM.
- Pruebas con pytest contra PostgreSQL real.
- Web: React + TypeScript con Vite, Tailwind con los tokens de `design-system/tokens.json`, que se implementan en `web/src/styles.css` (un token nuevo cambia los dos en el mismo PR), componentes propios en `web/src/components/` con variantes `cva` al estilo de shadcn/ui (ver `docs/frontend/SISTEMA.md`), TanStack Query, React Hook Form + Zod. La API se llama solo con `web/src/api/client.ts`, con tipos generados (`pnpm gen:api`); nunca se escriben a mano. Node no está instalado en la máquina: todo corre en Docker.
- Antes de tocar algo visible en `web/`, sigue la skill `ppm-interfaz` (`.claude/skills/ppm-interfaz/SKILL.md`).
- Cada paso va en una rama con su pull request; Dany aprueba con merge.
- Versión única para todo PPM (beta en 0.x; v1.0.0 = lanzamiento al público). Cada PR que entra a main la sube en `api/pyproject.toml`, `api/uv.lock`, `api/app/main.py` y `web/package.json`: función nueva, el número del medio (0.15.0); arreglo, el último (0.14.1). El CI revisa que coincidan y, al entrar a main, crea la etiqueta `vX.Y.Z`.
