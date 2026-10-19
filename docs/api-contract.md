# Kontrak API Lemone (Work, Chat, HR)

Base URL: API berjalan di `API_PORT` (dev `http://localhost:4000`). Frontend memanggil lewat proxy same-origin `/api/*` (Next.js rewrite), sehingga cookie sesi bersifat host-only pada host aplikasi.

Semua respons JSON. Kesalahan: `{ code, message, ...extra }` dengan kode stabil: `UNAUTHENTICATED` (401), `ACCOUNT_PENDING`, `ACCOUNT_DISABLED`, `NO_APP_GRANT`, `FORBIDDEN`, `CSRF` (403), `NOT_FOUND` (404), `INVALID` (400), `ALREADY_EXISTS`, `USERNAME_TAKEN`, `LAST_ADMIN`, `NOT_PENDING`, `DUPLICATE_REQUEST`, `RACE` (409).

Autentikasi:
- Web: cookie sesi aplikasi (`lw_sid` untuk Work, `lc_sid` untuk Chat), `HttpOnly`, `SameSite=Lax`, `Secure` bila URL publik https. Permintaan selain GET wajib membawa header `X-Lemone-Request: 1`; `Origin` harus sama dengan URL publik aplikasi.
- Mobile/API: `Authorization: Bearer <access_token>` dengan `aud` berisi `lemone-api` (issuer dari discovery). ID token bukan pengganti access token. Token yang diterbitkan sebelum `users.tokens_not_before` ditolak.
- Setiap permintaan memeriksa: status akun `ACTIVE`, grant aplikasi `ACTIVE`, dan versi otorisasi. Menyembunyikan tombol di UI tidak cukup.

## Auth (BFF)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/auth/{work\|chat}/login?return=/path&activation=<id>&login_hint=<username>&prompt=login` | Mulai OIDC Authorization Code + PKCE S256. `state`/`nonce`/verifier disimpan dalam cookie sementara terenkripsi (10 menit). `return` hanya path relatif same-origin. |
| GET | `/auth/{app}/callback?code&state` | Tukar code, validasi issuer/audience/signature/nonce/state. Mengikat identitas (`issuer+sub`) ke akun. Hasil: redirect ke `return`, `/activate?status=done|mismatch|expired|revoked`, `/akun-belum-aktif`, atau `/masuk?error=<kode>` (`tidak_terdaftar`, `nonaktif`, `tanpa_akses`, `callback_ditolak`, `sesi_login_*`). |
| POST | `/auth/{app}/logout?sso=1` | Keluar dari aplikasi ini (mencabut sesi aplikasi). `sso=1` mengembalikan `redirect` ke end-session IdP. Respons: `{ ok, redirect, ssoEnded, note }`. |
| POST | `/auth/{app}/logout-all` | Keluar dari semua perangkat: semua sesi aplikasi dicabut, token lama ditolak, logout IdP dijadwalkan (job). |
| GET | `/auth/{app}/me` | `{ userId, username, displayName, employeeId, status, roles[], grants[], hrDivisions, canUseApp, authMode, idpConfigured, erpLabel }`. Akun pending tetap mendapat status (untuk pengarahan UI). |

## Aktivasi (publik)

| Method | Path | Keterangan |
|---|---|---|
| POST | `/activation/inspect` `{ token }` | Membaca undangan tanpa mengonsumsi. `{ status: VALID\|EXPIRED\|REVOKED\|USED\|INVALID\|IN_PROGRESS, username?, displayName?, expiresAt?, resumable? }`. Aman untuk pemindai tautan. |
| POST | `/activation/begin` `{ token }` | Reservasi atomik (satu proses per undangan). 200/201 `{ ok, activationId, username, loginUrl }` + cookie `lact` (konteks aktivasi, 30 menit). 409 `{ ok:false, status }`. Frontend lalu mengarahkan ke `loginUrl` (login IdP dengan `prompt=login`). |
| GET | `/activation/context` | Status konteks aktivasi pemegang cookie: `{ active, activationId, status, username, loginUrl }` (untuk halaman mismatch/lanjutkan). |

