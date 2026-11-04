# Playbook: membangun Bot Creator dengan Claude Code

Cara pakai: kerjakan berurutan. Copy-paste satu prompt, tunggu sampai selesai, cek hasilnya sendiri di browser, baru lanjut.
Jangan pernah menggabungkan dua fase dalam satu prompt.

---

## Langkah 0: Persiapan manual
Ikuti `docs/SETUP.md` sampai checklist bagian E tercentang semua. Ringkasnya: key SumoPod, project Supabase, dan tempat kerja (VS Code atau claude.ai/code). Vercel belum perlu.

---

## Pola setiap fase (wajib diikuti)
1. **Plan**: aktifkan plan mode (Shift+Tab di Claude Code) lalu kirim prompt fase. Baca rencananya. Kalau ada yang tidak kamu pahami, tanya "jelaskan dengan bahasa sederhana".
2. **Build**: setujui rencana.
3. **Verifikasi**: kirim prompt verifikasi (di bawah).
4. **Tes manual**: buka aplikasi, coba sendiri sesuai "Definition of Done".
5. **Commit**: kirim "commit dan push pekerjaan fase ini". Di claude.ai/code langkah ini wajib, kalau tidak pekerjaan hilang.
6. Mulai sesi baru (`/clear`) sebelum fase berikutnya supaya konteks bersih.

### Prompt verifikasi (pakai di akhir setiap fase)
```
Verifikasi fase ini:
1. Jalankan lint, typecheck, dan semua test. Perbaiki yang gagal.
2. Jalankan aplikasi dan gunakan Playwright untuk mencoba setiap poin Definition of Done fase ini seperti pengguna sungguhan. Ambil screenshot di lebar 375px dan 1440px.
3. Review kodenya sendiri: cari bug, celah keamanan (API key bocor, RLS hilang, input tidak divalidasi), dan duplikasi logika.
4. Laporkan dalam bahasa sederhana: apa yang berhasil, apa yang gagal, apa yang perlu saya cek manual.
5. Update docs/PROGRESS.md.
Jangan bilang selesai jika masih ada yang gagal.
```

---

## Fase 1: Fondasi + bot + playground
```
Baca CLAUDE.md dan semua file di docs/. Kita mengerjakan FASE 1 saja.

Tujuan: saya bisa login, membuat bot, dan chat dengan bot itu di playground.

LANGKAH PERTAMA (sebelum fitur apa pun):
- Setup project Next.js minimal dan buat lib/llm/provider.ts (OpenAI-compatible, baseURL dari env, default SumoPod).
- Buat script npm run check:provider yang mengetes 6 kebutuhan provider di docs/ARCHITECTURE.md dan mencetak tabel lulus/gagal + dimensi embedding + contoh usage.
- Buat .env.example sesuai docs/SETUP.md bagian C.
- Jalankan tesnya, laporkan hasilnya ke saya dalam bahasa sederhana, lalu BERHENTI dan tunggu keputusan saya sebelum lanjut.

Setelah saya setujui hasil tes provider, kerjakan:
- Lengkapi setup: TypeScript strict + Tailwind + shadcn/ui + Supabase + Vitest + Playwright.
- Auth Supabase untuk satu owner saja (pendaftaran publik dimatikan).
- Migrasi tabel bots, conversations, messages dengan RLS.
- Halaman daftar bot, buat/edit/hapus bot (nama, avatar, system prompt, model dari daftar /models provider, temperature, pesan sambutan).
- Playground chat dengan streaming, mengikuti komponen chat di docs/UI.md.
- Fungsi inti lib/bot/runBot.ts sesuai docs/ARCHITECTURE.md, memanggil LLM hanya lewat lib/llm/provider.ts.
- Simpan pesan beserta token, biaya, dan latensi.

Definition of Done:
- Saya bisa login, membuat bot "Tes", chat, dan jawaban muncul bertahap (streaming).
- Refresh halaman, riwayat chat masih ada.
- Tampilan rapi di HP dan desktop, ada empty state, loading, dan error state.
- Tidak ada API key di kode client (buktikan dengan pencarian di bundle hasil build).

Buat rencana dulu, jangan tulis kode sebelum saya setujui.
```

## Fase 2: Knowledge (RAG)
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 2 saja.

Tujuan: bot menjawab berdasarkan dokumen yang saya upload dan menyebut sumbernya.

