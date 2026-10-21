-- Rubric auto-scoring for new arrivals (score-candidate edge function).
-- Adds one helper function and one cron job. No tables, columns or policies are changed.
-- Arrivals before app_secrets.rubric_autoscore_since are the backlog and are NOT scored automatically.

create or replace function public.rubric_pending(max_rows int default 6, max_attempts int default 3)
returns table (candidate_id uuid, job_id uuid, application_id uuid, created_at timestamptz)
language sql stable
set search_path = ''
as $$
  with since as (
    select value::timestamptz as t from public.app_secrets where key = 'rubric_autoscore_since'
  ),
  apps as (
    select a.candidate_id, a.job_id, a.id as application_id, a.created_at
    from public.applications a
    join public.candidates c on c.id = a.candidate_id, since
    where a.created_at >= since.t
      and coalesce((c.custom_fields -> 'rubric_error' ->> 'attempts')::int, 0) < max_attempts
      and not exists (
        select 1 from public.screening_results s
        where s.candidate_id = a.candidate_id and s.job_id = a.job_id and s.result ->> 'engine' = 'rubric'
      )
  ),
  cands as (
    select c.id as candidate_id, null::uuid as job_id, null::uuid as application_id, c.created_at
    from public.candidates c, since
    where c.created_at >= since.t
      and c.ai_analysis -> 'rubric' is null
      and coalesce((c.custom_fields -> 'rubric_error' ->> 'attempts')::int, 0) < max_attempts
      and not exists (select 1 from public.applications a where a.candidate_id = c.id)
  )
  select * from (select * from apps union all select * from cands) q
  order by q.created_at
  limit max_rows;
$$;

revoke all on function public.rubric_pending(int, int) from public, anon, authenticated;
grant execute on function public.rubric_pending(int, int) to service_role;

select cron.schedule(
  'rubric-autoscore',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nwknnsbiroppdaraxmxp.supabase.co/functions/v1/score-candidate',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select value from public.app_secrets where key = 'sync_secret')),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
