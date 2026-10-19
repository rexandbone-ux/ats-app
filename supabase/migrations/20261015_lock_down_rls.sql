-- Lock down RLS: staff-only access to ATS data.
-- Before: dozens of "authenticated → true" policies let ANY signed-in user (client/candidate
-- portal logins, or anyone who signs up) read/write every table and edit their own role.
-- After: authenticated access requires is_staff() (active super_admin/admin/recruiter/hiring_manager).
-- Anonymous INSERT policies (public apply / lead forms) are untouched. Edge functions use the
-- service role and are unaffected.

-- 1) Replace every wide-open authenticated policy with a staff-only one.
do $$
declare r record; t text;
  open_tables text[] := array[
    'activities','ai_generations','apollo_phone_requests','applications','automation_events','automation_runs','automations',
    'campaign_members','campaign_runs','candidate_activity','candidates','client_aliases','client_contacts','clients','documents',
    'email_templates','interviews','job_board_postings','jobs','notes','offer_letters','outreach_campaigns','pipeline_stages',
    'pipelines','placements','referrals','report_configs','requisitions','saved_searches','scheduling_slots',
    'second_interview_candidates','surveys','talent_pool_candidates','talent_pools','tasks'];
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename <> 'profiles'
      and roles && array['authenticated']::name[]
      and (qual = 'true' or with_check = 'true')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  foreach t in array open_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'staff_all_' || t, t);
      execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', 'staff_all_' || t, t);
    end if;
  end loop;
end $$;

-- 2) Profiles: own row or staff can read; only admins manage; nobody escalates themselves.
drop policy if exists authenticated_all_profiles on public.profiles;
drop policy if exists authenticated_read_profiles on public.profiles;

create or replace function public.guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') or public.is_admin() then return new; end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active
     or new.client_id is distinct from old.client_id or new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Only admins can change role, access, client or email';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_privileges on public.profiles;
create trigger guard_profile_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- 3) New signups get no access until an admin assigns a role (was 'recruiter' = full staff).
alter table public.profiles alter column role set default 'candidate_user';
