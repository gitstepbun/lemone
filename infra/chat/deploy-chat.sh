#!/usr/bin/env bash
# Deploy lemone.chat berdiri sendiri (username + sandi) ke VPS Ubuntu yang sudah menjalankan nginx. Idempoten.
#   ssh ubuntu@43.133.129.111 'curl -fsSL https://raw.githubusercontent.com/gitstepbun/lemone/main/infra/chat/deploy-chat.sh | bash'
# Host lain: CHAT_HOST=lemone.chat bash
set -euo pipefail
if [ -z "${LEMONE_DEPLOY_SELF:-}" ]; then
  SELF="$(mktemp /tmp/lemone-chat-deploy.XXXXXX.sh)"
  if [ -f "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ]; then cp "${BASH_SOURCE[0]}" "$SELF"; else cat > "$SELF"; fi
  chmod +x "$SELF"; LEMONE_DEPLOY_SELF=1 exec bash "$SELF" "$@" </dev/null
fi

REPO_URL="${REPO_URL:-https://github.com/gitstepbun/lemone}"
DIR="${DIR:-$HOME/lemone}"
CHAT_HOST="${CHAT_HOST:-chat.lemone.id}"
ACME_EMAIL="${ACME_EMAIL:-step@lemone.id}"
COMPOSE="sudo docker compose -f infra/chat/docker-compose.chat.yml --env-file .env"
log() { printf '\n== %s\n' "$*"; }
rand() { openssl rand -hex "$1"; }

log "Paket dasar"
export DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 LANG=C.UTF-8
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates openssl python3 nginx certbot python3-certbot-nginx >/dev/null
command -v docker >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sudo sh

log "Sumber: $REPO_URL → $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO_URL" "$DIR"; fi
cd "$DIR"

# Hentikan tumpukan portal+Keycloak lama bila ada (dari deploy sebelumnya); datanya tetap ada di volume lemone_pgdata.
if sudo docker ps -a --format '{{.Names}}' | grep -q '^lemone-keycloak-1$'; then
  log "Menghentikan tumpukan portal + Keycloak lama (lemone_*)"
  sudo docker compose -f infra/docker-compose.yml -f infra/prod/docker-compose.nginx.yml --env-file .env down >/dev/null 2>&1 || true
fi

if [ ! -f .env ]; then
  log "Membuat .env (secret acak, tidak dicetak)"
  cat > .env <<ENV
PG_SUPERUSER=lemone
PG_SUPERPASSWORD=$(rand 16)
API_DB_PASSWORD=$(rand 16)
API_PORT=4000
AUTH_MODE=local
REGISTRATION_OPEN=true
CHAT_PUBLIC_URL=https://${CHAT_HOST}
CHAT_WS_URL=wss://${CHAT_HOST}/ws
SESSION_ENC_KEY=$(openssl rand -base64 32)
HR_INBOX_USERNAME=hr
ERP_ADAPTER=demo
AI_PROVIDER=none
LOG_LEVEL=info
ENV
  chmod 600 .env
fi
grep -q '^AUTH_MODE=' .env || echo 'AUTH_MODE=local' >> .env
sed -i 's#^AUTH_MODE=.*#AUTH_MODE=local#' .env
grep -q '^REGISTRATION_OPEN=' .env || echo 'REGISTRATION_OPEN=true' >> .env
grep -q '^CHAT_WS_URL=' .env || echo "CHAT_WS_URL=wss://${CHAT_HOST}/ws" >> .env
sed -i "s#^CHAT_WS_URL=.*#CHAT_WS_URL=wss://${CHAT_HOST}/ws#" .env
sed -i "s#^CHAT_PUBLIC_URL=.*#CHAT_PUBLIC_URL=https://${CHAT_HOST}#" .env
API_DB_PASSWORD=$(grep '^API_DB_PASSWORD=' .env | cut -d= -f2-)
grep -q '^DATABASE_URL=' .env && sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://lemone_api:${API_DB_PASSWORD}@postgres:5432/lemone#" .env || echo "DATABASE_URL=postgres://lemone_api:${API_DB_PASSWORD}@postgres:5432/lemone" >> .env

log "Build dan jalankan (Postgres, API, worker, chat-web)"
$COMPOSE up -d --build
log "Menunggu API sehat"
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:14000/health 2>/dev/null | grep -q '"ok":true' && break
  sleep 5
  if [ "$i" = 60 ]; then echo "API tidak sehat:"; $COMPOSE logs --tail=40 api; exit 1; fi
done
$COMPOSE exec -T api node dist/db/seed.js </dev/null

log "nginx: situs ${CHAT_HOST}"
sudo cp infra/prod/nginx-lemone-proxy.conf /etc/nginx/snippets/lemone-proxy.conf
if ! grep -rqs 'connection_upgrade' /etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null; then
  printf 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }\n' | sudo tee /etc/nginx/conf.d/lemone-upgrade.conf >/dev/null
fi
sed "s/server_name lemone.chat www.lemone.chat;/server_name ${CHAT_HOST};/" infra/prod/nginx-lemone-chat.conf | sudo tee /etc/nginx/sites-available/lemone-chat.conf >/dev/null
sudo ln -sf /etc/nginx/sites-available/lemone-chat.conf /etc/nginx/sites-enabled/lemone-chat.conf
# Lepas rute portal dari lemone.work bila pernah dipasang (situs lama kembali seperti semula)
if [ -f /etc/nginx/snippets/lemone-work-portal.conf ]; then
  for f in /etc/nginx/sites-enabled/*; do sudo sed -i '/include snippets\/lemone-work-portal.conf;/d' "$f" 2>/dev/null || true; done
  sudo rm -f /etc/nginx/snippets/lemone-work-portal.conf
fi
sudo nginx -t 2>&1 | grep -v "protocol options redefined" || true
sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx

MYIP=$(curl -fsS https://api.ipify.org || true)
CHATIP=$(getent hosts "$CHAT_HOST" | awk '{print $1}' | head -1 || true)
if [ -n "$MYIP" ] && [ "$CHATIP" = "$MYIP" ]; then
  if ! sudo test -d "/etc/letsencrypt/live/$CHAT_HOST"; then
    log "Sertifikat TLS ${CHAT_HOST}"
    sudo certbot --nginx -d "$CHAT_HOST" --non-interactive --agree-tos -m "$ACME_EMAIL" --redirect || echo "certbot gagal; jalankan ulang setelah DNS stabil"
  fi
  log "Verifikasi"
  curl -fsS "https://${CHAT_HOST}/api/health" | head -c 160; echo
  curl -fsS -o /dev/null -w "halaman masuk: %{http_code}\n" "https://${CHAT_HOST}/masuk"
  log "Selesai. Buka https://${CHAT_HOST} → Daftar. Pendaftar pertama otomatis menjadi admin (Owner + HR)."
else
  echo "DNS ${CHAT_HOST} -> ${CHATIP:-tidak ada} (server ini ${MYIP}). Arahkan A record ${CHAT_HOST} ke ${MYIP}, lalu jalankan ulang skrip ini."
  curl -fsS -H "Host: ${CHAT_HOST}" "http://127.0.0.1/api/health" | head -c 120; echo
fi
