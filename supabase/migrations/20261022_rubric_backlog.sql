-- One-off backlog run: score active candidates who arrived before auto-scoring started,
-- through the half-price Message Batches API (score-candidate {action:"backlog"}).
-- Spend stops at app_secrets.rubric_backlog_cap_usd. The cron job removes itself once the queue is empty.

create table if not exists public.rubric_backlog (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'prepared', 'submitted', 'done', 'error')),
  params jsonb,          -- the prepared batch request, cleared once submitted
  meta jsonb,            -- role, data notes and transcript metrics needed to save the result
  batch_id text,
  cost_usd numeric,
  error text,
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rubric_backlog_status_idx on public.rubric_backlog (status);
alter table public.rubric_backlog enable row level security;
create policy staff_read_rubric_backlog on public.rubric_backlog for select to authenticated using (public.is_staff());

-- Active candidates without a rubric score, each against their latest open application where there is one.
insert into public.rubric_backlog (candidate_id, job_id, application_id)
select c.id, a.job_id, a.id
from public.candidates c
left join lateral (
  select ap.id, ap.job_id from public.applications ap
  where ap.candidate_id = c.id and ap.status::text <> 'rejected'
  order by ap.created_at desc limit 1
) a on true
where c.status::text not in ('placed', 'rejected', 'withdrawn', 'blacklisted')
  and c.ai_analysis -> 'rubric' is null
  and c.created_at < (select value::timestamptz from public.app_secrets where key = 'rubric_autoscore_since')
on conflict (candidate_id) do nothing;

insert into public.app_secrets (key, value) values ('rubric_backlog_cap_usd', '90')
on conflict (key) do update set value = excluded.value;

select cron.schedule('rubric-backlog', '*/3 * * * *', $cron$
  select case
    when exists (select 1 from public.rubric_backlog where status in ('queued', 'prepared', 'submitted'))
    then net.http_post(
      url := 'https://nwknnsbiroppdaraxmxp.supabase.co/functions/v1/score-candidate',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select value from public.app_secrets where key = 'sync_secret')),
      body := '{"action":"backlog"}'::jsonb, timeout_milliseconds := 150000)
    else (select cron.unschedule('rubric-backlog'))::int::bigint
  end;
$cron$);
