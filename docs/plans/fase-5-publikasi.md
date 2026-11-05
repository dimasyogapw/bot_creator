# Rencana Fase 5: Publikasi (disusun 2026-11-05, disetujui owner 2026-11-05)

## Tujuan
Orang lain bisa chat dengan bot owner lewat link publik dan widget di website mana pun, dengan pengaman biaya dan spam yang aktif sebelum link dibagikan.

## Fitur
1. **Tab Publikasi** per bot:
   - Saklar "Publikasikan bot" (`is_public`). Mati secara bawaan.
   - Link publik `/c/<slug>` dengan tombol salin.
   - Kode embed widget siap salin, dengan pratinjau. Pengaturan: warna, posisi (kanan/kiri bawah), teks tombol, pesan sambutan.
   - Daftar domain yang boleh memasang widget.
   - Batas: biaya harian per bot (USD), jumlah pesan harian per bot, pesan per menit per pengunjung. Pesan saat batas tercapai bisa diubah.
2. **Halaman chat publik** `/c/<slug>`: tampilan penuh (nama, avatar, pesan sambutan), streaming, sitasi, tombol stop, jempol, chat baru. Tanpa login. Tanpa panel setelan.
3. **Widget**: satu tag `<script>` memunculkan tombol chat di pojok, membuka jendela chat (iframe ke `/embed/<slug>`). Ringan, tidak mengganggu tampilan website pemasang.
4. **Pengunjung anonim**: ID acak di browser pengunjung (localStorage), tercatat sebagai end user channel `web` atau `widget`. Memory, knowledge, dan skill bot berlaku sama seperti di Playground. Percakapan muncul di tab Percakapan dengan channel Link publik / Widget.
5. **Pengaman**:
   - Rate limit per pengunjung/IP (bawaan 20 pesan/menit), batas pesan harian per bot (bawaan 300), batas biaya harian per bot (bawaan USD 1). Batas tercapai: bot membalas pesan ramah, model tidak dipanggil.
   - Bot yang tidak dipublikasikan: halaman dan API publik membalas "tidak ditemukan".
   - Respons publik hanya berisi teks jawaban, sitasi, dan status. Tidak pernah berisi system prompt, konfigurasi skill, model, token, biaya, atau data pengunjung lain.
   - Pengunjung hanya bisa melanjutkan percakapannya sendiri.
   - Widget hanya bisa ditampilkan di domain yang diizinkan (header `frame-ancestors`).
   - Input divalidasi Zod, panjang pesan dibatasi.

## Keputusan owner (2026-11-05, ikut semua rekomendasi)
1. Batas bawaan per bot: USD 1 per hari, 300 pesan per hari, 20 pesan per menit per pengunjung (bisa diubah per bot).
2. Gambar dari pengunjung publik: dimatikan dulu (tetap ada di Playground).
3. Pemberitahuan privasi singkat ditampilkan di halaman publik dan widget.
4. Skill di channel publik sama dengan pengaturan bot (tidak ada pengaturan terpisah).
- Batas harian (pesan dan biaya) hanya menghitung channel publik; pemakaian owner di Playground tidak ikut dibatasi.

## Teknis
- Migrasi: kolom batas dan pengaturan widget di `bots` (atau `settings`), tabel `rate_limits` (hitungan per kunci per jendela waktu) dengan fungsi atomik yang hanya bisa dipanggil server. RLS aktif.
- Channel publik memakai `runBot` yang sama (tidak ada logika chat baru). Karena pengunjung tidak login, server memakai secret key Supabase dengan pengecekan eksplisit: bot harus `is_public`, percakapan harus milik bot dan pengunjung itu.
- Rute publik dikecualikan dari login di middleware. Halaman publik `noindex`.
- Biaya harian dihitung dari `messages.cost_usd` hari ini (WIB). Biaya ekstraksi memory/ringkasan belum ikut dihitung (dicatat sebagai batasan).
- IP pengunjung dari header proxy standar (`x-forwarded-for` / `x-real-ip`), tidak terkunci ke Vercel.

## Definition of Done
1. Link publik dibuka di mode incognito (tanpa login), bisa chat dengan streaming.
2. Widget ditempel di file HTML tes, tombol muncul dan chat berfungsi.
3. 30 pesan cepat: rate limit aktif dengan pesan ramah.
4. Bot yang tidak dipublikasikan mengembalikan halaman tidak ditemukan (halaman dan API).
5. Batas biaya harian tercapai: bot membalas pesan fallback tanpa memanggil model.
6. Halaman/API publik tidak membocorkan system prompt (diuji dengan kode rahasia di system prompt dan upaya prompt injection), konfigurasi skill, atau percakapan pengunjung lain.
7. Widget ditolak tampil di domain yang tidak diizinkan.
8. Percakapan publik muncul di tab Percakapan dengan channel yang benar.
Plus unit test, test Playwright (lokal dan Production), screenshot 375px dan 1440px, review keamanan, PR ke main.

## Di luar fase ini
- Telegram, WhatsApp, Discord (fase 7).
- Bot mengirim kartu/tombol/gambar (dikerjakan bersama channel di fase 7; widget fase 5 menampilkan markdown seperti Playground).
- Login pengunjung, domain kustom.
