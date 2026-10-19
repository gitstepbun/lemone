#!/usr/bin/env bash
# Deploy Lemone Work (portal di lemone.work/user, IdP di lemone.work/auth) dan Lemone Chat (lemone.chat)
# ke VPS Ubuntu yang SUDAH menjalankan nginx untuk situs lemone.work. Idempoten: aman dijalankan ulang.
#
# Dari Mac:  ssh ubuntu@43.133.129.111 'curl -fsSL https://raw.githubusercontent.com/gitstepbun/lemone/main/infra/deploy.sh | bash'
# Opsi env:  OWNER_EMPLOYEE=EMP-0001 OWNER_USERNAME=stephanus ACME_EMAIL=step@lemone.id
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/gitstepbun/lemone}"
DIR="${DIR:-$HOME/lemone}"
WORK_HOST="${WORK_HOST:-lemone.work}"
CHAT_HOST="${CHAT_HOST:-lemone.chat}"
OWNER_EMPLOYEE="${OWNER_EMPLOYEE:-EMP-0001}"
OWNER_USERNAME="${OWNER_USERNAME:-stephanus}"
ACME_EMAIL="${ACME_EMAIL:-step@lemone.id}"
COMPOSE="sudo docker compose -f infra/docker-compose.yml -f infra/prod/docker-compose.nginx.yml --env-file .env"

log() { printf '\n== %s\n' "$*"; }
rand() { openssl rand -hex "$1"; }

log "Paket dasar"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates openssl python3 nginx certbot python3-certbot-nginx >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  log "Memasang Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo docker compose version >/dev/null 2>&1 || { log "Docker compose plugin tidak ada"; sudo apt-get install -y -qq docker-compose-plugin; }
sudo usermod -aG docker "$USER" || true

log "Sumber: $REPO_URL → $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO_URL" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  log "Membuat .env (secret acak, tidak pernah dicetak)"
  cat > .env <<EOF
PG_SUPERUSER=lemone
PG_SUPERPASSWORD=$(rand 16)
PG_PORT=5432
KC_DB_PASSWORD=$(rand 16)
API_DB_PASSWORD=$(rand 16)
KC_ADMIN_USER=kcadmin
KC_ADMIN_PASSWORD=$(rand 16)
KC_PORT=8080
KC_PUBLIC_URL=https://${WORK_HOST}/auth
API_PORT=4000
DATABASE_URL=postgres://lemone_api:ganti@postgres:5432/lemone
OIDC_ISSUER=https://${WORK_HOST}/auth/realms/lemone
KC_ADMIN_URL=http://keycloak:8080/auth
KC_REALM=lemone
IDP_PROVISIONER_CLIENT_ID=lemone-provisioner
IDP_PROVISIONER_CLIENT_SECRET=$(rand 24)
OIDC_CLIENT_WORK_ID=lemone-work-web
OIDC_CLIENT_WORK_SECRET=$(rand 24)
OIDC_CLIENT_CHAT_ID=lemone-chat-web
OIDC_CLIENT_CHAT_SECRET=$(rand 24)
API_AUDIENCE=lemone-api
WORK_PUBLIC_URL=https://${WORK_HOST}
CHAT_PUBLIC_URL=https://${CHAT_HOST}
CHAT_WS_URL=wss://${CHAT_HOST}/ws
SESSION_ENC_KEY=$(openssl rand -base64 32)
INVITATION_TTL_HOURS=24
HR_INBOX_USERNAME=hr
BOOTSTRAP_ENABLED=false
ERP_ADAPTER=demo
AI_PROVIDER=none
LOG_LEVEL=info
EOF
  chmod 600 .env
fi
# DATABASE_URL harus memakai API_DB_PASSWORD yang sama
API_DB_PASSWORD=$(grep '^API_DB_PASSWORD=' .env | cut -d= -f2-)
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://lemone_api:${API_DB_PASSWORD}@postgres:5432/lemone#" .env

log "Build dan jalankan container (Postgres, Keycloak, API, worker, work-web, chat-web)"
$COMPOSE up -d --build

log "Menunggu API sehat"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/health 2>/dev/null | grep -q '"ok":true'; then break; fi
  sleep 5
  [ "$i" = 60 ] && { echo "API tidak sehat. Log:"; $COMPOSE logs --tail=50 api keycloak; exit 1; }
done
$COMPOSE exec -T api node dist/db/seed.js