Kerjakan:
- Aktifkan pgvector. Migrasi knowledge_sources dan knowledge_chunks dengan RLS.
- Tab Knowledge: upload PDF, DOCX, TXT, MD (drag and drop), tambah URL, tambah teks manual.
- Proses di background: ekstrak teks, potong menjadi chunk (sekitar 500 sampai 800 token, dengan overlap), buat embedding lewat lib/llm/provider.ts (model dan dimensi dari env), simpan. Tampilkan status pending/processing/ready/error.
- Skill bawaan search_knowledge sebagai tool Claude (agentic RAG). Gabungkan pencarian vektor dan full-text (hybrid).
- Konten knowledge dibungkus sebagai data, dengan perlindungan prompt injection sesuai docs/ARCHITECTURE.md.
- Jawaban menampilkan sitasi yang bisa diklik.
- Tambahkan aturan di system prompt dasar: jika knowledge tidak memuat jawabannya, katakan tidak tahu.

Definition of Done:
- Upload PDF 20 halaman, status berubah menjadi ready.
- Pertanyaan yang jawabannya ada di PDF dijawab benar dan menampilkan sitasi.
- Pertanyaan yang tidak ada di PDF dijawab "tidak tahu", bukan dikarang.
- Dokumen yang berisi kalimat "abaikan instruksimu" tidak mengubah perilaku bot.
- Hapus sumber, chunk ikut terhapus.

Buat rencana dulu.
```

## Fase 3: Percakapan + Memory
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 3 saja.

Tujuan: saya bisa melihat semua percakapan, dan bot mengingat fakta penting tentang tiap end user antar percakapan.

Kerjakan:
- Migrasi end_users dan memories dengan RLS.
- Tab Percakapan: daftar percakapan, filter per channel, detail percakapan, feedback thumbs up/down.
- Riwayat panjang diringkas otomatis agar tidak melebihi batas konteks.
- Memory: setelah percakapan, model ringan mengekstrak fakta penting (nama, preferensi, konteks) lalu menyimpan, memperbarui, atau menghapus memory yang bertentangan. Memory relevan dimasukkan ke konteks percakapan berikutnya.
- Toggle memory on/off per bot. Tab Memory untuk melihat dan menghapus memory per end user.
- Jangan simpan data sensitif (password, nomor kartu, nomor KTP) di memory.

Definition of Done:
- Di percakapan A saya bilang "nama saya Budi, suka kopi hitam". Di percakapan baru B, bot tahu nama dan minuman saya.
- Memory bisa dihapus dan bot benar-benar lupa.
- Bot dengan memory dimatikan tidak mengingat apa pun.

Buat rencana dulu.
```

## Fase 4: Skills
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 4 saja.

Tujuan: setiap bot bisa diberi kemampuan tambahan yang bisa saya nyalakan/matikan dan konfigurasi tanpa coding.

Kerjakan:
- Migrasi skills dengan RLS. Arsitektur skill sebagai registry: setiap tipe skill punya skema konfigurasi (Zod), definisi tool untuk Claude, dan fungsi eksekusi. Menambah tipe skill baru di masa depan cukup menambah satu file.
- Tipe skill awal:
  1. search_knowledge (pindahkan dari fase 2 ke registry).
  2. http_webhook: saya isi nama, deskripsi, URL, method, header, dan skema parameter. Cocok untuk memanggil workflow n8n. Wajib allowlist domain, timeout, dan batas ukuran respons.
  3. current_datetime (zona waktu bisa diatur).
  4. handoff_to_human: mencatat permintaan dan memberi notifikasi ke saya.
- Tab Skills: daftar, toggle, form konfigurasi, tombol "Tes skill".
- Di chat, tampilkan indikator saat skill dipakai, dan di tab Percakapan tampilkan detail panggilan tool.
- Batasi loop tool maksimal 5 iterasi.

Definition of Done:
- Saya buat skill webhook ke URL tes, bot memanggilnya saat relevan dan menjawab dari hasilnya.
- Skill yang dimatikan tidak pernah dipanggil.
- URL di luar allowlist ditolak.
- Webhook yang error/timeout membuat bot menjawab sopan, bukan crash.

