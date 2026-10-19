#!/bin/sh
# Backup/restore Postgres (DB lemone + keycloak). Pakai: ./infra/backup.sh backup | restore <file.sql.gz>
set -e
cd "$(dirname "$0")/.."
. ./.env
case "$1" in
  backup)
    f="backup-$(date +%Y%m%d-%H%M%S).sql.gz"
    docker exec lemone-postgres-1 pg_dumpall -U "$PG_SUPERUSER" | gzip > "$f"
    echo "Tersimpan: $f"
    ;;
  restore)
    [ -f "$2" ] || { echo "Berkas tidak ada"; exit 1; }
    echo "Memulihkan $2 ke cluster (menimpa data). Hentikan API/worker/Keycloak dulu."
    gunzip -c "$2" | docker exec -i lemone-postgres-1 psql -U "$PG_SUPERUSER" -d postgres
    ;;
  *) echo "pakai: backup | restore <file>"; exit 1;;
esac