Aktivasi selesai hanya di callback: identitas IdP harus cocok dengan user yang diundang (`expected_idp_user_id`) dan belum terikat ke akun lain. Grant `PENDING` → `ACTIVE` hanya di sini.

## Work (portal, butuh grant WORK + peran OWNER/ACCOUNT_ADMIN/HR)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/work/status` | Status koneksi: `erp {adapter,label,connected,status}`, `idp`, `email`, `push`, `ai`, `counts`. Nilai `BELUM_TERHUBUNG` bila belum diisi. |
| GET | `/work/employees?q=` | Karyawan dari sumber resmi (ERP/DEMO) dalam cakupan aktor: `{ source, connected, items:[{ employeeId, fullName, division, position, managerEmployeeId, workStatus, hasAccount, accountStatus, suggestedUsername }] }`. |
| GET | `/work/accounts?q=&division=&status=&page=&pageSize=` | Daftar akun: `{ total, page, pageSize, divisions[], items:[{ id, employee_id, username, display_name, status, division, position, work_status, grants[], uiStatus }] }`. `uiStatus` ∈ `PENDING_ACTIVATION\|ACTIVE\|DISABLED\|PERLU_DITINJAU`. |
| POST | `/work/accounts` `{ employeeId, username, apps:[CHAT\|WORK], delivery: HR_HANDOVER\|EMAIL, roles?:[{role,scope}] }` | Buat akun + provisioning inline. Respons `{ userId, jobId, jobStatus, stage, error?, handover }`. `handover` (sekali-tampil, tidak disimpan): `{ username, temporaryPassword, activationUrl, expiresAt, delivery, emailStatus }`. |
| GET | `/work/accounts/:id` | Detail: `user`, `identity`, `grants`, `roles`, `hrAssignments`, `invitations`, `jobs` (tahap/status/kesalahan), `sessions`, `audit`, `syncStatus` (`SELESAI\|SEDANG_DIPROSES\|PERLU_DITINJAU`), `uiStatus`. |
| POST | `/work/accounts/:id/invitation` `{ delivery }` | Buat ulang undangan + kredensial sementara baru (membatalkan yang lama). Respons seperti pembuatan. |
| DELETE | `/work/accounts/:id/invitation` | Cabut undangan aktif. |
| POST | `/work/accounts/:id/grants` `{ app, enable }` | Beri/cabut akses aplikasi. Cabut: sesi aplikasi dicabut, WebSocket ditutup, push dijadwalkan. |
| POST | `/work/accounts/:id/roles` `{ role, scope }` | Tetapkan peran dalam delegasi aktor (lihat batas di bawah). |
| DELETE | `/work/accounts/:id/roles/:role` | Cabut peran. Peran admin dilindungi aturan administrator terakhir (`LAST_ADMIN`). |
| POST | `/work/accounts/:id/disable` `{ reason }` | Nonaktifkan: blokir lokal segera (status, sesi, token lama, WS), lalu job `DEACTIVATE_ACCOUNT` menonaktifkan user IdP, mencabut sesi IdP, dan registrasi push. |
| POST | `/work/accounts/:id/reactivate` | Aktifkan kembali (ditolak bila ERP `TERMINATED`). |
| DELETE | `/work/accounts/:id/sessions/:sid` | Cabut satu sesi aplikasi. |
| POST | `/work/accounts/:id/logout-all` | Keluar dari semua perangkat untuk akun itu. |
| POST | `/work/accounts/:id/recovery` | Pemulihan akses tanpa email oleh petugas berwenang: kredensial sementara baru (sekali-tampil), semua sesi dicabut, tercatat di audit. |
| GET | `/work/audit?limit=` | Audit organisasi (OWNER/ACCOUNT_ADMIN). |

