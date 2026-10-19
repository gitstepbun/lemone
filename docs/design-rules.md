# Aturan desain web Lemone (Work & Chat)

Keputusan pemilik, berlaku tanpa ditanya ulang.

- Bahasa Indonesia, gaya langsung, tanpa jargon. Deskripsi sesedikit mungkin: tidak ada kalimat penjelas di bawah tombol/kolom/kartu.
- Jangan pakai tanda pisah panjang "—". Pakai "-".
- Tombol aksi utama: latar kuning Lemone `#FFCC00`, teks gelap `#1A1A1A`, hover `#E6B800`. Tombol sekunder: putih/abu dengan border. Tombol bahaya: teks merah `#B3261E`, border merah tipis.
- Tombol tidak full-width kecuali tombol utama halaman (mis. "Masuk dengan akun Lemone", "Aktifkan akun").
- Tidak ada sudut pill (border-radius 999px). Kolom & tombol 10px, kartu/panel 14-16px, tombol mengambang 16px.
- Merah `#B3261E` untuk hal penting/negatif. Status: hijau `#1B7F3B` (aktif/disetujui), kuning `#B07A00` (menunggu), abu `#6B7280` (nonaktif), merah (ditolak/perlu ditinjau).
- Toast: latar `#FFFCF7`, tinta gelap, ~2,4 detik, tumpukan maksimal 3.
- Semua dropdown bisa diketik untuk mencari (combobox).
- Halaman kosong tidak boleh buntu: selalu ada tindakan lanjut.
- Gambar ulang di halaman yang sama tidak melempar scroll ke atas.
- Font: sistem (`-apple-system, Segoe UI, Roboto, Inter, sans-serif`). Ukuran dasar 15px, judul 20-24px, label 13px.
- Responsif: nyaman di laptop dan ponsel. Tabel menjadi kartu di layar sempit.
- Status yang tampil ke pengguna: "Menunggu aktivasi", "Aktif", "Dinonaktifkan", "Perlu ditinjau". Rincian teknis job hanya di panel detail admin.
- Label koneksi: "Belum terhubung" untuk ERP/email/push/AI yang belum diisi; data contoh selalu berlabel "DEMO".
- Setiap tombol aktif punya fungsi nyata ke API. Tidak ada placeholder yang pura-pura berhasil.
- Navigasi Chat: Chat, AI, Saya, dan HR (hanya bagi yang berwenang).
