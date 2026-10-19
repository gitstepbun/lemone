# Laporan status: Lemone Work Accounts & Lemone Chat

Tanggal: 19 Oktober 2026. Lingkungan uji: workspace Linux (Docker: Postgres 16, Keycloak 26.2), API NestJS :4000, Next.js :3001/:3002, Node 22. Seluruh uji dijalankan ulang pada stack yang dibangun dari nol mengikuti README (`infra:up` → migrate → seed → idp:bootstrap → bootstrap:owner): PASS.

## Sudah berfungsi dan diuji (PASS)

Uji alur penuh `pnpm --filter @lemone/api test:e2e` menjalankan 19 skenario terhadap stack yang hidup (Keycloak nyata, form login/ganti sandi/OTP dikemudikan headless, callback OIDC diproses API). Hasil terakhir: **19/19 PASS**.

| # | Skenario (mengacu uji penerimaan §14) | Status | Bukti |
|---|---|---|---|
| S1 | Owner: provisioning → aktivasi (ganti sandi + OTP wajib) → masuk portal Work | PASS | langkah: login form > configure OTP > update password |
| S2 | Buat akun Sari (CHAT): kredensial sekali-tampil; inspect tidak mengonsumsi undangan (uji 2) | PASS | temp cred hanya di respons; invitation tetap PENDING; token salah → INVALID |
| S3 | Kredensial sementara dipakai langsung di IdP tidak membuka API sebelum aktivasi; CSRF tanpa header ditolak (uji 2) | PASS | login IdP langsung → `/akun-belum-aktif`, tanpa sesi; `/chat/me` 401; CSRF 403 |
| S4 | Aktivasi lewat undangan → ACTIVE → masuk Chat via SSO → token dipakai ulang ditolak (uji 1, 2, 14) | PASS | SSO tanpa form login kedua; inbox `@hr` dibuat |
| S5 | Akun HR Rina (CHAT+WORK, HR Produksi+HR) → aktivasi → petugas inbox (uji 1) | PASS | Rina OFFICER pada inbox @hr milik Sari |
| S6 | Deteksi izin: kalimat jelas → PENDING_APPROVAL + kartu Ubah/Batalkan; "izin tanya" dan pesan terusan tidak jadi pengajuan; "izin" tanpa tanggal → tanya tanggal → "besok" melengkapi (uji 15) | PASS | request IZIN 2026-10-21 dengan alasan |
| S7 | Pesan idempoten (clientMsgId sama → tidak ganda) dan persisten; bukan anggota 403 (uji 14) | PASS | duplicate=true, id sama |
| S8 | Pengaju tidak bisa menyetujui sendiri; HR menyetujui → APPROVED; worker mengirim ke ERP DEMO → SYNCED; kirim ulang tidak menggandakan catatan; keputusan kedua ditolak (uji 15, 16) | PASS | ref DEMO-ATT-n, jumlah catatan tetap |
| S9 | Penolakan tidak menulis absensi; pembatalan mempertahankan histori; pembatalan setelah tercatat mengirim koreksi (uji 15, 16) | PASS | histori CREATED → APPROVED → CANCELLED |
| S10 | WebSocket: tiket valid tersambung; cabut akses Chat menutup WS (4401), API ditolak, tiket lama ditolak; grant ulang memulihkan; akses WORK orang lain tetap (uji 6, 11) | PASS | |
| S11 | Delegasi: HR tidak bisa memberi OWNER/ACCOUNT_ADMIN/WORK, tidak bisa mengubah peran sendiri; APPROVER dalam cakupan OK; cakupan luar 403 (uji 7) | PASS | |
| S12 | Undangan B dibuka saat masuk sebagai A → `status=mismatch`, akun tidak digabung (uji 4) | PASS | Dedi tetap PENDING, binding Rina utuh |
| S13 | Buat ulang undangan membatalkan yang lama; undangan dicabut → inspect REVOKED, begin 409 (uji 2) | PASS | |
| S14 | Dua aktivasi bersamaan dengan token sama: satu 201, satu 409; satu aktivasi hidup (uji 3) | PASS | |
| S15 | Callback dengan state salah ditolak; `return` di luar allowlist dinormalkan ke `/` (uji 9) | PASS | |
| S16 | Nonaktifkan akun: API & WS ditolak seketika; worker menonaktifkan user IdP; login IdP gagal; push ditandai BELUM_TERHUBUNG (uji 8, 12) | PASS | job DEACTIVATE_ACCOUNT DONE |
| S17 | IdP timeout saat provisioning → retry melanjutkan job yang sama, menemukan user IdP via referensi `lemone_user_id`, tanpa identitas/undangan ganda (uji 3, 13) | PASS | |
| S18 | Dua Owner saling mencabut peran bersamaan → tepat satu berhasil, satu `LAST_ADMIN` (uji 8) | PASS | |
| S19 | Audit tidak memuat password/token; log akses meredaksi token (uji 17) | PASS | 250+ baris audit diperiksa |

