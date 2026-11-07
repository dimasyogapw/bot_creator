-- Harga model (USD per 1 juta token) untuk menghitung biaya panggilan non-stream (juri eval, memory,
-- ringkasan, persona). SumoPod hanya melaporkan "cost" pada respons stream, jadi tanpa tabel ini biaya
-- latar belakang tercatat 0. Dikalibrasi 2026-11-06 dari angka cost yang SumoPod laporkan sendiri
-- (tiga panggilan stream per model dengan rasio token berbeda, selisih prediksi di bawah 0,05%).
-- Perbarui baris ini jika harga SumoPod berubah. Harga cache sengaja dikosongkan: biaya jawaban bot
-- memakai angka provider.
insert into public.model_prices (model, input_per_mtok, output_per_mtok)
values
  ('claude-haiku-5-5', 0.125, 0.5),
  ('claude-sonnet-5-5', 2.5, 10)
on conflict (model) do nothing;
