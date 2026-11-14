# Desplegar PPM en una VPS

Esta guía lleva PPM a producción en un servidor propio con Docker. Está escrita para seguirse paso a paso, por una persona o por un agente. Todo lo de producción está en estos archivos:

| Archivo | Qué es |
|---|---|
| `docker-compose.prod.yml` | las piezas de producción: `db`, `migrate`, `usuario-api`, `api` y `web` |
| `web/Dockerfile` · `web/Caddyfile` | la web ya construida, servida por Caddy, que además saca el certificado HTTPS y reenvía `/api/…` a la API |
| `api/Dockerfile` | la API (FastAPI) |
| `deploy/.env.example` | la configuración que cambia entre servidores; se copia como `.env` |
| `deploy/respaldo.sh` | el respaldo diario de la base y de los adjuntos |

`docker-compose.yml` (sin `.prod`) es solo para desarrollo: tiene Mailpit, recarga en caliente y contraseñas de prueba. **Nunca se usa en el servidor.**

## Cómo queda

```
Internet ──443/80──▶ web (Caddy)
                      ├─ /          la web (archivos de Vite)
                      └─ /api/…  ──▶ api:8000 (FastAPI + importador diario de SUNAT)
                                       └──▶ db:5432 (PostgreSQL 18, volumen pgdata), como ppm_api
```

**Dos usuarios de PostgreSQL.** `ppm` es el dueño de las tablas: solo lo usan `migrate`, los respaldos y quien entra a mano. La API entra como `ppm_api`, que no es dueño ni superusuario: sin ponerse un rol no puede leer ninguna tabla, y solo puede ponerse `ppm_app` (cada persona, con seguridad por fila) o `ppm_admin` (el importador de SUNAT y Z1, que solo lee y escribe el tipo de cambio y no ve cuentas ni movimientos de nadie). Qué protege y qué no: un error en el código que se olvide de ponerse el rol falla en vez de ver todo, y quien llegara a usar la conexión de la API no podría cambiar las tablas, quitar la seguridad por fila, saltarse las reglas de la base (el cuadre, el cierre) ni hacerse pasar por el dueño. Pero sí podría leer y cambiar datos de personas, porque con `ppm_app` la API declara de quién es cada pedido (`app.user_id`). Por eso la contraseña de `ppm_api` se cuida igual que la del dueño. Cada uno tiene su contraseña en `.env`.

Solo Caddy publica puertos (80 y 443). La API y la base quedan dentro de la red de Docker. El proyecto se llama `ppm-prod` (`name:` en el compose), así nunca se mezcla con uno de desarrollo.

## 1. Lo que hace falta antes

- **Una VPS** con Ubuntu 24.04 LTS (o Debian 12), 2 GB de RAM y 20 GB de disco como mínimo. Construir la web necesita la memoria; con 1 GB, agrega swap (paso 2).
- **Un dominio o subdominio** (por ejemplo `ppm.ejemplo.com`) con un registro **A** que apunte a la IP de la VPS. Debe resolver **antes** de levantar: Caddy pide el certificado a Let's Encrypt al arrancar.
- **Un proveedor de correo SMTP** con STARTTLS en el puerto 587 (por ejemplo Brevo, Resend, Amazon SES o el SMTP de Google Workspace). Lo usa «Olvidé mi contraseña». La API no soporta SSL directo en el 465.
- **El correo del administrador**: quien verá Z1 (tipo de cambio).
- **Opcional, para «Continuar con Google»**: un cliente OAuth de Google (paso 1b). Sin él, PPM funciona igual y el botón no aparece.

### 1b. El cliente de Google (opcional)

