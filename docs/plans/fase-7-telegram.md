# Rencana Fase 7: Telegram (disusun 2026-11-07, menunggu persetujuan owner)

Fase 7 di PRD berisi Telegram, lalu WhatsApp, lalu Discord. Rencana ini HANYA untuk **Telegram**. WhatsApp dan Discord direncanakan sendiri setelah Telegram stabil dan disetujui owner (WhatsApp butuh langkah panjang di Meta, akan ditulis bernomor saat itu).

## Tujuan
Bot yang sama bisa dipakai di Telegram tanpa menduplikasi logika: knowledge, memory, dan skill berfungsi seperti di Playground. Percakapan Telegram muncul di tab Percakapan dengan channel Telegram.

## Cara kerja (ringkas)
1. Owner membuat bot di Telegram lewat BotFather, lalu menempel **token** di tab Publikasi bagian Telegram, dan menekan **Hubungkan**.
2. Aplikasi memeriksa token (`getMe`), menyimpannya terenkripsi (Supabase Vault, pola sama dengan header rahasia webhook: tidak pernah dikirim ke browser), membuat kode rahasia acak, dan mendaftarkan webhook otomatis (`setWebhook`) ke alamat Production.
3. Pesan masuk diterima di `POST /api/telegram/webhook/<id>`. Server memeriksa kode rahasia (`X-Telegram-Bot-Api-Secret-Token`, dibandingkan dengan aman), menolak jika salah, lalu langsung membalas 200 ke Telegram dan memproses lewat `after()`.
4. Pesan diteruskan ke `runBot` (channel `telegram`, pengguna `tg:<chat_id>`). Jawaban dikumpulkan lengkap, diubah ke format Telegram, dipecah jika panjang, dan dikirim balik.

## Fitur
- **Bagian Telegram di tab Publikasi**: status (tersambung/error), tautan `t.me/<username>`, token (kolom sandi, tidak pernah ditampilkan lagi), tombol Hubungkan, saklar aktif/nonaktif, tombol Putuskan (konfirmasi), waktu pesan terakhir, pesan error jelas.
- **Perintah**: `/start` (kirim pesan sambutan bot), `/baru` (mulai percakapan baru). Selain itu satu percakapan berlanjut per chat Telegram.
- **Format**: markdown jawaban diubah ke HTML Telegram (tebal, miring, kode, tautan, daftar). Jika Telegram menolak formatnya, dikirim ulang sebagai teks biasa. Pesan lebih dari 4096 karakter dipecah di batas paragraf tanpa memutus blok kode. Sumber knowledge ditulis sebagai baris "Sumber: judul, hal. N".
- **Indikator mengetik** (`sendChatAction`) selama bot berpikir.
- **Pesan non-teks** (gambar, suara, stiker, dokumen): dibalas "Maaf, saat ini aku hanya bisa membaca pesan teks." (konsisten dengan keputusan owner: tanpa gambar di channel publik).
- **Batas pemakaian**: batas pesan per menit per chat, pesan harian, dan biaya harian per bot yang sama dengan link publik (fungsi `bot_public_usage_today` sudah menghitung channel `telegram`). Batas tercapai: balasan ramah, model tidak dipanggil.
- **Anti-ganda**: Telegram mengirim ulang pesan jika balasan lambat. Setiap `update_id` hanya diproses sekali (tabel dedupe).

## Keputusan yang perlu owner (default saya di tanda panah)
1. **Siapa yang boleh chat dengan bot Telegram?** Siapa pun yang tahu username bot (dibatasi batas harian) -> **default**, sama dengan link publik. Alternatif: hanya chat ID tertentu (daftar izin), lebih aman untuk tahap uji pribadi tapi menambah satu bidang pengaturan.
2. **Grup Telegram**: bot hanya melayani chat pribadi; pesan dari grup diabaikan -> **default**.
3. **Gambar dan suara**: dibalas "belum bisa" -> **default** (bisa ditambah di fase lain).
4. **Satu bot aplikasi = satu bot Telegram** -> **default**.
5. **Balasan tidak di-stream** (dikirim utuh setelah selesai, karena Telegram tidak mendukung streaming token) -> **default**.

