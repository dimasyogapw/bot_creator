# Progres

| Fase | Status | Catatan |
|---|---|---|
| 0 Persiapan | belum | ikuti docs/SETUP.md |
| 1 Fondasi + playground | berjalan | langkah pertama (tes provider) selesai, menunggu persetujuan owner |
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

(diisi Claude Code di akhir tiap fase)
