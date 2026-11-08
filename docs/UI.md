# Design brief UI

## Karakter
Bersih, tenang, profesional. Referensi rasa: Linear, Vercel dashboard, Claude.ai.
Bukan gaya "template admin" yang penuh kartu warna-warni.

## Aturan visual
- Satu warna aksen (misal indigo), sisanya netral (abu-abu). Dukung light dan dark mode.
- Font: Inter atau Geist. Ukuran dasar 14 sampai 16px.
- Spasi konsisten (kelipatan 4px). Radius 8 sampai 12px.
- Ikon: lucide-react, satu ketebalan garis.
- Animasi halus dan pendek (150 sampai 200ms), hormati `prefers-reduced-motion`.

## Halaman
1. **Login**: satu form email (magic link) atau email + password.
2. **Daftar bot**: grid/list bot dengan nama, avatar, model, status publik, jumlah chat 7 hari. Tombol "Bot baru".
3. **Detail bot** dengan tab:
   - *Playground*: chat di kiri/tengah, panel setelan di kanan (bisa ditutup di HP).
   - *Persona*: system prompt, model, temperature, pesan sambutan.
   - *Knowledge*: daftar sumber + status proses, upload drag and drop.
   - *Memory*: daftar memory per end user, bisa dihapus.
   - *Skills*: daftar skill dengan toggle on/off dan form konfigurasi.
   - *Publikasi*: link publik, kode embed widget, koneksi Telegram (token, status, saklar, putuskan) dan nanti WhatsApp.
   - *Percakapan*: riwayat chat, filter channel, feedback.
   - *Evals*: daftar test case (tambah/impor), tombol "Jalankan" dengan perkiraan biaya, riwayat run (skor, selisih, biaya), halaman hasil per kasus dengan penilaian juri, perbandingan run sebelumnya, dan tagihan run (bot, juri, latar belakang).
   - *Analitik*: ringkasan 7/30/90 hari (percakapan, jawaban, token, biaya jawaban/latar belakang/eval, latensi, jempol, skor eval terakhir) dan grafik batang per hari.
4. **Halaman chat publik**: tampilan chat penuh, bersih, dengan nama dan avatar bot.

## Komponen chat (wajib ada)
- Streaming jawaban token per token.
- Render markdown (list, tabel, kode dengan tombol salin).
- Tampilkan sitasi knowledge sebagai chip yang bisa diklik.
- Indikator saat bot memakai skill ("Mencari di knowledge...").
- Tombol stop, regenerate, salin, thumbs up/down.
- Input auto-resize, Enter kirim, Shift+Enter baris baru.
- Auto-scroll yang berhenti jika user scroll ke atas.

## State yang harus didesain (sering terlupa)
- Kosong (belum ada bot, belum ada knowledge, belum ada chat) dengan ajakan tindakan.
- Loading (skeleton, bukan spinner di seluruh halaman).
- Error (pesan jelas dalam bahasa Indonesia + tombol coba lagi).
- Proses panjang (upload dokumen) dengan status progres.

## Aksesibilitas
- Semua tombol bisa diakses keyboard, fokus terlihat.
- Kontras teks minimal WCAG AA.
- Target sentuh minimal 44px di HP.
