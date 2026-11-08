-- Fase 7: koneksi channel pesan (Telegram dulu). Semua tabel memakai RLS.

-- KONEKSI CHANNEL ---------------------------------------------------------
-- Satu koneksi per bot per channel. Token dan kode rahasia webhook TIDAK disimpan di sini
-- melainkan di Vault (fungsi khusus server di bawah).
create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  channel text not null check (channel ~ '^[a-z]{3,20}$'),
  enabled boolean not null default true,
  status text not null default 'connected' check (status in ('connected', 'error')),
  bot_username text check (char_length(bot_username) <= 64),
  external_bot_id bigint,
  last_error text check (char_length(last_error) <= 500),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bot_id, channel)
);
create trigger channel_connections_set_updated_at before update on public.channel_connections
  for each row execute function public.set_updated_at();

alter table public.channel_connections enable row level security;
-- Pemilik hanya boleh MEMBACA (status di tab Publikasi). Semua perubahan lewat server (secret key)
-- setelah kepemilikan bot dibuktikan lewat RLS.
create policy "owner reads channel connections of own bots" on public.channel_connections
  for select to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

revoke all on public.channel_connections from anon;
revoke insert, update, delete on public.channel_connections from authenticated;
grant select on public.channel_connections to authenticated;

-- PESAN MASUK YANG SUDAH DIPROSES (anti-ganda) ---------------------------------
create table public.channel_updates (
  connection_id uuid not null references public.channel_connections (id) on delete cascade,
  update_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (connection_id, update_id)
);
create index channel_updates_created_idx on public.channel_updates (created_at);
alter table public.channel_updates enable row level security;
-- Sengaja tanpa policy: hanya server.
revoke all on public.channel_updates from anon, authenticated;

-- Klaim satu pesan masuk. true = baru (boleh diproses), false = sudah pernah diproses.
-- Pembersihan catatan lama dilakukan kode aplikasi (bukan di sini).
create or replace function public.claim_channel_update(p_connection_id uuid, p_update_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  insert into public.channel_updates (connection_id, update_id) values (p_connection_id, p_update_id)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- CHAT AKTIF PER PENGGUNA CHANNEL -----------------------------------------------
-- Penunjuk percakapan yang sedang berlanjut untuk satu chat. "/baru" mengosongkannya.
create table public.channel_chats (
  connection_id uuid not null references public.channel_connections (id) on delete cascade,
  chat_id bigint not null,
  conversation_id uuid references public.conversations (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, chat_id)
);
create index channel_chats_conversation_idx on public.channel_chats (conversation_id);
alter table public.channel_chats enable row level security;
revoke all on public.channel_chats from anon, authenticated;

-- RAHASIA KONEKSI (Vault) ---------------------------------------------------------
-- Nama secret: channel:<connection_id>:<token|webhook_secret>. HANYA bisa dipanggil server (secret key).
create or replace function public.set_channel_secret(p_connection_id uuid, p_key text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  if p_key not in ('token', 'webhook_secret') or p_value is null or char_length(p_value) > 500 then -- nilai kosong boleh: dipakai menimpa rahasia saat koneksi diputus
    raise exception 'data tidak valid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.channel_connections where id = p_connection_id) then
    raise exception 'koneksi tidak ada' using errcode = '22023';
  end if;
  v_name := 'channel:' || p_connection_id::text || ':' || p_key;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_value, v_name, 'Rahasia koneksi channel');
  else
    perform vault.update_secret(v_id, p_value, v_name, 'Rahasia koneksi channel');
  end if;
end;
$$;

create or replace function public.get_channel_secrets(p_connection_id uuid)
returns table (key text, value text) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'tidak diizinkan' using errcode = '42501';
  end if;
  return query
    select split_part(d.name, ':', 3), d.decrypted_secret
    from vault.decrypted_secrets d
    where d.name like 'channel:' || p_connection_id::text || ':%';
end;
$$;

-- Rahasia TIDAK dihapus lewat SQL di sini. Saat koneksi diputus atau bot dihapus, kode aplikasi menimpa
-- token dan kode rahasia dengan nilai kosong (set_channel_secret). Pembersihan baris kosong menyusul di migrasi terpisah.

revoke execute on function public.claim_channel_update(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.set_channel_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.get_channel_secrets(uuid) from public, anon, authenticated;
grant execute on function public.claim_channel_update(uuid, bigint) to service_role;
grant execute on function public.set_channel_secret(uuid, text, text) to service_role;
grant execute on function public.get_channel_secrets(uuid) to service_role;
