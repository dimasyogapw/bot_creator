# Rencana Fase 4: Skills (disusun 2026-11-05, disetujui owner 2026-11-05)

## Tujuan
Setiap bot bisa diberi kemampuan tambahan (skill) yang bisa dinyalakan/dimatikan dan dikonfigurasi owner tanpa coding.

## Daftar usulan owner dan posisinya
| Usulan owner | Posisi | Catatan |
|---|---|---|
| Integrasi API | Fase 4: skill `http_webhook` | Sudah di PRD. Cocok untuk n8n. |
| Browsing / live search | Fase 4: `web_fetch` + `web_search` | Di luar PRD awal, perlu persetujuan. `web_search` butuh akun layanan pencarian (SumoPod tidak punya model pencarian). |
| Function calling / tool use | Bukan skill terpisah | Mesin yang menjalankan semua skill. Sudah ada sejak fase 2 (`search_knowledge`). |
| Omnichannel (Website, Telegram, WhatsApp, Discord, Instagram) | Bukan skill: fase 5 (website/widget) dan fase 7 (Telegram, WhatsApp) | Discord dan Instagram di luar PRD, usulan ditambahkan ke fase 7. |
| Jam/tanggal saat ini | Fase 4: `current_datetime` | Sudah di PRD. |
| Rich media | Fase 4: gambar dari pengguna (input) | Diuji 2026-11-05: `claude-haiku-5-5` lewat SumoPod bisa membaca gambar, `deepseek-v4-flash` tidak. Bot mengirim kartu/tombol/gambar ke pengguna masuk fase 5/7 (tergantung channel). |

## Skill fase 4
1. `search_knowledge`: dipindah ke registry (perilaku sama), bisa dimatikan per bot.
2. `http_webhook` (integrasi API): nama, deskripsi, URL, method, header, skema parameter. Wajib allowlist domain, timeout, batas ukuran respons, perlindungan SSRF (dipakai ulang dari fase 2). Header rahasia (mis. API key) disimpan terenkripsi di Supabase Vault dan tidak pernah dikirim balik ke browser.
3. `current_datetime`: zona waktu bisa diatur (bawaan Asia/Jakarta).
4. `web_fetch` (baca halaman web): bot membuka alamat yang diberikan pengguna atau ada di knowledge. Gratis, memakai pengambil URL aman dari fase 2. Opsional batasi domain.
5. `web_search` (cari di internet): lewat layanan pencarian eksternal (usulan: Tavily). Owner perlu membuat akun dan mengisi API key.
6. `handoff_to_human`: bot mencatat permintaan "bicara dengan manusia" (alasan + ringkasan), tampil di aplikasi (badge di tab Percakapan), opsional kirim notifikasi ke webhook n8n (mis. diteruskan ke WhatsApp/Telegram/email owner).
7. Gambar dari pengguna: tombol lampirkan/tempel gambar di Playground (maks 5 MB, JPG/PNG/WebP), disimpan di storage privat, dikirim ke model yang mendukung gambar. Model yang tidak mendukung: tombol dinonaktifkan dengan penjelasan.
8. (Usulan tambahan) `capture_lead` (simpan data pelanggan): bot mengumpulkan data yang owner tentukan (mis. nama, nomor HP, kebutuhan), menyimpannya ke tabel, owner melihat daftar dan mengunduh CSV, opsional dikirim ke webhook n8n.

## Keputusan owner (2026-11-05, ikut semua rekomendasi)
- `web_search` masuk fase 4 (owner membuat akun Tavily dan mengisi API key).
- Rich media: gambar dari pengguna dulu; output kartu/tombol/gambar di fase 5/7.
- Discord ditambahkan ke fase 7, Instagram ditunda.
- `capture_lead` masuk fase 4.
- Notifikasi handoff: di aplikasi + opsional webhook n8n.

## Teknis
- Registry skill: satu file per tipe skill berisi skema konfigurasi (Zod), definisi tool untuk model, dan fungsi eksekusi. Menambah tipe baru cukup satu file.
- Migrasi: `skills` (id, bot_id, type, name, description, config jsonb, enabled, created_at, updated_at), `handoff_requests`, `leads` (jika disetujui). Semua RLS. Rahasia di Supabase Vault lewat fungsi khusus.
- `runBot`: tools = skill aktif bot. Loop tool maksimal 5 iterasi (sudah ada). Detail panggilan tool (nama, argumen, durasi, berhasil/gagal, ringkasan hasil) disimpan di `messages.content.tools`.
- Hasil tool dibungkus sebagai data (bukan instruksi), dipotong jika terlalu panjang.
- Tab **Skills**: daftar, saklar, form konfigurasi, tombol "Tes skill". Chat menampilkan indikator per skill ("Memanggil API...", "Mencari di internet..."). Tab Percakapan menampilkan detail panggilan tool.

## Definition of Done
1. Skill webhook ke URL tes: bot memanggilnya saat relevan dan menjawab dari hasilnya.
2. Skill yang dimatikan tidak pernah dipanggil.
3. URL di luar allowlist ditolak.
4. Webhook yang error/timeout membuat bot menjawab sopan, bukan crash.
5. Pertanyaan "jam berapa sekarang" dijawab sesuai zona waktu bot.
6. Bot membaca halaman web dari URL yang diberikan pengguna dan menjawab dengan sumbernya. (Jika `web_search` disetujui: pertanyaan berita terbaru dijawab dengan sumber.)
7. "Saya mau bicara dengan manusia" tercatat dan muncul di aplikasi.
8. Gambar yang diupload di Playground dibaca bot dengan benar.
9. Header rahasia webhook tidak pernah muncul di browser (dicek di file build dan respons API).
Plus unit test, test Playwright (lokal dan Production), screenshot 375px dan 1440px, review keamanan, PR ke main.

## Di luar fase ini
- Channel: website/widget (fase 5), Telegram dan WhatsApp (fase 7), Discord/Instagram (usulan fase 7).
- Bot mengirim gambar/kartu/tombol ke pengguna (fase 5/7).
- Voice tetap di luar scope (PRD bagian 5).
