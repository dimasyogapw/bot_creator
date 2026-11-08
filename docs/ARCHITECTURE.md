# Arsitektur

## Stack
- **Frontend + backend**: Next.js (App Router, TypeScript). Fase 1 sampai 4 jalan lokal; deploy ke Vercel mulai fase 5.
- **UI**: Tailwind CSS + shadcn/ui.
- **Database, auth, storage, vektor**: Supabase (Postgres + pgvector + Storage + Auth).
- **LLM**: lewat API OpenAI-compatible memakai package `openai` dengan `baseURL` yang bisa diganti.
  - **Provider default: SumoPod** (`https://ai.sumopod.com/v1`). Cadangan: OpenRouter (`https://openrouter.ai/api/v1`).
  - Semua akses LLM lewat satu modul `lib/llm/provider.ts`. Ganti provider cukup lewat environment variable, tanpa ubah kode lain.
  - Model dipilih per bot dari daftar model yang diambil dari endpoint `/models` provider (jangan hardcode nama model).
  - Default bot: **Claude Haiku 5.5** (`claude-haiku-5-5`), diputuskan 2026-11-04 setelah uji banding 7 model (lihat PROGRESS.md). Model bisa diganti per bot kapan saja. Tugas ringan (ringkasan, ekstraksi memory, judul percakapan) juga memakai Haiku. Nama model diatur di env `LLM_DEFAULT_MODEL` dan `LLM_LIGHT_MODEL`.
- **Embedding**: endpoint `/embeddings` di provider yang sama (SumoPod). Nama model dan dimensi vektor diatur lewat env `EMBEDDING_MODEL` dan `EMBEDDING_DIMENSIONS`. Jika SumoPod tidak mendukung embedding dengan baik (hasil tes fase 1), pakai Voyage AI sebagai cadangan.

## Kebutuhan wajib dari provider (dites di fase 1 dengan `npm run check:provider`)
1. Daftar model (`/models`) bisa diambil.
2. Chat biasa berhasil.
3. Streaming berhasil.
4. Tool calling (function calling) berhasil, termasuk mengirim hasil tool dan mendapat jawaban akhir.
5. Embedding berhasil dan dimensinya tercatat.
6. Penggunaan token (`usage`) dikembalikan, untuk hitung biaya.
Jika poin 3 atau 4 gagal, berhenti dan laporkan ke owner sebelum lanjut.
- **Validasi**: Zod untuk semua input API.
- **Test**: Vitest (unit), Playwright (end-to-end).

## Keputusan hosting (ditetapkan 2026-11-04, diperbarui 2026-11-04)
- Status pemakaian: **testing pribadi owner**, belum untuk bisnis.
- **Mulai fase 1**: deploy ke **Vercel paket Hobby (gratis)**. Region fungsi: Singapura (`sin1`, diatur di `vercel.json`), dekat dengan Supabase.
  Alasan perubahan: laptop owner memblokir file native hasil npm (Windows Application Control), jadi aplikasi tidak bisa dijalankan lokal dan owner butuh URL online untuk tes manual.
- Eksekusi kode (lint, test, build, Playwright) dikerjakan di Claude Code web. Laptop owner hanya `git pull` dan membaca.
- Sebelum fase 5, dashboard di Vercel hanya bisa dimasuki akun ber-role owner, dan belum ada endpoint publik.
- Proses panjang (olah dokumen knowledge, ekstraksi memory) harus dirancang aman terhadap batas waktu fungsi Vercel: pecah jadi langkah kecil atau antrean, jangan satu proses panjang.
- Jangan menulis kode yang mengunci ke fitur khusus Vercel, supaya bisa pindah ke VPS (Hostinger KVM 2 + Coolify, atau SumoPod) tanpa tulis ulang.
- Tinjau ulang keputusan ini jika bot mulai dipakai untuk bisnis atau butuh n8n/WhatsApp di server yang sama.

## Prinsip
1. Semua panggilan LLM dan embedding hanya dari server (Route Handler / Server Action). Tidak ada API key di client.
2. Satu fungsi inti `runBot(botId, conversationId, userMessage)` yang dipakai oleh SEMUA channel (playground, link publik, widget, Telegram, WhatsApp). Channel hanya adapter.
3. Kalau provider mendukung prompt caching untuk model Claude, gunakan untuk system prompt dan bagian statis. Kalau tidak, catat di PROGRESS.md dan jaga system prompt tetap ringkas.
4. Biaya per pesan dihitung dari `usage` dikali harga model yang disimpan di tabel/konfigurasi `model_prices` (bisa diedit owner).
5. Semua tabel memakai Row Level Security. Owner bisa akses semuanya; endpoint publik memakai secret key Supabase (format baru `sb_secret_`, bukan legacy service_role) di server dengan pengecekan eksplisit.
6. Setiap migrasi database disimpan sebagai file SQL di `supabase/migrations/`.

