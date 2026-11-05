# Setup project Bot Creator (dikerjakan owner, sekitar 30 sampai 45 menit)

Claude Code tidak bisa membuat akun atau mengisi rahasia untukmu. Kerjakan langkah ini sekali, berurutan.
Aturan emas: **API key dan password tidak pernah ditempel di chat Claude Code dan tidak pernah di-commit ke GitHub.**

---

## A. Akun dan kunci yang dibutuhkan

### A1. SumoPod (otak bot)
1. Login ke ai.sumopod.com.
2. Buka tab **AI** lalu **API Keys** lalu **Create key**. Beri nama `bot-creator`.
3. Salin key (format `sk-...`) ke catatan sementara yang aman (misal password manager).
4. Pastikan saldo cukup. Untuk tahap pengembangan, Rp 100 sampai 200 ribu biasanya lebih dari cukup.
5. Catat nama persis model Claude yang tersedia (Sonnet dan Haiku terbaru) dari daftar model SumoPod.

### A2. Supabase (database, login, file, pencarian knowledge)
1. Buka supabase.com, **New project**. Nama: `bot-creator`. Region: **Southeast Asia (Singapore)**.
2. Simpan **database password** yang kamu buat.
3. Setelah project jadi, buka **Project Settings lalu API Keys**. Pakai key format baru (jangan buka "View legacy API keys", key lama dihentikan awal 2027). Catat:
   - **Publishable key** (`sb_publishable_...`), aman untuk browser
   - **Secret key** (`sb_secret_...`), rahasia, jangan pernah dibagikan
   - **Project URL** (`https://xxxx.supabase.co`), ada di tombol **Connect** atau menu **Data API**
4. Buka **Authentication lalu Sign In / Providers**, matikan **Allow new users to sign up** setelah akun owner dibuat (Claude Code akan memandu kapan waktunya di fase 1).

### A3. GitHub
Repo `dimasyogapw/bot_creator` sudah ada dan berisi dokumen proyek ini. Tidak perlu apa-apa lagi.

### A4. Vercel (dipakai mulai fase 1, lihat bagian F)

### A5. Nanti saja (tidak dibutuhkan sekarang)
- **Telegram BotFather**: fase 7.
- **OpenRouter**: hanya jika SumoPod gagal tes di fase 1.

---

## B. Pilih tempat kerja

Kamu bisa memakai salah satu atau keduanya. Keduanya membaca repo GitHub yang sama.

### B1. VS Code di laptop (disarankan untuk fase build besar)
1. Install: Node.js versi LTS, Git, VS Code, lalu ekstensi **Claude Code** di VS Code. Login dengan akun langganan Claude kamu.
2. Buka terminal, jalankan:
   ```bash
   git clone https://github.com/dimasyogapw/bot_creator.git
   ```
3. Di VS Code: **File lalu Open Folder**, pilih folder `bot_creator`.
4. Buat file `.env.local` di root folder (Claude Code akan membuat `.env.example` di fase 1 sebagai contoh). Isi dengan kunci dari langkah A. File ini otomatis diabaikan Git.
5. Buka panel Claude Code, lanjut ke `prompts/PLAYBOOK.md` fase 1.

### B2. Claude Code web (claude.ai/code), bisa dari HP
1. Buka claude.ai/code, mulai sesi baru, pilih repo `dimasyogapw/bot_creator`.
2. Atur environment (menu cloud environment di judul sesi, lalu **Edit**):
   - **Environment variables / secrets**: isi semua variabel di bagian C.
   - **Network access**: pilih level Limited dan tambahkan domain berikut di Allowed domains (biarkan "Allow package managers" tercentang):
     - `ai.sumopod.com`
     - `*.supabase.co`
     - `supabase.com` dan `api.supabase.com` (untuk perintah Supabase CLI / migrasi)
     - `api.voyageai.com` (hanya jika dipakai sebagai cadangan)
     - `openrouter.ai` (hanya jika dipakai sebagai cadangan)
     - `api.tavily.com` (skill "Cari di internet", fase 4)
   - Panduan resmi: https://code.claude.com/docs/en/cloud-environments#network-access
3. Mulai sesi **baru** setelah mengubah environment supaya pengaturan terbaca.
   Catatan: koneksi database langsung (port 5432) kemungkinan tetap diblokir di claude.ai/code. Jika migrasi gagal di sana, jalankan migrasi dari VS Code atau lewat connector Supabase.
4. Ingat: komputer cloud ini sementara. Setiap akhir pekerjaan minta "commit dan push".

---

## C. Daftar environment variable

