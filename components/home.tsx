"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, canEdit, canManageUsers } from "@/lib/auth";
import { Empty, fullName, ago, fn, useToast, scoreTone, recruiterTone, PRIORITY_TONE } from "@/lib/ui";
import { Pipeline } from "@/components/pipeline";
import { Search } from "@/components/search";
import { Insights } from "@/components/dashboard";

/* ---------------- Command dashboard (approved design) ----------------
   Header with agent status, six summary tiles, then tabs: Pipeline, Search, Recruiters,
   AI Agents, Outreach, Activity, plus Insights (the previous dashboard widgets). */
type Nav = (p: string, d?: any) => void;
const LIVE_MS = 4 * 86400000;
const isRecent = (iso?: string | null) => !!iso && Date.now() - new Date(iso).getTime() < LIVE_MS;
const TABS = [["pipeline", "Pipeline"], ["search", "Search"], ["recruiters", "Recruiters"], ["agents", "AI Agents"], ["outreach", "Outreach"], ["activity", "Activity"], ["insights", "Insights"]] as const;
type Tab = (typeof TABS)[number][0];

const AGENT_TAG: Record<string, string> = {
  agent_assign: "bg-violet-100 text-violet-800", agent_recommend: "bg-rose-100 text-rose-800",
  ai_scoring: "bg-amber-100 text-amber-800", ai_screening: "bg-violet-100 text-violet-800", automation: "bg-cyan-100 text-cyan-800",
  sequence_enrolled: "bg-pink-100 text-pink-800", email_sent: "bg-pink-100 text-pink-800", application_received: "bg-emerald-100 text-emerald-800",
  stage_change: "bg-amber-100 text-amber-800", note: "bg-slate-100 text-slate-700", call: "bg-sky-100 text-sky-800",
};

async function loadAll() {
  const q = (p: any) => p.then((r: any) => { if (r.error) throw new Error(r.error.message); return r; });
  const [jobs, cands, placed, apps, stages, tasks, people, drafts, acts, rubricLast, screenLast, campaignLast, autoLast, recsLast, newestCand, recs, teamRecs, teamRuns, inbound] = await Promise.all([
    q(supabase.from("jobs").select("id,title,status,recruiter_id").order("title")),
    q(supabase.from("candidates").select("id", { count: "exact", head: true })),
    q(supabase.from("candidates").select("id,owner_id").eq("status", "placed").limit(5000)),
    q(supabase.from("applications").select("id,job_id,stage_id,status,candidate_id,candidates(owner_id,status)").neq("status", "rejected").limit(20000)),
    q(supabase.from("pipeline_stages").select("id,name,sort_order,color").order("sort_order")),
    q(supabase.from("tasks").select("id,title,priority,due_date,status,assigned_to_id,candidate_id").in("status", ["pending", "in_progress"]).order("due_date", { nullsFirst: false }).limit(500)),
    q(supabase.from("profiles").select("id,first_name,last_name,email,role,is_active")),
    q(supabase.from("outreach_drafts").select("id,candidate_id,job_id,to_email,subject,body,hook,status,created_by,created_at,candidates(first_name,last_name,overall_score),jobs(title)").eq("status", "draft").order("created_at", { ascending: false }).limit(100)),
    q(supabase.from("activities").select("id,type,description,created_at,candidate_id,candidates(first_name,last_name)").neq("type", "enrich_error").order("created_at", { ascending: false }).limit(80)),
    q(supabase.from("screening_results").select("created_at").eq("result->>engine", "rubric").order("created_at", { ascending: false }).limit(1)),
    q(supabase.from("screening_results").select("created_at").neq("result->>engine", "rubric").order("created_at", { ascending: false }).limit(1)),
    q(supabase.from("campaign_runs").select("ran_at,status,emails_sent,enrolled").order("ran_at", { ascending: false }).limit(1)),
    q(supabase.from("automation_runs").select("created_at,status").order("created_at", { ascending: false }).limit(1)),
    q(supabase.from("job_recommendations").select("created_at").order("created_at", { ascending: false }).limit(1)),
    q(supabase.from("candidates").select("created_at,source").order("created_at", { ascending: false }).limit(1)),
    q(supabase.from("job_recommendations").select("id,job_id,candidate_id,name,title,score,reason,status").eq("status", "suggested").gte("score", 70).order("score", { ascending: false }).limit(300)),
    q(supabase.from("recommendations").select("id,recruiter_id,kind,priority,message,candidate_id,job_id,created_at").eq("status", "open").order("created_at", { ascending: false }).limit(300)),
    q(supabase.from("activities").select("type,created_at,description").in("type", ["agent_assign", "agent_recommend"]).order("created_at", { ascending: false }).limit(20)),
    q(supabase.from("emails").select("created_at").eq("direction", "inbound").order("created_at", { ascending: false }).limit(1)),
  ]);
  return {
    jobs: jobs.data || [], candidateCount: cands.count || 0, placed: placed.data || [], apps: apps.data || [], stages: stages.data || [],
    tasks: tasks.data || [], people: people.data || [], drafts: drafts.data || [], acts: acts.data || [], recs: recs.data || [], teamRecs: teamRecs.data || [],
    last: {
      assign: teamRuns.data?.find((a: any) => a.type === "agent_assign")?.created_at, assignDetail: teamRuns.data?.find((a: any) => a.type === "agent_assign")?.description,
      recommend: teamRuns.data?.find((a: any) => a.type === "agent_recommend")?.created_at, recommendDetail: teamRuns.data?.find((a: any) => a.type === "agent_recommend")?.description,
      sync: inbound.data?.[0]?.created_at,
      rubric: rubricLast.data?.[0]?.created_at, screening: screenLast.data?.[0]?.created_at, outreach: campaignLast.data?.[0]?.ran_at,
      outreachDetail: campaignLast.data?.[0], automation: autoLast.data?.[0]?.created_at, sourcing: recsLast.data?.[0]?.created_at,
      intake: newestCand.data?.[0]?.created_at, intakeSource: newestCand.data?.[0]?.source,
    } as Record<string, any>,
  };
}
type Data = Awaited<ReturnType<typeof loadAll>>;

