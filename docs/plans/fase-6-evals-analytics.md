# Rencana Fase 6: Evals + Analytics (disusun 2026-11-05, disetujui owner 2026-11-06)

## Tujuan
Owner bisa mengukur kualitas bot secara otomatis sebelum dan sesudah mengubahnya, serta memantau pemakaian dan biaya, termasuk biaya setiap kali eval dijalankan.

## Keputusan owner
1. Model juri: awalnya `claude-sonnet-5-5`. **Diperbarui 2026-11-07 atas permintaan owner (cari model lain, kalau belum ada pakai Sonnet)**: setelah uji banding (lihat PROGRESS.md) bawaan diganti `claude-haiku-5-5`. Env `LLM_JUDGE_MODEL` bisa mengembalikannya ke Sonnet.
2. Skill berefek samping saat eval: simpan data pelanggan dan alihkan ke manusia berjalan dalam mode tes (tidak menulis). Webhook GET dipanggil sungguhan. Webhook POST tidak dipanggil, dicatat "dilewati (mode eval)".
3. Biaya latar belakang ikut batas biaya harian fase 5.
4. Persentase jawaban "tidak tahu" (PRD bagian 8) ditunda.
5. Tambahan owner: info tagihan per run eval tampil di aplikasi (lihat bagian Tagihan eval).

## A. Evals (tab Evals)
- Kasus: tambah satu per satu, impor JSONL, edit, hapus (konfirmasi). Kasus boleh punya beberapa langkah (`steps`), langkah bisa ditandai `new_conversation` (untuk tes memory). Format lama `input` tetap didukung. Maks 50 kasus per bot.
- Jalankan: perkiraan biaya ditampilkan sebelum jalan. Berjalan bertahap (satu kasus per langkah), progres per kasus, bisa dilanjutkan jika halaman ditutup. Tiap kasus memakai `runBot` dengan pengguna uji terpisah.
- Juri: lulus/gagal + alasan, suhu 0, jawaban bot dibungkus sebagai data, keluaran rusak dicoba ulang sekali lalu ditandai "error juri". Kasus memory dilewati dengan keterangan jika memory bot mati.
- Perbandingan: setiap run menyimpan salinan pengaturan bot (system prompt, model, suhu). Hasil menampilkan skor naik/turun, kasus yang berubah, dan apakah system prompt berubah. Garis target 90%.
- Tombol "Buat test case dari percakapan ini" di tab Percakapan; draf perilaku yang diharapkan disarankan model ringan, bisa diedit, tidak pernah tersimpan otomatis.
- CLI `npm run eval -- --bot <slug>` memakai fungsi inti yang sama (hanya dari Claude Code web).
- Percakapan eval berchannel `eval`: tidak tampil di tab Percakapan, tidak dihitung sebagai pengguna di analytics, biayanya tercatat terpisah. Hapus run ikut menghapus percakapan eval-nya (dengan konfirmasi).

## Tagihan eval (permintaan owner)
- Setiap kasus menyimpan biaya bot, biaya juri, token, dan latensi. Biaya bot dijumlah dari semua jawaban bot di kasus itu (termasuk loop skill), biaya juri dari panggilan juri.
- Setiap run menyimpan total: biaya bot, biaya juri, biaya latar belakang (mis. memory) yang terjadi saat run, total keseluruhan.
- Tab Evals: tabel riwayat run (waktu, skor, perubahan, **biaya**), halaman detail run dengan rincian biaya per kasus dan total, kartu "Pengeluaran eval" (30 hari dan seluruhnya).
- Sebelum menekan Jalankan: perkiraan biaya (dari rata-rata run sebelumnya, atau perkiraan kasar jika belum ada).
- Tab Analitik: biaya eval tampil terpisah dari biaya chat.

## B. Pencatatan biaya lengkap
- Tabel `llm_usage`: setiap panggilan model di luar jawaban bot (memory, ringkasan, embedding, persona, tes skill, juri, saran test case) dengan tujuan, model, token, biaya, bot, run eval (jika ada).
- Biaya sebelum fase 6 tidak bisa direkonstruksi; dashboard memberi keterangan.
- Batas biaya harian fase 5 ikut menghitung biaya latar belakang channel publik.

## C. Analytics (tab Analitik)
- Rentang 7/30/90 hari, per hari menurut WIB. Kartu: percakapan, pesan, token, biaya jawaban, biaya latar belakang, biaya eval, biaya rata-rata per percakapan, latensi rata-rata, rasio jempol, skor eval terakhir.
- Grafik batang SVG sederhana (tanpa pustaka baru). Perhitungan lewat fungsi SQL security invoker.
- "Biaya jawaban" harus sama dengan jumlah `messages.cost_usd` pada rentang itu.

## Definition of Done
1. 6 kasus contoh berjalan dan menampilkan hasil per kasus (kasus webhook hanya di lokal).
2. Ubah system prompt, jalankan ulang: skor naik/turun terlihat, kasus yang berubah ditandai.
3. Biaya di dashboard sama dengan total di tabel messages (dicek dengan query).
4. Biaya setiap run eval tampil di aplikasi dan sama dengan jumlah biaya per kasus dan data `llm_usage`/`messages`.
Plus unit test, Playwright (lokal dan Production), screenshot 375px dan 1440px, advisor keamanan Supabase, PR ke main.

## Di luar fase ini
Persentase "tidak tahu", biaya Tavily, eval terjadwal otomatis, Telegram/WhatsApp/Discord (fase 7).
