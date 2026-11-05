# Rencana Fase 3: Percakapan + Memory (disusun 2026-11-05, disetujui owner 2026-11-05)

## Tujuan
Owner bisa melihat semua percakapan, dan bot mengingat fakta penting tentang tiap end user antar percakapan.

## Fitur
1. **Tab Percakapan**: daftar semua percakapan bot (judul, channel, end user, jumlah pesan, jumlah jempol atas/bawah, waktu terakhir), filter per channel dan filter "ada jempol bawah", halaman detail (transkrip lengkap, sitasi, kueri pencarian knowledge, token/biaya/latensi per jawaban), feedback jempol bisa diubah dari detail.
2. **Ringkasan otomatis riwayat panjang**: jika pesan yang belum diringkas lebih dari 30, pesan lama diringkas oleh model ringan. Yang dikirim ke model: ringkasan + 10 pesan terakhir.
3. **Memory per end user**:
   - Setelah setiap jawaban bot, di background, model ringan membaca pesan baru + memory yang sudah ada, lalu memutuskan: tambah, perbarui, atau hapus memory (mis. "suka kopi hitam" diganti "sekarang suka teh").
   - Memory end user dimasukkan ke konteks percakapan berikutnya sebagai data (bukan instruksi). Maksimal 50 memory per end user, diurutkan menurut kepentingan dan waktu.
   - Data sensitif ditolak dua lapis: instruksi ke model ringan, lalu filter di server (password/PIN/OTP, nomor kartu dengan cek Luhn, NIK 16 digit, nomor rekening).
4. **Toggle memory per bot** (on/off). Jika off: memory tidak dibaca dan tidak dibuat. Memory lama tidak dihapus otomatis.
5. **Tab Memory**: daftar end user dan memory-nya, hapus satu memory, hapus semua memory satu end user (dengan konfirmasi).
6. **Playground**: owner dianggap satu end user tetap per bot ("Owner (playground)"), supaya DoD bisa diuji. Panel setelan menampilkan status memory.

## Keputusan owner (2026-11-05)
- Memory **mati secara bawaan**, dinyalakan per bot (bot lama juga mati sampai dinyalakan).
- Hapus percakapan: **belum** di fase ini.
- Playground: **satu identitas** owner per bot. Pemisahan memory antar end user diuji otomatis.

## Teknis
- Migrasi:
  - `end_users` (id, bot_id, channel, external_id, display_name, created_at, last_seen_at), unik per (bot_id, channel, external_id).
  - `memories` (id, bot_id, end_user_id, content maks 500 karakter, importance 1 sampai 5, source_conversation_id, created_at, updated_at).
  - `conversations`: foreign key `end_user_id` ke `end_users`, kolom `summary`, `summary_until`, `memory_until` (batas pesan yang sudah diringkas/diekstrak).
  - `bots`: kolom `memory_enabled`.
  - Isi `end_user_id` untuk percakapan playground lama (owner).
  - Semua tabel RLS lewat kepemilikan bot. Index untuk foreign key.
- `runBot` menerima identitas end user dari channel (playground: `owner`). Channel publik/Telegram nanti cukup mengirim identitasnya sendiri.
- Pekerjaan background (ekstraksi memory, ringkasan) dijalankan setelah jawaban terkirim lewat `after()` dari Next.js (jalan di Vercel dan server biasa). `runBot` hanya menerima fungsi "jalankan nanti" dari channel, jadi tidak terkunci ke Vercel. Setiap tugas kecil dan aman terhadap batas waktu.
- Prompt caching tetap jalan: memory diletakkan di blok terpisah setelah system prompt statis yang di-cache.
- Semua output model ringan divalidasi Zod. Jika gagal, memory tidak diubah (tidak pernah menghapus karena output rusak).
- Ekstraksi hanya membaca pesan sejak `memory_until`, jadi memory yang sudah dihapus owner tidak muncul lagi dari pesan lama.

## Definition of Done
1. Di percakapan A owner bilang "nama saya Budi, suka kopi hitam". Di percakapan baru B, bot tahu nama dan minumannya.
2. Memory dihapus di tab Memory, lalu di percakapan baru bot benar-benar lupa.
3. Bot dengan memory dimatikan tidak mengingat apa pun (dan tidak membuat memory baru).
4. Tab Percakapan menampilkan percakapan, filter channel berfungsi, detail dan feedback berfungsi.
5. Percakapan panjang (lebih dari 30 pesan) tetap dijawab, dan ringkasan tersimpan.
6. Data sensitif (contoh nomor kartu, NIK) tidak masuk memory.
Plus unit test, test Playwright, screenshot 375px dan 1440px, review keamanan, PR ke main.

## Di luar fase ini
- End user publik, widget, Telegram (fase 5 dan 7). Struktur sudah siap untuk itu.
- Biaya model ringan (ekstraksi/ringkasan) belum dicatat per pesan; dibahas di fase 6 analytics.
