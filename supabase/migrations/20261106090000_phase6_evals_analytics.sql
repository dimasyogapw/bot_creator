-- Fase 6: Evals + analytics. Semua tabel baru memakai RLS.

-- 1. Channel baru "eval" untuk percakapan uji otomatis ------------------------
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('playground', 'web', 'widget', 'telegram', 'whatsapp', 'eval'));
alter table public.end_users drop constraint if exists end_users_channel_check;
alter table public.end_users add constraint end_users_channel_check
  check (channel in ('playground', 'web', 'widget', 'telegram', 'whatsapp', 'eval'));

-- Tab Percakapan tidak menampilkan percakapan eval.
create or replace view public.conversation_overview with (security_invoker = true) as
select
  c.id, c.bot_id, c.channel, c.title, c.end_user_id, c.created_at, c.updated_at,
  e.display_name as end_user_name,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.role in ('user', 'assistant'))::integer as message_count,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = 1)::integer as thumbs_up,
  (select count(*) from public.messages m where m.conversation_id = c.id and m.feedback = -1)::integer as thumbs_down,
  (select count(*) from public.handoff_requests h where h.conversation_id = c.id and h.status = 'open')::integer as open_handoffs
from public.conversations c
left join public.end_users e on e.id = c.end_user_id
where c.channel <> 'eval';

-- 2. EVAL_CASES: soal uji per bot ------------------------------------------------
create table public.eval_cases (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  input text not null check (char_length(input) between 1 and 4000),
  expected_behavior text not null check (char_length(expected_behavior) between 1 and 2000),
  tags text[] not null default '{}',
  -- Pesan pendahuluan (urut) yang dikirim dulu di percakapan yang sama, mis. "Nama saya Budi".
  setup jsonb not null default '[]'::jsonb,
  -- true: pertanyaan utama dikirim di percakapan BARU (tetap pengguna uji yang sama), untuk tes memory.
  new_conversation boolean not null default false,
  source_conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index eval_cases_bot_idx on public.eval_cases (bot_id, created_at);
create index eval_cases_source_conversation_idx on public.eval_cases (source_conversation_id);
create trigger eval_cases_set_updated_at before update on public.eval_cases
  for each row execute function public.set_updated_at();

-- 3. EVAL_RUNS: satu kali menekan "Jalankan" ----------------------------------
create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done')),
  source text not null default 'app' check (source in ('app', 'cli')),
  judge_model text not null,
  -- Salinan pengaturan bot saat run dimulai (untuk membandingkan run).
  bot_snapshot jsonb not null default '{}'::jsonb,
  total integer not null default 0,
  pass_count integer not null default 0,
  fail_count integer not null default 0,
  error_count integer not null default 0,
  skipped_count integer not null default 0,
  estimated_cost_usd numeric(12, 6),
  cost_bot_usd numeric(12, 6) not null default 0,
  cost_judge_usd numeric(12, 6) not null default 0,
  cost_background_usd numeric(12, 6) not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index eval_runs_bot_created_idx on public.eval_runs (bot_id, created_at desc);

-- 4. EVAL_RESULTS: hasil per kasus dalam satu run -------------------------------
create table public.eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.eval_runs (id) on delete cascade,
  case_id uuid references public.eval_cases (id) on delete set null,
  position integer not null,
  -- Salinan soal saat run (soal bisa diedit/dihapus setelahnya).
  case_input text not null,
  case_expected text not null,
  case_tags text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'pass', 'fail', 'error', 'skipped')),
  reason text,
  answer text,
  tools jsonb not null default '[]'::jsonb,
  citations_count integer not null default 0,
  conversation_id uuid references public.conversations (id) on delete set null,
  cost_bot_usd numeric(12, 6) not null default 0,
  cost_judge_usd numeric(12, 6) not null default 0,
  cost_background_usd numeric(12, 6) not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  latency_ms integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, position)
);
create index eval_results_case_idx on public.eval_results (case_id);
create index eval_results_conversation_idx on public.eval_results (conversation_id);