Batas kewenangan (ditegakkan di `permissions.ts`, berlaku untuk UI, API, worker):
- OWNER: semua. ACCOUNT_ADMIN: akun dalam cakupan divisi; boleh beri CHAT/WORK; boleh tetapkan HR/APPROVER/EMPLOYEE dalam cakupannya; tidak boleh OWNER/ACCOUNT_ADMIN. HR: akun dalam cakupan; boleh beri CHAT (bukan WORK); boleh tetapkan APPROVER/EMPLOYEE.
- Tidak ada aktor yang boleh mengubah peran/akses/status dirinya sendiri.
- Administrator terakhir: perubahan yang menghilangkan OWNER/ACCOUNT_ADMIN penuh aktif terakhir ditolak; dua perubahan bersamaan diserialisasi lewat kunci baris `org_locks('admins')`.

## Chat (butuh grant CHAT)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/chat/me` | `{ userId, username, displayName, employeeId, roles[], isHr, isApprover, hrInbox, erpLabel, aiStatus }` |
| POST | `/chat/ws-ticket` | `{ ticket, expiresIn:60 }` → `GET ws(s)://<api>/ws?ticket=…`. Server memverifikasi status/grant/versi otorisasi saat connect dan tiap 30 detik; pencabutan menutup soket dengan kode 4401. |
| GET | `/chat/directory?q=` | Rekan kerja aktif dengan akses Chat + akun layanan (`verified: true`). |
| GET | `/chat/conversations` | Daftar percakapan: `{ id, type: DM\|GROUP\|HR_INBOX\|AI\|ANNOUNCEMENT, title, username, verified, myRole, memberCount, unread, lastMessage, lastMessageAt }`. Percakapan `@hr`, `@hr.ai`, `@lemone.ai` dibuat otomatis. |
| POST | `/chat/conversations/dm` `{ userId }` | Buka/buat DM (atau percakapan layanan). |
| POST | `/chat/conversations/group` `{ title, memberIds[] }` | Buat grup. |
| GET | `/chat/conversations/:id` | Detail + anggota. |
| POST | `/chat/conversations/:id/members` `{ memberIds[] }` | Tambah anggota (admin grup). |
| GET | `/chat/conversations/:id/messages?before=&after=&limit=` | Pesan berurutan `seq`. |
| POST | `/chat/conversations/:id/messages` `{ clientMsgId(uuid), kind: TEXT\|VOICE\|FILE, body, payload?, replyToId?, forwarded?, asService? }` | Kirim pesan; `clientMsgId` sama → `duplicate:true`, pesan tidak ganda. Di `HR_INBOX`, pesan karyawan menjalankan deteksi izin; respons memuat `detection { intent: LEAVE_REQUEST\|NEEDS_INFO\|AMBIGUOUS\|QUESTION\|NEGATION\|NONE, requestId? }`. Petugas HR membalas sebagai `@hr` (ditandai `via_username`). |
| POST | `/chat/conversations/:id/read` `{ seq }` | Tandai terbaca. |
| POST | `/chat/devices` `{ platform, label }` | Registrasi perangkat (push: `BELUM_TERHUBUNG`). |

Bentuk pesan: `{ id, conversation_id, seq, sender_user_id, sender_username, sender_name, sender_kind, via_username, client_msg_id, kind: TEXT\|SYSTEM\|CARD\|VOICE\|FILE, body, payload, reply_to_id, forwarded, created_at }`.

Kartu (`kind: CARD`, `payload.card`):
- `LEAVE_REQUEST`: `{ requestId, type, typeLabel, dateFrom, dateTo, dateLabel, shift, shiftLabel, reason, status, statusLabel, erpSync, erpSyncLabel, erpReference, version, actions: [UBAH, BATALKAN], decidedByName?, decisionNote? }`
- `ASK`: `{ askingFor: 'date', quickReplies: [...] }` (sistem meminta informasi minimum)
- `HINT`: `{ requestId }`

Event WebSocket: `{ event: ready\|message\|message.updated\|hr.queue\|pong, conversationId?, data }`.

