# CLAUDE.md

## Proyek
Bot Creator: aplikasi web pribadi untuk membuat dan mengelola chatbot berbasis Claude.
Baca `docs/PRD.md`, `docs/ARCHITECTURE.md`, dan `docs/UI.md` sebelum mengerjakan fitur apa pun.
Progres fase dicatat di `docs/PROGRESS.md`.

## Tentang owner
Owner tidak membaca kode. Karena itu:
- Jelaskan hasil kerja dalam bahasa Indonesia sederhana, tanpa istilah teknis yang tidak perlu.
- Jika butuh tindakan manual dari owner (membuat akun, mengisi API key, klik di dashboard Supabase/Vercel), tulis langkahnya bernomor dan spesifik.
- Jangan pernah meminta owner mengedit kode secara manual.

## Stack
Next.js (App Router, TypeScript strict), Tailwind + shadcn/ui, Supabase, package `openai` dengan baseURL SumoPod (OpenAI-compatible), Zod, Vitest, Playwright.
Provider LLM default SumoPod, cadangan OpenRouter. Detail di docs/ARCHITECTURE.md.

## Lingkungan kerja
Proyek ini dikerjakan dari dua tempat: VS Code di laptop owner dan Claude Code web (claude.ai/code). GitHub `dimasyogapw/bot_creator` adalah sumber kebenaran.
- Selalu `git pull` sebelum mulai, commit dan push setelah selesai. Di Claude Code web, pekerjaan yang tidak di-push akan hilang.
- Jika permintaan jaringan ke suatu domain gagal di Claude Code web, beri tahu owner domain mana yang perlu diizinkan di Network access environment. Jangan memalsukan hasil.

## Perintah
- `npm run dev` : jalankan lokal
- `npm run lint` : lint
- `npm run typecheck` : cek tipe
- `npm test` : unit test
- `npm run check:provider` : tes kemampuan provider LLM (model, chat, streaming, tool calling, embedding, usage)
- `npm run test:e2e` : test Playwright
- `npm run eval -- --bot <slug>` : jalankan eval set (mulai fase 6)

## Aturan kerja
1. Kerjakan SATU fase dalam satu waktu. Jangan mengerjakan fitur dari fase lain.
2. Sebelum menulis kode untuk fitur baru, buat rencana dan tunggu persetujuan.
3. Setelah selesai: jalankan lint, typecheck, test, dan buka aplikasi dengan Playwright untuk memastikan fitur benar-benar berjalan. Ambil screenshot halaman yang berubah.
4. Jangan menyatakan "selesai" kalau ada test yang gagal. Laporkan apa adanya.
5. Update `docs/PROGRESS.md` di akhir setiap fase: apa yang selesai, apa yang belum, keputusan penting.
6. Commit kecil dan sering dengan pesan yang jelas.

## Aturan kode
- Semua panggilan LLM dan embedding hanya di server, dan hanya lewat `lib/llm/provider.ts`. Jangan pernah mengekspos API key ke client.
- Semua input API divalidasi dengan Zod.
- Logika chat hanya ada di `lib/bot/runBot.ts`. Channel (playground, publik, widget, Telegram, WhatsApp) memanggil fungsi ini, tidak menduplikasi logika.
- Perubahan skema database hanya lewat file migrasi di `supabase/migrations/`.
- Semua tabel wajib Row Level Security.
- Tangani error dengan pesan yang ramah untuk pengguna; log detail teknis di server.
- Teks antarmuka dalam bahasa Indonesia.

## Yang tidak boleh
- Menambah fitur di luar `docs/PRD.md` tanpa bertanya.
- Menghapus data atau migrasi tanpa konfirmasi.
- Mengubah file `.env*` yang berisi rahasia, atau melakukan commit atas file tersebut.
- Menonaktifkan test, lint, atau RLS supaya build lolos.
