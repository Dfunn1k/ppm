# Instrucciones para trabajar en ppm

Repositorio único: `api/` (PostgreSQL, dbmate, FastAPI) y `web/` (React + TypeScript).

- El dueño es Dany. Escribe en español y explica cada decisión con una analogía antes de proponerla.
- No avances al siguiente paso sin su confirmación. Si hay varias opciones, muéstralas con sus pros y contras y deja que él elija.
- La única fuente de verdad es el documento «PPM — Modelo contable y base de datos» (claude.ai). Toda decisión nueva se registra ahí.
- Nombres al estilo Odoo: `account_account`, `account_move`, `account_move_line`, `res_users`, `res_partner`, `res_currency`…
- Migraciones: archivos `api/db/migrations/NNNN_nombre.sql` para dbmate, con `-- migrate:up` y `-- migrate:down`. Nunca edites una migración que ya está en main: crea otra.
- Lógica en Python con dataclasses y `Decimal`; Pydantic solo en el borde de la API; SQL directo con psycopg 3, sin ORM.
- Pruebas con pytest contra PostgreSQL real.
- Cada paso va en una rama con su pull request; Dany aprueba con merge.