export function Dash({ nav }: { nav: Nav }) {
  const { profile } = useAuth();
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("ss_dash_tab") as Tab) || "pipeline"; } catch { return "pipeline"; } });
  const refresh = useCallback(async () => { try { setErr(""); setD(await loadAll()); } catch (e: any) { setErr(String(e?.message || e)); } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem("ss_dash_tab", t); } catch { /* */ } };
  const role = profile?.role; const editable = canEdit(role); const isAdmin = canManageUsers(role);
  const recruiters = useMemo(() => (d?.people || []).filter((p: any) => p.role === "recruiter" && p.is_active !== false), [d]);
  if (err) return <div className="py-20 text-center text-red-500 text-sm">Dashboard failed to load: {err} <button onClick={refresh} className="underline ml-2">Retry</button></div>;
  if (!d) return <div className="py-20 text-center text-gray-400">Loading...</div>;

  const lastAgentRun = Object.entries(d.last).filter(([k]) => !/Detail|Source/.test(k)).map(([, v]) => v as string).filter(Boolean).sort().pop();
  const live = isRecent(lastAgentRun);
  const mineTasks = d.tasks.filter((t: any) => isAdmin || t.assigned_to_id === profile?.id);
  const openJobs = d.jobs.filter((j: any) => j.status === "open");
  const inPipe = d.apps.filter((a: any) => a.candidates?.status !== "placed").length;
  const stats = [
    { l: "Open Roles", v: openJobs.length, tone: "text-indigo-600", go: () => nav("jobs") },
    { l: "Candidates", v: d.candidateCount, tone: "text-cyan-600", go: () => nav("cands") },
    { l: "In Pipeline", v: inPipe, tone: "text-amber-600", go: () => pick("pipeline") },
    { l: "Hired", v: d.placed.length, tone: "text-emerald-600", go: () => nav("placements") },
    { l: "Pending Tasks", v: mineTasks.length, tone: "text-violet-600", go: () => pick("recruiters") },
    { l: "Recruiters", v: recruiters.length, tone: "text-pink-600", go: () => pick("recruiters") },
  ];

  return <div>
    <div className="flex flex-wrap items-center gap-3 mb-5">
      <span className="text-2xl text-indigo-600" aria-hidden>▦</span>
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Streamlined Staffing ATS</h1>
      {live
        ? <span title={`Last agent run ${ago(lastAgentRun)}`} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />Agents live</span>
        : <span title={lastAgentRun ? `Last agent run ${ago(lastAgentRun)}` : "No agent runs yet"} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Agents idle</span>}
      <button onClick={refresh} className="ml-auto text-xs px-2.5 py-1.5 border rounded-lg bg-white hover:bg-gray-50" aria-label="Refresh">↻ Refresh</button>
    </div>

    <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Summary">
      {stats.map(s => <button key={s.l} onClick={s.go} className="rounded-xl border bg-white p-4 text-left hover:shadow-sm">
        <div className={`text-3xl font-bold tabular-nums ${s.tone}`}>{s.v.toLocaleString()}</div>
        <div className="mt-1 text-sm text-gray-500">{s.l}</div>
      </button>)}
    </section>

    <div className="mb-6 overflow-x-auto"><div role="tablist" className="inline-flex gap-1 rounded-xl bg-gray-100 p-1">
      {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => pick(id)} className={`rounded-lg px-4 py-2 text-sm whitespace-nowrap ${tab === id ? "bg-white font-medium text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>{label}{id === "outreach" && d.drafts.length ? ` (${d.drafts.length})` : ""}</button>)}
    </div></div>

    {tab === "pipeline" && <Pipeline nav={nav} editable={editable} />}
    {tab === "search" && <Search nav={nav} editable={editable} pr={{}} />}
    {tab === "recruiters" && <RecruitersTab d={d} recruiters={recruiters} me={profile?.id} isAdmin={isAdmin} nav={nav} refresh={refresh} />}
    {tab === "agents" && <AgentsTab d={d} canRun={editable} refresh={refresh} nav={nav} />}
    {tab === "outreach" && <OutreachTab d={d} editable={editable} refresh={refresh} nav={nav} />}
    {tab === "activity" && <ActivityTab d={d} nav={nav} />}
    {tab === "insights" && <Insights nav={nav} />}
  </div>;
}

/* ---------------- Recruiters ---------------- */
function RecruitersTab({ d, recruiters, me, isAdmin, nav, refresh }: { d: Data; recruiters: any[]; me?: string; isAdmin: boolean; nav: Nav; refresh: () => void }) {
  const { say } = useToast();
  const ids = recruiters.map(r => r.id);
  const shown = isAdmin ? recruiters : recruiters.filter(r => r.id === me);
  const PORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const jobTitle = (id: string) => d.jobs.find((j: any) => j.id === id)?.title || "a role";
  async function done(t: any) {
    const { error } = await supabase.from("tasks").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", t.id);
    if (error) say(error.message, false); else { say(`Done: ${t.title}`); refresh(); }
  }
  const uniqStages = d.stages.filter((s: any, i: number, arr: any[]) => arr.findIndex(x => x.name === s.name) === i);
  const stageName = (id: string) => d.stages.find((s: any) => s.id === id)?.name || uniqStages[0]?.name;
  const unassigned = d.tasks.filter((t: any) => !t.assigned_to_id);
  const teamFlags = d.teamRecs.filter((x: any) => !x.recruiter_id || !ids.includes(x.recruiter_id));
  async function closeRec(id: string, status: "done" | "dismissed") {
    const { error } = await supabase.from("recommendations").update({ status }).eq("id", id);
    if (error) say(error.message, false); else refresh();
  }
  return <div className="space-y-6">
    {isAdmin && teamFlags.length > 0 && <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="text-amber-500">💡</span>Team recommendations</h2>
      <ul className="space-y-1.5">{teamFlags.slice(0, 8).map((x: any) => <li key={x.id} className="flex items-start gap-2 text-sm">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_TONE[x.priority] || "bg-slate-400"}`} />
        <button onClick={() => x.job_id ? nav("job", { id: x.job_id }) : x.candidate_id ? nav("det", { id: x.candidate_id }) : undefined} className="min-w-0 flex-1 text-left hover:underline">{x.message}</button>
        <button onClick={() => closeRec(x.id, "dismissed")} aria-label="Dismiss" className="text-gray-400 hover:text-gray-700">✕</button>
      </li>)}</ul>
    </section>}
    {shown.length === 0 && <Empty t="No recruiter accounts yet. Add one in Settings." />}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {shown.map(r => {
        const tone = recruiterTone(ids, r.id);
        const active = d.apps.filter((a: any) => a.candidates?.owner_id === r.id && a.candidates?.status !== "placed").length;
        const hired = d.placed.filter((c: any) => c.owner_id === r.id).length;
        const tasks = d.tasks.filter((t: any) => t.assigned_to_id === r.id).sort((a: any, b: any) => (PORDER[a.priority] ?? 9) - (PORDER[b.priority] ?? 9) || Date.parse(a.due_date || "9999") - Date.parse(b.due_date || "9999"));
        const myJobs = new Set(d.jobs.filter((j: any) => j.recruiter_id === r.id && j.status === "open").map((j: any) => j.id));
        const recs = d.recs.filter((x: any) => myJobs.has(x.job_id)).slice(0, 2);
        const flags = d.teamRecs.filter((x: any) => x.recruiter_id === r.id).sort((a: any, b: any) => (PORDER[a.priority] ?? 9) - (PORDER[b.priority] ?? 9)).slice(0, 4);
        const name = r.first_name || r.email;
        return <article key={r.id} className="flex min-w-0 flex-col rounded-xl border bg-white p-4">
          <header className="mb-3 flex items-center gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold uppercase text-white ${tone.avatar}`}>{(name || "?")[0]}</div>
            <div className="min-w-0"><h3 className="font-semibold capitalize">{fullName(r)}</h3><p className="truncate text-xs text-gray-400">{r.email}</p></div>
          </header>
          <dl className="mb-3 grid grid-cols-3 text-center">
            {([["Active", active], ["Tasks", tasks.length], ["Hired", hired]] as const).map(([l, v]) => <div key={l}><dd className="text-xl font-bold tabular-nums">{v}</dd><dt className="text-xs text-gray-400">{l}</dt></div>)}
          </dl>
          {(flags.length > 0 || recs.length > 0) && <ul className="mb-2 space-y-1 rounded-lg bg-amber-50 p-2 text-xs">
            {flags.map((x: any) => <li key={x.id} className="flex items-start gap-1.5"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_TONE[x.priority] || "bg-slate-400"}`} /><button onClick={() => x.candidate_id ? nav("det", { id: x.candidate_id }) : x.job_id ? nav("job", { id: x.job_id }) : undefined} className="min-w-0 flex-1 text-left hover:underline">{x.message}</button><button onClick={() => closeRec(x.id, "done")} aria-label="Mark done" className="text-gray-400 hover:text-emerald-600">✓</button></li>)}
            {recs.map((x: any) => <li key={x.id} className="flex items-start gap-1.5"><span className="text-amber-600">💡</span><button onClick={() => x.candidate_id ? nav("det", { id: x.candidate_id }) : nav("job", { id: x.job_id, tab: "slate" })} className="min-w-0 flex-1 text-left hover:underline">Contact <b>{x.name || "a match"}</b> ({x.score}) for {jobTitle(x.job_id)}</button></li>)}
          </ul>}
          <ul className="divide-y border-t">
            {tasks.length === 0 && <li className="py-4 text-center text-sm text-gray-400">All tasks complete</li>}
            {tasks.slice(0, 12).map((t: any) => { const overdue = t.due_date && Date.parse(t.due_date) < Date.now(); return <li key={t.id} className="flex items-start gap-2 py-2">
              <span className={`mt-0.5 h-8 w-1 shrink-0 rounded-full ${PRIORITY_TONE[t.priority] || "bg-slate-300"}`} aria-label={`${t.priority} priority`} />
              <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-snug">{t.title}</p><p className={`text-xs ${overdue ? "font-medium text-rose-600" : "text-gray-400"}`}>{t.due_date ? (overdue ? "Overdue · " : "Due ") + new Date(t.due_date).toLocaleDateString() : "No due date"}</p></div>
              <button onClick={() => done(t)} className="h-7 shrink-0 rounded-md bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-600 hover:text-white">Done</button>
            </li>; })}
            {tasks.length > 12 && <li className="py-2 text-center text-xs text-gray-400">+{tasks.length - 12} more · <button onClick={() => nav("tasks")} className="underline">All tasks</button></li>}
          </ul>
        </article>;
      })}
    </div>
    {isAdmin && unassigned.length > 0 && <p className="text-xs text-gray-500">{unassigned.length} open task{unassigned.length === 1 ? "" : "s"} not assigned to anyone. <button onClick={() => nav("tasks")} className="underline">Open Tasks</button></p>}

    <section>
      <h2 className="mb-2 text-sm font-semibold">Funnel by role</h2>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-gray-400"><tr><th className="p-2 text-left font-medium">Role</th>{uniqStages.map((s: any) => <th key={s.id} className="p-2 text-right font-medium whitespace-nowrap">{s.name}</th>)}<th className="p-2 text-right font-medium">Total</th></tr></thead>
          <tbody>
            {d.jobs.filter((j: any) => j.status === "open").map((j: any) => { const rows = d.apps.filter((a: any) => a.job_id === j.id); return <tr key={j.id} onClick={() => nav("job", { id: j.id })} className="border-b last:border-0 cursor-pointer hover:bg-gray-50">
              <td className="p-2 font-medium">{j.title}</td>
              {uniqStages.map((s: any) => { const n = rows.filter((a: any) => stageName(a.stage_id) === s.name).length; return <td key={s.id} className={`p-2 text-right tabular-nums ${n ? "" : "text-gray-300"}`}>{n}</td>; })}
              <td className="p-2 text-right tabular-nums font-semibold">{rows.length}</td>
            </tr>; })}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}

/* ---------------- AI Agents ---------------- */
const AGENTS = [
  { id: "sourcing", name: "Sourcer", border: "border-t-indigo-500", help: "Finds matching people for each open role from your pool and Apollo, so every role keeps a full pipeline.", run: { fn: "recruit-agent", body: { action: "recommend_due" } }, sched: "Hourly" },
  { id: "rubric", name: "Screener", border: "border-t-amber-500", help: "Scores every new candidate 0-100 on 7 job-related dimensions (spoken English on clarity, not accent). Ranks only; recruiters decide.", run: { fn: "score-candidate", body: { action: "sweep" } }, sched: "Every 5 minutes" },
  { id: "assign", name: "Assigner", border: "border-t-violet-500", help: "Routes unowned candidates to Carla, Roe and the team by role and workload, and creates their first task.", run: { fn: "team-agents", body: { action: "assign" } }, sched: "Every 30 minutes" },
  { id: "outreach", name: "Outreach", border: "border-t-emerald-500", help: "Drafts personal emails for approved matches and sends only what a recruiter approved.", sched: "Weekdays, US hours" },
  { id: "sync", name: "Reply sync", border: "border-t-sky-500", help: "Pulls replies and bounces back from Gmail and Apollo onto each candidate's timeline.", sched: "Every 10 minutes" },
  { id: "recommend", name: "Recommender", border: "border-t-rose-500", help: "Flags replies, stalled candidates, overdue tasks, waiting drafts and thin pipelines for each recruiter.", run: { fn: "team-agents", body: { action: "recommend" } }, sched: "Hourly" },
] as const;

function AgentsTab({ d, canRun, refresh, nav }: { d: Data; canRun: boolean; refresh: () => void; nav: Nav }) {
  const { say } = useToast(); const [running, setRunning] = useState("");
  async function run(a: (typeof AGENTS)[number]) {
    if (!("run" in a)) return;
    setRunning(a.id);
    try { const r = await fn(a.run.fn, a.run.body, { timeoutMs: 170000 }); say(`${a.name} agent finished${r?.scored != null ? `: ${r.scored} scored` : r?.assigned != null ? `: ${r.assigned} assigned` : r?.added != null ? `: ${r.added} new` : ""}.`); refresh(); }
    catch (e: any) { say(`${a.name}: ${e?.message || e}`, false); }
    setRunning("");
  }
  const detail = (id: string) => id === "outreach" && d.last.outreachDetail ? `${d.last.outreachDetail.enrolled ?? 0} enrolled, ${d.last.outreachDetail.emails_sent ?? 0} emails` : id === "assign" ? d.last.assignDetail || "" : id === "recommend" ? d.last.recommendDetail || "" : "";
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 text-sm text-gray-500">Agents run on their own schedules. A dot turns green when an agent ran in the last 4 days.</p><button onClick={() => nav("campaigns")} className="text-xs px-2.5 py-1.5 border rounded-lg bg-white hover:bg-gray-50">Campaigns &amp; agent settings →</button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {AGENTS.map(a => { const last = d.last[a.id]; return <article key={a.id} className={`flex flex-col rounded-xl border border-t-4 bg-white p-4 ${a.border}`}>
        <h3 className="font-semibold">{a.name} agent</h3>
        <p className="mt-1 flex-1 text-sm text-gray-500">{a.help}</p>
        {detail(a.id) && <p className="mt-2 rounded-md bg-gray-50 px-2 py-1 text-xs">{detail(a.id)}</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          {isRecent(last) ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />Active</span> : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-400"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Idle</span>}
          <span className="text-xs tabular-nums text-gray-400" title={a.sched}>Last run {ago(last)}</span>
          {canRun && "run" in a ? <button onClick={() => run(a)} disabled={!!running} aria-label={`Run ${a.name} agent`} className="h-7 rounded-md border px-2 text-xs hover:bg-gray-50 disabled:opacity-50">{running === a.id ? "Running…" : "▶ Run"}</button> : <span className="text-[10px] text-gray-300">{a.sched}</span>}
        </div>
      </article>; })}
    </div>
  </div>;
}

/* ---------------- Outreach ---------------- */
function OutreachTab({ d, editable, refresh, nav }: { d: Data; editable: boolean; refresh: () => void; nav: Nav }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Drafts to review <span className="ml-1 rounded-full bg-gray-100 px-2 text-xs">{d.drafts.length}</span></h2><button onClick={() => nav("campaigns")} className="text-xs px-2.5 py-1.5 border rounded-lg bg-white hover:bg-gray-50">Campaigns →</button></div>
    {d.drafts.length === 0 && <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">No drafts waiting. Pick people in Search or Candidates and choose &ldquo;AI email&rdquo; to draft personal outreach for review.</p>}
    <div className="grid gap-4 xl:grid-cols-2">{d.drafts.map((x: any) => <Draft key={x.id} row={x} editable={editable} refresh={refresh} />)}</div>
  </div>;
}

function Draft({ row, editable, refresh }: { row: any; editable: boolean; refresh: () => void }) {
  const { say } = useToast();
  const [subject, setSubject] = useState(row.subject || ""); const [body, setBody] = useState(row.body || ""); const [busy, setBusy] = useState("");
  const ai = (b: any, t = 60000) => fn("ai-outreach", b, { timeoutMs: t });
  async function approve() {
    setBusy("send");
    try { await ai({ action: "update", id: row.id, subject, body }, 20000); const r = await ai({ action: "send", draft_ids: [row.id] }, 120000); say(r.sent ? `Sent from ${r.from}.` : "Not sent: " + (r.results?.[0]?.error || "check the mailbox in Settings"), !!r.sent); refresh(); }
    catch (e: any) { say(String(e?.message || e), false); }
    setBusy("");
  }
  async function discard() {
    setBusy("discard");
    const { error } = await supabase.from("outreach_drafts").update({ status: "discarded" }).eq("id", row.id);
    if (error) say(error.message, false); else { say("Draft discarded."); refresh(); }
    setBusy("");
  }
  const sc = row.candidates?.overall_score;
  return <article className="rounded-lg border bg-white p-4">
    <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-medium">{fullName(row.candidates)} <span className="font-normal text-gray-400">· {row.jobs?.title || "General"}</span></p><p className="break-all text-xs text-gray-400">{row.to_email}</p></div>
      <span title="AI match score" className={`rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${scoreTone(sc)}`}>{sc ?? "–"}</span>
    </header>
    <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor={`subj-${row.id}`}>Subject</label>
    <input id={`subj-${row.id}`} value={subject} disabled={!editable} onChange={e => setSubject(e.target.value)} className="mb-3 w-full rounded-lg border px-3 py-2 text-sm" />
    <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor={`body-${row.id}`}>Email</label>
    <textarea id={`body-${row.id}`} value={body} disabled={!editable} onChange={e => setBody(e.target.value)} rows={9} className="w-full rounded-lg border px-3 py-2 font-mono text-[13px] leading-relaxed" />
    {row.hook && <p className="mt-2 text-xs text-gray-400">Personal line based on: {row.hook}</p>}
    {editable && <div className="mt-3 flex flex-wrap gap-2">
      <button onClick={approve} disabled={!!busy} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">{busy === "send" ? "Sending…" : "✓ Approve and send"}</button>
      <button onClick={discard} disabled={!!busy} className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Discard</button>
    </div>}
  </article>;
}

/* ---------------- Activity ---------------- */
function ActivityTab({ d, nav }: { d: Data; nav: Nav }) {
  const stamp = (iso: string) => { const t = new Date(iso); return new Date().toDateString() === t.toDateString() ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : t.toLocaleDateString([], { month: "short", day: "numeric" }); };
  return <div className="overflow-hidden rounded-xl border bg-white">
    {d.acts.length === 0 && <p className="p-6 text-sm text-gray-400">No activity yet.</p>}
    <ul className="divide-y">{d.acts.map((a: any) => <li key={a.id} onClick={() => a.candidate_id && nav("det", { id: a.candidate_id })} className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 ${a.candidate_id ? "cursor-pointer hover:bg-gray-50" : ""}`}>
      <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-gray-400">{stamp(a.created_at)}</span>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${AGENT_TAG[a.type] || "bg-gray-100 text-gray-600"}`}>{(a.type || "event").replace(/_/g, " ")}</span>
      <span className="min-w-0 flex-1 break-words text-sm">{a.candidates ? <b className="font-medium">{fullName(a.candidates)} </b> : null}{a.description || a.type}</span>
    </li>)}</ul>
  </div>;
}
