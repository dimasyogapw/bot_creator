-- model_prices bersifat global (tidak per owner_id). Gabungkan dua policy menjadi satu
-- dan batasi hanya untuk akun ber-role owner (app_metadata tidak bisa diubah pengguna).
drop policy if exists "authenticated read prices" on public.model_prices;
drop policy if exists "authenticated write prices" on public.model_prices;

create policy "owner manages prices" on public.model_prices
  for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'owner');
