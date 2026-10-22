// team-agents — the Assigner and Recommender agents from the approved dashboard design.
//   {action:"assign"}     route unowned active candidates to recruiters by workload, and create their first task
//   {action:"recommend"}  flag replies, stalled candidates, overdue tasks, waiting drafts and thin pipelines
// Neither agent contacts candidates, rejects anyone or spends API credits.
// Auth: x-sync-secret header (or ?key=) == app_secrets.sync_secret, or a signed-in staff JWT.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ASSIGN_PER_RUN = 30;
const STALLED_DAYS = 7;
const THIN_PIPELINE = 5;
const DONE_STATUSES = ["placed", "rejected", "withdrawn", "blacklisted"];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} ${path.slice(0, 80)}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as any;
}

async function authorized(req: Request, url: URL): Promise<boolean> {
  const rows = await sb(`app_secrets?key=eq.sync_secret&select=value`).catch(() => []);
  const sync = rows?.[0]?.value || "";
  const k = req.headers.get("x-sync-secret") || url.searchParams.get("key") || "";
  if (sync && k && k === sync) return true;
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!u.ok) return false;
  const user = await u.json();
  const p = (await sb(`profiles?id=eq.${user.id}&select=role,is_active`))?.[0];
  return !!p && p.is_active !== false && ["super_admin", "admin", "recruiter"].includes(p.role);
}

const name = (c: any) => `${c?.first_name || ""} ${c?.last_name || ""}`.trim() || "a candidate";
const recruiters = () => sb(`profiles?role=eq.recruiter&is_active=eq.true&select=id,first_name,email`);
const logRun = (type: string, description: string, metadata: unknown) =>
  sb(`activities`, { method: "POST", body: JSON.stringify({ type, description, metadata }) }).catch(() => null);

// ---------- Assigner ----------
async function assign() {
  const team = await recruiters();
  if (!team.length) return { assigned: 0, note: "no active recruiter accounts" };
  const apps = await sb(`applications?status=eq.active&select=id,candidate_id,job_id,created_at,candidates(id,first_name,last_name,owner_id,status,overall_score),jobs(title,recruiter_id,status)&order=created_at.desc&limit=5000`);
  const live = apps.filter((a: any) => a.candidates && !DONE_STATUSES.includes(a.candidates.status) && a.jobs?.status !== "closed");
  const load: Record<string, number> = Object.fromEntries(team.map((r: any) => [r.id, 0]));
  for (const a of live) if (a.candidates.owner_id in load) load[a.candidates.owner_id]++;

  const seen = new Set<string>();
  const todo = live.filter((a: any) => !a.candidates.owner_id && !seen.has(a.candidate_id) && seen.add(a.candidate_id)).slice(0, ASSIGN_PER_RUN);
  const out: any[] = [];
  const due = new Date(Date.now() + 86400000).toISOString();
  for (const a of todo) {
    // The job's own recruiter first if they're on the team, otherwise whoever has the lightest load.
    const owner = a.jobs?.recruiter_id && a.jobs.recruiter_id in load ? a.jobs.recruiter_id : Object.entries(load).sort((x, y) => x[1] - y[1])[0][0];
    await sb(`candidates?id=eq.${a.candidate_id}&owner_id=is.null`, { method: "PATCH", body: JSON.stringify({ owner_id: owner, assigned_at: new Date().toISOString() }) });
    load[owner]++;
    const open = await sb(`tasks?candidate_id=eq.${a.candidate_id}&status=in.(pending,in_progress)&select=id&limit=1`);
    if (!open.length) {
      const score = a.candidates.overall_score;
      await sb(`tasks`, { method: "POST", body: JSON.stringify({
        title: `Review ${name(a.candidates)} for ${a.jobs?.title || "the role"}${score != null ? ` (score ${score})` : ""}`,
        priority: score != null && score >= 80 ? "high" : "medium", status: "pending", due_date: due,
        candidate_id: a.candidate_id, assigned_to_id: owner, created_by_id: owner,
      }) });
    }
    out.push({ candidate_id: a.candidate_id, owner });
  }
  const who = Object.fromEntries(team.map((r: any) => [r.id, r.first_name || r.email]));
  const per = out.reduce((m: Record<string, number>, o) => { m[who[o.owner]] = (m[who[o.owner]] || 0) + 1; return m; }, {});
  await logRun("agent_assign", out.length ? `Assigner routed ${out.length} candidate${out.length === 1 ? "" : "s"}: ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(", ")}` : "Assigner: every active candidate already has an owner", { assigned: out.length, per });
  return { assigned: out.length, per, remaining_unowned: live.filter((a: any) => !a.candidates.owner_id).length - out.length };
}

