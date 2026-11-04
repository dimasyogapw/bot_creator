# Progres

| Fase | Status | Catatan |
|---|---|---|
| 0 Persiapan | belum | ikuti docs/SETUP.md |
| 1 Fondasi + playground | **selesai** (disetujui owner 2026-11-04) | live di https://bot-creator-three.vercel.app |
| 2 Knowledge | belum | |
| 3 Percakapan + memory | belum | |
| 4 Skills | belum | |
| 5 Publikasi | belum | |
| 6 Evals + analytics | belum | |
| 7 Telegram / WhatsApp | belum | |

## Keputusan penting
- 2026-11-04: Provider LLM default SumoPod, cadangan OpenRouter.
- 2026-11-04: Hosting: lokal untuk fase 1 sampai 4, Vercel Hobby mulai fase 5 (testing pribadi). Lihat docs/ARCHITECTURE.md.
- 2026-11-04 (revisi): Vercel Hobby dipakai mulai fase 1, karena laptop owner tidak bisa menjalankan aplikasi. Region `sin1`. Langkah di docs/SETUP.md bagian F.
- 2026-11-04: Model default bot diganti dari Sonnet ke Haiku 5.5 (biaya sekitar 1/20).
- 2026-11-04: Akun owner dibuat owner sendiri di dashboard Supabase (password tidak pernah lewat chat), lalu role owner dipasang oleh Claude Code.

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
- Migrasi `20261104130000_model_prices_owner_policy.sql` sudah diterapkan (2026-11-04, disetujui owner). Advisor performa dan security bersih, kecuali saran opsional "Leaked password protection".
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

### Pengecekan ulang (sesi Claude Code web, 2026-11-04)
- Laptop owner memblokir file native hasil npm (Windows Application Control), jadi aplikasi, test, dan build tidak bisa jalan di laptop. Semua eksekusi dilakukan di Claude Code web; laptop hanya `git pull` dan membaca.
- Install bersih (`npm ci`), lint, typecheck, 25 unit test, build, dan 9 test end-to-end: semua lulus.
- `npm run dev` + Playwright: halaman login dan daftar bot tampil di 1440px dan 375px, tanpa error di browser.
- Akun owner BELUM dibuat. Migrasi `model_prices_owner_policy` masih BELUM diterapkan.
- Akibat batasan laptop, tes manual owner di `localhost` tidak mungkin. Keputusan hosting (lokal untuk fase 1 sampai 4) perlu ditinjau ulang oleh owner.

### Uji banding model (2026-11-04)
Persona travel umroh, 5 uji (jawab dari data, bilang tidak tahu, tolak topik luar, tolak prompt injection, tool calling). Biaya dari angka `cost` SumoPod.

| Model | USD per 5 uji | Token pertama | Lulus |
|---|---|---|---|
| claude-sonnet-5-5 | 0,0204 | ~2,3 dtk | 5/5 |
| claude-haiku-5-5 | 0,0010 | ~1,6 dtk | 5/5 |
| deepseek-v4-flash | 0,0008 | ~2,6 dtk | 5/5 |
| qwen3.8-flash | 0,0009 | ~3,1 dtk | 5/5 |
| deepseek-v4-pro | 0,0044 | ~3,8 dtk | 5/5 |
| gpt-5.4-mini | 0,0055 | ~2,6 dtk | 4/5 (menulis kode Python di luar topik) |
| gemini/gemini-3.5-flash | 0,0113 | ~4,3 dtk | 5/5 |

Keputusan: default bot `claude-haiku-5-5` (murah, tercepat, prompt caching jalan). Cadangan: `deepseek-v4-flash`. Sampel kecil; dievaluasi ulang dengan eval set di fase 6.

(diisi Claude Code di akhir tiap fase)
