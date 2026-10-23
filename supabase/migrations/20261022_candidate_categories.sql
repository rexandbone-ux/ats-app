-- Terminated status, professional categories and recorded location for candidates.
-- Additive only: one new enum value, three new tables, functions and triggers. No existing rows,
-- columns or policies are changed. Job title and status are never written by the classifier.

-- 1. Terminated status (kept for history; nothing is deleted).
alter type public.candidate_status add value if not exists 'terminated';

-- 2. Categories. Data-driven: add a row to add a category; the rules live in the row, not in code.
create table if not exists public.candidate_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'profession' check (kind in ('profession', 'experience')),
  country text,                       -- recorded country required for membership; null = any location
  match_pattern text,                 -- case-insensitive regex over the candidate's own profile text
  match_pattern_cs text,              -- case-sensitive regex (for acronyms such as CPA, RN)
  group_by_state boolean not null default false,  -- show US-state subcategories (e.g. Registered Nurse - Texas)
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_category_links (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  category_id uuid not null references public.candidate_categories(id) on delete cascade,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  evidence text,                      -- the phrase that matched, so recruiters can verify
  created_at timestamptz not null default now(),
  primary key (candidate_id, category_id)
);
create index if not exists candidate_category_links_category_idx on public.candidate_category_links (category_id);

-- 3. Recorded location, separate from status and categories. Only stated locations are used.
create table if not exists public.candidate_locations (
  candidate_id uuid primary key references public.candidates(id) on delete cascade,
  country text,
  us_state text,
  source text not null check (source in ('profile', 'resume', 'manual')),
  raw text,                           -- the recorded value the country/state came from
  updated_at timestamptz not null default now()
);
create index if not exists candidate_locations_country_idx on public.candidate_locations (country, us_state);

alter table public.candidate_categories enable row level security;
alter table public.candidate_category_links enable row level security;
alter table public.candidate_locations enable row level security;
create policy staff_read_candidate_categories on public.candidate_categories for select to authenticated using (public.is_staff());
create policy admin_write_candidate_categories on public.candidate_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_all_candidate_category_links on public.candidate_category_links for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all_candidate_locations on public.candidate_locations for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- US state names from a recorded full name or two-letter code; null when it is not a US state.
create or replace function public.us_state_name(p text) returns text
language sql immutable set search_path = '' as $$
  select s.name from (values
    ('AL','Alabama'),('AK','Alaska'),('AZ','Arizona'),('AR','Arkansas'),('CA','California'),('CO','Colorado'),('CT','Connecticut'),
    ('DE','Delaware'),('DC','District of Columbia'),('FL','Florida'),('GA','Georgia'),('HI','Hawaii'),('ID','Idaho'),('IL','Illinois'),
    ('IN','Indiana'),('IA','Iowa'),('KS','Kansas'),('KY','Kentucky'),('LA','Louisiana'),('ME','Maine'),('MD','Maryland'),
    ('MA','Massachusetts'),('MI','Michigan'),('MN','Minnesota'),('MS','Mississippi'),('MO','Missouri'),('MT','Montana'),
    ('NE','Nebraska'),('NV','Nevada'),('NH','New Hampshire'),('NJ','New Jersey'),('NM','New Mexico'),('NY','New York'),
    ('NC','North Carolina'),('ND','North Dakota'),('OH','Ohio'),('OK','Oklahoma'),('OR','Oregon'),('PA','Pennsylvania'),
    ('RI','Rhode Island'),('SC','South Carolina'),('SD','South Dakota'),('TN','Tennessee'),('TX','Texas'),('UT','Utah'),
    ('VT','Vermont'),('VA','Virginia'),('WA','Washington'),('WV','West Virginia'),('WI','Wisconsin'),('WY','Wyoming'),('PR','Puerto Rico')
  ) as s(code, name)
  where upper(btrim(p)) = s.code or lower(btrim(p)) = lower(s.name)
  limit 1;
$$;

