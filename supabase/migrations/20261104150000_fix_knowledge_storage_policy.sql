-- Perbaikan: di policy sebelumnya `name` di dalam subquery terbaca sebagai bots.name,
-- bukan storage.objects.name, sehingga semua upload ditolak. Kolom kini ditulis lengkap.
-- Memakai ALTER (bukan drop + create) supaya tidak ada jeda tanpa policy.
alter policy "owner manages knowledge files" on storage.objects
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
