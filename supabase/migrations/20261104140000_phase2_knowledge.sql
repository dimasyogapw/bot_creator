-- Fase 2: knowledge (sumber dokumen, chunk + embedding, pencarian hybrid, storage).
-- Semua tabel memakai RLS lewat kepemilikan bot.

create extension if not exists vector with schema extensions;

-- KNOWLEDGE SOURCES -----------------------------------------------------
create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  type text not null check (type in ('file', 'url', 'text')),
  title text not null check (char_length(title) between 1 and 300),
  -- uploading: file belum selesai diupload browser; pending: siap diproses.
  status text not null default 'pending' check (status in ('uploading', 'pending', 'processing', 'ready', 'error')),
  error_message text check (char_length(error_message) <= 500),
  storage_path text,
  url text check (char_length(url) <= 2000),
  mime text,
  size_bytes bigint check (size_bytes >= 0),
  chunk_count integer check (chunk_count >= 0),
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, bot_id)
);
create index knowledge_sources_bot_id_created_idx on public.knowledge_sources (bot_id, created_at desc);
create trigger knowledge_sources_set_updated_at before update on public.knowledge_sources
  for each row execute function public.set_updated_at();

alter table public.knowledge_sources enable row level security;
create policy "owner manages knowledge sources of own bots" on public.knowledge_sources
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- KNOWLEDGE CHUNKS ------------------------------------------------------
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  bot_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 20000),
  embedding extensions.vector(1536),
  fts tsvector generated always as (to_tsvector('simple', content)) stored,
  metadata jsonb not null default '{}'::jsonb,
  token_count integer,
  created_at timestamptz not null default now(),
  -- chunk selalu milik bot yang sama dengan sumbernya; ikut terhapus bersama sumber.
  foreign key (source_id, bot_id) references public.knowledge_sources (id, bot_id) on delete cascade,
  unique (source_id, chunk_index)
);
create index knowledge_chunks_bot_id_idx on public.knowledge_chunks (bot_id);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_chunks_fts_idx on public.knowledge_chunks using gin (fts);

alter table public.knowledge_chunks enable row level security;
create policy "owner manages knowledge chunks of own bots" on public.knowledge_chunks
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

revoke all on public.knowledge_sources, public.knowledge_chunks from anon;
grant select, insert, update, delete on public.knowledge_sources, public.knowledge_chunks to authenticated;

-- Simpan embedding banyak chunk sekaligus (vektor dikirim sebagai teks '[...]').
create or replace function public.set_chunk_embeddings(p_ids uuid[], p_embeddings text[])
returns integer
language sql
security invoker
set search_path = ''
as $$
  with u as (
    update public.knowledge_chunks c
    set embedding = e.emb::extensions.vector
    from unnest(p_ids, p_embeddings) as e(id, emb)
    where c.id = e.id
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Pencarian hybrid: vektor (cosine) + full-text, digabung dengan Reciprocal Rank Fusion.
-- Hanya sumber berstatus ready. security invoker: tunduk pada RLS pemanggil.
create or replace function public.match_knowledge(
  p_bot_id uuid,
  p_query_embedding extensions.vector(1536),
  p_query_text text,
  p_match_count integer default 6,
  p_rrf_k integer default 50
)
returns table (id uuid, source_id uuid, source_title text, chunk_index integer, content text, metadata jsonb, score double precision)
language sql
stable
security invoker
set search_path = ''
set hnsw.ef_search = 100
set hnsw.iterative_scan = 'relaxed_order'
as $$
  with q as (
    select to_tsquery('simple', coalesce(
      (select string_agg(w, ' | ')
       from regexp_split_to_table(lower(coalesce(p_query_text, '')), '[^[:alnum:]]+') as w
       where char_length(w) > 1),
      '')) as tsq
  ),
  ready as (
    select s.id, s.title from public.knowledge_sources s
    where s.bot_id = p_bot_id and s.status = 'ready'
  ),
  semantic as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_query_embedding) as rank
    from public.knowledge_chunks c
    where c.bot_id = p_bot_id and c.embedding is not null and c.source_id in (select r.id from ready r)
    order by c.embedding operator(extensions.<=>) p_query_embedding
    limit p_match_count * 4
  ),
  fulltext as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as rank
    from public.knowledge_chunks c, q
    where c.bot_id = p_bot_id and c.fts @@ q.tsq and c.source_id in (select r.id from ready r)
    order by ts_rank_cd(c.fts, q.tsq) desc
    limit p_match_count * 4
  )
  select c.id, c.source_id, r.title, c.chunk_index, c.content, c.metadata,
    (coalesce(1.0 / (p_rrf_k + s.rank), 0) + coalesce(1.0 / (p_rrf_k + f.rank), 0))::double precision as score
  from semantic s
  full outer join fulltext f on s.id = f.id
  join public.knowledge_chunks c on c.id = coalesce(s.id, f.id)
  join ready r on r.id = c.source_id
  order by score desc
  limit least(greatest(p_match_count, 1), 20);
$$;

revoke execute on function public.set_chunk_embeddings(uuid[], text[]) from public, anon;
revoke execute on function public.match_knowledge(uuid, extensions.vector, text, integer, integer) from public, anon;
grant execute on function public.set_chunk_embeddings(uuid[], text[]) to authenticated;
grant execute on function public.match_knowledge(uuid, extensions.vector, text, integer, integer) to authenticated;

-- STORAGE: bucket privat, path bot_id/source_id/nama-file ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge', 'knowledge', false, 20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do nothing;

create policy "owner manages knowledge files" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'knowledge'
    and exists (select 1 from public.bots b where b.id::text = (storage.foldername(name))[1] and b.owner_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'knowledge'
    and exists (select 1 from public.bots b where b.id::text = (storage.foldername(name))[1] and b.owner_id = (select auth.uid()))
  );