## Teknis
- **Migrasi** (RLS semua, tanpa `drop`): tabel `channel_connections` (id, bot_id, channel, enabled, status, bot_username, bot_telegram_id, last_error, last_message_at, timestamps; satu per bot per channel); tabel `channel_updates` (connection_id, update_id, created_at; kunci unik untuk dedupe, dibersihkan berkala); fungsi Vault khusus server untuk token dan kode rahasia (hanya `service_role`, pola `skill_secrets_server_only`). Channel `telegram` sudah ada di aturan `conversations` dan `end_users`.
- **Kode**: `lib/channels/telegram/` (klien API, pengubah markdown ke HTML + pemecah pesan, parser update dengan Zod, pengikat ke runBot), route webhook, aksi server (hubungkan, putuskan, aktif/nonaktif), komponen UI di tab Publikasi. Logika chat tetap hanya di `lib/bot/runBot.ts`.
- **Jaringan keluar** lewat `lib/net/safe-http.ts` dengan host yang diizinkan `api.telegram.org`. Alamat dasar API bisa diganti lewat env `TELEGRAM_API_BASE` KHUSUS test lokal (server tiruan di localhost, diabaikan di Vercel, pola sama dengan `E2E_ALLOW_PRIVATE_HOSTS`).
- **Rahasia**: token ada di alamat URL panggilan Telegram, jadi URL dan galat tidak pernah dilog atau dikirim ke browser (disensor). Token dan kode rahasia tidak ada di tabel biasa, HTML, atau log.
- **Middleware**: `/api/telegram/webhook/` dikecualikan dari login (autentikasi lewat kode rahasia), `X-Robots-Tag: noindex`.
- **Batas waktu**: route `maxDuration = 60`. Jawaban yang melewati ~50 detik dihentikan dan dibalas permintaan maaf (pekerjaan tetap tercatat).
- **Hanya Production**: Telegram butuh alamat HTTPS publik, dan Preview Vercel dilindungi login, jadi Telegram nyata hanya bisa di Production. Di lokal diuji dengan server tiruan.
- Tidak ada env baru di Vercel yang wajib.

## Langkah manual owner (dilakukan SETELAH kode di-merge dan Production aktif; saya ingatkan lagi saat itu)
1. Buka aplikasi Telegram, cari **@BotFather** (centang biru), tekan Start.
2. Kirim `/newbot`. Isi nama tampilan (bebas), lalu username unik yang berakhiran `bot` (mis. `kopisenja_tes_bot`).
3. BotFather membalas **token** (angka, titik dua, huruf). **Jangan kirim token ke chat Claude Code.**
4. Buka https://bot-creator-three.vercel.app, pilih bot, tab **Publikasi**, bagian **Telegram**, tempel token, tekan **Hubungkan**. Status harus berubah jadi "Tersambung".
5. Buka tautan `t.me/<username>` yang tampil, tekan Start, lalu coba tanya sesuatu.
6. Beri tahu saya. Saya cek percakapan masuk dan memandu 3 uji (knowledge, memory, skill).
Disarankan memakai bot Telegram khusus uji, bukan bot yang sudah dipakai orang lain.

## Definition of Done
1. Token ditempel, status "Tersambung", webhook terdaftar otomatis (Production, bersama owner).
2. Chat ke bot Telegram nyata: jawaban dari knowledge dengan sumber, memory (nama diingat di percakapan `/baru`), dan skill (mis. jam/tanggal) berfungsi seperti di Playground.
3. Percakapan muncul di tab Percakapan dengan channel Telegram.
4. Kode rahasia salah ditolak (tanpa memanggil model); update ganda hanya dibalas sekali.
5. Token tidak ada di HTML halaman, tabel biasa, atau log; owner lain dan pengunjung tanpa login tidak bisa membaca koneksi.
6. Batas per menit dan harian aktif di Telegram (balasan ramah, model tidak dipanggil).
7. Pesan panjang terpecah rapi, format tebal/kode tampil benar, fallback teks biasa jika format ditolak.
8. Putuskan: webhook dihapus di Telegram dan pesan berikutnya tidak diproses.
Plus unit test (pengubah format, pemecah pesan, parser, perbandingan rahasia, penyensoran token), test Playwright lokal dengan server Telegram tiruan, test Production, screenshot 375px dan 1440px, advisor keamanan Supabase, PR ke main.

## Di luar fase ini
WhatsApp dan Discord (rencana terpisah), Instagram (ditunda), grup, gambar/suara, tombol/kartu interaktif, streaming balasan, lebih dari satu bot Telegram per bot, daftar izin chat (kecuali owner memilih alternatif pada keputusan 1).

## Urutan kerja (komit kecil)
1. Migrasi dan fungsi Vault. 2. Klien Telegram, pengubah format, pemecah pesan (+ unit test). 3. Route webhook, dedupe, perintah, runBot. 4. Aksi hubungkan/putuskan dan UI Publikasi. 5. Test lokal dengan server tiruan + review keamanan. 6. Dokumen (ARCHITECTURE, SETUP bagian Telegram, PROGRESS, PRD). 7. PR, lalu test Production bersama owner.