-- 5. LLM_USAGE: panggilan model di luar jawaban bot (jawaban bot ada di messages) ----
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users (id) on delete set null,
  bot_id uuid references public.bots (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  eval_run_id uuid references public.eval_runs (id) on delete cascade,
  eval_result_id uuid references public.eval_results (id) on delete cascade,
  purpose text not null check (purpose in ('memory', 'summary', 'embedding', 'persona', 'web_search_test', 'eval_judge', 'eval_suggest')),
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  tokens_cached integer not null default 0,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);
create index llm_usage_bot_created_idx on public.llm_usage (bot_id, created_at);
create index llm_usage_owner_idx on public.llm_usage (owner_id);
create index llm_usage_conversation_idx on public.llm_usage (conversation_id);
create index llm_usage_eval_run_idx on public.llm_usage (eval_run_id);
create index llm_usage_eval_result_idx on public.llm_usage (eval_result_id);

-- 6. RLS -------------------------------------------------------------------
alter table public.eval_cases enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_results enable row level security;
alter table public.llm_usage enable row level security;

create policy "owner manages eval cases of own bots" on public.eval_cases
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

create policy "owner manages eval runs of own bots" on public.eval_runs
  for all to authenticated
  using (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid())));

create policy "owner manages eval results of own bots" on public.eval_results
  for all to authenticated
  using (exists (
    select 1 from public.eval_runs r join public.bots b on b.id = r.bot_id
    where r.id = run_id and b.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from public.eval_runs r join public.bots b on b.id = r.bot_id
    where r.id = run_id and b.owner_id = (select auth.uid())));

create policy "owner reads llm usage" on public.llm_usage
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid()))
  );
create policy "owner writes llm usage" on public.llm_usage
  for insert to authenticated
  with check (
    (bot_id is null and owner_id = (select auth.uid()))
    or exists (select 1 from public.bots b where b.id = bot_id and b.owner_id = (select auth.uid()))
  );

revoke all on public.eval_cases, public.eval_runs, public.eval_results, public.llm_usage from anon;
grant select, insert, update, delete on public.eval_cases, public.eval_runs, public.eval_results to authenticated;
grant select, insert on public.llm_usage to authenticated;