## Model data (awal, boleh diperbaiki saat plan)
```
bots            id, name, slug, avatar_url, system_prompt, model, temperature,
                max_tokens, welcome_message, is_public, memory_enabled, daily_cost_limit_usd,
                daily_message_limit, per_minute_limit, limit_message, widget jsonb,
                allowed_domains text[], settings jsonb,
                created_at, updated_at
knowledge_sources id, bot_id, type (file|url|text), title, status
                (uploading|pending|processing|ready|error), error_message, storage_path,
                url, mime, size_bytes, chunk_count, progress, created_at, updated_at
knowledge_chunks id, source_id, bot_id, chunk_index, content, embedding vector(1536),
                fts tsvector, metadata jsonb (pages), token_count
end_users       id, bot_id, channel (playground|web|widget|telegram|whatsapp|eval),
                external_id, display_name, created_at, last_seen_at
memories        id, bot_id, end_user_id, content, importance, source_conversation_id,
                created_at, updated_at
skills          id, bot_id, type (search_knowledge|http_webhook|current_datetime|web_fetch|
                web_search|handoff_to_human|capture_lead), name, tool_name, description,
                config jsonb, enabled   (header rahasia webhook di Supabase Vault)
handoff_requests id, bot_id, conversation_id, end_user_id, reason, summary,
                status (open|resolved), created_at, resolved_at
leads           id, bot_id, conversation_id, end_user_id, data jsonb, created_at
rate_limits     key, bucket, count   (hanya server)
channel_connections id, bot_id, channel (telegram), enabled, status (connected|error), bot_username,
                external_bot_id, last_error, last_message_at   (token dan kode rahasia webhook di Supabase Vault)
channel_updates connection_id, update_id   (anti-ganda; hanya server)
channel_chats   connection_id, chat_id, conversation_id   (percakapan yang sedang berlanjut per chat; hanya server)
conversations   id, bot_id, end_user_id, channel (termasuk eval), title, summary, summary_until,
                memory_until, created_at, updated_at
messages        id, conversation_id, role, content jsonb, tokens_in, tokens_out,
                cost_usd, latency_ms, feedback (-1|0|1), created_at
eval_cases      id, bot_id, input, expected_behavior, tags, setup jsonb (pesan pendahuluan),
                new_conversation, source_conversation_id
eval_runs       id, bot_id, status (running|done), source (app|cli), judge_model,
                bot_snapshot jsonb, total, pass/fail/error/skipped_count, estimated_cost_usd,
                cost_bot_usd, cost_judge_usd, cost_background_usd, cost_usd, tokens_in/out
eval_results    id, run_id, case_id, position, case_input/expected (salinan), status
                (pending|running|pass|fail|error|skipped), reason, answer, tools, conversation_id,
                cost_bot/judge/background_usd, tokens, latency_ms
llm_usage       id, bot_id, conversation_id, eval_run_id, eval_result_id, purpose
                (memory|summary|embedding|persona|web_search_test|eval_judge|eval_suggest),
                model, tokens, cost_usd   (panggilan model di luar jawaban bot)
```

## Alur satu pesan (runBot)
1. Ambil konfigurasi bot + skill aktif.
2. Ambil riwayat percakapan (N pesan terakhir, ringkas jika terlalu panjang).
3. Ambil memory end user (jika fitur memory aktif).
4. Kirim ke model (lewat lib/llm/provider.ts) dengan tools = skill aktif. Knowledge diakses lewat tool `search_knowledge` (agentic RAG), bukan selalu disuntikkan.
5. Jalankan tool loop sampai Claude selesai (batas maksimal iterasi, misalnya 5).
6. Stream jawaban ke channel.
7. Simpan pesan, token, biaya, latensi.
8. Di background: ekstrak memory baru dengan model ringan.

