#!/usr/bin/env sh
# Respaldo diario de la base de PPM: un pg_dump comprimido por día, se guardan los últimos 14.
# En la VPS, con cron (como root):
#   15 4 * * *  /opt/ppm/deploy/respaldo.sh >> /var/log/ppm-respaldo.log 2>&1
# Restaurar: ver «Respaldos» en DESPLIEGUE.md.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="${PPM_RESPALDOS:-/var/backups/ppm}"
DIAS="${PPM_RESPALDOS_DIAS:-14}"
ARCHIVO="$DESTINO/ppm-$(date +%Y-%m-%d_%H%M).dump"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
docker compose -f "$REPO/docker-compose.prod.yml" --project-directory "$REPO" exec -T db \
  pg_dump -U ppm -d ppm --format=custom > "$ARCHIVO.tmp"
mv "$ARCHIVO.tmp" "$ARCHIVO"
find "$DESTINO" -name 'ppm-*.dump' -mtime +"$DIAS" -delete
echo "$(date -Is) respaldo listo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
