"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { B, Av, Widget, Empty, days, ago, scoreText, fullName, Btn } from "@/lib/ui";

export function Dash({ nav }: { nav: (p: string, d?: any) => void }) {
  const { profile } = useAuth();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ data: ca }, { data: jo }, { data: ap }, { data: cl }, { data: st }, { data: iv }, { data: tk }, { data: acts }, { data: top }, { data: sums }, { count: newWeek }, { data: recent }] = await Promise.all([
        supabase.from("candidates").select("id,status,source,created_at,updated_at").limit(10000),
        supabase.from("jobs").select("id,title,status,created_at,updated_at,client_id,clients(company_name)").limit(3000),
        supabase.from("applications").select("id,job_id,stage_id,status,offer_accepted_at,offer_declined_at,offer_date,submitted_to_client_at").limit(20000),
        supabase.from("clients").select("id,status").limit(2000),
        supabase.from("pipeline_stages").select("*").order("sort_order"),
        supabase.from("interviews").select("id,scheduled_at,type,status,location,candidates(first_name,last_name)").gte("scheduled_at", new Date(Date.now() - 3600000).toISOString()).order("scheduled_at").limit(8),
        supabase.from("tasks").select("id,title,due_date,priority,status,candidates(first_name,last_name)").neq("status", "completed").order("due_date", { nullsFirst: false }).limit(10),
        supabase.from("activities").select("id,type,description,created_at,candidate_id,candidates(first_name,last_name)").order("created_at", { ascending: false }).limit(12),
        supabase.from("v_job_leaderboard").select("job_id,candidate_id,first_name,last_name,current_title,score,rank,verdict,recommended_action,application_id,app_status").lte("rank", 3).gte("score", 60).order("score", { ascending: false }).limit(60),
        supabase.from("v_job_rank_summary").select("*"),
        supabase.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
        supabase.from("candidates").select("id,first_name,last_name,current_title,source,created_at,status").order("created_at", { ascending: false }).limit(8),
      ]);
      const jobs = jo || []; const cands = ca || []; const apps = ap || []; const stages = st || [];
      const openJobs = jobs.filter((j: any) => j.status === "open");
      const filled = jobs.filter((j: any) => j.status === "filled");
      const placed = cands.filter((c: any) => c.status === "placed" || c.status === "hired");
      const ttf = filled.length ? Math.round(filled.reduce((s: number, j: any) => s + days(j.created_at, j.updated_at), 0) / filled.length) : null;
      const tth = placed.length ? Math.round(placed.reduce((s: number, c: any) => s + days(c.created_at, c.updated_at), 0) / placed.length) : null;
      const accepted = apps.filter((a: any) => a.offer_accepted_at).length; const declined = apps.filter((a: any) => a.offer_declined_at).length; const offers = accepted + declined;
      const sb = cands.reduce((a: any, c: any) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
      // Applications by stage (dedupe stage names across pipelines)
      const active = apps.filter((a: any) => a.status !== "rejected"); const byStageName: Record<string, number> = {}; const stageName = (id: string) => stages.find((s: any) => s.id === id)?.name || stages[0]?.name || "New";
      active.forEach((a: any) => { const n = stageName(a.stage_id); byStageName[n] = (byStageName[n] || 0) + 1; });
      const uniqStages = stages.filter((s: any, i: number, arr: any[]) => arr.findIndex(x => x.name === s.name) === i);
      const sumMap: Record<string, any> = {}; (sums || []).forEach((s: any) => { sumMap[s.job_id] = s; });
      const attention = openJobs.map((j: any) => { const s = sumMap[j.id]; const inPipe = active.filter((a: any) => a.job_id === j.id).length; const reasons: string[] = []; if (!s || !s.screened) reasons.push("nobody screened"); else if (!s.strong) reasons.push("no strong match yet"); if (!inPipe) reasons.push("empty pipeline"); if (days(j.created_at) > 30 && !active.some((a: any) => a.job_id === j.id && a.submitted_to_client_at)) reasons.push(`${days(j.created_at)}d open, nothing submitted`); return { j, reasons, s, inPipe }; }).filter(x => x.reasons.length).slice(0, 8);
      const jobTitle: Record<string, string> = {}; jobs.forEach((j: any) => { jobTitle[j.id] = j.title; });
      const topList = (top || []).filter((t: any) => t.app_status !== "rejected" && !t.application_id).slice(0, 8);
      setD({ tCand: cands.length, newWeek: newWeek || 0, oj: openJobs.length, tClient: (cl || []).filter((c: any) => c.status === "active").length, ttf, tth, submitted: active.filter((a: any) => a.submitted_to_client_at).length, offers, accepted, rate: offers ? Math.round((accepted / offers) * 100) : null,
        ageRows: openJobs.map((j: any) => ({ id: j.id, title: j.title, client: j.clients?.company_name, age: days(j.created_at) })).sort((a: any, b: any) => b.age - a.age).slice(0, 6),
        stages: uniqStages, byStageName, sb, iv: iv || [], tasks: tk || [], acts: acts || [], topList, jobTitle, attention, recent: recent || [] });
    } catch (e: any) { setErr(String(e?.message || e)); }
  })(); }, []);
  if (err) return <div className="py-20 text-center text-red-500 text-sm">Dashboard failed to load: {err}</div>;
  if (!d) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const cards = [["Candidates", d.tCand.toLocaleString(), `+${d.newWeek} this week`, "cands"], ["Open jobs", d.oj, `${d.attention.length} need attention`, "jobs"], ["Submitted to clients", d.submitted, "active applications", "pipeline"], ["Interviews", d.iv.length, "upcoming", "interviews"]] as const;
  const maxStage = Math.max(1, ...Object.values(d.byStageName).map(Number));
  return <div>
    <div className="flex justify-between items-center mb-5"><div><h1 className="text-lg font-semibold">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {profile?.first_name || "there"}</h1><p className="text-xs text-gray-400">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p></div><Btn small primary onClick={() => nav("search")}>🔍 Find someone</Btn></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">{cards.map(([l, v, sub, dest]) => <div key={l} onClick={() => nav(dest as string)} className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-sm"><div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{l}</div><div className="text-2xl font-semibold">{v as any}</div><div className="text-[11px] text-gray-400">{sub}</div></div>)}</div>

    <div className="grid md:grid-cols-2 gap-4 mb-4">
      <Widget title="Who to call today" info="Top-3 AI matches (60+) on open jobs who aren't in a pipeline yet" right={<button onClick={() => nav("rank")} className="text-xs text-blue-600 hover:underline">Rank ↗</button>}>{d.topList.length === 0 ? <Empty t="No unworked strong matches. Open a job and click Find candidates." /> : <div className="divide-y">{d.topList.map((t: any) => <div key={t.candidate_id + t.job_id} onClick={() => nav("job", { id: t.job_id, tab: "slate" })} className="flex items-center justify-between py-2 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded"><div className="flex items-center gap-2 min-w-0"><Av n={`${t.first_name} ${t.last_name}`} sz="w-7 h-7 text-[10px]" /><div className="min-w-0"><div className="text-sm truncate">{t.first_name} {t.last_name} <span className="text-[10px] text-gray-400">#{t.rank}</span></div><div className="text-[10px] text-gray-400 truncate">{d.jobTitle[t.job_id] || "Job"}</div></div></div><span className={`text-sm font-bold ${scoreText(t.score)}`}>{t.score}</span></div>)}</div>}</Widget>
      <Widget title="Jobs needing attention" right={<button onClick={() => nav("jobs")} className="text-xs text-blue-600 hover:underline">Jobs ↗</button>}>{d.attention.length === 0 ? <Empty t="Every open job has a screened slate and an active pipeline." /> : <div className="divide-y">{d.attention.map((x: any) => <div key={x.j.id} onClick={() => nav("job", { id: x.j.id })} className="py-2 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded"><div className="text-sm truncate">{x.j.title} <span className="text-[10px] text-gray-400 capitalize">{x.j.clients?.company_name || ""}</span></div><div className="text-[10px] text-amber-700">{x.reasons.join(" · ")}</div></div>)}</div>}</Widget>
    </div>

    <div className="mb-4"><Widget title="Hiring pipeline" info="Active applications by stage, all open jobs">
      <div className="flex gap-1 flex-wrap">{d.stages.map((s: any) => { const n = d.byStageName[s.name] || 0; return <div key={s.id} onClick={() => nav("pipeline")} className="flex-1 min-w-[90px] text-center py-3 rounded-lg cursor-pointer" style={{ background: s.color + "14", border: `1px solid ${s.color}30` }}><div className="text-xl font-semibold" style={{ color: s.color }}>{n}</div><div className="text-[9px] font-semibold" style={{ color: s.color }}>{s.name}</div><div className="h-1 mt-2 mx-3 rounded-full bg-white/60 overflow-hidden"><div className="h-full" style={{ width: `${(n / maxStage) * 100}%`, background: s.color }} /></div></div>; })}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4">{Object.entries(d.sb).sort((a: any, b: any) => b[1] - a[1]).map(([s, c]: any) => <div key={s} onClick={() => nav("cands", { status: s })} className="flex items-center gap-1.5 text-xs cursor-pointer"><B s={s} /><span className="text-gray-500">{c}</span></div>)}</div>
    </Widget></div>

    <div className="grid md:grid-cols-3 gap-4 mb-4">
      <Widget title="Time-to-fill" info="Avg days to fill a job">{d.ttf == null ? <Empty /> : <div className="py-2 text-center"><div className="text-3xl font-semibold">{d.ttf}</div><div className="text-xs text-gray-400 mt-1">average days</div></div>}</Widget>
      <Widget title="Time-to-hire" info="Avg days from applied to placed">{d.tth == null ? <Empty /> : <div className="py-2 text-center"><div className="text-3xl font-semibold">{d.tth}</div><div className="text-xs text-gray-400 mt-1">average days</div></div>}</Widget>
      <Widget title="Offer acceptance">{d.rate == null ? <Empty /> : <div className="py-2 text-center"><div className="text-3xl font-semibold">{d.rate}%</div><div className="text-xs text-gray-400 mt-1">{d.accepted} of {d.offers} offers accepted</div></div>}</Widget>
    </div>

    <div className="grid md:grid-cols-2 gap-4 mb-4">
      <Widget title="Age of open jobs" info="How long open jobs have been live">{d.ageRows.length === 0 ? <Empty /> : <table className="w-full text-sm"><thead><tr className="text-left text-[10px] text-gray-400 uppercase"><th className="pb-2">Job</th><th className="pb-2 text-right">Days open</th></tr></thead><tbody>{d.ageRows.map((r: any) => <tr key={r.id} onClick={() => nav("job", { id: r.id })} className="border-t border-gray-50 cursor-pointer hover:bg-gray-50"><td className="py-1.5 truncate max-w-[240px]">{r.title}<span className="text-[10px] text-gray-400 capitalize"> {r.client || ""}</span></td><td className={`py-1.5 text-right font-medium ${r.age > 30 ? "text-red-600" : ""}`}>{r.age}</td></tr>)}</tbody></table>}</Widget>
      <Widget title="Upcoming interviews" right={<button onClick={() => nav("interviews")} className="text-xs text-blue-600 hover:underline">All ↗</button>}>{d.iv.length === 0 ? <Empty t="Nothing scheduled." /> : <div className="divide-y">{d.iv.map((i: any) => <div key={i.id} className="flex items-center justify-between py-2"><div className="flex items-center gap-2"><Av n={fullName(i.candidates)} sz="w-7 h-7 text-[10px]" /><div><div className="text-sm">{fullName(i.candidates)}</div><div className="text-[10px] text-gray-400">{(i.type || "").replace(/_/g, " ")}</div></div></div><div className="flex items-center gap-2 text-xs text-gray-500">{i.location && /^https?:/.test(i.location) && <a href={i.location} target="_blank" rel="noreferrer" className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">Join</a>}{new Date(i.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div></div>)}</div>}</Widget>
    </div>

    <div className="grid md:grid-cols-3 gap-4">
      <Widget title="New applicants" info="Latest people to enter the ATS" right={<button onClick={() => nav("cands")} className="text-xs text-blue-600 hover:underline">All ↗</button>}>{d.recent.length === 0 ? <Empty /> : <div className="divide-y">{d.recent.map((c: any) => <div key={c.id} onClick={() => nav("det", { id: c.id })} className="flex items-center justify-between py-2 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded"><div className="min-w-0"><div className="text-sm truncate">{fullName(c)}</div><div className="text-[10px] text-gray-400 truncate">{c.current_title || "—"} · {c.source || "?"}</div></div><span className="text-[10px] text-gray-400 shrink-0">{ago(c.created_at)}</span></div>)}</div>}</Widget>
      <Widget title="Tasks due" right={<button onClick={() => nav("tasks")} className="text-xs text-blue-600 hover:underline">All ↗</button>}>{d.tasks.length === 0 ? <Empty t="No open tasks." /> : <div className="divide-y">{d.tasks.map((t: any) => { const overdue = t.due_date && new Date(t.due_date) < new Date(); return <div key={t.id} className="flex items-center justify-between py-2"><div className="min-w-0"><div className="text-sm truncate">{t.title}</div><div className="text-[10px] text-gray-400">{t.candidates ? fullName(t.candidates) : ""}</div></div><span className={`text-[10px] ${overdue ? "text-red-500" : "text-gray-400"}`}>{t.due_date ? new Date(t.due_date).toLocaleDateString() : "—"}</span></div>; })}</div>}</Widget>
      <Widget title="Recent activity">{d.acts.length === 0 ? <Empty /> : <div className="divide-y">{d.acts.map((a: any) => <div key={a.id} onClick={() => a.candidate_id && nav("det", { id: a.candidate_id })} className="py-1.5 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded"><div className="text-xs truncate">{a.candidates ? <b className="font-medium">{fullName(a.candidates)}</b> : null} {a.description || a.type}</div><div className="text-[10px] text-gray-400">{ago(a.created_at)}</div></div>)}</div>}</Widget>
    </div>
  </div>;
}
