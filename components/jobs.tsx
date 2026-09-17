"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { B, Av, Modal, Field, TextArea, Select, logActivity, fn, useToast, Btn, Inline, Score, scoreText, ago, Empty, fullName, exportCsv } from "@/lib/ui";
import { Audit, BriefModal, callAgent } from "@/app/rank";

export const JOB_STATUSES = ["draft", "open", "on_hold", "filled", "closed"];
const JST: Record<string, string> = { open: "bg-green-100 text-green-800", on_hold: "bg-yellow-100 text-yellow-800", filled: "bg-blue-100 text-blue-800", draft: "bg-gray-100 text-gray-600", closed: "bg-gray-100 text-gray-500" };
const ACTION_LABEL: Record<string, string> = { advance: "Advance", human_call: "Call", human_review: "Review", decline_recommended: "Decline" };
const ACTION_CLS: Record<string, string> = { advance: "bg-green-100 text-green-700", human_call: "bg-blue-100 text-blue-700", human_review: "bg-amber-100 text-amber-700", decline_recommended: "bg-red-100 text-red-700" };

/* ---------------- Jobs list ---------------- */
export function Jobs({ nav, editable, pr }: { nav: (p: string, d?: any) => void; editable: boolean; pr?: any }) {
  const [jobs, setJobs] = useState<any[]>([]); const [clients, setClients] = useState<any[]>([]); const [apps, setApps] = useState<any[]>([]); const [stages, setStages] = useState<any[]>([]); const [recs, setRecs] = useState<any[]>([]); const [add, setAdd] = useState(!!pr?.add); const [collapsed, setCollapsed] = useState<Record<string, boolean>>({}); const [sum, setSum] = useState<Record<string, any>>({}); const [view, setView] = useState<"open" | "all">("open"); const [q, setQ] = useState("");
  const load = useCallback(async () => {
    const [{ data: j }, { data: c }, { data: a }, { data: st }, { data: r }, { data: s }] = await Promise.all([
      supabase.from("jobs").select("*").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,company_name").order("company_name"),
      supabase.from("applications").select("job_id,stage_id,status").limit(10000),
      supabase.from("pipeline_stages").select("id,name,sort_order,color").order("sort_order"),
      supabase.from("profiles").select("id,first_name,email").in("role", ["super_admin", "admin", "recruiter", "hiring_manager"]),
      supabase.from("v_job_rank_summary").select("*"),
    ]);
    const m: Record<string, any> = {}; (s || []).forEach((x: any) => { m[x.job_id] = x; });
    setJobs(j || []); setClients(c || []); setApps(a || []); setStages(st || []); setRecs(r || []); setSum(m);
  }, []);
  useEffect(() => { load(); }, [load]);
  const clientName = (id: string) => clients.find(c => c.id === id)?.company_name || "Unassigned";
  const clientMap: Record<string, string> = {}; clients.forEach(c => clientMap[c.id] = c.company_name);
  async function patch(id: string, p: any) { setJobs(js => js.map(j => j.id === id ? { ...j, ...p } : j)); const { error } = await supabase.from("jobs").update(p).eq("id", id); if (error) alert(error.message); }
  const jobApps = (id: string) => apps.filter(a => a.job_id === id && a.status !== "rejected");
  const breakdown = (id: string) => { const list = jobApps(id); const first = stages[0]?.id; const m: Record<string, number> = {}; list.forEach(a => { const sid = a.stage_id || first; m[sid] = (m[sid] || 0) + 1; }); return stages.filter(s => m[s.id]).map(s => ({ name: s.name, color: s.color, n: m[s.id] })); };
  const filtered = jobs.filter(j => (view === "all" || j.status === "open" || j.status === "on_hold") && (!q || (j.title || "").toLowerCase().includes(q.toLowerCase()) || clientName(j.client_id).toLowerCase().includes(q.toLowerCase())));
  const byClient: Record<string, any[]> = {}; filtered.forEach(j => { const k = j.client_id || "none"; (byClient[k] = byClient[k] || []).push(j); });
  const groups = Object.keys(byClient).map(k => ({ clientId: k, name: k === "none" ? "Unassigned" : clientName(k), jobs: byClient[k] })).sort((a, b) => a.name.localeCompare(b.name));
  return <div>
    <div className="flex justify-between items-center mb-4 flex-wrap gap-2"><div><h1 className="text-xl font-semibold">Jobs</h1><p className="text-xs text-gray-400">{filtered.length} roles · {groups.length} clients. Open a job to see its AI slate.</p></div>
      <div className="flex gap-2 items-center"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" className="px-3 py-1.5 border rounded-lg text-sm w-40" /><div className="flex rounded-lg border overflow-hidden text-xs"><button onClick={() => setView("open")} className={"px-3 py-1.5 " + (view === "open" ? "bg-slate-800 text-white" : "bg-white")}>Open</button><button onClick={() => setView("all")} className={"px-3 py-1.5 " + (view === "all" ? "bg-slate-800 text-white" : "bg-white")}>All</button></div>{editable && <Btn primary onClick={() => setAdd(true)}>+ Add job</Btn>}</div></div>
    {groups.length === 0 && <Empty t="No jobs yet." />}
    {groups.map(g => <div key={g.clientId} className="mb-5">
      <div onClick={() => setCollapsed(p => ({ ...p, [g.clientId]: !p[g.clientId] }))} className="flex items-center gap-2 mb-1 cursor-pointer select-none"><span className="text-xs text-gray-400 w-3">{collapsed[g.clientId] ? "▸" : "▾"}</span><h3 className="text-sm font-semibold capitalize">{g.name}</h3><span className="text-[10px] text-gray-400">{g.jobs.length} {g.jobs.length === 1 ? "role" : "roles"}</span></div>
      {!collapsed[g.clientId] && <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60">{["Job", "Status", "Recruiter", "AI slate", "Pipeline", "Progress"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{g.jobs.map(j => { const bd = breakdown(j.id); const total = jobApps(j.id).length; const s = sum[j.id]; return <tr key={j.id} className="hover:bg-gray-50"><td className="px-3 py-2 font-medium cursor-pointer min-w-[180px]" onClick={() => nav("job", { id: j.id })}>{j.title}<div className="text-[10px] text-gray-400 font-normal">{j.location || "Remote"}{j.salary_min || j.salary_max ? ` · $${j.salary_min || ""}${j.salary_max ? "–" + j.salary_max : ""}${j.salary_period ? "/" + j.salary_period : ""}` : ""} · {ago(j.created_at)}</div></td>
          <td className="px-3 py-2">{editable ? <select value={j.status} onChange={e => patch(j.id, { status: e.target.value })} className={`px-2 py-1 rounded-md text-xs font-semibold border-0 cursor-pointer ${JST[j.status] || "bg-gray-100"}`}>{JOB_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select> : <B s={j.status} />}</td>
          <td className="px-3 py-2">{editable ? <select value={j.recruiter_id || ""} onChange={e => patch(j.id, { recruiter_id: e.target.value || null })} className="px-2 py-1 border rounded text-xs bg-white"><option value="">— assign —</option>{recs.map(r => <option key={r.id} value={r.id}>{r.first_name || r.email}</option>)}</select> : (recs.find(r => r.id === j.recruiter_id)?.first_name || "—")}</td>
          <td className="px-3 py-2 text-xs whitespace-nowrap">{s ? <span onClick={() => nav("job", { id: j.id, tab: "slate" })} className="cursor-pointer"><span className={s.strong ? "text-green-700 font-semibold" : "text-gray-500"}>{s.strong} strong</span> · {s.pass_count} pass · {s.screened} screened</span> : <span className="text-gray-300">not screened</span>}</td>
          <td className="px-3 py-2 text-center font-medium">{total}</td>
          <td className="px-3 py-2"><div className="flex gap-1 flex-wrap">{bd.length === 0 ? <span className="text-[10px] text-gray-300">nobody in pipeline</span> : bd.map(s => <span key={s.name} className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: s.color + "22", color: s.color }}>{s.name} {s.n}</span>)}</div></td></tr>; })}</tbody></table></div>}
    </div>)}
    {add && <AddJob clients={clientMap} onClose={() => setAdd(false)} onSaved={(id) => { setAdd(false); load(); if (id) nav("job", { id }); }} />}
  </div>;
}

