-- Perbaikan peringkat full-text di match_knowledge.
-- Masalah: dengan kueri OR, chunk yang mengulang satu kata umum (mis. "karyawan") berkali-kali
-- mengalahkan chunk yang memuat hampir semua kata pertanyaan. Sekarang peringkat full-text
-- diurutkan dulu menurut jumlah kata kueri berbeda yang cocok, baru ts_rank_cd ternormalisasi panjang.
-- Kata tanya/kata sambung umum dibuang dari kueri full-text.
-- Setelan hnsw.ef_search/iterative_scan dilepas: Supabase menolak mengubahnya di level fungsi.
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
as $$
  with words as (
    select distinct w
    from regexp_split_to_table(lower(coalesce(p_query_text, '')), '[^[:alnum:]]+') as w
    where char_length(w) > 1
      and w <> all (array[
        'apa','apakah','yang','di','ke','dari','dan','atau','itu','ini','adalah','ialah','berapa','bagaimana',
        'siapa','kapan','mana','dimana','kenapa','mengapa','untuk','dengan','pada','saya','aku','kamu','anda',
        'tolong','mohon','bisa','boleh','ada','tidak','juga','sudah','akan','dalam','oleh','sebagai','agar',
        'the','is','are','what','how','who','when','where','of','to','in','for','and','or','an'])
  ),
  q as (
    select to_tsquery('simple', coalesce((select string_agg(w, ' | ') from words), '')) as tsq
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
  fts_hits as (
    select c.id,
      (select count(*) from words w where c.fts @@ to_tsquery('simple', w.w)) as coverage,
      ts_rank_cd(c.fts, q.tsq, 1) as tr
    from public.knowledge_chunks c, q
    where c.bot_id = p_bot_id and c.fts @@ q.tsq and c.source_id in (select r.id from ready r)
  ),
  fulltext as (
    select h.id, row_number() over (order by h.coverage desc, h.tr desc) as rank
    from fts_hits h
    order by h.coverage desc, h.tr desc
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