## HR (butuh grant CHAT)

| Method | Path | Keterangan |
|---|---|---|
| GET | `/hr/requests/mine` | Pengajuan saya (kartu). |
| POST | `/hr/requests` `{ type, dateFrom, dateTo?, reason? }` | Pengajuan manual (tanpa AI/deteksi), kartu diposting ke inbox `@hr`. |
| POST | `/hr/requests/:id/update` `{ type?, dateFrom?, dateTo?, reason? }` | Ubah (pemilik; hanya saat menunggu/perlu dilengkapi). Versi naik, histori dicatat. |
| POST | `/hr/requests/:id/cancel` | Batalkan (pemilik). Bila sudah tercatat di ERP, koreksi dikirim via outbox; izin tetap berlaku sampai koreksi tercatat. |
| GET | `/hr/queue?status=PENDING_APPROVAL\|APPROVED\|REJECTED\|ALL` | Antrean keputusan untuk HR (cakupan divisi) atau atasan (`APPROVER`, bawahan langsung menurut ERP). |
| POST | `/hr/requests/:id/decide` `{ decision: APPROVED\|REJECTED, note? }` | Putuskan. Pengaju tidak bisa memutuskan sendiri. `APPROVED` → `erp_sync_status=PENDING` → worker mengirim ke ERP secara idempoten (`sourceRef = leave:<id>:v<versi>`). |
| GET | `/hr/attendance/mine` | Jadwal/shift hari ini dan catatan absensi (proyeksi ERP/DEMO) + `source`, `connected`. |

Status terpisah: `status` (keputusan permohonan) vs `erp_sync_status` (`NOT_SENT\|PENDING\|SYNCED\|FAILED\|AMBIGUOUS\|NOT_CONNECTED`). Hasil ambigu direkonsiliasi lewat `findAttendanceNote(sourceRef)` sebelum kirim ulang.

## Kontrak adapter ERP (`src/erp/erp.adapter.ts`)

`searchEmployees(q, limit)`, `getEmployee(id)`, `listEmployees()`, `getShift(id, date)`, `postAttendanceNote({ sourceRef, employeeId, dateFrom, dateTo, noteType, note, approvedByEmployeeId, approvedAt })` → `{ ok:true, reference, duplicate } | { ok:false, retryable, error } | { ok:'ambiguous', error }`, `findAttendanceNote(sourceRef)`.

Implementasi `http` memakai endpoint usulan `GET /v1/employees`, `GET /v1/employees/:id`, `GET /v1/employees/:id/shift`, `POST /v1/attendance/notes`, `GET /v1/attendance/notes/by-source/:ref`; sesuaikan saat API ERP Lemone tersedia. Tanpa `ERP_BASE_URL`/`ERP_API_KEY` adapter dilaporkan `Belum terhubung`.

## Job & outbox

Job (`ops.provisioning_jobs`, idempotency key, tahap, retry eksponensial, `NEEDS_REVIEW` bila tidak bisa dilanjutkan): `PROVISION_ACCOUNT` (VALIDATE_EMPLOYEE → SETUP_IDENTITY → SET_GRANTS → ISSUE_INVITATION), `REISSUE_INVITATION`, `DEACTIVATE_ACCOUNT` (IDP_DISABLE → IDP_LOGOUT → PUSH_REVOKE), `REVOKE_APP`, `LOGOUT_ALL`, `REACTIVATE_ACCOUNT`, `SYNC_IDP_ADMIN_ROLE`.

Outbox (`ops.outbox_events`): `ACCOUNT_ACTIVATED`, `HR_ASSIGNED`, `LEAVE_APPROVED`, `LEAVE_CANCELLED_AFTER_APPROVAL`.

Audit (`ops.audit_events`): aktor, tindakan, target, correlation id, hasil, detail (kunci yang menyerupai secret diredaksi). Tidak pernah memuat password, token undangan mentah, authorization code, access/refresh token.