-- 7. Hitung ulang total biaya dan skor satu run dari hasil per kasus --------------
create or replace function public.recompute_eval_run(p_run_id uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.eval_runs r set
    pass_count = s.pass_n,
    fail_count = s.fail_n,
    error_count = s.error_n,
    skipped_count = s.skipped_n,
    cost_bot_usd = s.bot,
    cost_judge_usd = s.judge,
    cost_background_usd = s.bg,
    cost_usd = s.bot + s.judge + s.bg,
    tokens_in = s.tin,
    tokens_out = s.tout,
    status = case when s.open_n = 0 then 'done' else r.status end,
    finished_at = case when s.open_n = 0 then coalesce(r.finished_at, now()) else r.finished_at end
  from (
    select
      count(*) filter (where status = 'pass')::integer as pass_n,
      count(*) filter (where status = 'fail')::integer as fail_n,
      count(*) filter (where status = 'error')::integer as error_n,
      count(*) filter (where status = 'skipped')::integer as skipped_n,
      count(*) filter (where status in ('pending', 'running'))::integer as open_n,
      coalesce(sum(cost_bot_usd), 0) as bot,
      coalesce(sum(cost_judge_usd), 0) as judge,
      coalesce(sum(cost_background_usd), 0) as bg,
      coalesce(sum(tokens_in), 0)::integer as tin,
      coalesce(sum(tokens_out), 0)::integer as tout
    from public.eval_results where run_id = p_run_id
  ) s
  where r.id = p_run_id;
$$;

-- 8. Analitik per bot, per hari (WIB). Channel eval dihitung terpisah. ---------------
create or replace function public.bot_analytics(p_bot_id uuid, p_days integer default 30)
returns table (
  day date,
  conversations integer,
  answers integer,
  tokens_in bigint,
  tokens_out bigint,
  cost_answers numeric,
  cost_background numeric,
  cost_eval numeric,
  latency_sum_ms bigint,
  latency_count integer,
  ttft_sum_ms bigint,
  ttft_count integer,
  thumbs_up integer,
  thumbs_down integer
) language sql stable security invoker set search_path = '' as $$
  with params as (
    select (now() at time zone 'Asia/Jakarta')::date as today, greatest(1, least(p_days, 366)) as n
  ),
  days as (
    select (p.today - g)::date as d from params p, generate_series(0, (select n from params) - 1) g
  ),
  conv as (
    select (c.created_at at time zone 'Asia/Jakarta')::date as d, count(*)::integer as n
    from public.conversations c
    where c.bot_id = p_bot_id and c.channel <> 'eval'
      and c.created_at >= ((select today - (n - 1) from params)::timestamp at time zone 'Asia/Jakarta')
    group by 1
  ),
  msg as (
    select
      (m.created_at at time zone 'Asia/Jakarta')::date as d,
      count(*) filter (where c.channel <> 'eval')::integer as answers,
      coalesce(sum(m.tokens_in) filter (where c.channel <> 'eval'), 0)::bigint as tin,
      coalesce(sum(m.tokens_out) filter (where c.channel <> 'eval'), 0)::bigint as tout,
      coalesce(sum(m.cost_usd) filter (where c.channel <> 'eval'), 0) as cost_answers,
      coalesce(sum(m.cost_usd) filter (where c.channel = 'eval'), 0) as cost_eval_answers,
      coalesce(sum(m.latency_ms) filter (where c.channel <> 'eval'), 0)::bigint as lat_sum,
      count(m.latency_ms) filter (where c.channel <> 'eval')::integer as lat_n,
      coalesce(sum((m.content ->> 'ttft_ms')::integer) filter (where c.channel <> 'eval' and m.content ? 'ttft_ms'), 0)::bigint as ttft_sum,
      count(*) filter (where c.channel <> 'eval' and m.content ? 'ttft_ms')::integer as ttft_n,
      count(*) filter (where c.channel <> 'eval' and m.feedback = 1)::integer as up,
      count(*) filter (where c.channel <> 'eval' and m.feedback = -1)::integer as down
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.bot_id = p_bot_id and m.role = 'assistant'
      and m.created_at >= ((select today - (n - 1) from params)::timestamp at time zone 'Asia/Jakarta')
    group by 1
  ),
  usage as (
    select
      (u.created_at at time zone 'Asia/Jakarta')::date as d,
      coalesce(sum(u.cost_usd) filter (where u.eval_run_id is null), 0) as bg,
      coalesce(sum(u.cost_usd) filter (where u.eval_run_id is not null), 0) as eval_bg
    from public.llm_usage u
    where u.bot_id = p_bot_id
      and u.created_at >= ((select today - (n - 1) from params)::timestamp at time zone 'Asia/Jakarta')
    group by 1
  )
  select
    days.d,
    coalesce(conv.n, 0),
    coalesce(msg.answers, 0),
    coalesce(msg.tin, 0),
    coalesce(msg.tout, 0),
    coalesce(msg.cost_answers, 0),
    coalesce(usage.bg, 0),
    coalesce(msg.cost_eval_answers, 0) + coalesce(usage.eval_bg, 0),
    coalesce(msg.lat_sum, 0),
    coalesce(msg.lat_n, 0),
    coalesce(msg.ttft_sum, 0),
    coalesce(msg.ttft_n, 0),
    coalesce(msg.up, 0),
    coalesce(msg.down, 0)
  from days
  left join conv on conv.d = days.d
  left join msg on msg.d = days.d
  left join usage on usage.d = days.d
  order by days.d;
$$;

grant execute on function public.recompute_eval_run(uuid) to authenticated, service_role;
grant execute on function public.bot_analytics(uuid, integer) to authenticated, service_role;
revoke execute on function public.recompute_eval_run(uuid) from public, anon;
revoke execute on function public.bot_analytics(uuid, integer) from public, anon;

-- 9. Batas harian channel publik: hanya channel publik (bukan playground/eval), dan ikut menghitung
--    biaya latar belakang (memory, ringkasan, embedding pencarian) dari percakapan publik.
create or replace function public.bot_public_usage_today(p_bot_id uuid)
returns table (messages integer, cost_usd numeric) language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer
       from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.bot_id = p_bot_id and c.channel in ('web', 'widget', 'telegram', 'whatsapp') and m.role = 'assistant'
        and m.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')),
    (select coalesce(sum(m.cost_usd), 0)
       from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.bot_id = p_bot_id and c.channel in ('web', 'widget', 'telegram', 'whatsapp') and m.role = 'assistant'
        and m.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'))
    +
    (select coalesce(sum(u.cost_usd), 0)
       from public.llm_usage u join public.conversations c on c.id = u.conversation_id
      where u.bot_id = p_bot_id and c.channel in ('web', 'widget', 'telegram', 'whatsapp')
        and u.created_at >= (date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'));
$$;