## Eval dan analitik (fase 6)
- Eval = ujian otomatis untuk bot: test case (pertanyaan + perilaku yang diharapkan) dijawab bot lewat `runBot` (channel `eval`), lalu dinilai juri (model `LLM_JUDGE_MODEL`, bawaan `claude-haiku-5-5` hasil uji banding 2026-11-07, suhu 0) dengan rubrik lulus/gagal + alasan. Mesin di `lib/evals/engine.ts`, juri di `lib/evals/judge.ts`.
- Satu run = banyak kasus; satu langkah (`POST /api/bots/<id>/evals/runs/<run>/step`) = satu kasus, supaya aman terhadap batas waktu Vercel. Klaim kasus atomik, jadi aman dipanggil bersamaan (CLI memakai 2 pekerja). Kasus yang macet lebih dari 3 menit boleh diambil ulang.
- Keamanan saat eval: skill penyimpan data (lead, handoff) berjalan dalam mode tes, webhook POST tidak dikirim, webhook GET dipanggil sungguhan. Kasus memory dilewati jika memory bot mati. Memory pengguna uji dihapus setelah tiap kasus. Jawaban bot dibungkus sebagai data untuk juri.
- Setiap run menyimpan salinan pengaturan bot (`bot_snapshot`) untuk perbandingan antar run. Run tidak bisa dihapus (riwayat biaya tetap utuh).
- Biaya: jawaban bot tetap di `messages.cost_usd`; semua panggilan model lain dicatat di `llm_usage` lewat `lib/llm/usage.ts` (gagal mencatat tidak pernah menghentikan pekerjaan utama). Biaya run = jumlah biaya bot (messages) + juri + latar belakang (llm_usage). Batas biaya harian fase 5 ikut menghitung biaya latar belakang channel publik.
- Analitik per bot per hari (WIB) lewat fungsi SQL `bot_analytics` (security invoker). Channel `eval` dihitung terpisah sebagai "biaya eval" dan tidak ikut statistik chat.

## Channel Telegram (fase 7)
- Adapter di `lib/channels/telegram/`: `api.ts` (klien Bot API lewat `lib/net/safe-http.ts`, token disensor dari semua galat), `format.ts` (markdown ke HTML Telegram, pemecah pesan 4096 karakter), `parse.ts` (update masuk dengan Zod, perintah, perbandingan rahasia), `connection.ts` (hubungkan/putuskan, rahasia di Vault), `handler.ts` (pesan masuk ke `runBot`, balasan keluar), `actions.ts` (aksi server untuk tab Publikasi).
- Alur: owner menempel token di tab Publikasi, aplikasi memeriksa (`getMe`), menyimpan token dan kode rahasia acak di Vault (`set_channel_secret`, hanya `service_role`), lalu `setWebhook` ke `/api/telegram/webhook/<connection_id>` dengan `secret_token`. Webhook: kode rahasia dibandingkan (`timingSafeEqual`), `update_id` diklaim sekali (`claim_channel_update`), balasan 200 segera, pemrosesan lewat `after()` dengan batas jawaban 50 detik.
- Hanya chat pribadi dan teks. Grup, bot lain, dan update selain pesan diabaikan; pesan non-teks dibalas "hanya bisa membaca teks". Perintah `/start` (pesan sambutan) dan `/baru` (kosongkan penunjuk percakapan di `channel_chats`).
- Batas pemakaian memakai `checkLimits` yang sama dengan link publik (per menit per chat, harian, biaya harian) dan menghitung channel `telegram`. Hanya Production yang bisa dihubungkan di Vercel (Preview dilindungi login). `TELEGRAM_API_BASE` (server Telegram tiruan) hanya berlaku di luar Vercel.
- Rahasia tidak dihapus lewat SQL: saat diputus atau bot dihapus, token dan kode rahasia ditimpa kosong lalu baris koneksi dihapus oleh aplikasi (baris Vault kosong tersisa; pembersihannya butuh migrasi dengan perintah hapus, ditunda).

## Keamanan
- Konten knowledge dibungkus tag `<document>` dan system prompt menegaskan bahwa isinya data, bukan instruksi.
- Skill `http_webhook` hanya boleh memanggil domain yang ada di allowlist bot.
- Semua HTTP keluar (knowledge URL, webhook, baca halaman, pencarian) lewat `lib/net/safe-http.ts`: tolak IP privat/lokal (dicek saat koneksi), port standar, batas ukuran dan waktu.
- Header rahasia webhook disimpan di Supabase Vault; fungsi pembacanya hanya bisa dipanggil server (secret key) setelah kepemilikan skill dibuktikan lewat RLS.
- Registry skill: `lib/skills/defs/*` (satu file per tipe: skema konfigurasi Zod, definisi tool, eksekusi), didaftarkan di `lib/skills/registry.ts`.
- Rate limit endpoint publik (bawaan 20 pesan/menit per IP dan per pengunjung, 300 pesan/hari per bot), disimpan di tabel `rate_limits` lewat fungsi atomik khusus server.
- Batas biaya harian per bot (bawaan USD 1, dihitung dari `messages.cost_usd` channel publik hari ini WIB); jika terlewati, bot membalas pesan fallback tanpa memanggil model.
- Channel publik (`/c/<slug>`, `/embed/<slug>`, `/api/public/*`, `/widget.js`) tanpa login: server memakai secret key dengan pengecekan eksplisit (bot `is_public`, percakapan milik bot dan pengunjung itu). Event dan riwayat untuk pengunjung disaring (`lib/publish/public.ts`): hanya teks, label skill, sitasi tanpa id internal, status.
- Widget hanya bisa di-embed di domain yang diizinkan (header CSP `frame-ancestors` dari `bots.allowed_domains`, dipasang di middleware).
