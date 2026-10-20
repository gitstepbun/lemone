# Lemone Chat DEMO (satu file HTML)

`lemone-chat-demo.html`: dibuka langsung di browser (klik dua kali), tanpa server, tanpa internet. Data di `localStorage` browser itu saja (kunci `lemonechat.demo.v1`), tidak tersinkron antar perangkat. Semua layar berlabel DEMO.

Yang bisa dicoba: daftar/masuk (pendaftar pertama = admin Owner + HR), DM, grup, @hr dengan deteksi izin dari teks ("izin tidak masuk besok karena ..."), kartu Menunggu/Disetujui/Ditolak/Dibatalkan dengan Ubah/Batalkan, tab HR (Setujui/Tolak), absensi DEMO (`DEMO-ATT-n`), Saya (jadwal 7 hari, pengajuan, ganti sandi, ganti pengguna), AI (jawaban dari daftar SOP DEMO, bukan model). Buka dua tab browser untuk melihat pembaruan antar pengguna.

Sumber: `lemone-chat-demo.template.html` (gambar diisi saat build). Uji: `pnpm --filter @lemone/api exec node --no-experimental-strip-types --import tsx ../../demo/uji-demo.ts` (Chromium headless, offline) → 12/12 PASS pada 20 Oktober 2026.
