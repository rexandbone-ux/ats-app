-- Campaigns → Juicebox-style Agents (one per open job).
-- * Real filter columns (seniorities etc. used to live in last_result.extra_filters and got
--   overwritten on the first run).
-- * Exclusion lists the agent honours on every run (set by reviewers or by Recalibrate).
-- * Autonomy: auto | review_before_shortlist | review_before_sequence.
-- * Review queue state on campaign_members, and an agent_decisions log (staff-only RLS)
--   that outreach-agent learns from on each hourly run.

alter table public.outreach_campaigns
  add column if not exists seniorities       text[] not null default '{}',
  add column if not exists employee_ranges   text[] not null default '{}',
  add column if not exists industry_keywords text[] not null default '{}',
  add column if not exists company_domains   text[] not null default '{}',
  add column if not exists exclude_titles    text[] not null default '{}',
  add column if not exists exclude_companies text[] not null default '{}',
  add column if not exists exclude_locations text[] not null default '{}',
  add column if not exists autonomy          text   not null default 'auto',
  add column if not exists learned           jsonb,
  add column if not exists recalibrations    jsonb  not null default '[]'::jsonb;

do $$ begin
  alter table public.outreach_campaigns add constraint outreach_campaigns_autonomy_check
    check (autonomy in ('auto', 'review_before_shortlist', 'review_before_sequence'));
exception when duplicate_object then null; end $$;

-- Rescue filters that were stashed in last_result before the first run overwrote them.
update public.outreach_campaigns set
  seniorities       = coalesce(array(select jsonb_array_elements_text(last_result->'extra_filters'->'seniorities')), '{}'),
  employee_ranges   = coalesce(array(select jsonb_array_elements_text(last_result->'extra_filters'->'employee_ranges')), '{}'),
  industry_keywords = coalesce(array(select jsonb_array_elements_text(last_result->'extra_filters'->'industry_keywords')), '{}'),
  company_domains   = coalesce(array(select jsonb_array_elements_text(last_result->'extra_filters'->'company_domains')), '{}')
where jsonb_typeof(last_result->'extra_filters') = 'object';

-- Review queue. NULL = sourced before agents existed (never gated).
alter table public.campaign_members
  add column if not exists review_status text,
  add column if not exists reviewed_at   timestamptz;
do $$ begin
  alter table public.campaign_members add constraint campaign_members_review_status_check
    check (review_status is null or review_status in ('pending', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;
create index if not exists campaign_members_review_idx on public.campaign_members (campaign_id, review_status);

-- One decision per person per agent (latest wins). Title/company/location are snapshotted
-- so learning still works if the candidate record is edited later.
create table if not exists public.agent_decisions (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.outreach_campaigns(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  decision     text not null check (decision in ('approve', 'reject')),
  reason       text,
  title        text,
  company      text,
  location     text,
  decided_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (campaign_id, candidate_id)
);
create index if not exists agent_decisions_campaign_idx on public.agent_decisions (campaign_id, decision);

alter table public.agent_decisions enable row level security;
drop policy if exists staff_all_agent_decisions on public.agent_decisions;
create policy staff_all_agent_decisions on public.agent_decisions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
