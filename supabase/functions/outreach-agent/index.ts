import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const db = createClient(SB_URL, SERVICE);
const STAFF = ["super_admin", "admin", "recruiter", "hiring_manager"];

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function secret(key: string): Promise<string | null> {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function cfg(key: string): Promise<string | null> {
  const { data } = await db.from("config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function apolloKeys(): Promise<string[]> {
  const fromDb = await secret("apollo_api_key");
  const fromEnv = Deno.env.get("APOLLO_API_KEY");
  return Array.from(new Set([fromDb, fromEnv].filter((k): k is string => !!k && k.trim().length > 0)));
}
function safeEq(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// Server jobs: x-app-key / x-cron-key header. Browser: an ACTIVE STAFF user's JWT (client/candidate logins are refused).
// Returns false, or { userId } (null for server jobs) so decisions can be attributed.
async function authorized(req: Request): Promise<false | { userId: string | null }> {
  const got = req.headers.get("x-app-key") || req.headers.get("x-cron-key");
  if (got) {
    const keys = [await cfg("outreach_app_key"), await cfg("outreach_cron_key")].filter((k): k is string => !!k);
    return keys.some((k) => safeEq(k, got)) ? { userId: null } : false;
  }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: p } = await db.from("profiles").select("role,is_active").eq("id", data.user.id).maybeSingle();
  return !!p && !!p.is_active && STAFF.includes(p.role) ? { userId: data.user.id } : false;
}

function startOfTodayISO(): string { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); }
const realEmail = (e: unknown): string | null => {
  const s = typeof e === "string" ? e.trim() : "";
  if (!s || s.includes("email_not_unlocked") || s.includes("domain.com")) return null;
  return s;
};

async function haiku(prompt: string, maxTokens = 500, model = "claude-haiku-4-5-20251001"): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    const d = await r.json();
    return d?.content?.[0]?.text?.trim() || null;
  } catch { return null; }
}