En [Google Cloud Console](https://console.cloud.google.com), dentro de un proyecto, en **Google Auth Platform**:

1. **Branding**: nombre de la app `PPM`, tu correo de asistencia y, en dominios autorizados, el dominio de `PPM_DOMAIN`. Sin logo: con logo, Google exige verificar la marca.
2. **Audience**: tipo *Externo*. Mientras esté en *Testing* solo entran los correos de *Test users*; cuando funcione, *Publish app* (con solo nombre y correo no pide revisión).
3. **Data access**: solo `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`.
4. **Clients › Create client**: *Aplicación web*, sin orígenes de JavaScript, y en **URIs de redireccionamiento autorizados**, exactamente `https://TU-DOMINIO/api/auth/google/callback` (y, para probar en tu equipo, `http://localhost:5173/api/auth/google/callback`).
5. Copia el Client ID y el secreto (Google muestra el secreto una sola vez) a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del `.env`.

Para probar en tu equipo con la Google de verdad (sin ellas, el desarrollo usa una Google falsa en http://localhost:8099), pon en el `.env` del repo las dos de arriba y además `GOOGLE_AUTH_URL=https://accounts.google.com/o/oauth2/v2/auth` y `GOOGLE_TOKEN_URL=https://oauth2.googleapis.com/token`.

## 2. Preparar el servidor (una sola vez)

Como root:

```bash
apt update && apt upgrade -y
apt install -y git ufw

# Docker y su plugin compose, desde el repositorio oficial
curl -fsSL https://get.docker.com | sh

# Cortafuegos: solo SSH y web
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Solo si la VPS tiene 1 GB de RAM: 2 GB de swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Comprueba con `docker compose version` (debe ser 2.24 o más nuevo).

## 3. Traer el código y configurarlo

```bash
git clone https://github.com/Dfunn1k/ppm.git /opt/ppm
cd /opt/ppm
cp deploy/.env.example .env
chmod 600 .env
openssl rand -hex 24      # úsalo como POSTGRES_PASSWORD
openssl rand -hex 24      # otra, para PPM_API_PASSWORD
nano .env                 # llena todo
```

| Variable | Qué poner |
|---|---|
| `PPM_DOMAIN` | el dominio, sin `https://` |
| `POSTGRES_PASSWORD` | la salida de `openssl rand -hex 24`. **Solo letras y números**: va dentro de una URL |
| `PPM_API_PASSWORD` | otra salida de `openssl rand -hex 24`, distinta: la contraseña de `ppm_api`. También solo letras y números |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASSWORD` | los datos del proveedor de correo (puerto 587) |
| `SMTP_STARTTLS` | `true` |
| `MAIL_FROM` | el remitente, de un dominio verificado en el proveedor: `PPM <no-responder@ejemplo.com>` |
| `ADMIN_EMAILS` | el o los correos de administrador, separados por coma |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | opcionales: el cliente de Google del paso 1b. Vacíos, no aparece «Continuar con Google» |

`.env` tiene secretos: no se sube a git (ya está en `.gitignore`) ni se copia a ningún otro lado.

## 4. Levantar

```bash
cd /opt/ppm
docker compose -f docker-compose.prod.yml up -d --build
```

En orden: arranca `db`; `migrate` aplica todas las migraciones y termina; `usuario-api` le pone a `ppm_api` la contraseña de `.env` y termina; arranca `api`; `web` construye la app y pide el certificado.

Para no escribir `-f docker-compose.prod.yml` cada vez, en esa sesión:

```bash
export COMPOSE_FILE=docker-compose.prod.yml
```

El resto de la guía lo asume.

## 5. Comprobar que funciona

```bash
docker compose ps -a                      # db (healthy), api y web «Up»; migrate y usuario-api «Exited (0)»
docker compose logs migrate               # «Applied: 0001_base.sql» … hasta la última
curl -s https://ppm.ejemplo.com/api/health   # tu dominio: {"status":"ok","postgres":"18.x"}
```

Luego, en el navegador:

1. Abre `https://ppm.ejemplo.com`: sale «Iniciar sesión» con el refrán.
2. Crea una cuenta con el correo de `ADMIN_EMAILS` y pasa los 3 pasos.
3. En **Más** debe aparecer **Tipo de cambio**, con el dólar de SUNAT de hoy. El importador trae el tipo al arrancar y luego todos los días a las 09:00 de Lima.
4. Cierra sesión y prueba «¿Olvidaste tu contraseña?»: el correo debe llegar. Si no llega, mira `docker compose logs api`.

## 6. Respaldos (obligatorio)

`deploy/respaldo.sh` hace un `pg_dump` comprimido de la base y un `.tar.gz` de los adjuntos (los extractos importados, en el volumen `filestore`) en `/var/backups/ppm`, y guarda los últimos 14 días. Los dos van juntos: una ficha de adjunto en la base sin su archivo no sirve. Prográmalo con cron (como root):

```bash
crontab -e
# cada día a las 04:15 (hora del servidor)
15 4 * * * /opt/ppm/deploy/respaldo.sh >> /var/log/ppm-respaldo.log 2>&1
```

Pruébalo una vez a mano: `/opt/ppm/deploy/respaldo.sh`.

**Copia los respaldos fuera de la VPS.** Si el servidor se pierde, se pierden con él. Cualquier destino sirve: `rclone` a un bucket o `rsync` a otra máquina.

### Restaurar

```bash
cd /opt/ppm
docker compose stop api web
docker compose exec -T db pg_restore -U ppm -d ppm --clean --if-exists < /var/backups/ppm/ppm-AAAA-MM-DD_HHMM.dump
docker compose run --rm --no-deps -T api sh -c 'rm -rf /var/lib/ppm/filestore && tar xzf - -C /var/lib/ppm' \
  < /var/backups/ppm/ppm-adjuntos-AAAA-MM-DD_HHMM.tar.gz      # los adjuntos del mismo día
docker compose start api web
```

En un servidor nuevo, primero levanta todo (paso 4) para que existan la base y sus roles. Después restaura.

## 7. Actualizar a una versión nueva

Cada vez que se haga merge a `main`:

```bash
cd /opt/ppm
/opt/ppm/deploy/respaldo.sh                     # primero, un respaldo
git pull --ff-only
docker compose up -d --build                    # migrate aplica solo las migraciones nuevas
docker compose ps && curl -s https://ppm.ejemplo.com/api/health   # tu dominio
```

Las migraciones solo avanzan. Nunca se edita una que ya está en `main`, así que actualizar es seguro.

**Una sola vez, en un servidor que se desplegó antes de `ppm_api`:** antes del `docker compose up`, agrega a `.env` la línea `PPM_API_PASSWORD=` con la salida de `openssl rand -hex 24`. Sin ella, Docker Compose se detiene con «Falta PPM_API_PASSWORD en .env» y no cambia nada.

Si una actualización falla:

1. Vuelve al commit anterior: `git checkout <commit>` y luego `docker compose up -d --build`.
2. Si la migración nueva ya cambió datos, restaura el respaldo del paso 1.

## 8. Operar

| Para | Comando |
|---|---|
| Ver qué corre | `docker compose ps` |
| Logs | `docker compose logs -f api` (o `web`, `db`) |
| Reiniciar la API | `docker compose restart api` |
| Cambiar algo de `.env` | editar `.env` y `docker compose up -d` (recrea lo que cambió) |
| Cambiar la contraseña de `ppm_api` | editar `PPM_API_PASSWORD` en `.env` y `docker compose up -d`: `usuario-api` la pone y la API se recrea con ella |
| Entrar a la base | `docker compose exec db psql -U ppm -d ppm` |
| Espacio de Docker | `docker system df`; limpiar imágenes viejas con `docker image prune` |

El importador de SUNAT escribe en los logs de `api` solo cuando falla («Importador de SUNAT, intento N de 6…»). Si SUNAT no responde, reintenta 5 veces cada 30 minutos. Si falla todo, se sigue usando el último tipo. El administrador puede cargarlo a mano o usar «Traer de SUNAT ahora» en Z1.

## Lo que nunca se hace

- **`docker compose down -v`**: el `-v` borra los volúmenes `pgdata` y `filestore`, es decir, **todos los datos y los adjuntos**. Para detener, `docker compose down` (sin `-v`) o `stop`.
- Publicar el puerto 5432 de la base o el 8000 de la API.
- Usar `docker-compose.yml` (el de desarrollo) en el servidor.
- Editar una migración que ya está en `main` o tocar la base a mano para «arreglar» datos sin respaldo.
- Levantar la API con más de un proceso (`--workers`): el importador de SUNAT corre dentro de ella.
- Poner `COOKIE_SECURE=false`: sin HTTPS, la cookie de sesión no debe viajar.
- Conectar la API como `ppm` (el dueño): perdería la protección de `ppm_api`.

## 9. Monitoreo (UptimeRobot)

Un servicio de afuera consulta `/api/health` cada 5 minutos y te avisa si deja de responder. `/api/health` responde `200` con `{"status":"ok",…}` solo si la API está viva **y** llega a la base; si la base no responde, devuelve `500`. Responde a `GET` y a `HEAD`. Tiene que ser de afuera: un monitor en la misma VPS se cae con ella.

Dos detalles de UptimeRobot que importan:

- **Cuenta como arriba cualquier respuesta entre 200 y 399**, también una redirección. Por eso la URL va siempre con `https://`: con `http://`, Caddy responde con una redirección (308) aunque la API esté caída, y el monitor nunca avisaría.
- **Por defecto consulta con `HEAD`.** `/api/health` lo atiende, pero `GET` es lo más directo: es lo que hace un navegador y devuelve el cuerpo con `"status":"ok"`.

Pasos:

1. Crea una cuenta en [uptimerobot.com](https://uptimerobot.com) y confirma tu correo. Para uso personal alcanza el plan gratis (revisa sus condiciones en su página de precios).
2. **New monitor**:
   - Si tu plan ofrece el tipo **Keyword**, úsalo: URL `https://ppm.ejemplo.com/api/health` (tu dominio), palabra `"status":"ok"` y que avise cuando **no** aparezca. Es lo más estricto: solo cuenta como arriba si la API dice que llega a la base.
   - Si no, tipo **HTTP(s)**, con la misma URL. En **Advanced Settings**, elige el método **GET**.
   - **Intervalo:** 5 minutos.
3. En los contactos de alerta, deja tu correo (y la app de UptimeRobot o Telegram, si quieres el aviso en el celular).
4. Pruébalo: `docker compose stop api`, espera el aviso (unos 5 a 10 minutos) y vuelve con `docker compose start api`. Debe llegar un segundo aviso de que volvió.
