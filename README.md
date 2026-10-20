# Lemone Chat (dan Lemone Work)

**Mode utama saat ini: lemone.chat berdiri sendiri.** Karyawan mendaftar sendiri dengan username + kata sandi (`AUTH_MODE=local`); pendaftar pertama otomatis menjadi admin (Owner + HR). Fitur HR (@hr, kartu izin, tab HR, absensi DEMO) tetap aktif. Portal akun lemone.work + Keycloak (`AUTH_MODE=oidc`) tetap ada di repo sebagai mode lanjutan.

## Deploy lemone.chat (mode mandiri)

Alamat: **https://chat.lemone.id** (DNS sudah mengarah ke VPS). Untuk host lain: `CHAT_HOST=... bash`. Jalankan sekali dari Mac, idempoten (aman diulang; bila DNS belum sampai, skrip tetap memasang semuanya dan tinggal dijalankan ulang untuk sertifikat):

```bash
ssh ubuntu@43.133.129.111 'curl -fsSL https://raw.githubusercontent.com/gitstepbun/lemone/main/infra/chat/deploy-chat.sh | bash'
```

Skrip `infra/chat/deploy-chat.sh`: memasang Docker/nginx/certbot bila belum ada, clone/pull ke `~/lemone`, menghentikan tumpukan portal+Keycloak lama bila ada, membuat `.env` (secret acak), menjalankan `infra/chat/docker-compose.chat.yml` (Postgres, API, worker, chat-web; port hanya di 127.0.0.1), memasang situs nginx `lemone.chat`, melepas rute portal `/akun` dari lemone.work, lalu meminta sertifikat Let's Encrypt dan verifikasi `https://lemone.chat/api/health`. Setelah itu buka https://chat.lemone.id → **Daftar**.

Uji alur mandiri di browser: `RESET_DB=1 pnpm --filter @lemone/api test:local` (Chromium headless; daftar 2 akun, DM realtime, izin ke @hr, persetujuan admin, ganti sandi).

| Bagian | Lokasi |
|---|---|
| API (direktori, provisioning, BFF OIDC, chat, HR) | `apps/api` (NestJS, TypeScript, Kysely, PostgreSQL) |
| Portal akun `lemone.work/user`, aktivasi `/activate` | `apps/work-web` (Next.js) |
| Web Chat `lemone.chat` | `apps/chat-web` (Next.js) |
| Aplikasi Android/iOS | `apps/mobile` (Expo dev build, OIDC PKCE) |
| IdP (Keycloak realm `lemone`), Postgres, proxy produksi | `infra/` |
| Kontrak API, aturan desain, laporan uji | `docs/` |

## Menjalankan lokal

Prasyarat: Docker, Node 22, pnpm 10.

```bash
cp .env.example .env          # isi semua nilai "ganti-saya" (openssl rand -hex 16)
pnpm install
pnpm infra:up                 # Postgres + Keycloak (import realm lemone)
pnpm db:migrate && pnpm db:seed   # skema + akun layanan @hr/@hr.ai/@lemone.ai + karyawan DEMO
pnpm idp:bootstrap -- --write # ambil client secret dari Keycloak dev ke .env
cp .env apps/api/.env
BOOTSTRAP_ENABLED=true pnpm bootstrap:owner -- --employee EMP-0001 --username <username>   # Owner pertama, cetak undangan sekali
pnpm dev:api                  # :4000
pnpm dev:worker               # job provisioning + outbox
pnpm dev:work                 # :3001  (lemone.work)
pnpm dev:chat                 # :3002  (lemone.chat)
./infra/dev-stop.sh           # hentikan semua proses dev
```

Setelah Owner aktif (login pertama wajib ganti sandi + OTP), set `BOOTSTRAP_ENABLED=false`.

Alur pertama: buka `http://localhost:3001/masuk` → Masuk dengan akun Lemone → `/user` → Buat akun → serahkan kredensial sekali-tampil → karyawan membuka `/activate?t=…` → Aktifkan akun → login IdP (ganti sandi) → `Akun aktif` → buka `http://localhost:3002`.

## Uji

```bash
pnpm --filter @lemone/api test        # unit: parser izin, delegasi peran
pnpm --filter @lemone/api test:e2e    # 19 skenario API terhadap stack berjalan (butuh API :4000, Keycloak, Postgres)
npx playwright install chromium       # sekali
pnpm --filter @lemone/api test:ui     # 10 langkah UI di Chromium headless (butuh API, worker, web :3001 dan :3002); bukti di docs/bukti/
```

