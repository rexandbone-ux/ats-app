-- Assigner + Recommender agents (team-agents edge function).
-- Adds one table for recommendations and two cron jobs. Existing tables and policies are untouched.

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid references public.profiles(id) on delete cascade,  -- null = whole team
  kind text not null,                -- reply | stalled | overdue | thin_pipeline | drafts
  priority text not null default 'medium' check (priority in ('urgent', 'high', 'medium', 'low')),
  message text not null,
  candidate_id uuid references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  dedupe_key text not null unique,   -- one open recommendation per situation
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists recommendations_open_idx on public.recommendations (recruiter_id) where status = 'open';

alter table public.recommendations enable row level security;
create policy staff_all_recommendations on public.recommendations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

select cron.schedule('team-agents-assign', '10,40 * * * *', $cron$
  select net.http_post(
    url := 'https://nwknnsbiroppdaraxmxp.supabase.co/functions/v1/team-agents',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select value from public.app_secrets where key = 'sync_secret')),
    body := '{"action":"assign"}'::jsonb, timeout_milliseconds := 60000);
$cron$);

select cron.schedule('team-agents-recommend', '25 * * * *', $cron$
  select net.http_post(
    url := 'https://nwknnsbiroppdaraxmxp.supabase.co/functions/v1/team-agents',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select value from public.app_secrets where key = 'sync_secret')),
    body := '{"action":"recommend"}'::jsonb, timeout_milliseconds := 60000);
$cron$);
