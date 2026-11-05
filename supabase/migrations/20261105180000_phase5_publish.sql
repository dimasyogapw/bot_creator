-- Fase 5: publikasi (link publik + widget), batas pemakaian, rate limit.

-- Pengaturan publikasi per bot (bawaan sesuai keputusan owner 2026-11-05).
alter table public.bots
  add column daily_cost_limit_usd numeric(10, 4) not null default 1 check (daily_cost_limit_usd >= 0 and daily_cost_limit_usd <= 1000),
  add column daily_message_limit integer not null default 300 check (daily_message_limit between 0 and 100000),
  add column per_minute_limit integer not null default 20 check (per_minute_limit between 1 and 600),
  add column limit_message text not null default 'Maaf, layanan chat sedang ramai. Silakan coba lagi beberapa saat lagi.' check (char_length(limit_message) between 1 and 500),
  add column widget jsonb not null default '{}'::jsonb,
  add column allowed_domains text[] not null default '{}' check (cardinality(allowed_domains) <= 20);

-- RATE LIMIT: hitungan per kunci per jendela waktu. Hanya server (secret key) yang boleh memakai.
create table public.rate_limits (
  key text not null check (char_length(key) <= 300),
  bucket timestamptz not null,
  count integer not null default 0,
  primary key (key, bucket)
);
alter table public.rate_limits enable row level security;
-- Sengaja tanpa policy: anon dan authenticated tidak bisa membaca/menulis.
revoke all on public.rate_limits from anon, authenticated;

-- Tambah hitungan dan kembalikan true jika masih di bawah batas. Atomik (insert ... on conflict).
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, bucket, count) values (p_key, v_bucket, 1)
  on conflict (key, bucket) do update set count = public.rate_limits.count + 1
  returning count into v_count;
  -- bersihkan jendela lama sesekali
  if random() < 0.02 then
    delete from public.rate_limits where bucket < now() - interval '1 day';
  end if;
  return v_count <= p_max;
end;
$$;

-- Pemakaian channel publik hari ini (zona waktu WIB): jumlah jawaban bot dan total biaya.
create or replace function public.bot_public_usage_today(p_bot_id uuid)
returns table (messages integer, cost_usd numeric) language sql stable security definer set search_path = '' as $$
  select count(*)::integer, coalesce(sum(m.cost_usd), 0)
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where c.bot_id = p_bot_id
    and c.channel <> 'playground'
    and m.role = 'assistant'
    and m.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta');
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.bot_public_usage_today(uuid) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
grant execute on function public.bot_public_usage_today(uuid) to service_role;

-- Index untuk menghitung pemakaian harian.
create index if not exists messages_created_at_idx on public.messages (created_at);
