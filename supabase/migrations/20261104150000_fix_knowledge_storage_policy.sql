-- Perbaikan: di policy sebelumnya `name` di dalam subquery terbaca sebagai bots.name,
-- bukan storage.objects.name, sehingga semua upload ditolak. Kolom kini ditulis lengkap.
drop policy if exists "owner manages knowledge files" on storage.objects;

create policy "owner manages knowledge files" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'knowledge'
    and exists (
      select 1 from public.bots b
      where b.id::text = (storage.foldername(objects.name))[1] and b.owner_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'knowledge'
    and exists (
      select 1 from public.bots b
      where b.id::text = (storage.foldername(objects.name))[1] and b.owner_id = (select auth.uid())
    )
  );