Hasil terakhir dan cakupan ada di `docs/laporan.md`.

## Konfigurasi yang dibutuhkan

| Kebutuhan | Variabel / tempat | Status awal |
|---|---|---|
| Domain & TLS | `infra/prod/Caddyfile`, DNS `lemone.work`, `auth.lemone.work`, `lemone.chat` | Belum diverifikasi dari sesi ini |
| IdP | `OIDC_ISSUER`, `KC_PUBLIC_URL`, client secret via `pnpm idp:bootstrap` | Keycloak lokal berjalan |
| ERP | `ERP_ADAPTER=http`, `ERP_BASE_URL`, `ERP_API_KEY` (kontrak di `docs/api-contract.md`) | `demo` (DEMO) |
| Email undangan | belum ada penyedia | Belum terhubung (tautan tetap diserahkan manual) |
| Push notifikasi | belum ada penyedia (FCM/APNs) | Belum terhubung |
| AI | `AI_PROVIDER`, `AI_API_KEY` | `none` (asisten menjawab status saja) |
| Signing & distribusi mobile | akun Google Play/App Store, `apps/mobile/app.json` (bundle `chat.lemone.app`) | Belum ada |

## Deploy portal + Keycloak ke VPS (mode OIDC, lanjutan)

VPS yang sudah melayani lemone.work lewat nginx: jalankan sekali dari Mac, idempoten (aman diulang):

```bash
ssh ubuntu@43.133.129.111 'curl -fsSL https://raw.githubusercontent.com/gitstepbun/lemone/main/infra/deploy.sh | bash'
```

Skrip memasang Docker bila belum ada, clone repo ke `~/lemone`, membuat `.env` dengan secret acak, membangun dan menjalankan container (port hanya di 127.0.0.1), menyisipkan rute portal + IdP ke server block https `lemone.work` (portal di `/akun/user`, `/akun/activate`; Keycloak di `/auth`, konsol admin diblokir; path `/user` milik situs lama tidak disentuh), membuat situs `lemone.chat`, meminta sertifikat untuk `lemone.chat` bila DNS sudah mengarah ke VPS, lalu mencetak kredensial Owner pertama sekali. Situs lama di lemone.work tidak diubah selain penambahan `include`; berkas asli dicadangkan di `/etc/nginx/lemone-backups/`.

Prasyarat DNS: A record `lemone.chat` → IP VPS (saat ini masih parkir Hostinger). `lemone.work` sudah mengarah ke VPS; tidak perlu subdomain baru. Portal akun: https://lemone.work/akun/user

Opsi: `OWNER_EMPLOYEE`, `OWNER_USERNAME`, `ACME_EMAIL` sebagai variabel env sebelum `bash`.

## Staging/produksi dengan Caddy (server kosong)

```bash
docker compose -f infra/docker-compose.yml -f infra/prod/docker-compose.prod.yml --env-file .env up -d --build
```

Caddy menangani TLS untuk tiga host dan meneruskan `/api/*` serta `/ws` ke API. Keycloak berjalan di `auth.lemone.work` (`start`, hostname ketat). Backup/restore: `infra/backup.sh backup` / `infra/backup.sh restore <file>`.

## Prosedur

- **Bootstrap admin pertama**: `pnpm bootstrap:owner` (hanya saat `BOOTSTRAP_ENABLED=true`, tanpa password bawaan, tanpa pendaftaran publik). Pemulihan organisasi tanpa admin: sama, dengan `--force-recovery`, dicatat di audit.
- **Onboarding tanpa email**: HR membuat akun, memverifikasi penerima, menyerahkan username + kata sandi sementara + tautan aktivasi secara langsung. Kata sandi sementara wajib diganti di login pertama dan tidak disimpan portal.
- **Pemulihan akses**: di detail akun, "Mulai pemulihan akses" (kredensial sementara baru, semua sesi dicabut, tercatat audit). Nomor karyawan/tanggal lahir saja tidak dipakai untuk pemulihan.
- **Offboarding**: "Nonaktifkan akun" memblokir lokal seketika (API, WS, token lama), lalu job menonaktifkan user IdP, mencabut sesi IdP, dan registrasi push. Status sinkronisasi tampil di detail akun sampai semua komponen selesai.
- **Cabut akses Chat saja**: toggle CHAT di detail akun; aplikasi lain mengikuti grant yang masih berlaku.