-- Country name from a recorded country value; null when it is not a recognisable country.
create or replace function public.country_name(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p is null or btrim(p) = '' then null
    when lower(btrim(p)) in ('united states', 'united states of america', 'usa', 'us', 'u.s.', 'u.s.a.') then 'United States'
    when lower(btrim(p)) in ('philippines', 'ph', 'the philippines') then 'Philippines'
    when lower(btrim(p)) in ('south africa', 'za') then 'South Africa'
    when lower(btrim(p)) in ('mexico', 'mx') then 'Mexico'
    when lower(btrim(p)) in ('argentina', 'ar') then 'Argentina'
    when lower(btrim(p)) in ('canada', 'ca') then 'Canada'
    when lower(btrim(p)) in ('united kingdom', 'uk', 'gb') then 'United Kingdom'
    when lower(btrim(p)) in ('india', 'in') then 'India'
    else null
  end;
$$;

-- Links are never deleted: auto links are switched off (active = false) when they stop matching,
-- and a manual removal also just switches the link off. Internal functions live in the private schema
-- so they are not callable through the public API.
alter table public.candidate_category_links add column if not exists active boolean not null default true;
create index if not exists candidate_category_links_active_idx on public.candidate_category_links (category_id) where active;
create schema if not exists private;

-- Recompute one candidate's location (unless set by hand) and automatic categories (manual links are kept).
create or replace function private.classify_candidate(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.candidates%rowtype;
  v_country text; v_state text; v_source text; v_raw text;
  parts text[]; part text; txt text; cat record; ev text;
begin
  select * into c from public.candidates where id = p_id;
  if not found then return; end if;

  if not exists (select 1 from public.candidate_locations where candidate_id = p_id and source = 'manual') then
    -- a) Profile fields: country, or a country / US state recorded in the state field.
    v_country := public.country_name(c.country);
    v_state := public.us_state_name(c.state);
    if v_country is null and v_state is not null then v_country := 'United States'; end if;
    if v_country is null then v_country := public.country_name(c.state); end if;
    if v_country is not null then
      v_source := 'profile'; v_raw := concat_ws(', ', nullif(c.city, ''), nullif(c.state, ''), nullif(c.country, ''));
    else
      -- b) The location the candidate stated on their resume, only when it names the country or a US state.
      v_raw := nullif(btrim(c.resume_parsed_data ->> 'location'), '');
      if v_raw is not null then
        parts := regexp_split_to_array(v_raw, '\s*,\s*');
        foreach part in array parts loop
          v_country := coalesce(v_country, public.country_name(part));
          v_state := coalesce(v_state, public.us_state_name(part));
        end loop;
        if v_country is null and v_raw ~* '\mphilippines\M' then v_country := 'Philippines'; end if;
        if v_country is null and v_state is not null then v_country := 'United States'; end if;
        if v_country is not null then v_source := 'resume'; end if;
      end if;
    end if;
    if v_country is distinct from 'United States' then v_state := null; end if;

    if v_country is not null or exists (select 1 from public.candidate_locations where candidate_id = p_id) then
      insert into public.candidate_locations (candidate_id, country, us_state, source, raw, updated_at)
      values (p_id, v_country, v_state, coalesce(v_source, 'profile'), v_raw, now())
      on conflict (candidate_id) do update set country = excluded.country, us_state = excluded.us_state,
        source = excluded.source, raw = excluded.raw, updated_at = now();
    end if;
  end if;
  v_country := null;
  select l.country into v_country from public.candidate_locations l where l.candidate_id = p_id;

  -- The candidate's own profile text: title, skills, certifications, experience notes and resume.
  txt := concat_ws(E'\n', c.current_title, array_to_string(c.skills, ', '), array_to_string(c.certifications, ', '),
    c.hands_on_experience, c.resume_parsed_data ->> 'current_title', (c.resume_parsed_data -> 'employers')::text,
    (c.resume_parsed_data -> 'skills')::text, (c.resume_parsed_data -> 'certifications')::text, c.resume_text);

  update public.candidate_category_links set active = false where candidate_id = p_id and source = 'auto' and active;
  for cat in select * from public.candidate_categories where active loop
    continue when cat.country is not null and cat.country is distinct from v_country;
    ev := null;
    if cat.match_pattern is not null then ev := (regexp_match(txt, '(' || cat.match_pattern || ')', 'i'))[1]; end if;
    if ev is null and cat.match_pattern_cs is not null then ev := (regexp_match(txt, '(' || cat.match_pattern_cs || ')'))[1]; end if;
    if ev is not null then
      insert into public.candidate_category_links (candidate_id, category_id, source, evidence, active)
      values (p_id, cat.id, 'auto', left(ev, 120), true)
      on conflict (candidate_id, category_id) do update set active = true, evidence = excluded.evidence
        where public.candidate_category_links.source = 'auto';
    end if;
  end loop;