// ---------- Recommender ----------
async function recommend() {
  const team = await recruiters();
  const recs: any[] = [];
  const day = new Date().toISOString().slice(0, 10);

  // Replies to outreach: the person who approved the outreach should answer.
  const replied = await sb(`job_recommendations?status=eq.replied&candidate_id=not.is.null&select=candidate_id,job_id,approved_by,name&limit=200`);
  for (const r of replied) recs.push({ recruiter_id: r.approved_by, kind: "reply", priority: "urgent", message: `${r.name || "A candidate"} replied to your outreach. Reply today.`, candidate_id: r.candidate_id, job_id: r.job_id, dedupe_key: `reply:${r.candidate_id}:${r.job_id}` });

  // Stalled: active applications untouched for a week.
  const cutoff = new Date(Date.now() - STALLED_DAYS * 86400000).toISOString();
  const stalled = await sb(`applications?status=eq.active&updated_at=lt.${cutoff}&select=id,candidate_id,job_id,updated_at,candidates(first_name,last_name,owner_id,status),jobs(title,status)&limit=300`);
  for (const a of stalled.filter((a: any) => a.candidates && !DONE_STATUSES.includes(a.candidates.status) && a.jobs?.status === "open").slice(0, 150)) {
    const days = Math.round((Date.now() - Date.parse(a.updated_at)) / 86400000);
    recs.push({ recruiter_id: a.candidates.owner_id, kind: "stalled", priority: days > 21 ? "high" : "medium", message: `${name(a.candidates)} has not moved for ${days} days on ${a.jobs.title}. Move them on or close them out.`, candidate_id: a.candidate_id, job_id: a.job_id, dedupe_key: `stalled:${a.id}` });
  }

  // Overdue tasks, one summary per recruiter per day.
  const overdue = await sb(`tasks?status=in.(pending,in_progress)&due_date=lt.${new Date().toISOString()}&select=id,assigned_to_id&limit=2000`);
  for (const r of team) {
    const n = overdue.filter((t: any) => t.assigned_to_id === r.id).length;
    if (n) recs.push({ recruiter_id: r.id, kind: "overdue", priority: n >= 5 ? "high" : "medium", message: `${n} overdue task${n === 1 ? "" : "s"}. Clear or reschedule them.`, dedupe_key: `overdue:${r.id}:${day}` });
  }

  // Outreach drafts waiting for approval.
  const drafts = await sb(`outreach_drafts?status=eq.draft&kind=eq.first_touch&select=id,created_by&limit=500`);
  const byUser = drafts.reduce((m: Record<string, number>, d: any) => { const k = d.created_by || "team"; m[k] = (m[k] || 0) + 1; return m; }, {});
  for (const [u, n] of Object.entries(byUser)) recs.push({ recruiter_id: u === "team" ? null : u, kind: "drafts", priority: "medium", message: `${n} outreach draft${n === 1 ? "" : "s"} waiting for approval in the Outreach tab.`, dedupe_key: `drafts:${u}:${day}` });

  // Thin pipelines: open roles with fewer than 5 active applications.
  const jobs = await sb(`jobs?status=eq.open&select=id,title,recruiter_id`);
  const active = await sb(`applications?status=eq.active&select=job_id&limit=20000`);
  const count = active.reduce((m: Record<string, number>, a: any) => { m[a.job_id] = (m[a.job_id] || 0) + 1; return m; }, {});
  const teamIds = new Set(team.map((r: any) => r.id));
  for (const j of jobs) {
    const n = count[j.id] || 0;
    if (n < THIN_PIPELINE) recs.push({ recruiter_id: teamIds.has(j.recruiter_id) ? j.recruiter_id : null, kind: "thin_pipeline", priority: n === 0 ? "high" : "low", message: `${j.title} has only ${n} active candidate${n === 1 ? "" : "s"}. Approve sourced matches or source more.`, job_id: j.id, dedupe_key: `thin:${j.id}:${day}` });
  }

  // Insert new ones; existing open or closed recommendations with the same key are left as they are.
  // Bulk inserts need every row to carry the same keys.
  const rowsOut = recs.map((r) => ({ recruiter_id: r.recruiter_id ?? null, kind: r.kind, priority: r.priority, message: r.message, candidate_id: r.candidate_id ?? null, job_id: r.job_id ?? null, dedupe_key: r.dedupe_key }));
  let added = 0;
  for (let i = 0; i < rowsOut.length; i += 200) {
    const rows = await sb(`recommendations?on_conflict=dedupe_key`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(rowsOut.slice(i, i + 200)) });
    added += rows?.length || 0;
  }
  // Stalled recommendations resolve themselves once the application moves.
  const moved = await sb(`recommendations?kind=eq.stalled&status=eq.open&select=id,dedupe_key`);
  const stillStalled = new Set(stalled.map((a: any) => `stalled:${a.id}`));
  const resolved = moved.filter((r: any) => !stillStalled.has(r.dedupe_key)).map((r: any) => r.id);
  if (resolved.length) await sb(`recommendations?id=in.(${resolved.join(",")})`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
  const kinds = recs.reduce((m: Record<string, number>, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
  await logRun("agent_recommend", `Recommender: ${added} new recommendation${added === 1 ? "" : "s"} (${Object.entries(kinds).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ") || "nothing to flag"})`, { added, kinds, auto_resolved: resolved.length });
  return { added, kinds, auto_resolved: resolved.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  try {
    if (!(await authorized(req, url))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action || url.searchParams.get("action");
    if (action === "assign") return json({ ok: true, ...(await assign()) });
    if (action === "recommend") return json({ ok: true, ...(await recommend()) });
    return json({ error: `unknown action '${action}'` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