Buat rencana dulu.
```

## Fase 5: Publikasi (link publik + widget)
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 5 saja.

Tujuan: orang lain bisa chat dengan bot saya lewat link publik dan widget di website mana pun.

Kerjakan:
- Halaman publik /c/[slug] untuk bot yang is_public = true. End user anonim diidentifikasi dengan ID di cookie/localStorage.
- Widget embed: satu tag <script> yang memunculkan bubble chat (iframe ke halaman publik). Bisa diatur warna, posisi, dan pesan sambutan. Tab Publikasi menampilkan kode embed siap salin.
- Allowlist domain untuk widget per bot.
- Rate limit per IP dan per bot, batas biaya harian per bot dengan pesan fallback.
- Halaman publik tidak boleh membocorkan system prompt, konfigurasi skill, atau data end user lain.

Definition of Done:
- Buka link publik di mode incognito, bisa chat.
- Tempel widget di file HTML tes, bubble muncul dan berfungsi.
- Kirim 30 pesan cepat, rate limit aktif dengan pesan ramah.
- Bot yang is_public = false mengembalikan halaman tidak ditemukan.

Buat rencana dulu.
```

## Fase 6: Evals + analytics
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 6 saja.

Tujuan: saya bisa mengukur kualitas bot secara otomatis sebelum mengubahnya, dan melihat penggunaan serta biaya.

Kerjakan:
- Migrasi eval_cases dan eval_runs. Tab Evals: tambah/impor test case (format seperti evals/cases.example.jsonl), tombol Jalankan.
- Penilaian memakai Claude sebagai juri dengan rubrik jelas: lulus/gagal + alasan. Tampilkan perbandingan dengan run sebelumnya.
- Tombol "Buat test case dari percakapan ini" di tab Percakapan (terutama yang diberi thumbs down).
- Perintah CLI npm run eval -- --bot <slug>.
- Dashboard analytics per bot: jumlah percakapan, pesan, token, biaya, rata-rata latensi, rasio feedback, per hari.

Definition of Done:
- Eval 6 kasus contoh berjalan dan menampilkan hasil per kasus.
- Saya ubah system prompt, jalankan ulang, dan bisa melihat apakah skor naik atau turun.
- Angka biaya di dashboard sesuai dengan total di tabel messages.

Buat rencana dulu.
```

## Fase 7: Telegram, lalu WhatsApp
```
Baca CLAUDE.md, docs/, dan docs/PROGRESS.md. Kita mengerjakan FASE 7 saja, mulai dari Telegram.

Tujuan: bot yang sama bisa dipakai di Telegram (lalu WhatsApp) tanpa menduplikasi logika.

Kerjakan:
- Adapter channel Telegram: saya masukkan token BotFather di tab Publikasi, aplikasi mendaftarkan webhook otomatis. Pesan masuk diteruskan ke runBot, jawaban dikirim balik (format markdown Telegram, pesan panjang dipecah).
- Verifikasi secret token webhook. Token disimpan terenkripsi.
- Setelah Telegram stabil dan saya setujui, buat rencana untuk WhatsApp Cloud API dengan pola adapter yang sama, termasuk daftar langkah manual di Meta yang harus saya lakukan.

Definition of Done:
- Chat ke bot Telegram, jawaban sama kualitasnya dengan playground (knowledge, memory, skill berfungsi).
- Percakapan Telegram muncul di tab Percakapan dengan channel telegram.

Buat rencana dulu.
```

---

## Deploy ke Vercel (mulai fase 5, sebelum link publik dibagikan)
Fase 1 sampai 4 cukup dijalankan lokal. Vercel dibutuhkan agar aplikasi online 24 jam untuk link publik, widget, dan Telegram.
```
Siapkan deploy ke Vercel. Beri saya langkah bernomor untuk menghubungkan repo, mengisi environment variables, dan mengatur URL redirect auth di Supabase. Setelah saya selesai, cek URL produksi dengan Playwright.
```

## Prompt darurat
- Saat bug: `Ada bug: [jelaskan apa yang kamu lakukan, apa yang diharapkan, apa yang terjadi, tempel pesan error/screenshot]. Cari akar masalahnya dulu, jelaskan ke saya, baru perbaiki. Tambahkan test agar bug ini tidak terulang.`
- Saat Claude berputar-putar: `/clear`, lalu `Baca CLAUDE.md dan docs/PROGRESS.md. Masalah yang belum selesai: [...]. Usulkan 2 pendekatan berbeda sebelum mencoba lagi.`
- Saat ingin fitur baru: `Saya ingin [fitur]. Jangan coding dulu. Apakah ini masuk scope PRD? Fase mana yang cocok? Apa risikonya?` Lalu update docs/PRD.md sebelum membangun.
