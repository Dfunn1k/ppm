# API de PPM

Base de datos (PostgreSQL 18), migraciones (dbmate) y API (FastAPI). Se levanta desde la raíz del repositorio con `docker compose up`.

## Estructura

```
db/migrations/   0001_base … 0008_iconos_y_futuro: se aplican en orden y nunca se editan una vez en main
app/             la API: rutas, lógica (dataclasses + Decimal) y adaptadores
tests/           pytest contra un PostgreSQL de verdad
```

Cada migración tiene su parte `-- migrate:up` y su `-- migrate:down` (para deshacerla).

## Asientos y saldos

Cada movimiento de dinero es un asiento (`account_move`) con sus apuntes (`account_move_line`), al Debe o al Haber, como en Odoo. La base cuida, al confirmar la transacción, que todo asiento confirmado cuadre, que cada apunte vaya en la moneda de su cuenta y que en moneda base el monto coincida. Además: solo las cuentas hoja reciben movimientos, «Por cobrar», «Por pagar» y «Plata que guardo de otros» exigen persona, y una cuenta con movimientos ya no cambia de tipo ni de moneda.

Un movimiento con fecha futura no puede estar confirmado: queda por confirmar y no cuenta hasta que llegue su día.

Los saldos no se guardan: se calculan (`account_balance`, y `account_move_line_running` con el saldo después de cada apunte). El saldo inicial es un asiento contra «Saldos iniciales» (`post_opening_balance`), y las altas lo hacen en un solo paso: `create_cash_account`, `create_bank_account` (con su CCI validado contra el banco) y `post_custody_opening`.

## Cuentas

| Ruta | Qué hace |
|---|---|
| `GET /accounts` | lo que realmente tengo (= tengo − guardo de otros − debo) y las cuentas de cada grupo |
| `GET /accounts/{id}` | detalle: saldos, datos del banco, saldo inicial y movimientos con el saldo después de cada uno |
| `POST /accounts/cash` · `/accounts/bank` | nueva cuenta con su saldo inicial, en un paso |
| `PUT /accounts/{id}/opening` | poner o corregir el saldo inicial (el paso 3 lo usa con el Efectivo) |
| `PATCH /accounts/{id}` · `POST /accounts/{id}/archive` | renombrar o editar banco, número y CCI · archivar (solo con saldo cero) |
| `POST /custody` · `GET`/`POST /partners` | plata que guardo de otros · personas (por ahora, solo el nombre) |

Los montos viajan como texto decimal exacto (`"1284.90"`), entran y salen así. Una moneda que no es la base pide su tipo de cambio (`rate`); sin él, la base rechaza el saldo.

## Acceso

| Ruta | Qué hace |
|---|---|
| `POST /auth/signup` | crear cuenta (nombre, correo, contraseña de 8 o más) y dejar la sesión abierta |
| `POST /auth/login` | iniciar sesión |
| `POST /auth/logout` · `/auth/logout-all` | cerrar esta sesión · cerrar todas |
| `POST /auth/password` | cambiar contraseña (cierra las demás sesiones) |
| `POST /auth/password-reset` · `/confirm` | pedir el enlace por correo · poner la contraseña nueva |
| `GET /me` · `POST /me/setup` · `GET /catalog` | quién eres · configuración inicial · países, monedas e idiomas |

La sesión es una cookie `ppm_session` (httpOnly, SameSite=Lax) con un número al azar; la base guarda solo su huella en `res_users_session` y la sesión vence a los 30 días. Las contraseñas se guardan con Argon2id. La API no toca las tablas de sesiones ni de enlaces: pasa por las funciones `auth_*` de `0005_acceso.sql`.

## Aislamiento entre usuarios

Todos comparten una base, pero cada persona solo ve sus filas. Cada tabla de usuario tiene `user_id` y seguridad por fila (`ppm_enable_rls`). La API trabaja dentro de `user_transaction(user_id)`, que pasa a `ppm_app` y fija `app.user_id` solo para esa transacción. Sin usuario en la sesión, la base da error en vez de mostrar todo. Una prueba guardiana falla si alguna tabla con `user_id` queda sin esa regla.

## Pruebas

Las pruebas corren contra un PostgreSQL real, nunca contra una base simulada: las reglas importantes (cuadre de asientos, aislamiento entre usuarios, cuentas de sistema) viven en la base.

Con Docker, sin instalar nada más:

```bash
docker compose run --rm pruebas
```

O, si tienes uv instalado y `docker compose up` corriendo: `cd api && uv run pytest`.

GitHub Actions corre lo mismo en cada pull request que toca `api/`, con PostgreSQL 18, y además prueba que cada migración se puede deshacer.