/* ---------- Apollo ---------- */
function buildPeopleBody(c: any, page: number, perPage: number) {
  const b: Record<string, unknown> = { page, per_page: perPage };
  if (c.titles?.length) b.person_titles = c.titles;
  if (c.locations?.length) b.person_locations = c.locations;
  if (c.seniorities?.length) b.person_seniorities = c.seniorities;
  if (c.org_locations?.length) b.organization_locations = c.org_locations;
  if (c.employee_ranges?.length) b.organization_num_employees_ranges = c.employee_ranges;
  if (c.company_domains?.length) b.q_organization_domains_list = c.company_domains;
  if (c.industry_keywords?.length) b.q_organization_keyword_tags = c.industry_keywords;
  if (c.keywords) b.q_keywords = c.keywords;
  if (c.verified_only) b.contact_email_status = ["verified"];
  return b;
}
async function apolloPost(path: string, key: string, body: unknown) {
  const r = await fetch(`https://api.apollo.io/api/v1/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Api-Key": key }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
async function apolloSearch(c: any, page: number, perPage = 25) {
  const keys = await apolloKeys();
  if (!keys.length) throw new Error("Apollo API key not configured");
  const body = buildPeopleBody(c, page, Math.min(perPage, 100));
  let lastErr = "";
  for (const k of keys) {
    let res = await apolloPost("mixed_people/api_search", k, body);
    if (res.status >= 300) {
      const alt = await apolloPost("mixed_people/search", k, body);
      if (alt.status < 300) res = alt;
      else { lastErr = `Apollo ${res.status}: ${res.d?.error || res.d?.message || ""}`.slice(0, 300); continue; }
    }
    const d = res.d;
    const people = d.people || d.contacts || [];
    const total = d.total_entries ?? d.pagination?.total_entries ?? people.length;
    const totalPages = d.pagination?.total_pages ?? Math.max(1, Math.ceil(total / Math.min(perPage, 100)));
    return { people, total, totalPages, key: k };
  }
  throw new Error(lastErr || "Apollo search failed");
}
async function apolloCompanySearch(c: any, page: number, perPage = 25) {
  const keys = await apolloKeys();
  if (!keys.length) throw new Error("Apollo API key not configured");
  const body: Record<string, unknown> = { page, per_page: Math.min(perPage, 100) };
  if (c.name) body.q_organization_name = c.name;
  if (c.locations?.length) body.organization_locations = c.locations;
  if (c.employee_ranges?.length) body.organization_num_employees_ranges = c.employee_ranges;
  if (c.industry_keywords?.length) body.q_organization_keyword_tags = c.industry_keywords;
  let lastErr = "";
  for (const k of keys) {
    let res = await apolloPost("mixed_companies/api_search", k, body);
    if (res.status >= 300) {
      const alt = await apolloPost("mixed_companies/search", k, body);
      if (alt.status < 300) res = alt;
      else { lastErr = `Apollo companies ${res.status}: ${res.d?.error || res.d?.message || ""}`.slice(0, 300); continue; }
    }
    const d = res.d;
    const orgs = d.organizations || d.accounts || [];
    const total = d.total_entries ?? d.pagination?.total_entries ?? orgs.length;
    return { orgs, total, totalPages: d.pagination?.total_pages ?? Math.max(1, Math.ceil(total / Math.min(perPage, 100))) };
  }
  throw new Error(lastErr || "Apollo company search failed");
}
async function apolloReveal(key: string, ids: string[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const res = await apolloPost("people/bulk_match", key, { details: batch.map((id) => ({ id })), reveal_personal_emails: true });
    if (res.status < 300 && Array.isArray(res.d.matches)) out.push(...res.d.matches.filter(Boolean));
  }
  return out;
}
function personRow(p: any) {
  return {
    apollo_id: p.id,
    name: [p.first_name, p.last_name || p.last_name_obfuscated].filter(Boolean).join(" "),
    first_name: p.first_name || "",
    title: p.title || "", company: p.organization?.name || "",
    city: p.city || "", state: p.state || "", country: p.country || "",
    linkedin_url: p.linkedin_url || null,
    has_email: p.has_email !== false,
    has_phone: p.has_direct_phone === "Yes" || p.has_direct_phone === true,
    email_status: p.email_status || null,
    company_size: p.organization?.estimated_num_employees || null,
    company_industry: p.organization?.industry || null,
  };
}

/* ---------- AI match scoring (Juicebox-style) ---------- */
async function scoreCandidates(rows: { id: string; blob: string }[], jobText: string, guidance = "") {
  if (!ANTHROPIC_KEY || !rows.length) return;
  const txt = await haiku(
    `Score each candidate 0-100 for fit against this role. Role: ${jobText.slice(0, 600)}\n${guidance ? guidance.slice(0, 1200) + "\n" : ""}Candidates:\n${rows.map((r, i) => `${i}: ${r.blob}`).join("\n")}\nReturn ONLY a JSON array like [{"i":0,"score":82,"reason":"12y skilled nursing leadership"}] with one short reason (max 12 words) each. No fences.`,
    120 * rows.length + 200,
  );
  if (!txt) return;
  try {
    const arr = JSON.parse(txt.replace(/```json|```/g, "").trim());
    for (const s of arr) {
      const row = rows[s.i];
      if (!row || typeof s.score !== "number") continue;
      await db.from("candidates").update({ ai_match_score: Math.round(s.score), ai_match_reason: String(s.reason || "").slice(0, 200) }).eq("id", row.id);
    }
  } catch { /* ignore */ }
}

/* ---------- Agent learning (review decisions → exclusions + weighting) ---------- */
// A title/company/location rejected this many times with zero approvals is excluded automatically.
const LEARN_EXCLUDE_AFTER = 2;
const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["of", "and", "the", "for", "at", "in", "to", "a", "&"]);
const tokens = (s: unknown) => norm(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
const locOf = (p: { city?: string; state?: string; country?: string }) => p.state || p.country || p.city || "";

type Learned = {
  approved: number; rejected: number;
  exclude: { titles: string[]; companies: string[]; locations: string[] };
  prefer: { titles: string[]; companies: string[]; locations: string[] };
  avoid_reasons: string[];
  tokenWeight: Record<string, number>; companyWeight: Record<string, number>; locationWeight: Record<string, number>;
};

async function learn(campaignId: string): Promise<Learned> {
  const { data } = await db.from("agent_decisions").select("decision,reason,title,company,location").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(500);
  const ds = data || [];
  const tally = (key: "title" | "company" | "location") => {
    const m = new Map<string, { label: string; a: number; r: number }>();
    for (const d of ds as any[]) {
      const k = norm(d[key]); if (!k) continue;
      const e = m.get(k) || { label: d[key], a: 0, r: 0 };
      if (d.decision === "approve") e.a++; else e.r++;
      m.set(k, e);
    }
    return m;
  };
  const t = tally("title"), co = tally("company"), lo = tally("location");
  const excl = (m: Map<string, any>) => [...m.values()].filter((e) => e.r >= LEARN_EXCLUDE_AFTER && e.a === 0).map((e) => e.label);
  const pref = (m: Map<string, any>) => [...m.values()].filter((e) => e.a > e.r).sort((x, y) => y.a - x.a).slice(0, 8).map((e) => e.label);
  const tokenWeight: Record<string, number> = {};
  for (const d of ds as any[]) for (const tk of tokens(d.title)) tokenWeight[tk] = (tokenWeight[tk] || 0) + (d.decision === "approve" ? 1 : -1);
  const w = (m: Map<string, any>) => Object.fromEntries([...m.entries()].map(([k, e]) => [k, e.a - e.r]));
  return {
    approved: ds.filter((d: any) => d.decision === "approve").length,
    rejected: ds.filter((d: any) => d.decision === "reject").length,
    exclude: { titles: excl(t), companies: excl(co), locations: excl(lo) },
    prefer: { titles: pref(t), companies: pref(co), locations: pref(lo) },
    avoid_reasons: [...new Set((ds as any[]).filter((d) => d.decision === "reject" && d.reason).map((d) => String(d.reason).trim()))].slice(0, 10),
    tokenWeight, companyWeight: w(co), locationWeight: w(lo),
  };
}

// Explicit (campaign) + learned exclusions. Titles/companies match as substrings of the name (so "staffing"
// knocks out every "... Staffing LLC"). Only agency words also match the industry: Apollo files agencies
// under "staffing & recruiting", but files nearly every nursing employer under "hospital & health care",
// so matching any other word against industry ("skip hospitals") would exclude everyone.
const INDUSTRY_TERMS = ["staffing", "recruiting", "recruitment", "agency", "agencies"];
function excluded(c: any, L: Learned | null, p: { title?: string; company?: string; industry?: string; city?: string; state?: string; country?: string }) {
  const title = norm(p.title), company = norm(p.company), industry = norm(p.industry);
  const locs = [p.city, p.state, p.country].map(norm).filter(Boolean);
  const exT = [...(c.exclude_titles || []), ...(L?.exclude.titles || [])].map(norm).filter(Boolean);
  const exC = [...(c.exclude_companies || []), ...(L?.exclude.companies || [])].map(norm).filter(Boolean);
  const exL = [...(c.exclude_locations || []), ...(L?.exclude.locations || [])].map(norm).filter(Boolean);
  if (title && exT.some((x) => title.includes(x))) return "title";
  if (exC.some((x) => (company && company.includes(x)) || (industry && INDUSTRY_TERMS.includes(x) && industry.includes(x)))) return "company";
  if (locs.length && exL.some((x) => locs.includes(x))) return "location";
  return null;
}

// Higher = looks more like people the recruiter approved.
function affinity(L: Learned | null, p: any): number {
  if (!L || !(L.approved + L.rejected)) return 0;
  let s = 0;
  for (const tk of tokens(p.title)) s += L.tokenWeight[tk] || 0;
  s += 3 * (L.companyWeight[norm(p.organization?.name || p.company)] || 0);
  s += 2 * (L.locationWeight[norm(locOf(p))] || 0);
  return s;
}

function guidanceText(L: Learned | null) {
  if (!L || !(L.approved + L.rejected)) return "";
  const parts = [];
  if (L.prefer.titles.length || L.prefer.companies.length) parts.push(`Recruiter has approved people like: ${[...L.prefer.titles, ...L.prefer.companies].join(", ")}.`);
  if (L.avoid_reasons.length) parts.push(`Recruiter rejected people for: ${L.avoid_reasons.join("; ")}. Score similar profiles lower.`);
  return parts.join(" ");
}

async function saveLearned(campaignId: string, L: Learned) {
  await db.from("outreach_campaigns").update({
    learned: { approved: L.approved, rejected: L.rejected, exclude: L.exclude, prefer: L.prefer, avoid_reasons: L.avoid_reasons, updated_at: new Date().toISOString() },
  }).eq("id", campaignId);
}

/* ---------- Agent filter helpers (Recalibrate) ---------- */
const AUTONOMY = ["auto", "review_before_shortlist", "review_before_sequence"];
const FILTER_ARRAYS = ["titles", "locations", "seniorities", "employee_ranges", "industry_keywords", "company_domains", "exclude_titles", "exclude_companies", "exclude_locations"] as const;
const SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry"];
const RANGES = ["1,10", "11,50", "51,200", "201,500", "501,1000", "1001,5000", "5001,10000"];
const cleanList = (a: unknown) => Array.isArray(a) ? [...new Set(a.map((x) => String(x).trim()).filter(Boolean))].slice(0, 30) : [];
function pickFilters(c: any) {
  const f: Record<string, unknown> = {};
  for (const k of FILTER_ARRAYS) f[k] = c[k] || [];
  f.keywords = c.keywords || "";
  f.verified_only = c.verified_only !== false;
  f.daily_source_limit = c.daily_source_limit || 25;
  return f;
}
function sanitizeFilters(raw: any, fallback: any) {
  const f: Record<string, unknown> = {};
  for (const k of FILTER_ARRAYS) f[k] = Array.isArray(raw[k]) ? cleanList(raw[k]) : fallback[k];
  f.seniorities = (f.seniorities as string[]).filter((s) => SENIORITIES.includes(s));
  f.employee_ranges = (f.employee_ranges as string[]).filter((s) => RANGES.includes(s));
  f.keywords = typeof raw.keywords === "string" ? (raw.keywords.trim().slice(0, 200) || null) : (fallback.keywords || null);
  f.verified_only = typeof raw.verified_only === "boolean" ? raw.verified_only : fallback.verified_only;
  const lim = Number(raw.daily_source_limit);
  f.daily_source_limit = Number.isFinite(lim) && lim >= 1 ? Math.min(100, Math.round(lim)) : fallback.daily_source_limit;
  // An agent with nothing to search for would source the whole of Apollo; refuse that.
  if (!(f.titles as string[]).length && !f.keywords && !(f.company_domains as string[]).length) f.titles = fallback.titles;
  return f;
}
function diffFilters(a: any, b: any) {
  const out: { field: string; added?: string[]; removed?: string[]; from?: unknown; to?: unknown }[] = [];
  for (const k of FILTER_ARRAYS) {
    const A = new Set<string>(a[k] || []), B = new Set<string>(b[k] || []);
    const added = [...B].filter((x) => !A.has(x)), removed = [...A].filter((x) => !B.has(x));
    if (added.length || removed.length) out.push({ field: k, added, removed });
  }
  for (const k of ["keywords", "verified_only", "daily_source_limit"]) if ((a[k] || null) !== (b[k] || null)) out.push({ field: k, from: a[k], to: b[k] });
  return out;
}

/* ---------- Close.com sync (dialer handoff) ---------- */
async function closeSync(candidateIds: string[]) {
  const key = await secret("close_api_key");
  if (!key) return { synced: 0, error: "close_api_key not set. Close → Settings → API Keys, then save it in app_secrets as close_api_key." };
  const auth = "Basic " + btoa(key + ":");
  const { data: cands } = await db.from("candidates").select("id,first_name,last_name,email,phone,current_title,current_company,city,state,close_lead_id").in("id", candidateIds.slice(0, 25));
  let synced = 0, skipped = 0; const errors: string[] = [];
  for (const c of cands || []) {
    if (c.close_lead_id) { skipped++; continue; }
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || "Candidate";
    try {
      const r = await fetch("https://api.close.com/api/v1/lead/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          name: c.current_company ? `${name} — ${c.current_company}` : name,
          description: `${c.current_title || ""} · imported from Streamlined Staffing ATS`,
          contacts: [{
            name, title: c.current_title || undefined,
            phones: c.phone ? [{ phone: c.phone, type: "mobile" }] : [],
            emails: c.email ? [{ email: c.email, type: "office" }] : [],
          }],
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status < 300 && d.id) {
        await db.from("candidates").update({ close_lead_id: d.id }).eq("id", c.id);
        synced++;
      } else { errors.push((d["field-errors"] ? JSON.stringify(d["field-errors"]) : d.error || `Close ${r.status}`).slice(0, 120)); }
    } catch (e) { errors.push(String(e).slice(0, 100)); }
  }
  return { synced, skipped, errors: errors.slice(0, 3) };
}

/* ---------- import selected apollo ids ---------- */
// agent: set when the hourly agent (not a person) is sourcing — applies exclusions and the review gate.
async function importPeople(apolloIds: string[], jobId: string | null, campaignId: string | null, sourceLabel: string, agent?: { campaign: any; learned: Learned | null }) {
  const keys = await apolloKeys();
  if (!keys.length) return { imported: 0, error: "Apollo API key not configured" };
  const matches = await apolloReveal(keys[0], apolloIds);
  let imported = 0, dupes = 0, noEmail = 0, excludedCount = 0;
  const gateShortlist = agent?.campaign?.autonomy === "review_before_shortlist";
  const ids: string[] = [];
  const toScore: { id: string; blob: string }[] = [];
  for (const m of matches) {
    const email = realEmail(m.email);
    if (!email) { noEmail++; continue; }
    if (agent && excluded(agent.campaign, agent.learned, { title: m.title, company: m.organization?.name, industry: m.organization?.industry, city: m.city, state: m.state, country: m.country })) { excludedCount++; continue; }
    const { data: dup } = await db.from("candidates").select("id").ilike("email", email).maybeSingle();
    let candidateId = dup?.id as string | undefined;
    if (candidateId) dupes++;
    if (!candidateId) {
      const { data: ins, error } = await db.from("candidates").insert({
        first_name: m.first_name || "", last_name: m.last_name || "", email,
        phone: m.phone_numbers?.[0]?.sanitized_number || null,
        current_title: m.title || null, current_company: m.organization?.name || null,
        city: m.city || null, state: m.state || null, country: m.country || null,
        linkedin_url: m.linkedin_url || null, apollo_contact_id: m.id,
        email_verification_status: m.email_status || null,
        source: "apollo", source_detail: sourceLabel, status: "new", outreach_status: "sourced",
      }).select("id").single();
      if (error || !ins) continue;
      candidateId = ins.id; imported++;
      toScore.push({ id: candidateId, blob: `${m.first_name} ${m.last_name}, ${m.title || "?"} at ${m.organization?.name || "?"}, ${m.city || ""} ${m.state || ""}` });
    }
    ids.push(candidateId);
    if (jobId && !gateShortlist) {
      await db.from("sourcing_recommendations").upsert(
        { job_id: jobId, candidate_id: candidateId, status: "sourced", reason: sourceLabel, ai: false },
        { onConflict: "job_id,candidate_id", ignoreDuplicates: true });
    }
    if (campaignId) {
      await db.from("campaign_members").upsert(
        { campaign_id: campaignId, candidate_id: candidateId, stage: gateShortlist ? "review" : "sourced",
          // agent-sourced people land in the review queue; people a recruiter picked by hand are pre-approved
          review_status: agent ? "pending" : "approved", reviewed_at: agent ? null : new Date().toISOString() },
        { onConflict: "campaign_id,candidate_id", ignoreDuplicates: true });
    }
  }
  if (toScore.length) {
    const { data: j } = jobId ? await db.from("jobs").select("title,description,location").eq("id", jobId).maybeSingle() : { data: null };
    const c = agent?.campaign;
    const jobText = j ? `${j.title} in ${j.location || ""}. ${j.description || ""}`
      : c ? `${(c.titles || []).join(" / ") || c.name}${(c.locations || []).length ? " in " + c.locations.join(", ") : ""}` : "";
    if (jobText) await scoreCandidates(toScore, jobText, guidanceText(agent?.learned || null));
  }
  return { imported, dupes, no_email: noEmail, excluded: excludedCount, candidate_ids: ids };
}

/* ---------- campaign pipeline ---------- */
// Autonomy changed away from "review before shortlist": release anyone still parked in review.
async function releaseReviewGate(c: any) {
  if (c.autonomy === "review_before_shortlist") return 0;
  const { data: parked } = await db.from("campaign_members").select("id,candidate_id").eq("campaign_id", c.id).eq("stage", "review").limit(500);
  if (!parked?.length) return 0;
  await db.from("campaign_members").update({ stage: "sourced" }).in("id", parked.map((m: any) => m.id));
  if (c.job_id) await db.from("sourcing_recommendations").upsert(
    parked.map((m: any) => ({ job_id: c.job_id, candidate_id: m.candidate_id, status: "sourced", reason: `campaign:${c.name}`, ai: false })),
    { onConflict: "job_id,candidate_id", ignoreDuplicates: true });
  return parked.length;
}
async function stageSource(c: any, L: Learned | null) {
  const { count: todayCount } = await db.from("campaign_members").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).gte("sourced_at", startOfTodayISO());
  const remaining = (c.daily_source_limit || 25) - (todayCount || 0);
  if (remaining <= 0) return { sourced: 0, note: "daily source limit reached" };
  const page = c.apollo_page || 1;
  let found: any[] = []; let totalPages = 1;
  try {
    // Over-fetch so exclusions + learned weighting have room to pick the best of the page.
    const res = await apolloSearch(c, page, Math.min(100, Math.max(25, (c.daily_source_limit || 25) * 2)));
    found = res.people; totalPages = res.totalPages;
  } catch (e) { return { sourced: 0, error: String(e).slice(0, 300) }; }
  if (!found.length) {
    await db.from("outreach_campaigns").update({ apollo_page: 1 }).eq("id", c.id);
    return { sourced: 0, note: "no results on page " + page };
  }
  const apolloIds = found.map((p: any) => p.id).filter(Boolean);
  const { data: existing } = await db.from("candidates").select("apollo_contact_id").in("apollo_contact_id", apolloIds);
  const known = new Set((existing || []).map((r: any) => r.apollo_contact_id));
  const contactable = found.filter((p: any) => p.has_email === undefined || p.has_email === true);
  const unseen = contactable.filter((p: any) => p.id && !known.has(p.id));
  const allowed = unseen.filter((p: any) => !excluded(c, L, { title: p.title, company: p.organization?.name, industry: p.organization?.industry, city: p.city, state: p.state, country: p.country }));
  const fresh = allowed
    .map((p: any, i: number) => ({ p, i, s: affinity(L, p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, remaining).map((x) => x.p);
  const prefiltered = unseen.length - allowed.length;
  if (!fresh.length) {
    await db.from("outreach_campaigns").update({ apollo_page: page < totalPages ? page + 1 : 1 }).eq("id", c.id);
    return { sourced: 0, excluded: prefiltered, note: prefiltered ? "everyone new on this page was excluded; advancing page" : "all results already in ATS; advancing page" };
  }
  const r = await importPeople(fresh.map((p: any) => p.id), c.job_id || null, c.id, `campaign:${c.name}`, { campaign: c, learned: L });
  await db.from("outreach_campaigns").update({ apollo_page: page < totalPages ? page + 1 : 1, sourced_total: (c.sourced_total || 0) + (r.imported || 0) }).eq("id", c.id);
  return { sourced: r.imported || 0, no_email: r.no_email || 0, excluded: prefiltered + (r.excluded || 0), page };
}
async function stageEnrich(c: any) {
  if (!c.enrich_with_clay) return { enrich_sent: 0, skipped: "enrichment off" };
  const { data: members } = await db.from("campaign_members")
    .select("id, candidate_id, candidates(id,first_name,last_name,email,linkedin_url,current_title,current_company,city,state,apollo_contact_id)")
    .eq("campaign_id", c.id).eq("stage", "sourced").limit(50);
  if (!members?.length) return { enrich_sent: 0 };
  const webhook = await secret("clay_webhook_url");
  if (!webhook) {
    await db.from("campaign_members").update({ stage: "enriched", enriched_at: new Date().toISOString(), note: "clay_not_configured" }).in("id", members.map((m: any) => m.id));
    return { enrich_sent: 0, warning: "clay_webhook_url not set" };
  }
  const rows = members.map((m: any) => ({ candidate_id: m.candidate_id, campaign_id: c.id, job_id: c.job_id, ...(m.candidates || {}) }));
  try {
    const r = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "ats-outreach-agent", rows }) });
    if (r.status >= 300) return { enrich_sent: 0, error: `Clay webhook ${r.status}` };
  } catch (e) { return { enrich_sent: 0, error: String(e).slice(0, 200) }; }
  await db.from("campaign_members").update({ stage: "enriching", enrich_sent_at: new Date().toISOString() }).in("id", members.map((m: any) => m.id));
  await db.from("candidates").update({ outreach_status: "enriching" }).in("id", members.map((m: any) => m.candidate_id));
  return { enrich_sent: rows.length };
}
async function stageDetectEnriched(c: any) {
  const { data: waiting } = await db.from("campaign_members")
    .select("id, candidate_id, enrich_sent_at, candidates(enriched_at)").eq("campaign_id", c.id).eq("stage", "enriching").limit(200);
  if (!waiting?.length) return { enriched: 0, timed_out: 0 };
  const cutoff = Date.now() - (c.enrich_wait_hours || 24) * 3600000;
  const done: string[] = []; const timedOut: string[] = [];
  for (const m of waiting as any[]) {
    if (m.candidates?.enriched_at) done.push(m.id);
    else if (m.enrich_sent_at && new Date(m.enrich_sent_at).getTime() < cutoff) timedOut.push(m.id);
  }
  if (done.length) await db.from("campaign_members").update({ stage: "enriched", enriched_at: new Date().toISOString() }).in("id", done);
  if (timedOut.length) await db.from("campaign_members").update({ stage: "enriched", enriched_at: new Date().toISOString(), note: "clay_timeout" }).in("id", timedOut);
  return { enriched: done.length, timed_out: timedOut.length };
}
async function stageEnroll(c: any) {
  if (!c.auto_enroll) return { enrolled: 0, skipped: "auto-enroll off" };
  if (!c.sequence_id) return { enrolled: 0, error: "campaign has no sequence" };
  const readyStage = c.enrich_with_clay ? "enriched" : "sourced";
  let q = db.from("campaign_members")
    .select("id, candidate_id, candidates(id,email,unsubscribed,outreach_status)").eq("campaign_id", c.id).eq("stage", readyStage);
  // Checkpoint before sequencing: only approved people (and pre-agent members with no review state).
  if (c.autonomy === "review_before_sequence") q = q.or("review_status.is.null,review_status.eq.approved");
  const { data: members } = await q.limit(100);
  if (!members?.length) return { enrolled: 0 };
  let enrolled = 0, skipped = 0;
  for (const m of members as any[]) {
    const cand = m.candidates;
    if (!cand?.email || cand.unsubscribed) {
      await db.from("campaign_members").update({ stage: "skipped", note: !cand?.email ? "no email" : "unsubscribed" }).eq("id", m.id);
      skipped++; continue;
    }
    const { data: already } = await db.from("sequence_enrollments").select("id").eq("sequence_id", c.sequence_id).eq("candidate_id", m.candidate_id).maybeSingle();
    if (already) {
      await db.from("campaign_members").update({ stage: "enrolled", enrolled_at: new Date().toISOString(), note: "already enrolled" }).eq("id", m.id);
      skipped++; continue;
    }
    const { error } = await db.from("sequence_enrollments").insert({ sequence_id: c.sequence_id, candidate_id: m.candidate_id, current_step: 0, status: "active", next_action_at: new Date().toISOString() });
    if (error) { skipped++; continue; }
    await db.from("campaign_members").update({ stage: "enrolled", enrolled_at: new Date().toISOString() }).eq("id", m.id);
    await db.from("candidates").update({ outreach_status: "enrolled" }).eq("id", m.candidate_id);
    try { await db.from("activities").insert({ type: "sequence_enrolled", description: `Auto-enrolled by campaign "${c.name}"`, candidate_id: m.candidate_id, job_id: c.job_id || null }); } catch { /**/ }
    enrolled++;
  }
  if (enrolled) await db.from("outreach_campaigns").update({ enrolled_total: (c.enrolled_total || 0) + enrolled }).eq("id", c.id);
  return { enrolled, skipped };
}
async function stageSend() {
  const cronKey = await cfg("outreach_cron_key");
  if (!cronKey) return { emails_sent: 0, error: "outreach_cron_key missing" };
  try {
    const r = await fetch(`${SB_URL}/functions/v1/outreach/api/run`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-key": cronKey } });
    const d = await r.json().catch(() => ({}));
    return { emails_sent: d.sent || 0, sms: d.sms || 0, tasks: d.tasks || 0, processed: d.processed || 0, capped: !!d.capped, send_errors: d.errors || [] };
  } catch (e) { return { emails_sent: 0, error: String(e).slice(0, 200) }; }
}
async function runCampaign(c: any) {
  const detail: Record<string, unknown> = { campaign: c.name, autonomy: c.autonomy || "auto" };
  const L = await learn(c.id).catch(() => null);
  if (L) await saveLearned(c.id, L);
  const released = await releaseReviewGate(c);
  if (released) detail.released_from_review = released;
  detail.source = await stageSource(c, L);
  detail.enrich = await stageEnrich(c);
  detail.detect = await stageDetectEnriched(c);
  detail.enroll = await stageEnroll(c);
  await db.from("campaign_runs").insert({
    campaign_id: c.id,
    sourced: (detail.source as any)?.sourced || 0,
    enrich_sent: (detail.enrich as any)?.enrich_sent || 0,
    enrolled: (detail.enroll as any)?.enrolled || 0,
    status: (detail.source as any)?.error || (detail.enroll as any)?.error ? "error" : "ok",
    detail,
  });
  await db.from("outreach_campaigns").update({ last_run_at: new Date().toISOString(), last_result: detail }).eq("id", c.id);
  return detail;
}
async function tick(campaignId?: string) {
  const q = campaignId
    ? db.from("outreach_campaigns").select("*").eq("id", campaignId)
    : db.from("outreach_campaigns").select("*").eq("status", "active");
  const { data: campaigns } = await q;
  if (!campaigns?.length) return { campaigns: 0, results: [], send: { emails_sent: 0 } };
  const results = [];
  for (const c of campaigns) results.push(await runCampaign(c));
  const send = await stageSend();
  return { campaigns: campaigns.length, results, send };
}
async function buildSequence(name: string, jobTitle: string, jobId: string | null, company: string) {
  let steps: any[] = [
    { delay_days: 0, type: "email", email_subject: `${jobTitle} role — worth a look?`, email_body: `<p>Hi {{first_name}},</p><p>I came across your background as {{title}} and thought of a ${jobTitle} opening I'm working on.</p><p>Open to a quick chat this week?</p><p>— ${company}</p>` },
    { delay_days: 3, type: "email", email_subject: `Re: ${jobTitle} role`, email_body: `<p>Hi {{first_name}},</p><p>Following up in case my last note got buried. The ${jobTitle} position is still open.</p><p>Worth 10 minutes?</p>` },
    { delay_days: 2, type: "call", task_title: `Call {{first_name}} {{last_name}} — ${jobTitle}`, task_description: `No email reply after 2 touches. Call about the ${jobTitle} role.` },
    { delay_days: 2, type: "sms", email_body: `Hi {{first_name}}, Streamlined Staffing here — I emailed about a ${jobTitle} opening. Worth a quick call? Reply STOP to opt out.` },
    { delay_days: 2, type: "email", email_subject: `Closing the loop`, email_body: `<p>Hi {{first_name}},</p><p>I'll stop reaching out about the ${jobTitle} role — if timing is off, reply "later" and I'll keep you in mind.</p>` },
  ];
  const ai = await haiku(`Write a 5-step multichannel cold recruiting sequence for a "${jobTitle}" role at staffing firm ${company}. Steps: 1 email day0, 2 email day3, 3 call task day2 later, 4 sms day2 later, 5 breakup email day2 later. Merge fields: {{first_name}} {{title}} {{company}}. Short, plain, human. Return ONLY JSON array of {delay_days,type,email_subject,email_body,task_title,task_description} where type is email|call|sms. Email bodies simple HTML <p>. SMS plain text under 300 chars with opt-out. No markdown fences.`, 1600);
  if (ai) { try { const parsed = JSON.parse(ai.replace(/```json|```/g, "").trim()); if (Array.isArray(parsed) && parsed.length >= 3) steps = parsed; } catch { /**/ } }
  const { data: seq, error } = await db.from("sequences").insert({ name: `${name} — sequence`, description: `Auto-created for ${jobTitle}`, is_active: true, job_id: jobId, channel: "multi" }).select("id").single();
  if (error || !seq) throw new Error(error?.message || "could not create sequence");
  await db.from("sequence_steps").insert(steps.map((s: any, i: number) => ({
    sequence_id: seq.id, sort_order: i + 1, type: s.type || "email", delay_days: s.delay_days ?? (i === 0 ? 0 : 3),
    email_subject: s.email_subject || null, email_body: s.email_body || null,
    task_title: s.task_title || null, task_description: s.task_description || null,
  })));
  return seq.id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = await authorized(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = body.action || new URL(req.url).searchParams.get("action") || "list";

  try {
    if (action === "search" || action === "preview") {
      const res = await apolloSearch(body, body.page || 1, body.per_page || 25);
      return json({ total: res.total, total_pages: res.totalPages, page: body.page || 1, people: res.people.map(personRow), sample: res.people.slice(0, 10).map(personRow) });
    }

    /* Juicebox-style natural language search */
    if (action === "nl_search") {
      if (!body.query) return json({ error: "query required" }, 400);
      const txt = await haiku(
        `Convert this recruiter search into Apollo API filters. Query: "${String(body.query).slice(0, 400)}"\nReturn ONLY JSON: {"titles":[],"locations":[],"seniorities":[],"employee_ranges":[],"industry_keywords":[],"company_domains":[],"keywords":"","verified_only":true}\nRules: seniorities from [owner,founder,c_suite,partner,vp,head,director,manager,senior,entry]. employee_ranges from ["1,10","11,50","51,200","201,500","501,1000","1001,5000","5001,10000"]. locations are regions/states/countries (e.g. "New Jersey","Philippines","South Africa"). titles are job titles incl. common synonyms (max 5). industry_keywords only if an industry is clearly implied. keywords stays empty unless a rare hard requirement. No fences.`,
        400,
      );
      if (!txt) return json({ error: "AI not configured" }, 500);
      let filters: any = {};
      try { filters = JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { return json({ error: "could not parse query" }, 500); }
      const res = await apolloSearch(filters, 1, body.per_page || 25);
      return json({ filters, total: res.total, total_pages: res.totalPages, page: 1, people: res.people.map(personRow) });
    }

    if (action === "company_search") {
      const res = await apolloCompanySearch(body, body.page || 1, body.per_page || 25);
      return json({
        total: res.total, total_pages: res.totalPages, page: body.page || 1,
        companies: res.orgs.map((o: any) => ({
          apollo_org_id: o.id, name: o.name || "", domain: o.primary_domain || o.website_url || "",
          industry: o.industry || "", size: o.estimated_num_employees || null,
          city: o.city || o.organization_city || "", state: o.state || "", country: o.country || "",
          linkedin_url: o.linkedin_url || null, logo_url: o.logo_url || null,
        })),
      });
    }

    if (action === "import") {
      const ids = body.apollo_ids || [];
      if (!ids.length) return json({ error: "apollo_ids required" }, 400);
      if (ids.length > 25) return json({ error: "max 25 per import" }, 400);
      const r = await importPeople(ids, body.job_id || null, body.campaign_id || null, body.source_label || "manual sourcing");
      return json(r);
    }

    /* Close.com dialer handoff */
    if (action === "close_sync") {
      const ids = body.candidate_ids || [];
      if (!ids.length) return json({ error: "candidate_ids required" }, 400);
      return json(await closeSync(ids));
    }

    /* re-score existing candidates against a job */
    if (action === "score") {
      const { candidate_ids, job_id } = body;
      if (!candidate_ids?.length || !job_id) return json({ error: "candidate_ids and job_id required" }, 400);
      const { data: j } = await db.from("jobs").select("title,description,location").eq("id", job_id).maybeSingle();
      if (!j) return json({ error: "job not found" }, 404);
      const { data: cands } = await db.from("candidates").select("id,first_name,last_name,current_title,current_company,city,state,skills").in("id", candidate_ids.slice(0, 25));
      const rows = (cands || []).map((c: any) => ({ id: c.id, blob: `${c.first_name} ${c.last_name}, ${c.current_title || "?"} at ${c.current_company || "?"}, ${c.city || ""} ${c.state || ""}, skills: ${(c.skills || []).slice(0, 8).join("/")}` }));
      await scoreCandidates(rows, `${j.title} in ${j.location || ""}. ${j.description || ""}`);
      const { data: updated } = await db.from("candidates").select("id,ai_match_score,ai_match_reason").in("id", candidate_ids.slice(0, 25));
      return json({ scored: updated || [] });
    }

    if (action === "save_search") {
      const { name, kind, filters } = body;
      if (!name || !filters) return json({ error: "name and filters required" }, 400);
      const { data, error } = await db.from("saved_searches").insert({ name, kind: kind || "people", filters }).select("*").single();
      return error ? json({ error: error.message }, 400) : json({ ok: true, search: data });
    }
    if (action === "list_searches") {
      const { data } = await db.from("saved_searches").select("*").order("created_at", { ascending: false }).limit(30);
      return json({ searches: data || [] });
    }
    if (action === "delete_search") {
      await db.from("saved_searches").delete().eq("id", body.id);
      return json({ ok: true });
    }

    if (action === "create") {
      const { name, job_id, sequence_id, titles, locations, keywords, seniorities, employee_ranges, industry_keywords, company_domains,
        verified_only = true, enrich_with_clay = false, auto_enroll = true, daily_source_limit = 25, enrich_wait_hours = 24, create_sequence = true,
        autonomy = "auto", exclude_titles, exclude_companies, exclude_locations } = body;
      if (!AUTONOMY.includes(autonomy)) return json({ error: "bad autonomy" }, 400);
      if (!name) return json({ error: "name required" }, 400);
      if (!titles?.length && !keywords && !company_domains?.length) return json({ error: "titles, keywords, or companies required" }, 400);
      let seqId = sequence_id || null;
      if (!seqId && create_sequence) {
        let jobTitle = titles?.[0] || keywords || "the role";
        if (job_id) { const { data: j } = await db.from("jobs").select("title").eq("id", job_id).maybeSingle(); if (j?.title) jobTitle = j.title; }
        seqId = await buildSequence(name, jobTitle, job_id || null, "Streamlined Staffing");
      }
      const { data, error } = await db.from("outreach_campaigns").insert({
        name, job_id: job_id || null, sequence_id: seqId,
        titles: titles || [], locations: locations || [], keywords: keywords || null,
        verified_only, enrich_with_clay, auto_enroll, daily_source_limit, enrich_wait_hours, status: "active",
        seniorities: seniorities || [], employee_ranges: employee_ranges || [], industry_keywords: industry_keywords || [], company_domains: company_domains || [],
        exclude_titles: exclude_titles || [], exclude_companies: exclude_companies || [], exclude_locations: exclude_locations || [], autonomy,
      }).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, campaign: data });
    }

    if (action === "list") {
      const { data: campaigns } = await db.from("outreach_campaigns").select("*, jobs(title), sequences(name,is_active)").order("created_at", { ascending: false });
      const out = [];
      for (const c of campaigns || []) {
        const { data: members } = await db.from("campaign_members").select("stage,review_status").eq("campaign_id", c.id);
        const funnel: Record<string, number> = {}; const review: Record<string, number> = {};
        for (const m of members || []) {
          funnel[m.stage] = (funnel[m.stage] || 0) + 1;
          if (m.review_status) review[m.review_status] = (review[m.review_status] || 0) + 1;
        }
        const { data: runs } = await db.from("campaign_runs").select("id,ran_at,sourced,enrolled,status").eq("campaign_id", c.id).order("ran_at", { ascending: false }).limit(3);
        out.push({ ...c, funnel, review, total_members: members?.length || 0, recent_runs: runs || [] });
      }
      return json({ campaigns: out });
    }

    if (action === "run") return json(await tick(body.campaign_id));

    /* ---------- Agent controls ---------- */
    if (action === "update_agent") {
      if (!body.campaign_id) return json({ error: "campaign_id required" }, 400);
      const patch: Record<string, unknown> = {};
      if (body.autonomy !== undefined) {
        if (!AUTONOMY.includes(body.autonomy)) return json({ error: "bad autonomy" }, 400);
        patch.autonomy = body.autonomy;
      }
      for (const k of FILTER_ARRAYS) if (Array.isArray(body[k])) patch[k] = cleanList(body[k]);
      if (!Object.keys(patch).length) return json({ error: "nothing to update" }, 400);
      const { data, error } = await db.from("outreach_campaigns").update(patch).eq("id", body.campaign_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      if (patch.autonomy) await releaseReviewGate(data);
      return json({ ok: true, campaign: data });
    }

    /* Approve / reject from the review queue. exclude: { title, company, location } adds that value to the agent's exclusion list. */
    if (action === "review") {
      const { campaign_id, member_ids, decision, reason, exclude } = body;
      if (!campaign_id || !Array.isArray(member_ids) || !member_ids.length) return json({ error: "campaign_id and member_ids required" }, 400);
      if (!["approve", "reject"].includes(decision)) return json({ error: "decision must be approve or reject" }, 400);
      const { data: c } = await db.from("outreach_campaigns").select("*").eq("id", campaign_id).maybeSingle();
      if (!c) return json({ error: "campaign not found" }, 404);
      const { data: members } = await db.from("campaign_members")
        .select("id,candidate_id,stage,candidates(current_title,current_company,city,state,country)")
        .eq("campaign_id", campaign_id).in("id", member_ids.slice(0, 100));
      const now = new Date().toISOString();
      const addEx = { exclude_titles: new Set<string>(c.exclude_titles || []), exclude_companies: new Set<string>(c.exclude_companies || []), exclude_locations: new Set<string>(c.exclude_locations || []) };
      let done = 0, stopped = 0;
      for (const m of (members || []) as any[]) {
        const cand = m.candidates || {};
        await db.from("agent_decisions").upsert({
          campaign_id, candidate_id: m.candidate_id, decision, reason: reason ? String(reason).slice(0, 300) : null,
          title: cand.current_title || null, company: cand.current_company || null, location: locOf(cand) || null,
          decided_by: auth.userId, created_at: now,
        }, { onConflict: "campaign_id,candidate_id" });
        const upd: Record<string, unknown> = { review_status: decision === "approve" ? "approved" : "rejected", reviewed_at: now };
        if (decision === "approve") {
          if (m.stage === "review" || m.stage === "rejected") {
            upd.stage = "sourced";
            if (c.job_id) await db.from("sourcing_recommendations").upsert(
              { job_id: c.job_id, candidate_id: m.candidate_id, status: "sourced", reason: `campaign:${c.name}`, ai: false },
              { onConflict: "job_id,candidate_id", ignoreDuplicates: true });
          }
        } else {
          upd.stage = "rejected"; upd.note = reason ? String(reason).slice(0, 120) : "rejected in review";
          // Auto mode may already have sequenced them: stop it.
          if (c.sequence_id) {
            const { data: st } = await db.from("sequence_enrollments").update({ status: "stopped" })
              .eq("sequence_id", c.sequence_id).eq("candidate_id", m.candidate_id).eq("status", "active").select("id");
            stopped += st?.length || 0;
          }
          if (exclude?.title && cand.current_title) addEx.exclude_titles.add(cand.current_title);
          if (exclude?.company && cand.current_company) addEx.exclude_companies.add(cand.current_company);
          if (exclude?.location && locOf(cand)) addEx.exclude_locations.add(locOf(cand));
        }
        await db.from("campaign_members").update(upd).eq("id", m.id);
        done++;
      }
      const exPatch = { exclude_titles: [...addEx.exclude_titles], exclude_companies: [...addEx.exclude_companies], exclude_locations: [...addEx.exclude_locations] };
      if (exclude && decision === "reject") await db.from("outreach_campaigns").update(exPatch).eq("id", campaign_id);
      const L = await learn(campaign_id);
      await saveLearned(campaign_id, L);
      return json({ ok: true, reviewed: done, sequences_stopped: stopped, learned: { exclude: L.exclude, prefer: L.prefer } });
    }

    /* Plain-English recalibration: Claude rewrites the agent's filters; we apply and return the diff. */
    if (action === "recalibrate") {
      const { campaign_id, instruction } = body;
      if (!campaign_id || !instruction) return json({ error: "campaign_id and instruction required" }, 400);
      const { data: c } = await db.from("outreach_campaigns").select("*, jobs(title,location)").eq("id", campaign_id).maybeSingle();
      if (!c) return json({ error: "campaign not found" }, 404);
      const before = pickFilters(c);
      // Rejection feedback is deliberately NOT passed here: the model treated it as instructions and
      // added keywords nobody asked for. Feedback already acts through learn() on every run.
      const txt = await haiku(
        `You tune an automated recruiting sourcing agent that searches Apollo.io.\nRole: ${c.jobs?.title || c.name}${c.jobs?.location ? " in " + c.jobs.location : ""}\nCurrent filters JSON:\n${JSON.stringify(before)}\nRecruiter instruction: "${String(instruction).slice(0, 500)}"\n` +
        `Return ONLY JSON: {"patch": {<ONLY the fields you change, each with its full new value>}, "summary": "<one sentence on what you changed>"}.\n` +
        `Rules: the patch must contain ONLY fields the instruction explicitly asks about. Do not "improve" anything else: "4 per day" touches daily_source_limit and nothing more. Never add keywords unless the instruction asks for a keyword (they shrink results to near zero). seniorities from [owner,founder,c_suite,partner,vp,head,director,manager,senior,entry] ("more senior" = drop the lowest levels and add the next one up). employee_ranges from ["1,10","11,50","51,200","201,500","501,1000","1001,5000","5001,10000"]. locations are full region names (e.g. "NJ only" -> ["New Jersey"]; "only" replaces, otherwise add). exclude_companies holds company names or words matched against company NAMES (e.g. "skip agencies" -> add "staffing","recruiting","agency"; "skip hospitals" -> add "hospital","medical center","health system"). exclude_titles are title substrings to skip. exclude_locations are state/country names. keywords stays a short string or "". daily_source_limit is an integer 1-100. No fences.`,
        900, "claude-sonnet-4-5",
      );
      if (!txt) return json({ error: "AI not configured (ANTHROPIC_API_KEY)" }, 500);
      let parsed: any;
      try { parsed = JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { return json({ error: "Claude returned something unreadable; try rephrasing" }, 500); }
      // Merge the patch over the current filters, so fields the model didn't mention can't drift.
      const after = sanitizeFilters({ ...before, ...(parsed?.patch || parsed?.filters || {}) }, before);
      const changes = diffFilters(before, after);
      if (!changes.length) return json({ ok: true, changes: [], summary: parsed?.summary || "No changes needed.", filters: before });
      const entry = { at: new Date().toISOString(), by: auth.userId, instruction: String(instruction).slice(0, 500), summary: String(parsed?.summary || "").slice(0, 300), changes, before };
      const log = [entry, ...((c.recalibrations as any[]) || [])].slice(0, 20);
      const { data: updated, error } = await db.from("outreach_campaigns").update({ ...after, apollo_page: 1, recalibrations: log }).eq("id", campaign_id).select("*").single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, changes, summary: entry.summary, filters: pickFilters(updated) });
    }
    if (action === "undo_recalibration") {
      const { data: c } = await db.from("outreach_campaigns").select("*").eq("id", body.campaign_id).maybeSingle();
      const last = (c?.recalibrations as any[] | undefined)?.[0];
      if (!c || !last?.before) return json({ error: "nothing to undo" }, 400);
      await db.from("outreach_campaigns").update({ ...sanitizeFilters(last.before, pickFilters(c)), apollo_page: 1, recalibrations: (c.recalibrations as any[]).slice(1) }).eq("id", c.id);
      return json({ ok: true });
    }

    if (action === "pause" || action === "resume") {
      if (!body.campaign_id) return json({ error: "campaign_id required" }, 400);
      await db.from("outreach_campaigns").update({ status: action === "pause" ? "paused" : "active" }).eq("id", body.campaign_id);
      return json({ ok: true });
    }
    if (action === "delete") {
      if (!body.campaign_id) return json({ error: "campaign_id required" }, 400);
      await db.from("outreach_campaigns").delete().eq("id", body.campaign_id);
      return json({ ok: true });
    }

    if (action === "health") {
      const [keys, cw, from, cap, closeKey] = await Promise.all([apolloKeys(), secret("clay_webhook_url"), cfg("outreach_from_email"), cfg("outreach_daily_cap"), secret("close_api_key")]);
      let apolloSearchOk = false; let apolloError: string | null = null;
      if (keys.length) {
        try { await apolloSearch({ titles: ["nurse"] }, 1, 1); apolloSearchOk = true; }
        catch (e) { apolloError = String(e).slice(0, 200); }
      }
      const { count: activeEnr } = await db.from("sequence_enrollments").select("id", { count: "exact", head: true }).eq("status", "active");
      return json({
        apollo: keys.length > 0, apollo_search: apolloSearchOk, apollo_error: apolloError, keys_configured: keys.length,
        clay: !!cw, resend: !!Deno.env.get("RESEND_API_KEY"), anthropic: !!ANTHROPIC_KEY, close: !!closeKey,
        from_email: from, sandbox_from: (from || "").includes("resend.dev"),
        daily_send_cap: cap, active_enrollments: activeEnr || 0,
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 500) }, 500);
  }
});
