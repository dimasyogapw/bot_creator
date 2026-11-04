# Progres

| Fase | Status | Catatan |
|---|---|---|
| 0 Persiapan | belum | ikuti docs/SETUP.md |
| 1 Fondasi + playground | selesai (menunggu tes manual owner) | 1 migrasi menunggu persetujuan, lihat di bawah |
| 2 Knowledge | belum | |
| 3 Percakapan + memory | belum | |
| 4 Skills | belum | |
| 5 Publikasi | belum | |
| 6 Evals + analytics | belum | |
| 7 Telegram / WhatsApp | belum | |

## Keputusan penting
- 2026-11-04: Provider LLM default SumoPod, cadangan OpenRouter.
- 2026-11-04: Hosting: lokal untuk fase 1 sampai 4, Vercel Hobby mulai fase 5 (testing pribadi). Lihat docs/ARCHITECTURE.md.

## Hasil tes provider SumoPod (2026-11-04, `npm run check:provider`)
Semua 6 kebutuhan LULUS dengan `claude-sonnet-5-5`:
1. /models: 58 model, `claude-sonnet-5-5` dan `claude-haiku-5-5` tersedia.
2. Chat biasa: lulus. Catatan: model memakai token "berpikir" (reasoning) bawaan; `max_tokens` yang terlalu kecil (20) menghasilkan jawaban kosong. Batas token bot jangan terlalu kecil.
3. Streaming: lulus, token pertama sekitar 1,9 detik, jawaban panjang datang dalam 100+ potongan.
4. Tool calling + kirim hasil tool: lulus.
5. Embedding: `text-embedding-3-small` (1536 dimensi), `text-embedding-3-large` (3072), `gemini/gemini-embedding-001` (3072). Voyage tidak diperlukan. Pilihan final menunggu owner.
6. Usage: dikembalikan di chat biasa dan di akhir stream (stream juga menyertakan `cost`).
7. Bonus prompt caching: `cache_control` diteruskan, panggilan kedua membaca 14.013 dari 14.022 token dari cache.

## Fase 1 (2026-11-04)

### Selesai
- Login khusus owner: halaman `/setup` (sekali saja, hanya untuk `OWNER_EMAIL`) dan `/login` email + password.
  Akun hanya bisa masuk jika `app_metadata.role = "owner"` (diisi server), jadi akun hasil pendaftaran publik tetap ditolak.
- Migrasi `bots`, `conversations`, `messages`, `model_prices`, semuanya dengan RLS. Security advisor Supabase: bersih.
- Daftar bot (empty state, skeleton, error + coba lagi), buat/edit/hapus bot. Model dipilih dari `/models` SumoPod (cache 10 menit).
- Asisten "Bantu buatkan persona" (PRD diperbarui): kuesioner, lalu draf instruksi + pesan sambutan dari model ringan, bisa diedit sebelum dipakai.
- `lib/bot/runBot.ts`: satu fungsi inti chat, stream NDJSON, simpan token, token cache, biaya, latensi, waktu token pertama. Prompt caching aktif untuk model Claude.
- Playground: streaming, markdown + salin kode, stop, ulangi, salin, jempol, Enter/Shift+Enter, auto-scroll yang berhenti saat scroll ke atas, panel setelan (sheet di HP), riwayat percakapan.
- Test: 25 unit test (Vitest), 9 test end-to-end (Playwright) termasuk login, streaming, refresh, stop/ulangi, tampilan HP, hapus bot, penolakan akun non-owner.
- Bukti keamanan: secret SumoPod dan Supabase tidak ada di file browser hasil build (dicek per nilai kunci). Semua panggilan Supabase lewat server; publishable key pun tidak dikirim ke browser.

### Belum / catatan
- Migrasi `20261104130000_model_prices_owner_policy.sql` sudah ditulis tapi BELUM diterapkan ke database (connector Supabase meminta persetujuan owner dan waktunya habis). Tidak memblokir fitur fase 1.
- Pendaftaran publik di Supabase masih harus dimatikan manual oleh owner (langkah di laporan).
- Tabel `model_prices` masih kosong. Selama kosong, biaya diambil dari angka `cost` yang dikirim SumoPod di akhir stream. UI edit harga belum ada (tidak diminta di fase 1).
- Avatar memakai alamat gambar (https), belum upload file.
- Model embedding belum dipilih owner (rekomendasi: `text-embedding-3-small`, 1536 dimensi). Dibutuhkan di fase 2.

### Keputusan penting
- Komponen shadcn/ui ditulis manual dari template standar karena `ui.shadcn.com` diblokir jaringan Claude Code web. Gaya dan API sama.
- Font Geist dari paket npm `geist` (bukan Google Fonts) supaya build tidak butuh internet.
- `max_tokens` minimal 1024 karena model memakai token berpikir; nilai kecil menghasilkan jawaban kosong.
- Riwayat yang dikirim ke model dibatasi 20 pesan terakhir (ringkasan otomatis di fase 3).
- Bug ditemukan saat verifikasi dan sudah diperbaiki: (1) pindah tab cepat bisa tersangkut di halaman lama karena `loading.tsx` di level bot, dipindah ke per halaman; (2) panel setelan di HP melebar keluar layar oleh judul percakapan panjang; (3) avatar kosong tersimpan sebagai teks kosong.

(diisi Claude Code di akhir tiap fase)