export function AddJob({ clients, onClose, onSaved }: { clients: Record<string, string>; onClose: () => void; onSaved: (id?: string) => void }) {
  const [f, setF] = useState<any>({ title: "", location: "", description: "", requirements: "", client_id: "", salary_min: "", salary_max: "", salary_period: "hour" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [gen, setGen] = useState(false);
  async function genJD() { if (!f.title) { setErr("Add a title first"); return; } setGen(true); try { const d: any = await fn("ai-assist", { action: "jd", title: f.title }); setF((x: any) => ({ ...x, description: d.text || d.description || x.description })); } catch (e: any) { setErr("AI: " + (e?.message || e)); } setGen(false); }
  async function save() { if (!f.title) { setErr("Title required"); return; } setBusy(true); const payload: any = { title: f.title, location: f.location, description: f.description, requirements: f.requirements || null, status: "open" }; if (f.client_id) payload.client_id = f.client_id; if (f.salary_min) payload.salary_min = Number(f.salary_min); if (f.salary_max) payload.salary_max = Number(f.salary_max); if (f.salary_min || f.salary_max) payload.salary_period = f.salary_period; const { data, error } = await supabase.from("jobs").insert(payload).select("id").single(); setBusy(false); if (error) setErr(error.message); else onSaved(data?.id); }
  return <Modal title="Add job" onClose={onClose}><Field label="Title *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} /><Select label="Client" value={f.client_id} onChange={(e: any) => setF({ ...f, client_id: e.target.value })} options={[["", "— None —"], ...Object.entries(clients)]} /><Field label="Location" value={f.location} onChange={(e: any) => setF({ ...f, location: e.target.value })} placeholder="Remote / Nanuet, NY" />
    <div className="grid grid-cols-3 gap-2"><Field label="Pay min" type="number" value={f.salary_min} onChange={(e: any) => setF({ ...f, salary_min: e.target.value })} /><Field label="Pay max" type="number" value={f.salary_max} onChange={(e: any) => setF({ ...f, salary_max: e.target.value })} /><Select label="Per" value={f.salary_period} onChange={(e: any) => setF({ ...f, salary_period: e.target.value })} options={["hour", "month", "year"]} /></div>
    <label className="block mb-3"><div className="flex justify-between items-center"><span className="text-xs text-gray-500">Description</span><button type="button" disabled={gen} onClick={genJD} className="text-xs text-blue-600 hover:underline disabled:opacity-50">{gen ? "Generating…" : "✨ Generate with AI"}</button></div><textarea value={f.description} onChange={(e: any) => setF({ ...f, description: e.target.value })} rows={6} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
    <TextArea label="Requirements (must-haves, one per line)" rows={4} value={f.requirements} onChange={(e: any) => setF({ ...f, requirements: e.target.value })} />
    {err && <p className="text-xs text-red-500 mb-2">{err}</p>}<Btn primary disabled={busy} onClick={save} className="w-full">{busy ? "Saving..." : "Save job"}</Btn></Modal>;
}

/* ---------------- Job detail: Slate / Pipeline / Details / Activity ---------------- */
export function JobDetail({ nav, pr, editable }: { nav: (p: string, d?: any) => void; pr: any; editable: boolean }) {
  const { profile } = useAuth(); const { say } = useToast();
  const [j, setJ] = useState<any>(null); const [tab, setTab] = useState<string>(pr?.tab || "slate"); const [apps, setApps] = useState<any[]>([]); const [rows, setRows] = useState<any[]>([]); const [stages, setStages] = useState<any[]>([]); const [clients, setClients] = useState<any[]>([]); const [recs, setRecs] = useState<any[]>([]); const [acts, setActs] = useState<any[]>([]); const [sum, setSum] = useState<any>(null); const [open, setOpen] = useState<any>(null); const [brief, setBrief] = useState(false); const [busy, setBusy] = useState(""); const [qs, setQs] = useState<string[]>([]); const [qIn, setQIn] = useState(""); const [drag, setDrag] = useState<string | null>(null); const [showAll, setShowAll] = useState(false);
  const load = useCallback(async () => {
    const [{ data }, { data: ap }, { data: lb }, { data: st }, { data: cl }, { data: pf }, { data: ac }, { data: sm }] = await Promise.all([
      supabase.from("jobs").select("*,clients(company_name)").eq("id", pr.id).single(),
      supabase.from("applications").select("id,status,created_at,candidate_id,stage_id,submitted_to_client_at,client_decision,candidates(first_name,last_name,current_title,status,phone,email,owner_id)").eq("job_id", pr.id).order("created_at", { ascending: false }),
      supabase.from("v_job_leaderboard").select("*").eq("job_id", pr.id).order("rank"),
      supabase.from("pipeline_stages").select("id,pipeline_id,name,sort_order,color").order("sort_order"),
      supabase.from("clients").select("id,company_name").order("company_name"),
      supabase.from("profiles").select("id,first_name,last_name,email").in("role", ["super_admin", "admin", "recruiter", "hiring_manager"]),
      supabase.from("activities").select("*").eq("job_id", pr.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("v_job_rank_summary").select("*").eq("job_id", pr.id).maybeSingle(),
    ]);
    setJ(data); setApps(ap || []); setRows(lb || []); setStages(st || []); setClients(cl || []); setRecs(pf || []); setActs(ac || []); setSum(sm || null);
    setQs(Array.isArray(data?.screening_questions) ? data.screening_questions.map((x: any) => typeof x === "string" ? x : (x.question || "")) : []);
  }, [pr.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpen((o: any) => { if (!o) return o; return rows.find(x => x.candidate_id === o.candidate_id) || o; }); }, [rows]);
  const recMap = useMemo(() => { const m: Record<string, string> = {}; recs.forEach(r => { m[r.id] = r.first_name || r.email || "?"; }); return m; }, [recs]);
  const jobStages = useMemo(() => { const pid = j?.pipeline_id; const own = pid ? stages.filter(s => s.pipeline_id === pid) : []; return own.length ? own : stages; }, [j, stages]);
  const stageOf = (id?: string) => jobStages.find(s => s.id === id) || jobStages[0];
  async function patch(p: any) { const { error } = await supabase.from("jobs").update(p).eq("id", j.id); if (error) { say(error.message, false); return; } setJ({ ...j, ...p }); }
  async function saveQs(next: string[]) { setQs(next); await supabase.from("jobs").update({ screening_questions: next }).eq("id", j.id); }
  async function findCandidates() { setBusy("shortlist"); try { const r: any = await callAgent({ action: "shortlist", job_id: j.id, size: 5 }); say(`Screened ${r?.screened ?? r?.results?.length ?? "more"} candidates from the pool.`); await load(); } catch (e: any) { say("Screening agent: " + (e?.message || e), false); } setBusy(""); }
  async function regenRubric() { setBusy("rubric"); try { await callAgent({ action: "rubric", job_id: j.id, force: true }); say("Rubric regenerated."); await load(); } catch (e: any) { say("Rubric: " + (e?.message || e), false); } setBusy(""); }
  async function moveApp(appId: string, stageId: string) {
    const a = apps.find(x => x.id === appId); if (!a || a.stage_id === stageId) return; const from = stageOf(a.stage_id)?.name; const to = stageOf(stageId)?.name;
    setApps(list => list.map(x => x.id === appId ? { ...x, stage_id: stageId } : x));
    const { error } = await supabase.from("applications").update({ stage_id: stageId }).eq("id", appId); if (error) { say(error.message, false); load(); return; }
    logActivity("stage_change", `Stage: ${from || "—"} → ${to || "—"}`, { candidate_id: a.candidate_id, job_id: j.id, application_id: appId }, profile?.id);
  }
  async function deleteJob() { if (!confirm(`Delete "${j.title}"? Applications for this job are removed too. Candidates stay.`)) return; await supabase.from("applications").delete().eq("job_id", j.id); const { error } = await supabase.from("jobs").delete().eq("id", j.id); if (error) { say(error.message, false); return; } say("Job deleted."); nav("jobs"); }
  if (!j) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const rubric = j.custom_fields?.screening_rubric || null;
  const top = rows.filter(r => r.app_status !== "rejected"); const slate = showAll ? top : top.slice(0, 10);
  const inPipe = apps.filter(a => a.status !== "rejected"); const appByCand: Record<string, any> = {}; apps.forEach(a => { appByCand[a.candidate_id] = a; });
  const TABS = [["slate", `AI slate (${top.length})`], ["pipeline", `Pipeline (${inPipe.length})`], ["details", "Details"], ["activity", `Activity (${acts.length})`]];
  return <div>
    <button onClick={() => nav("jobs")} className="text-sm text-gray-400 mb-3 block">&larr; Jobs</button>
    <div className="bg-white rounded-xl border p-5 mb-4">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1"><h1 className="text-lg font-semibold"><Inline editable={editable} value={j.title} onSave={v => patch({ title: v })} cls="font-semibold" /></h1>
          <div className="text-sm text-gray-500 mt-1 flex gap-2 flex-wrap items-center capitalize"><Inline editable={editable} value={j.client_id || ""} options={[["", "No client"], ...clients.map(c => [c.id, c.company_name] as [string, string])]} fmt={v => clients.find(c => c.id === v)?.company_name || j.clients?.company_name || "No client"} onSave={v => patch({ client_id: v || null })} /><span>·</span><Inline editable={editable} value={j.location || ""} placeholder="Location" onSave={v => patch({ location: v })} /><span>·</span><span className="normal-case">$<Inline editable={editable} type="number" value={j.salary_min} placeholder="min" onSave={v => patch({ salary_min: v })} />–<Inline editable={editable} type="number" value={j.salary_max} placeholder="max" onSave={v => patch({ salary_max: v })} />/<Inline editable={editable} value={j.salary_period || "hour"} options={["hour", "month", "year"]} onSave={v => patch({ salary_period: v })} /></span></div>
          <div className="flex gap-1.5 mt-2 flex-wrap text-[10px]">{rubric ? <><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.must_haves || []).length} must-haves</span><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.nice_to_haves || []).length} nice-to-haves</span><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.knockouts || []).length} knockouts</span></> : <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">No rubric yet — click Find candidates</span>}{sum && <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">{sum.screened} screened · {sum.pass_count} pass · {sum.strong} strong{sum.last_screened_at ? ` · ${ago(sum.last_screened_at)}` : ""}</span>}{j.is_public && <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700">● on careers page</span>}</div></div>
        <div className="flex flex-col items-end gap-2">{editable ? <select value={j.status} onChange={e => patch({ status: e.target.value })} className={`px-2 py-1 rounded-md text-xs font-semibold border-0 ${JST[j.status] || "bg-gray-100"}`}>{JOB_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select> : <B s={j.status} />}
          {editable && <div className="flex gap-1.5 flex-wrap justify-end"><Btn small primary disabled={!!busy} onClick={findCandidates}>{busy === "shortlist" ? "⏳ Screening… (~4 min)" : "✦ Find candidates"}</Btn><Btn small onClick={() => nav("search", { q: j.title })}>🔍 Search</Btn><Btn small onClick={() => setBrief(true)}>Edit brief</Btn><Btn small disabled={!!busy} onClick={regenRubric}>{busy === "rubric" ? "…" : "Rubric"}</Btn></div>}</div>
      </div>
    </div>
    <div className="flex border-b mb-4">{TABS.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm border-b-2 ${tab === id ? "border-slate-800 text-slate-800 font-medium" : "border-transparent text-gray-400"}`}>{l}</button>)}</div>

    {tab === "slate" && <div>
      {top.length === 0 ? <div className="bg-white rounded-xl border p-10 text-center"><p className="text-sm text-gray-500 mb-3">Nobody screened for this job yet.</p>{editable && <Btn primary disabled={!!busy} onClick={findCandidates}>{busy === "shortlist" ? "⏳ Screening…" : "✦ Find candidates from your pool"}</Btn>}<p className="text-[11px] text-gray-400 mt-3">The screening agent builds a rubric from the brief, then scores candidates against it with evidence. You can also add people from Search.</p></div>
        : <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60">{["#", "Candidate", "Score", "Verdict", "Why", "Stage", "Screened"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{slate.map(r => { const a = appByCand[r.candidate_id]; return <tr key={r.candidate_id} onClick={() => setOpen(r)} className={`cursor-pointer hover:bg-gray-50 ${open?.candidate_id === r.candidate_id ? "bg-blue-50/40" : ""} ${r.rank <= 2 ? "bg-green-50/30" : ""}`}>
            <td className="px-3 py-2 text-xs text-gray-400 font-medium">{r.rank <= 2 ? <span className="text-green-700 font-bold">#{r.rank}</span> : r.rank}</td>
            <td className="px-3 py-2"><div className="flex items-center gap-2"><Av n={`${r.first_name} ${r.last_name}`} sz="w-7 h-7 text-[9px]" /><div className="min-w-0"><div className="font-medium whitespace-nowrap">{r.first_name} {r.last_name}</div><div className="text-[10px] text-gray-400 truncate max-w-[220px]">{r.current_title || ""}{r.current_company ? ` @ ${r.current_company}` : ""}{r.min_hourly_rate ? ` · $${r.min_hourly_rate}/h` : ""}{r.english_cefr ? ` · ${r.english_cefr}` : ""}</div></div></div></td>
            <td className="px-3 py-2"><div className="flex items-center gap-2"><Score s={r.score} />{r.tier && <span className="text-[10px] text-gray-400">{r.tier}</span>}</div></td>
            <td className="px-3 py-2"><div className="flex items-center gap-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${r.verdict === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.verdict}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ACTION_CLS[r.recommended_action] || "bg-gray-100 text-gray-500"}`}>{ACTION_LABEL[r.recommended_action] || r.recommended_action || "—"}</span></div></td>
            <td className="px-3 py-2 text-xs text-gray-500 max-w-[320px]"><div className="line-clamp-2" title={r.summary || r.recommended_action_text || ""}>{r.summary || r.recommended_action_text || ""}</div></td>
            <td className="px-3 py-2 text-[11px] whitespace-nowrap">{a ? (a.status === "rejected" ? <B s="rejected" /> : <span className="text-gray-600">{stageOf(a.stage_id)?.name || "—"}</span>) : <span className="text-gray-300">not in pipeline</span>}</td>
            <td className="px-3 py-2 text-[10px] text-gray-400 whitespace-nowrap">{ago(r.screened_at)}</td></tr>; })}</tbody></table>
          {top.length > 10 && <div className="px-3 py-2 border-t text-xs"><button onClick={() => setShowAll(s => !s)} className="text-blue-600 hover:underline">{showAll ? "Show top 10" : `Show all ${top.length}`}</button></div>}
        </div>}
      <p className="text-[11px] text-gray-400 mt-2">Click a row for the full audit: criteria with evidence, red flags, interview questions, and next-step buttons (advance, submit to client, decline, call, email).</p>
    </div>}

    {tab === "pipeline" && <div>
      {inPipe.length === 0 ? <Empty t="Nobody in this job's pipeline yet. Advance someone from the slate, or add from Search / a candidate profile." /> : <div className="flex gap-3 overflow-x-auto pb-4">{jobStages.map(s => { const col = inPipe.filter(a => (a.stage_id || jobStages[0]?.id) === s.id); return <div key={s.id} onDragOver={e => editable && e.preventDefault()} onDrop={() => { if (editable && drag) { moveApp(drag, s.id); setDrag(null); } }} className="w-56 shrink-0"><div className="flex items-center gap-2 mb-2 px-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-xs font-semibold">{s.name}</span><span className="text-[10px] text-gray-400">{col.length}</span></div><div className="space-y-2 min-h-[80px] bg-gray-50/60 rounded-lg p-1.5">{col.map(a => { const lb = rows.find(r => r.candidate_id === a.candidate_id); return <div key={a.id} draggable={editable} onDragStart={() => setDrag(a.id)} onClick={() => nav("det", { id: a.candidate_id })} className="bg-white rounded-lg border p-2.5 cursor-pointer hover:shadow-sm"><div className="flex justify-between items-start gap-1"><div className="min-w-0"><div className="text-sm font-medium truncate">{fullName(a.candidates)}</div><div className="text-[10px] text-gray-400 truncate">{a.candidates?.current_title || ""}</div></div>{lb?.score != null && <span className={`text-xs font-bold ${scoreText(lb.score)}`}>{lb.score}</span>}</div>{a.submitted_to_client_at && <div className="text-[10px] text-cyan-700 mt-1">submitted {ago(a.submitted_to_client_at)}{a.client_decision ? ` · client: ${a.client_decision}` : ""}</div>}</div>; })}</div></div>; })}</div>}
      {apps.some(a => a.status === "rejected") && <details className="mt-2 text-xs text-gray-400"><summary className="cursor-pointer">Declined ({apps.filter(a => a.status === "rejected").length})</summary><div className="mt-1 space-y-1">{apps.filter(a => a.status === "rejected").map(a => <div key={a.id} onClick={() => nav("det", { id: a.candidate_id })} className="cursor-pointer hover:underline">{fullName(a.candidates)}</div>)}</div></details>}
    </div>}

    {tab === "details" && <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border p-4 md:col-span-2"><h3 className="text-sm font-medium mb-2">Description</h3><div className="text-sm text-gray-700 whitespace-pre-wrap"><Inline editable={editable} multiline value={j.description || ""} placeholder="Click to add a description" onSave={v => patch({ description: v })} /></div></div>
      <div className="bg-white rounded-xl border p-4 md:col-span-2"><h3 className="text-sm font-medium mb-2">Requirements</h3><div className="text-sm text-gray-700 whitespace-pre-wrap"><Inline editable={editable} multiline value={j.requirements || ""} placeholder="Click to add requirements (one per line)" onSave={v => patch({ requirements: v })} /></div></div>
      {rubric && <div className="bg-white rounded-xl border p-4 md:col-span-2"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-medium">Screening rubric</h3>{editable && <Btn small onClick={() => setBrief(true)}>Edit</Btn>}</div><div className="grid md:grid-cols-3 gap-3 text-xs">{[["Must-haves", rubric.must_haves], ["Nice-to-haves", rubric.nice_to_haves], ["Knockouts", rubric.knockouts]].map(([l, arr]: any) => <div key={l}><div className="text-[10px] uppercase text-gray-400 mb-1">{l}</div><ul className="list-disc ml-4 space-y-0.5 text-gray-700">{(arr || []).map((x: any, i: number) => <li key={i}>{typeof x === "string" ? x : x.text}</li>)}</ul></div>)}</div></div>}
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-2">Team</h3><div className="text-xs space-y-2"><div className="flex justify-between"><span className="text-gray-400">Recruiter</span><Inline editable={editable} value={j.recruiter_id || ""} options={[["", "Unassigned"], ...recs.map(r => [r.id, r.first_name || r.email] as [string, string])]} fmt={v => recMap[v] || "Unassigned"} onSave={v => patch({ recruiter_id: v || null })} /></div><div className="flex justify-between"><span className="text-gray-400">Created</span><span>{new Date(j.created_at).toLocaleDateString()}</span></div></div></div>
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-2">Careers page</h3><p className="text-xs text-gray-500 mb-2">{j.is_public ? "Live on your public careers page and in the Indeed feed." : "Not published."}</p>{editable && <Btn small onClick={() => patch({ is_public: !j.is_public, published_at: !j.is_public ? new Date().toISOString() : null })}>{j.is_public ? "Unpublish" : "Publish to careers"}</Btn>}</div>
      {editable && <div className="bg-white rounded-xl border p-4 md:col-span-2"><h3 className="text-sm font-medium mb-2">Screening questions (shown on the application form)</h3>{qs.length === 0 ? <p className="text-xs text-gray-400 mb-2">None yet.</p> : <ol className="list-decimal ml-4 mb-2">{qs.map((q, i) => <li key={i} className="text-sm py-0.5 flex justify-between gap-2"><span>{q}</span><button onClick={() => saveQs(qs.filter((_, x) => x !== i))} className="text-gray-300 hover:text-red-500 text-xs">remove</button></li>)}</ol>}<div className="flex gap-2"><input value={qIn} onChange={e => setQIn(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && qIn.trim()) { saveQs([...qs, qIn.trim()]); setQIn(""); } }} placeholder="Add a screening question…" className="flex-1 px-3 py-2 border rounded-lg text-sm" /><Btn primary onClick={() => { if (qIn.trim()) { saveQs([...qs, qIn.trim()]); setQIn(""); } }}>Add</Btn></div></div>}
      {editable && <div className="md:col-span-2 flex justify-end"><Btn small danger onClick={deleteJob}>Delete job</Btn></div>}
    </div>}

    {tab === "activity" && <div className="bg-white rounded-xl border p-4">{acts.length === 0 ? <p className="text-xs text-gray-400">No activity yet.</p> : <div className="space-y-2">{acts.map(a => <div key={a.id} className="flex gap-3 text-sm"><span className="text-[10px] text-gray-400 w-28 shrink-0">{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><span>{a.description || a.type}</span></div>)}</div>}</div>}

    {open && <Audit row={open} job={{ ...j, job: j, title: j.title }} jobStages={jobStages} recs={recs} recMap={recMap} editable={editable} profileId={profile?.id} onClose={() => setOpen(null)} onChanged={load} say={say} nav={nav} />}
    {brief && <BriefModal job={j} onClose={() => setBrief(false)} onSaved={async (regen: boolean) => { setBrief(false); await load(); if (regen) regenRubric(); else say("Brief saved."); }} />}
  </div>;
}
