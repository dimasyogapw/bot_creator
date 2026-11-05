-- Fase 3: end user, memory, ringkasan percakapan. Semua tabel memakai RLS lewat kepemilikan bot.

-- END USERS -------------------------------------------------------------
create table public.end_users (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  channel text not null check (channel in ('playground', 'web', 'widget', 'telegram', 'whatsapp')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  display_name text check (char_length(display_name) <= 200),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (bot_id, channel, external_id),
  unique (id, bot_id)
);

alter table public.end_users enable row level security;
create policy "owner manages end users of own bots" on public.end_users
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- MEMORIES --------------------------------------------------------------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null,
  end_user_id uuid not null,
  content text not null check (char_length(content) between 1 and 500),
  importance smallint not null default 3 check (importance between 1 and 5),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- memory selalu milik end user dari bot yang sama; ikut terhapus bersama end user.
  foreign key (end_user_id, bot_id) references public.end_users (id, bot_id) on delete cascade
);
create index memories_end_user_bot_idx on public.memories (end_user_id, bot_id);
create index memories_bot_id_idx on public.memories (bot_id);
create index memories_source_conversation_idx on public.memories (source_conversation_id);
create trigger memories_set_updated_at before update on public.memories
  for each row execute function public.set_updated_at();

alter table public.memories enable row level security;
create policy "owner manages memories of own bots" on public.memories
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- CONVERSATIONS: end user + ringkasan + penanda ekstraksi memory -----------
alter table public.conversations
  add column summary text check (char_length(summary) <= 8000),
  add column summary_until timestamptz,
  add column memory_until timestamptz;
alter table public.conversations
  add constraint conversations_end_user_fkey foreign key (end_user_id, bot_id)
  references public.end_users (id, bot_id) on delete set null (end_user_id);
create index conversations_end_user_bot_idx on public.conversations (end_user_id, bot_id);

-- BOTS: memory mati secara bawaan (keputusan owner 2026-11-05) -------------
alter table public.bots add column memory_enabled boolean not null default false;

-- Percakapan playground lama diberi end user owner.
insert into public.end_users (bot_id, channel, external_id, display_name)
select distinct c.bot_id, 'playground', 'owner', 'Owner (playground)'
from public.conversations c where c.channel = 'playground'
on conflict (bot_id, channel, external_id) do nothing;

update public.conversations c
set end_user_id = e.id
from public.end_users e
where c.channel = 'playground' and c.end_user_id is null
  and e.bot_id = c.bot_id and e.channel = 'playground' and e.external_id = 'owner';

-- Ringkasan per percakapan untuk tab Percakapan (security_invoker: tunduk pada RLS).
create view public.conversation_overview with (security_invoker = true) as
select
  c.id, c.bot_id, c.channel, c.title, c.end_user_id, c.created_at, c.updated_at,
  e.display_name as end_user_name,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.role in ('user', 'assistant'))::integer as message_count,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = 1)::integer as thumbs_up,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = -1)::integer as thumbs_down
from public.conversations c
left join public.end_users e on e.id = c.end_user_id;

revoke all on public.end_users, public.memories, public.conversation_overview from anon;
grant select, insert, update, delete on public.end_users, public.memories to authenticated;
grant select on public.conversation_overview to authenticated;