### Uji UI di browser (Chromium headless, `pnpm --filter @lemone/api test:ui`): **10/10 PASS**

Bukti tangkapan layar di `docs/bukti/`.

| # | Langkah | Status | Bukti |
|---|---|---|---|
| U1 | Halaman `/activate` membaca undangan; token dibersihkan dari URL | PASS | 01-aktivasi.png |
| U2 | "Aktifkan akun" → login Keycloak (tema Lemone, Bahasa Indonesia) → ganti sandi sementara → "Akun aktif" | PASS | 02-login-idp.png, 03-ganti-sandi.png, 04-akun-aktif.png |
| U3 | Buka Lemone Chat → "Masuk dengan akun Lemone" via SSO (tanpa sandi kedua) → daftar chat dengan `@hr`, `@hr.ai`, `@lemone.ai` terverifikasi | PASS | 05-chat-daftar.png |
| U4 | Kirim "Saya izin tidak masuk besok karena urusan keluarga" ke `@hr` → kartu: jenis, tanggal, shift, alasan, Menunggu persetujuan, tombol Ubah/Batalkan | PASS | 06-kartu-izin.png |
| U5 | Tab Saya: Pengajuan saya + Jadwal & absensi berlabel DEMO | PASS | 07-saya.png |
| U6 | Portal Work `/user`: daftar akun, strip koneksi "DEMO · Belum terhubung", "Email/Push/AI · Belum terhubung" | PASS | 08-work-daftar.png |
| U7 | Buat akun 5 langkah (pilih karyawan dari sumber DEMO, username otomatis, akses, penyerahan, ringkasan) → panel kredensial sekali-tampil | PASS | 09-wizard-1.png, 10-wizard-ringkasan.png, 11-handover.png |
| U8 | Detail akun: Menunggu aktivasi, undangan, akses, peran, sesi, tindakan, riwayat | PASS | 12-detail-akun.png |
| U9 | Karyawan kedua (Sari) aktivasi di browser terpisah, mengirim izin bertanggal ke `@hr` | PASS | 13-sari-kartu.png |
| U10 | HR (Rina) menyetujui di tab HR → kartu Sari berubah "Disetujui" lewat WebSocket, lalu "Tercatat di absensi" setelah worker mengirim ke ERP DEMO; tab Disetujui terisi | PASS | 14-hr-antrean.png, 15-sari-disetujui.png, 16-hr-disetujui.png |

Catatan: klik tombol diuji lewat Playwright pada Chromium headless, bukan pada Chrome/Safari pengguna nyata; tampilan ponsel diuji pada viewport 420px.

Unit (`pnpm --filter @lemone/api test`): 17 tes PASS (parser izin Bahasa Indonesia: tanggal absolut/relatif/rentang/nama hari, pertanyaan, negasi, kutipan/terusan, "izin" sebagai kata sopan; delegasi peran dan username dilindungi).

## Keputusan desain yang ditetapkan

