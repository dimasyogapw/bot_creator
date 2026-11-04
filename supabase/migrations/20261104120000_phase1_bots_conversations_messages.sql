-- Fase 1: bots, conversations, messages, model_prices. Semua tabel memakai RLS.

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- BOTS ------------------------------------------------------------------
create table public.bots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  avatar_url text,
  system_prompt text not null default '' check (char_length(system_prompt) <= 20000),
  model text not null,
  temperature numeric(3, 2) not null default 0.7 check (temperature between 0 and 1),
  max_tokens integer not null default 2048 check (max_tokens between 1024 and 16000),
  welcome_message text check (char_length(welcome_message) <= 1000),
  is_public boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bots_owner_id_idx on public.bots (owner_id);
create trigger bots_set_updated_at before update on public.bots
  for each row execute function public.set_updated_at();

alter table public.bots enable row level security;
create policy "owner manages own bots" on public.bots
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- CONVERSATIONS ---------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  end_user_id uuid, -- FK ke end_users ditambahkan di fase 3
  channel text not null default 'playground'
    check (channel in ('playground', 'web', 'widget', 'telegram', 'whatsapp')),
  title text check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_bot_id_updated_idx on public.conversations (bot_id, updated_at desc);
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
create policy "owner manages conversations of own bots" on public.conversations
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- MESSAGES --------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content jsonb not null,
  model text,
  tokens_in integer,
  tokens_out integer,
  tokens_cached integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  feedback smallint not null default 0 check (feedback in (-1, 0, 1)),
  status text not null default 'complete' check (status in ('complete', 'stopped', 'error')),
  created_at timestamptz not null default now()
);
create index messages_conversation_id_created_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;
create policy "owner manages messages of own bots" on public.messages
  for all to authenticated
  using (exists (
    select 1 from public.conversations c join public.bots b on b.id = c.bot_id
    where c.id = conversation_id and b.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from public.conversations c join public.bots b on b.id = c.bot_id
    where c.id = conversation_id and b.owner_id = (select auth.uid())));

-- MODEL PRICES (harga per 1 juta token, USD; bisa diedit owner) -----------
create table public.model_prices (
  model text primary key,
  input_per_mtok numeric(10, 4) not null check (input_per_mtok >= 0),
  output_per_mtok numeric(10, 4) not null check (output_per_mtok >= 0),
  cache_read_per_mtok numeric(10, 4) check (cache_read_per_mtok >= 0),
  cache_write_per_mtok numeric(10, 4) check (cache_write_per_mtok >= 0),
  updated_at timestamptz not null default now()
);
create trigger model_prices_set_updated_at before update on public.model_prices
  for each row execute function public.set_updated_at();

alter table public.model_prices enable row level security;
create policy "authenticated read prices" on public.model_prices
  for select to authenticated using (true);
create policy "authenticated write prices" on public.model_prices
  for all to authenticated using (true) with check (true);

-- HAK AKSES: hanya pengguna login, anon tidak bisa apa-apa ------------------
revoke all on public.bots, public.conversations, public.messages, public.model_prices from anon;
grant select, insert, update, delete on public.bots, public.conversations, public.messages, public.model_prices to authenticated;
