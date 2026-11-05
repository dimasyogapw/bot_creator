-- Fase 4: skills, permintaan bantuan manusia, data pelanggan, upload gambar chat.
-- Semua tabel memakai RLS lewat kepemilikan bot. Header rahasia webhook disimpan di Supabase Vault.

-- SKILLS ----------------------------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  type text not null check (type in ('search_knowledge', 'http_webhook', 'current_datetime', 'web_fetch', 'web_search', 'handoff_to_human', 'capture_lead')),
  name text not null check (char_length(name) between 1 and 80),
  -- nama fungsi yang dilihat model; unik per bot
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  description text not null default '' check (char_length(description) <= 1000),
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, tool_name)
);
-- skill bawaan hanya satu per bot; webhook boleh banyak
create unique index skills_one_builtin_per_bot on public.skills (bot_id, type) where type <> 'http_webhook';
create trigger skills_set_updated_at before update on public.skills
  for each row execute function public.set_updated_at();

alter table public.skills enable row level security;
create policy "owner manages skills of own bots" on public.skills
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- RAHASIA SKILL (Vault) -------------------------------------------------
-- Nama secret: skill:<skill_id>:<nama_header>. Hanya pemilik bot (atau server dengan secret key).
create or replace function public.can_manage_skill(p_skill_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.skills s join public.bots b on b.id = s.bot_id
    where s.id = p_skill_id
      and (b.owner_id = (select auth.uid()) or (select auth.role()) = 'service_role')
  );
$$;

create or replace function public.set_skill_secret(p_skill_id uuid, p_key text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_id uuid;
begin
  if not public.can_manage_skill(p_skill_id) then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  if p_key !~ '^[A-Za-z0-9-]{1,100}$' or p_value is null or char_length(p_value) > 4000 then
    raise exception 'data tidak valid' using errcode = '22023';
  end if;
  v_name := 'skill:' || p_skill_id::text || ':' || lower(p_key);
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_value, v_name, 'Header rahasia skill');
  else
    perform vault.update_secret(v_id, p_value, v_name, 'Header rahasia skill');
  end if;
end;
$$;

create or replace function public.delete_skill_secret(p_skill_id uuid, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_skill(p_skill_id) then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  delete from vault.secrets where name = 'skill:' || p_skill_id::text || ':' || lower(p_key);
end;
$$;

-- Dipakai server saat menjalankan skill. Tidak pernah dipanggil dari browser.
create or replace function public.get_skill_secrets(p_skill_id uuid)
returns table (key text, value text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_skill(p_skill_id) then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  return query
    select split_part(d.name, ':', 3), d.decrypted_secret
    from vault.decrypted_secrets d
    where d.name like 'skill:' || p_skill_id::text || ':%';
end;
$$;

-- Skill (atau bot) dihapus: rahasianya ikut dihapus.
create or replace function public.delete_skill_secrets_on_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name like 'skill:' || old.id::text || ':%';
  return old;
end;
$$;
create trigger skills_delete_secrets after delete on public.skills
  for each row execute function public.delete_skill_secrets_on_delete();

revoke execute on function public.can_manage_skill(uuid) from public, anon;
revoke execute on function public.set_skill_secret(uuid, text, text) from public, anon;
revoke execute on function public.delete_skill_secret(uuid, text) from public, anon;
revoke execute on function public.get_skill_secrets(uuid) from public, anon;
revoke execute on function public.delete_skill_secrets_on_delete() from public, anon, authenticated;
grant execute on function public.can_manage_skill(uuid) to authenticated, service_role;
grant execute on function public.set_skill_secret(uuid, text, text) to authenticated, service_role;
grant execute on function public.delete_skill_secret(uuid, text) to authenticated, service_role;
grant execute on function public.get_skill_secrets(uuid) to authenticated, service_role;

-- PERMINTAAN BANTUAN MANUSIA --------------------------------------------
create table public.handoff_requests (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  end_user_id uuid references public.end_users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  summary text check (char_length(summary) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index handoff_requests_bot_status_idx on public.handoff_requests (bot_id, status, created_at desc);
create index handoff_requests_conversation_idx on public.handoff_requests (conversation_id);
create index handoff_requests_end_user_idx on public.handoff_requests (end_user_id);

alter table public.handoff_requests enable row level security;
create policy "owner manages handoff requests of own bots" on public.handoff_requests
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

-- DATA PELANGGAN (capture_lead) -----------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  end_user_id uuid references public.end_users (id) on delete set null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8000),
  created_at timestamptz not null default now()
);
create index leads_bot_created_idx on public.leads (bot_id, created_at desc);
create index leads_conversation_idx on public.leads (conversation_id);
create index leads_end_user_idx on public.leads (end_user_id);

alter table public.leads enable row level security;
create policy "owner manages leads of own bots" on public.leads
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

revoke all on public.skills, public.handoff_requests, public.leads from anon;
grant select, insert, update, delete on public.skills, public.handoff_requests, public.leads to authenticated;

-- Tab Percakapan: jumlah permintaan bantuan manusia yang masih terbuka.
create or replace view public.conversation_overview with (security_invoker = true) as
select
  c.id, c.bot_id, c.channel, c.title, c.end_user_id, c.created_at, c.updated_at,
  e.display_name as end_user_name,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.role in ('user', 'assistant'))::integer as message_count,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = 1)::integer as thumbs_up,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = -1)::integer as thumbs_down,
  (select count(*) from public.handoff_requests h where h.conversation_id = c.id and h.status = 'open')::integer as open_handoffs
from public.conversations c
left join public.end_users e on e.id = c.end_user_id;

-- STORAGE: gambar dari pengguna chat, path bot_id/uploads/<uuid>.<ext> -----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-uploads', 'chat-uploads', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "owner manages chat uploads" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'chat-uploads'
    and exists (
      select 1 from public.bots b
      where b.id::text = (storage.foldername(objects.name))[1] and b.owner_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'chat-uploads'
    and exists (
      select 1 from public.bots b
      where b.id::text = (storage.foldername(objects.name))[1] and b.owner_id = (select auth.uid())
    )
  );