- Satu identitas: `users.id` permanen, `employee_id` dari sumber resmi, pemetaan OIDC `issuer+sub` unik. Username/nama/email tidak dipakai sebagai dasar kepemilikan.
- Web memakai BFF: token disimpan terenkripsi (AES-256-GCM) di `application_sessions`, cookie host-only `HttpOnly` `SameSite=Lax`; CSRF via header `X-Lemone-Request` + cek Origin. Mobile memakai public client PKCE, Bearer dengan audience `lemone-api`.
- Aktivasi: token acak 32 byte, hanya hash disimpan, masa berlaku 24 jam, reservasi atomik, GET/inspect tidak mengonsumsi, selesai hanya bila identitas IdP = user yang diundang. Kredensial sementara dan token mentah hanya ada di respons pembuatan (tidak disimpan); "Buat ulang undangan" menghasilkan yang baru.
- MFA: realm role `lemone-admin` disinkronkan untuk OWNER/ACCOUNT_ADMIN; browser flow Keycloak mewajibkan OTP untuk role itu (diuji S1).
- Pencabutan: pemblokiran lokal seketika (status, `authz_version`, `tokens_not_before`, sesi, WS), pekerjaan persisten untuk IdP/push; status sinkronisasi ditampilkan, tidak diklaim selesai sebelum job DONE.
- HR: `@hr` inbox layanan; petugas membalas dengan akun pribadi (ditandai `via @hr`), keputusan terekam atas nama petugas. Deteksi izin deterministik (tanpa AI) hanya pada kanal HR. Status keputusan terpisah dari status sinkron ERP; pengiriman idempoten (`sourceRef`), hasil ambigu direkonsiliasi.
- Persetujuan otomatis berbasis kebijakan: tidak ada (default nonaktif).

## Belum terhubung / berlabel DEMO

| Komponen | Keadaan | Yang dibutuhkan |
|---|---|---|
| ERP Lemone | Adapter `demo` (data karyawan contoh berlabel DEMO, catatan absensi di `ops.erp_demo_attendance_notes`) | `ERP_ADAPTER=http`, `ERP_BASE_URL`, `ERP_API_KEY`, dan penyesuaian path endpoint di `http-erp.adapter.ts` sesuai API ERP |
| Email undangan | Belum terhubung; tautan + kredensial tetap diserahkan manual | Penyedia email + templat |
| Push notifikasi | Registrasi perangkat ada, pengiriman belum | FCM/APNs; payload generik |
| AI (`@lemone.ai`, `@hr.ai`) | Stub: menjawab status "belum terhubung" dan mengarahkan ke `@hr` | `AI_PROVIDER`, `AI_API_KEY`, kebijakan konteks (data kesehatan diarahkan ke HR) |
| Voice note | Pesan tersimpan sebagai VOICE; interpretasi/konfirmasi belum ada | Jalur transkripsi privat |
| Domain, DNS, TLS, hosting | Tidak dapat diverifikasi dari sesi ini | Akses DNS/hosting; `infra/prod/Caddyfile` siap |

## Belum diuji (NOT TESTED) / terhalang

| Hal | Status | Keterangan |
|---|---|---|
| Login dan callback Android/iOS pada perangkat | NOT TESTED | `apps/mobile` berisi konfigurasi client, PKCE via browser sistem, SecureStore, deep link `lemone.chat://oauth/callback` dan App Link `https://lemone.chat/mobile/callback`. Belum ada SDK Android/Xcode di lingkungan ini; belum ada build, signing, atau pengajuan ke toko. |
| Fitur Chat di luar alur utama: grup, DM antar karyawan, lampiran, voice note, pencarian pesan, logout dari semua perangkat di UI | NOT TESTED di browser | Endpoint tersedia dan dipanggil UI; DM/grup diuji di API (S7), belum diklik di browser. |
| Deployment staging/HTTPS | NOT TESTED | Konfigurasi Caddy + compose produksi tersedia, belum pernah dijalankan ke domain nyata. |
| Backup/restore | NOT TESTED | Skrip `infra/backup.sh` ada; belum dijalankan terhadap data nyata. |
| Perubahan username | Tidak disediakan | Username tetap setelah dibuat (uji 5 tercakup secara struktural: kepemilikan data memakai `user_id`). |

## Keputusan yang masih memerlukan informasi nyata

1. Bentuk API ERP (endpoint karyawan, shift, catatan absensi) untuk mengganti adapter DEMO.
2. Kanal penyerahan undangan selain tatap muka (email perusahaan/WhatsApp resmi).
3. Akun developer Google Play/App Store dan metode distribusi privat.
4. Penyedia AI dan kebijakan data (apakah konten HR boleh diproses pihak ketiga).
5. Siapa pemegang Owner pertama di produksi (dijalankan via `bootstrap:owner` saat pilot).