| Nama | Isi | Rahasia? |
|---|---|---|
| `LLM_BASE_URL` | `https://ai.sumopod.com/v1` | Tidak |
| `LLM_API_KEY` | key SumoPod `sk-...` | **Ya** |
| `LLM_DEFAULT_MODEL` | nama model Claude Sonnet dari SumoPod | Tidak |
| `LLM_LIGHT_MODEL` | nama model Claude Haiku dari SumoPod | Tidak |
| `EMBEDDING_MODEL` | diisi setelah tes fase 1 | Tidak |
| `EMBEDDING_DIMENSIONS` | diisi setelah tes fase 1 | Tidak |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL Supabase | Tidak |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key `sb_publishable_...` | Tidak (memang untuk browser, dilindungi RLS) |
| `SUPABASE_SECRET_KEY` | Secret key `sb_secret_...` | **Ya, paling sensitif** |
| `OWNER_EMAIL` | email login owner | Tidak |
| `TAVILY_API_KEY` | API key Tavily `tvly-...` (opsional, skill "Cari di internet", fase 4) | **Ya** |

Daftar final mengikuti `.env.example` yang dibuat Claude Code di fase 1.

---

## D. Pengaman biaya (jangan dilewati)
1. Di SumoPod: isi saldo secukupnya, jangan besar. Saldo prabayar adalah batas pengeluaran alami.
2. Di aplikasi: batas biaya harian per bot (dibangun di fase 5) wajib aktif sebelum link publik dibagikan.
3. Jika key pernah tidak sengaja tertempel di chat atau ter-commit: hapus key itu di SumoPod dan buat yang baru. Menghapus pesan atau commit tidak cukup.

---

## E. Checklist sebelum fase 1
- [ ] Key SumoPod sudah ada dan saldo terisi
- [ ] Nama model Sonnet dan Haiku di SumoPod sudah dicatat
- [ ] Project Supabase sudah jadi, Project URL + publishable key + secret key sudah dicatat
- [ ] Tempat kerja siap (VS Code dengan repo ter-clone, atau environment claude.ai/code sudah diisi)
- [ ] Sudah membaca `prompts/PLAYBOOK.md` bagian "Pola setiap fase"

---

## F. Deploy ke Vercel (paket Hobby, gratis)
Aplikasi dibuka dari alamat online Vercel karena tidak bisa dijalankan di laptop owner.

1. Buka vercel.com, **Sign Up** dengan akun GitHub (pilih paket **Hobby**).
2. Klik **Add New** lalu **Project**. Jika repo `bot_creator` tidak muncul, klik **Adjust GitHub App Permissions** dan beri akses ke repo `dimasyogapw/bot_creator`.
3. Klik **Import** di repo `bot_creator`. Framework terdeteksi otomatis sebagai **Next.js**. Jangan ubah Build Command.
4. Buka bagian **Environment Variables** dan isi variabel dari bagian C (nilainya sama dengan yang ada di environment Claude Code web). `EMBEDDING_MODEL` dan `EMBEDDING_DIMENSIONS` boleh dikosongkan dulu.
5. Klik **Deploy**, tunggu sampai muncul tulisan selamat dan alamat seperti `https://bot-creator-xxxx.vercel.app`.
6. Di Supabase: **Authentication** lalu **URL Configuration**. Isi **Site URL** dengan alamat Vercel tadi, lalu **Save**.
7. Berikan alamat Vercel ke Claude Code agar dicek dengan Playwright.

Catatan: Vercel memasang versi dari branch utama (`main`). Pekerjaan baru masuk ke `main` lewat pull request yang Anda setujui (merge) di GitHub.

---

## G. Tavily untuk skill "Cari di internet" (fase 4, OPSIONAL, tidak wajib)
Skill "Cari di internet" sudah jalan tanpa Tavily untuk bot bermodel Claude atau Gemini (memakai pencarian bawaan model lewat SumoPod). Tavily hanya diperlukan jika bot memakai model lain (mis. DeepSeek) dan tetap ingin bisa mencari di internet.
1. Buka https://app.tavily.com dan daftar (bisa dengan akun Google). Paket gratis: 1.000 kredit per bulan, tanpa kartu kredit (per November 2026; cek halaman billing Tavily untuk angka terbaru).
2. Setelah masuk, salin **API key** (format `tvly-...`). Jangan tempel di chat Claude Code.
3. Vercel: buka project **bot-creator** lalu **Settings** lalu **Environment Variables**. Tambah `TAVILY_API_KEY` dengan nilai tadi, centang **Production** dan **Preview**, lalu **Save**. Buka **Deployments**, klik titik tiga di deployment teratas, pilih **Redeploy**.
4. Claude Code web (agar bisa dites otomatis): menu environment, **Edit**, tambah variabel `TAVILY_API_KEY` dan tambah domain `api.tavily.com` di Allowed domains. Mulai sesi baru.
5. Di aplikasi: tab **Skills**, nyalakan **Cari di internet**.

