#!/usr/bin/env sh
# Respaldo diario de PPM: la base (un pg_dump comprimido) y los adjuntos (un .tar.gz del volumen
# filestore), uno de cada uno por día; se guardan los últimos 14.
# En la VPS, con cron (como root):
#   15 4 * * *  /opt/ppm/deploy/respaldo.sh >> /var/log/ppm-respaldo.log 2>&1
# Restaurar: ver «Respaldos» en DESPLIEGUE.md.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO="${PPM_RESPALDOS:-/var/backups/ppm}"
DIAS="${PPM_RESPALDOS_DIAS:-14}"
FECHA="$(date +%Y-%m-%d_%H%M)"
ARCHIVO="$DESTINO/ppm-$FECHA.dump"
ADJUNTOS="$DESTINO/ppm-adjuntos-$FECHA.tar.gz"
COMPOSE="docker compose -f $REPO/docker-compose.prod.yml --project-directory $REPO"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
$COMPOSE exec -T db pg_dump -U ppm -d ppm --format=custom > "$ARCHIVO.tmp"
mv "$ARCHIVO.tmp" "$ARCHIVO"
$COMPOSE exec -T api tar czf - -C /var/lib/ppm filestore > "$ADJUNTOS.tmp"
mv "$ADJUNTOS.tmp" "$ADJUNTOS"
find "$DESTINO" \( -name 'ppm-*.dump' -o -name 'ppm-adjuntos-*.tar.gz' \) -mtime +"$DIAS" -delete
echo "$(date -Is) respaldo listo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1)) y $ADJUNTOS ($(du -h "$ADJUNTOS" | cut -f1))"
