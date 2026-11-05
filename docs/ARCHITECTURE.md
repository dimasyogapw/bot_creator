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
                max_tokens, welcome_message, is_public, memory_enabled, settings jsonb,
                created_at, updated_at
knowledge_sources id, bot_id, type (file|url|text), title, status
                (uploading|pending|processing|ready|error), error_message, storage_path,
                url, mime, size_bytes, chunk_count, progress, created_at, updated_at
knowledge_chunks id, source_id, bot_id, chunk_index, content, embedding vector(1536),
                fts tsvector, metadata jsonb (pages), token_count
end_users       id, bot_id, channel (playground|web|widget|telegram|whatsapp),
                external_id, display_name, created_at, last_seen_at
memories        id, bot_id, end_user_id, content, importance, source_conversation_id,
                created_at, updated_at
skills          id, bot_id, type (knowledge_search|http_webhook|...), name,
                description, config jsonb, enabled
conversations   id, bot_id, end_user_id, channel, title, summary, summary_until,
                memory_until, created_at, updated_at
messages        id, conversation_id, role, content jsonb, tokens_in, tokens_out,
                cost_usd, latency_ms, feedback (-1|0|1), created_at
eval_cases      id, bot_id, input, expected_behavior, tags
eval_runs       id, bot_id, created_at, pass_count, total, results jsonb
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

## Keamanan
- Konten knowledge dibungkus tag `<document>` dan system prompt menegaskan bahwa isinya data, bukan instruksi.
- Skill `http_webhook` hanya boleh memanggil domain yang ada di allowlist bot.
- Rate limit endpoint publik (contoh: 20 pesan/menit per IP, batas harian per bot).
- Batas biaya harian per bot; jika terlewati, bot membalas pesan fallback.