log "nginx: rute portal + IdP ke server block ${WORK_HOST}, situs ${CHAT_HOST}"
sudo cp infra/prod/nginx-lemone-proxy.conf /etc/nginx/snippets/lemone-proxy.conf
sudo cp infra/prod/nginx-lemone-work.conf /etc/nginx/snippets/lemone-work-portal.conf
if ! grep -rqs 'connection_upgrade' /etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null; then
  printf 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }\n' | sudo tee /etc/nginx/conf.d/lemone-upgrade.conf >/dev/null
fi
sudo python3 - "$WORK_HOST" <<'PY'
import glob, re, sys, shutil, os, time
host = sys.argv[1]
bak_dir = '/etc/nginx/lemone-backups'; os.makedirs(bak_dir, exist_ok=True)
done = False
for path in glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf'):
    try: src = open(path).read()
    except Exception: continue
    if host not in src or 'lemone-work-portal.conf' in src:
        if 'lemone-work-portal.conf' in src: done = True
        continue
    out, i, changed = [], 0, False
    # sisipkan include ke setiap server block yang memuat server_name <host> dan listen 443
    pos = 0
    for m in re.finditer(r'server\s*\{', src):
        start = m.end(); depth = 1; j = start
        while j < len(src) and depth:
            if src[j] == '{': depth += 1
            elif src[j] == '}': depth -= 1
            j += 1
        block = src[start:j-1]
        if re.search(r'server_name[^;]*\b' + re.escape(host) + r'\b', block) and '443' in block:
            block2 = re.sub(r'(server_name[^;]*;)', r'\1\n    include snippets/lemone-work-portal.conf;', block, count=1)
            out.append(src[pos:start]); out.append(block2); pos = j-1; changed = True
    out.append(src[pos:])
    if changed:
        shutil.copy(path, os.path.join(bak_dir, os.path.basename(path) + '.' + time.strftime('%Y%m%d-%H%M%S')))
        open(path, 'w').write(''.join(out)); done = True
        print('disisipkan ke', path)
print('OK' if done else 'PERINGATAN: server block https untuk ' + host + ' tidak ditemukan; tambahkan "include snippets/lemone-work-portal.conf;" manual')
PY
sudo cp infra/prod/nginx-lemone-chat.conf /etc/nginx/sites-available/lemone-chat.conf
sudo ln -sf /etc/nginx/sites-available/lemone-chat.conf /etc/nginx/sites-enabled/lemone-chat.conf
sudo nginx -t && sudo systemctl reload nginx

MYIP=$(curl -fsS https://api.ipify.org || true)
CHATIP=$(getent hosts "$CHAT_HOST" | awk '{print $1}' | head -1 || true)
if [ -n "$MYIP" ] && [ "$CHATIP" = "$MYIP" ]; then
  if ! sudo test -d "/etc/letsencrypt/live/$CHAT_HOST"; then
    log "Sertifikat TLS ${CHAT_HOST}"
    sudo certbot --nginx -d "$CHAT_HOST" --non-interactive --agree-tos -m "$ACME_EMAIL" --redirect || echo "certbot gagal; jalankan ulang skrip setelah DNS stabil"
  fi
else
  echo "DNS ${CHAT_HOST} -> ${CHATIP:-tidak ada} (server ini ${MYIP}). Arahkan A record ${CHAT_HOST} ke ${MYIP}, lalu jalankan ulang skrip ini untuk TLS."
fi

log "Verifikasi"
curl -fsS "https://${WORK_HOST}/api/health" | head -c 200; echo
curl -fsS "https://${WORK_HOST}/auth/realms/lemone/.well-known/openid-configuration" | head -c 120; echo
curl -fsS -o /dev/null -w "portal /masuk: %{http_code}\n" "https://${WORK_HOST}/masuk"

OWNER_EXISTS=$($COMPOSE exec -T postgres psql -U lemone -d lemone -tAc "select count(*) from directory.role_assignments r join directory.users u on u.id=r.user_id where r.role='OWNER' and r.revoked_at is null and u.status in ('ACTIVE','PENDING_ACTIVATION')" 2>/dev/null || echo 0)
if [ "${OWNER_EXISTS:-0}" = "0" ]; then
  log "Bootstrap Owner pertama (${OWNER_USERNAME}, ${OWNER_EMPLOYEE}). Kredensial di bawah tampil SEKALI."
  $COMPOSE exec -T -e BOOTSTRAP_ENABLED=true api node dist/scripts/bootstrap-owner.js --employee "$OWNER_EMPLOYEE" --username "$OWNER_USERNAME"
else
  echo "Owner sudah ada, bootstrap dilewati."
fi

log "Selesai. Portal: https://${WORK_HOST}/user  Chat: https://${CHAT_HOST}  IdP: https://${WORK_HOST}/auth"