end;
$$;

create or replace function private.reclassify_all_candidates() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.candidates loop
    perform private.classify_candidate(r.id); n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.trg_classify_candidate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.classify_candidate(new.id);
  return null;
end;
$$;

-- Seed categories. Patterns match only the candidate's own words; nothing is inferred from nationality.
insert into public.candidate_categories (slug, name, kind, country, match_pattern, match_pattern_cs, group_by_state, sort_order) values
  ('sales-ph', 'Sales', 'profession', 'Philippines',
    '\msales\M|business development|account executive|account manager|\mSDR\M|\mBDR\M|telemarket|telesales|appointment setter|appointment setting|cold call|lead generation|inside sales', null, false, 10),
  ('cpa-accounting-ph', 'CPA / Accounting', 'profession', 'Philippines',
    'certified public accountant|\maccountant\M|\maccounting (staff|associate|assistant|specialist|manager|clerk|officer)|bookkeep|accounts (payable|receivable)', '\mCPA\M', false, 20),
  ('csr-ph', 'CSR (Customer Service Representative)', 'profession', 'Philippines',
    'customer service|customer support|customer care|customer success|call cent(er|re)|contact cent(er|re)|client support|chat support|email support|help ?desk|technical support|tech support', '\mCSR\M', false, 30),
  ('medical-va-ph', 'Medical VA', 'profession', 'Philippines',
    'medical (virtual )?assistant|medical va\M|healthcare (virtual )?assistant|medical (billing|biller|coding|coder|scribe|receptionist|records|transcription|secretary|admin)|patient (intake|coordinator|scheduler|scheduling|care coordinator)|prior authori[sz]ation|insurance verification|\m(ehr|emr)\M', null, false, 40),
  ('rn-ph', 'Registered Nurse - Philippines', 'profession', 'Philippines',
    'registered nurse|\mnclex\M|nursing licen[cs]e|\mprc\M.{0,30}nurs', '\mRN\M|\mR\.N\.', false, 50),
  ('rn-us', 'Registered Nurse - US', 'profession', 'United States',
    'registered nurse|\mnclex\M|nursing licen[cs]e', '\mRN\M|\mR\.N\.', true, 60),
  ('sales-experience', 'Sales experience (any location)', 'experience', null,
    '\msales\M|business development|account executive|account manager|\mSDR\M|\mBDR\M|telemarket|telesales|appointment setter|appointment setting|cold call|lead generation|inside sales', null, false, 100)
on conflict (slug) do nothing;

-- Re-run classification for everyone when categories are added or their rules change.
create or replace function public.trg_reclassify_all() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.reclassify_all_candidates();
  return null;
end;
$$;

create trigger reclassify_after_category_change
after insert or update of match_pattern, match_pattern_cs, country, active on public.candidate_categories
for each statement execute function public.trg_reclassify_all();

create trigger classify_candidate_after_change
after insert or update of current_title, skills, certifications, hands_on_experience, resume_text, resume_parsed_data, city, state, country
on public.candidates for each row execute function public.trg_classify_candidate();

-- Backfill once (run in chunks of 1,000 on the live project).
select private.reclassify_all_candidates();

-- Filter options for the candidate list (respects RLS through security_invoker).
create or replace view public.candidate_location_options with (security_invoker = true) as
select country, us_state, count(*)::int as n
from public.candidate_locations where country is not null
group by country, us_state;

-- A location set by hand re-sorts that candidate's categories straight away.
create or replace function public.trg_classify_after_manual_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.classify_candidate(new.candidate_id);
  return null;
end;
$$;
create trigger classify_after_manual_location
after insert or update on public.candidate_locations
for each row when (new.source = 'manual') execute function public.trg_classify_after_manual_location();
