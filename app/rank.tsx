"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { B, Av, Modal, Field, logActivity, MediaLink } from "@/lib/ui";

/* ---------------- Rank (AI screening leaderboard) ---------------- */
const POOL = "General Applicant Pool";
const ACTION_LABEL: Record<string, string> = { advance: "Advance", human_call: "Call", human_review: "Review", decline_recommended: "Decline" };
const ACTION_CLS: Record<string, string> = { advance: "bg-green-100 text-green-700", human_call: "bg-blue-100 text-blue-700", human_review: "bg-amber-100 text-amber-700", decline_recommended: "bg-red-100 text-red-700" };
const STATUS_CLS: Record<string, string> = { met: "bg-green-100 text-green-700", pass: "bg-green-100 text-green-700", partially_met: "bg-amber-100 text-amber-700", not_met: "bg-red-100 text-red-700", fail: "bg-red-100 text-red-700", unknown: "bg-gray-100 text-gray-500" };
const COV_CLS: Record<string, string> = { low: "bg-red-50 text-red-600", medium: "bg-amber-50 text-amber-700", high: "bg-green-50 text-green-700" };
function scoreCls(s: number | null) { return s == null ? "bg-gray-300" : s >= 75 ? "bg-green-500" : s >= 60 ? "bg-amber-400" : s >= 40 ? "bg-gray-400" : "bg-red-400"; }
function scoreText(s: number | null) { return s == null ? "text-gray-400" : s >= 75 ? "text-green-700" : s >= 60 ? "text-amber-700" : s >= 40 ? "text-gray-600" : "text-red-600"; }
function ago(d?: string) { if (!d) return "—"; const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; const dd = Math.round(h / 24); if (dd < 30) return `${dd}d ago`; return new Date(d).toLocaleDateString(); }
function pay(j: any) { if (!j?.salary_min && !j?.salary_max) return ""; const f = (n: any) => n == null ? "" : `$${Number(n).toLocaleString()}`; return `${f(j.salary_min)}${j.salary_min && j.salary_max ? "–" : ""}${f(j.salary_max)}${j.salary_period ? " /" + j.salary_period : ""}`; }
function Pill({ s, t }: { s: string; t?: string }) { return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${STATUS_CLS[s] || "bg-gray-100 text-gray-500"}`}>{(t || s || "").replace(/_/g, " ")}</span>; }
function ScoreBar({ score, ko, w = "w-20" }: { score: number | null; ko?: boolean; w?: string }) {
  return <div className="flex items-center gap-2"><span className={`text-sm font-semibold w-7 text-right ${scoreText(score)}`}>{score ?? "–"}</span><div className={`${w} h-1.5 rounded-full bg-gray-100 overflow-hidden ${ko ? "ring-1 ring-red-400" : ""}`}><div className={`h-full ${scoreCls(score)}`} style={{ width: `${Math.max(0, Math.min(100, score || 0))}%` }} /></div></div>;
}

async function callAgent(body: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/screening-agent`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok || j?.ok === false || j?.error) throw new Error(j?.error || j?.message || (typeof j?.detail === "string" ? j.detail : "") || text.slice(0, 300) || `HTTP ${r.status}`);
  return j;
}

export function Rank({ nav, pr, editable }: { nav: (p: string, d?: any) => void; pr?: any; editable: boolean }) {
  const { profile } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]); const [sel, setSel] = useState<string>(pr?.job_id || ""); const [rows, setRows] = useState<any[]>([]); const [stages, setStages] = useState<any[]>([]); const [recs, setRecs] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [rowsLoading, setRowsLoading] = useState(false);
  const [verdict, setVerdict] = useState("all"); const [minScore, setMinScore] = useState(0); const [hasRes, setHasRes] = useState(false); const [hasTr, setHasTr] = useState(false); const [q, setQ] = useState("");
  const [open, setOpen] = useState<any>(null); const [busy, setBusy] = useState<string>(""); const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null); const [top, setTop] = useState<any[] | null>(null); const [showTop, setShowTop] = useState(false); const [brief, setBrief] = useState(false); const [agentMsg, setAgentMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const recMap = useMemo(() => { const m: Record<string, string> = {}; recs.forEach(r => { m[r.id] = r.first_name || r.email || "?"; }); return m; }, [recs]);
  const stageMap = useMemo(() => { const m: Record<string, any> = {}; stages.forEach(s => { m[s.id] = s; }); return m; }, [stages]);
  const say = useCallback((t: string, ok = true) => { setToast({ t, ok }); setTimeout(() => setToast(null), ok ? 3500 : 8000); }, []);

  const loadJobs = useCallback(async () => {
    const [{ data: sm }, { data: jb }, { data: st }, { data: pf }] = await Promise.all([
      supabase.from("v_job_rank_summary").select("*"),
      supabase.from("jobs").select("id,title,description,requirements,salary_min,salary_max,salary_period,currency,pipeline_id,custom_fields,clients(company_name)").eq("status", "open"),
      supabase.from("pipeline_stages").select("id,pipeline_id,name,sort_order,color").order("sort_order"),
      supabase.from("profiles").select("id,first_name,last_name,email").in("role", ["super_admin", "admin", "recruiter", "hiring_manager"]),
    ]);
    const jm: Record<string, any> = {}; (jb || []).forEach((j: any) => { jm[j.id] = j; });
    const list = (sm || []).map((s: any) => ({ ...s, job: jm[s.job_id] || {}, client: jm[s.job_id]?.clients?.company_name || "" })).sort((a: any, b: any) => (a.title === POOL ? 1 : b.title === POOL ? -1 : 0) || b.strong - a.strong || b.pass_count - a.pass_count || b.screened - a.screened);
    setJobs(list); setStages(st || []); setRecs(pf || []); setLoading(false);
    setSel(cur => cur && list.some((j: any) => j.job_id === cur) ? cur : (list.find((j: any) => j.title !== POOL)?.job_id || list[0]?.job_id || ""));
  }, []);
  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { if (pr?.job_id) setSel(pr.job_id); }, [pr?.job_id]);

  const loadRows = useCallback(async () => {
    if (!sel) { setRows([]); return; } setRowsLoading(true);
    const { data } = await supabase.from("v_job_leaderboard").select("*").eq("job_id", sel).order("rank"); setRows(data || []); setRowsLoading(false);
  }, [sel]);
  useEffect(() => { loadRows(); }, [loadRows]);
  const [auto, setAuto] = useState("");
  useEffect(() => { setOpen((o: any) => { if (!o) return o; const r = rows.find(x => x.candidate_id === o.candidate_id && x.job_id === o.job_id); return r || o; }); }, [rows]);
  useEffect(() => { const key = `${pr?.job_id}:${pr?.candidate_id}`; if (pr?.candidate_id && rows.length && auto !== key) { const r = rows.find(x => x.candidate_id === pr.candidate_id && x.job_id === pr.job_id); if (r) { setOpen(r); setAuto(key); } } }, [rows, pr?.job_id, pr?.candidate_id, auto]);
  useEffect(() => { if (showTop && top === null) supabase.from("v_job_leaderboard").select("job_id,candidate_id,first_name,last_name,current_title,score,rank,recommended_action,owner_id").lte("rank", 3).gte("score", 60).order("score", { ascending: false }).then(({ data }) => setTop(data || [])); }, [showTop, top]);

  const job = jobs.find(j => j.job_id === sel); const rubric = job?.job?.custom_fields?.screening_rubric || null;
  const jobStages = useMemo(() => { const pid = job?.job?.pipeline_id; const own = pid ? stages.filter(s => s.pipeline_id === pid) : []; return own.length ? own : stages; }, [job, stages]);
  const shown = rows.filter(r => (verdict === "all" || r.verdict === verdict) && (r.score ?? -1) >= minScore && (!hasRes || (r.inputs_resume && r.inputs_resume !== "none") || r.has_resume_text) && (!hasTr || r.inputs_transcript || r.has_transcript) && (!q || `${r.first_name} ${r.last_name} ${r.current_title || ""} ${r.current_company || ""}`.toLowerCase().includes(q.toLowerCase())));

  async function shortlist() { if (!sel) return; setBusy("shortlist"); setAgentMsg(null); try { const r = await callAgent({ action: "shortlist", job_id: sel, size: 5 }); const n = r?.screened ?? r?.results?.length ?? r?.count; setAgentMsg({ t: `Screened ${n ?? "more"} candidates from the pool.`, ok: true }); await Promise.all([loadRows(), loadJobs()]); } catch (e: any) { setAgentMsg({ t: "Screening agent: " + (e?.message || e), ok: false }); } setBusy(""); }
  async function regenRubric() { if (!sel) return; setBusy("rubric"); setAgentMsg(null); try { await callAgent({ action: "rubric", job_id: sel, force: true }); setAgentMsg({ t: "Rubric regenerated.", ok: true }); await loadJobs(); } catch (e: any) { setAgentMsg({ t: "Rubric: " + (e?.message || e), ok: false }); } setBusy(""); }

  if (loading) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div>
    <div className="flex justify-between items-center mb-4"><div><h1 className="text-xl font-semibold">Rank</h1><p className="text-xs text-gray-400">AI screening leaderboard per open position — click a row for the full audit.</p></div><button onClick={() => setShowTop(s => !s)} className={`text-xs px-3 py-1.5 rounded-lg border ${showTop ? "bg-slate-800 text-white border-slate-800" : ""}`}>☎ Who to call today</button></div>
    <div className="flex gap-4 items-start">
      <div className="w-72 shrink-0 space-y-3">
        <div className="bg-white rounded-xl border divide-y divide-gray-50 overflow-hidden">{jobs.length === 0 ? <p className="p-6 text-center text-gray-400 text-sm">No open positions.</p> : jobs.map(j => <div key={j.job_id} onClick={() => { setSel(j.job_id); setOpen(null); setAgentMsg(null); }} className={`px-3 py-2.5 cursor-pointer ${sel === j.job_id ? "bg-slate-50 border-l-2 border-slate-800" : "hover:bg-gray-50 border-l-2 border-transparent"}`}><div className="text-sm font-medium truncate" title={j.title}>{j.title}</div><div className="text-[10px] text-gray-400 capitalize truncate">{j.client || "Unassigned"}</div><div className="text-[10px] text-gray-500 mt-1">{j.screened} screened · {j.pass_count} pass · <span className={j.strong ? "text-green-700 font-semibold" : ""}>{j.strong} strong</span></div><div className="h-1 rounded-full bg-gray-100 mt-1.5 overflow-hidden" title={`${j.coverage_pct}% of pool screened`}><div className="h-full bg-teal-500" style={{ width: `${j.coverage_pct || 0}%` }} /></div></div>)}</div>
        {showTop && <div className="bg-white rounded-xl border p-3"><h3 className="text-xs font-semibold mb-2">Top matches across all jobs</h3>{top === null ? <p className="text-xs text-gray-400">Loading…</p> : top.length === 0 ? <p className="text-xs text-gray-400">Nobody scored 60+ in a top-3 slot yet.</p> : (() => { const g: Record<string, any[]> = {}; top.forEach(t => { (g[t.job_id] = g[t.job_id] || []).push(t); }); return Object.entries(g).map(([jid, list]) => <div key={jid} className="mb-2"><div className="text-[10px] text-gray-400 truncate">{jobs.find(j => j.job_id === jid)?.title || "Job"}</div>{list.map(t => <div key={t.candidate_id} onClick={() => { setOpen(null); setAuto(""); nav("rank", { job_id: jid, candidate_id: t.candidate_id }); }} className="flex items-center justify-between py-0.5 cursor-pointer hover:text-blue-600"><span className="text-xs truncate">#{t.rank} {t.first_name} {t.last_name}</span><span className={`text-xs font-semibold ${scoreText(t.score)}`}>{t.score}</span></div>)}</div>); })()}</div>}
      </div>

      <div className="flex-1 min-w-0">
        {!job ? <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">Select a position.</div> : <>
          <div className="bg-white rounded-xl border p-4 mb-3"><div className="flex justify-between items-start gap-3 flex-wrap"><div className="min-w-0"><h2 className="text-lg font-semibold">{job.title}</h2><div className="text-sm text-gray-500 capitalize">{job.client || "Unassigned"}{pay(job.job) ? ` · ${pay(job.job)}` : ""}</div><div className="flex gap-1.5 mt-2 flex-wrap">{rubric ? <><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.must_haves || []).length} must-haves</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.nice_to_haves || []).length} nice-to-haves</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{(rubric.knockouts || []).length} knockouts</span>{rubric.target_english && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">English {rubric.target_english}</span>}</> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">No rubric yet</span>}{job.avg_score != null && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">avg {job.avg_score}</span>}{job.last_screened_at && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">last screened {ago(job.last_screened_at)}</span>}</div></div>
            {editable && <div className="flex gap-1.5 flex-wrap"><button disabled={!!busy} onClick={shortlist} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">{busy === "shortlist" ? "⏳ Screening… (up to ~4 min)" : "✦ Screen more from pool"}</button><button disabled={!!busy} onClick={regenRubric} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "rubric" ? "Regenerating…" : "Regenerate rubric"}</button><button disabled={!!busy} onClick={() => setBrief(true)} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">Edit brief</button></div>}</div>
            {agentMsg && <p className={`text-xs mt-2 ${agentMsg.ok ? "text-green-700" : "text-red-600"}`}>{agentMsg.t}</p>}</div>

          <div className="flex gap-2 mb-2 items-center flex-wrap"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name…" className="px-3 py-1.5 border rounded-lg text-xs w-40" /><select value={verdict} onChange={e => setVerdict(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs"><option value="all">All verdicts</option><option value="PASS">Pass</option><option value="FAIL">Fail</option></select><select value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-xs"><option value={0}>Any score</option><option value={40}>40+</option><option value={60}>60+</option><option value={75}>75+</option></select><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={hasRes} onChange={e => setHasRes(e.target.checked)} />has resume</label><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={hasTr} onChange={e => setHasTr(e.target.checked)} />has transcript</label><span className="text-xs text-gray-400 ml-auto">{shown.length} of {rows.length}</span></div>
          <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60">{["#", "Candidate", "Score", "Verdict / action", "Evidence", "Eng", "Owner", "Stage", "Screened"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">{rowsLoading ? <tr><td colSpan={9} className="p-6 text-center text-gray-400 text-xs">Loading…</td></tr> : shown.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-gray-400 text-sm">{rows.length ? "No rows match the filters." : "Nobody screened for this position yet."}</td></tr> : shown.map(r => <tr key={r.candidate_id} onClick={() => setOpen(r)} className={`cursor-pointer hover:bg-gray-50 ${open?.candidate_id === r.candidate_id ? "bg-blue-50/40" : ""}`}>
              <td className="px-3 py-2 text-xs text-gray-400 font-medium">{r.rank}</td>
              <td className="px-3 py-2"><div className="flex items-center gap-2"><Av n={`${r.first_name} ${r.last_name}`} sz="w-6 h-6 text-[9px]" /><div className="min-w-0"><div className="font-medium whitespace-nowrap">{r.first_name} {r.last_name}</div><div className="text-[10px] text-gray-400 truncate max-w-[200px]">{r.current_title || ""}{r.current_company ? ` @ ${r.current_company}` : ""}{r.min_hourly_rate ? ` · $${r.min_hourly_rate}/h` : ""}</div></div></div></td>
              <td className="px-3 py-2"><ScoreBar score={r.score} ko={r.knockout_failed} />{r.tier && <div className="text-[10px] text-gray-400 ml-9">{r.tier}</div>}</td>
              <td className="px-3 py-2"><div className="flex items-center gap-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${r.verdict === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{r.verdict}</span><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ACTION_CLS[r.recommended_action] || "bg-gray-100 text-gray-500"}`}>{ACTION_LABEL[r.recommended_action] || r.recommended_action || "—"}</span></div><div className="text-[10px] text-gray-400 truncate max-w-[180px]" title={r.recommended_action_text || ""}>{r.recommended_action_text || ""}</div></td>
              <td className="px-3 py-2 whitespace-nowrap"><span title={`resume: ${r.inputs_resume || "none"}`} className={r.inputs_resume && r.inputs_resume !== "none" ? "" : "opacity-25"}>📄</span> <span title={r.inputs_transcript ? "transcript used" : "no transcript"} className={r.inputs_transcript ? "" : "opacity-25"}>🎙</span> <span title={r.inputs_answers ? "answers used" : "no answers"} className={r.inputs_answers ? "" : "opacity-25"}>✍</span> {r.coverage && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-1 ${COV_CLS[r.coverage] || "bg-gray-50 text-gray-500"}`}>{r.coverage === "medium" ? "med" : r.coverage}</span>}</td>
              <td className="px-3 py-2 text-xs">{r.english_cefr || <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-2 text-[11px] text-gray-500">{r.owner_id && recMap[r.owner_id] ? recMap[r.owner_id] : <span className="text-gray-300">—</span>}</td>
              <td className="px-3 py-2 text-[11px] whitespace-nowrap">{r.application_id ? (r.app_status === "rejected" ? <B s="rejected" /> : <span className="text-gray-600">{stageMap[r.stage_id]?.name || jobStages[0]?.name || "—"}</span>) : <span className="text-gray-300">not applied</span>}</td>
              <td className="px-3 py-2 text-[10px] text-gray-400 whitespace-nowrap">{ago(r.screened_at)}</td>
            </tr>)}</tbody></table></div>
        </>}
      </div>
    </div>
    {open && job && <Audit row={open} job={job} jobStages={jobStages} recs={recs} recMap={recMap} editable={editable} profileId={profile?.id} onClose={() => setOpen(null)} onChanged={async () => { await loadRows(); }} say={say} nav={nav} />}
    {brief && job && <BriefModal job={job.job} onClose={() => setBrief(false)} onSaved={async (regen: boolean) => { setBrief(false); await loadJobs(); if (regen) regenRubric(); else say("Brief saved."); }} />}
    {toast && <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg text-sm shadow-lg ${toast.ok ? "bg-slate-800 text-white" : "bg-red-600 text-white"}`}>{toast.t}</div>}
  </div>;
}

/* ---------------- Candidate audit drawer ---------------- */
function Sec({ t, children }: { t: string; children: any }) { return <div className="mb-4"><h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t}</h4>{children}</div>; }
function Audit({ row, job, jobStages, recs, recMap, editable, profileId, onClose, onChanged, say, nav }: { row: any; job: any; jobStages: any[]; recs: any[]; recMap: Record<string, string>; editable: boolean; profileId?: string; onClose: () => void; onChanged: () => Promise<void>; say: (t: string, ok?: boolean) => void; nav: (p: string, d?: any) => void }) {
  const [c, setC] = useState<any>(null); const [hist, setHist] = useState<any[]>([]); const [app, setApp] = useState<any>(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [vis, setVis] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVis(true), 10); return () => clearTimeout(t); }, []);
  const load = useCallback(async () => {
    const [{ data: cd }, { data: sr }, { data: ap }] = await Promise.all([
      supabase.from("candidates").select("id,first_name,last_name,email,phone,city,state,country,current_title,current_company,min_hourly_rate,english_rate,resume_url,voice_recording_url,video_url,adam_rating,roe_rating,owner_id,status,custom_fields").eq("id", row.candidate_id).single(),
      supabase.from("screening_results").select("id,score,verdict,tier,recommended_action,result,created_at").eq("candidate_id", row.candidate_id).eq("job_id", row.job_id).order("created_at", { ascending: false }),
      supabase.from("applications").select("id,stage_id,status,stage_history,submitted_to_client_at").eq("candidate_id", row.candidate_id).eq("job_id", row.job_id).order("created_at", { ascending: false }).limit(1),
    ]);
    setC(cd); setHist(sr || []); setApp(ap?.[0] || null);
  }, [row.candidate_id, row.job_id]);
  useEffect(() => { load(); }, [load]);
  const latest = hist[0]; const r: any = latest?.result || {};
  const name = `${row.first_name} ${row.last_name}`;
  const stageOf = (id?: string) => jobStages.find(s => s.id === id);
  const hist_entry = (s: any, by: string) => ({ stage: s?.name, stage_id: s?.id, moved_at: new Date().toISOString(), moved_by: by });
  const refs = { candidate_id: row.candidate_id, job_id: row.job_id, application_id: app?.id };

  async function run(key: string, fn: () => Promise<string>) { setBusy(key); setErr(""); try { const m = await fn(); say(m); await load(); await onChanged(); } catch (e: any) { const m = e?.message || String(e); setErr(m); say(m, false); } setBusy(""); }
  const rescreen = () => run("screen", async () => { await callAgent({ action: "screen", candidate_id: row.candidate_id, job_id: row.job_id }); await logActivity("candidate_scored", `Re-screened for ${job.title}`, refs, profileId); return "Re-screened."; });
  const advance = () => run("advance", async () => {
    if (app) { const cur = stageOf(app.stage_id) || jobStages[0]; const nxt = jobStages.find(s => s.sort_order > (cur?.sort_order ?? -1)); if (!nxt) throw new Error("Already at the last stage."); const { error } = await supabase.from("applications").update({ stage_id: nxt.id, stage_history: [...(Array.isArray(app.stage_history) ? app.stage_history : []), hist_entry(nxt, profileId || "rank")] }).eq("id", app.id); if (error) throw error; await logActivity("stage_change", `Stage: ${cur?.name || "—"} → ${nxt.name}`, refs, profileId); return `Advanced to ${nxt.name}.`; }
    const st = jobStages.find(s => s.sort_order === 1) || jobStages[0]; const { data, error } = await supabase.from("applications").insert({ candidate_id: row.candidate_id, job_id: row.job_id, stage_id: st?.id || null, status: "active", source: "rank", stage_history: [hist_entry(st, profileId || "rank")] }).select("id").single(); if (error) throw error; await logActivity("application_received", `Added to ${job.title} at ${st?.name || "first stage"} from Rank`, { ...refs, application_id: data?.id }, profileId); return `Added to pipeline at ${st?.name || "first stage"}.`;
  });
  const submit = () => run("submit", async () => {
    const st = jobStages.find(s => /submitted/i.test(s.name)) || jobStages.find(s => /client/i.test(s.name)); const patch: any = { submitted_to_client_at: new Date().toISOString() }; if (st) patch.stage_id = st.id;
    if (app) { if (st) patch.stage_history = [...(Array.isArray(app.stage_history) ? app.stage_history : []), hist_entry(st, profileId || "rank")]; const { error } = await supabase.from("applications").update(patch).eq("id", app.id); if (error) throw error; }
    else { const { error } = await supabase.from("applications").insert({ candidate_id: row.candidate_id, job_id: row.job_id, status: "active", source: "rank", ...patch, stage_history: st ? [hist_entry(st, profileId || "rank")] : [] }); if (error) throw error; }
    await supabase.from("candidates").update({ status: "submitted" }).eq("id", row.candidate_id);
    await logActivity("stage_change", `Submitted to client for ${job.title}`, refs, profileId); return "Submitted to client.";
  });
  const decline = () => { const reason = window.prompt("Decline reason:"); if (reason === null) return; run("decline", async () => {
    if (app) { const { error } = await supabase.from("applications").update({ status: "rejected", rejection_reason: reason || null }).eq("id", app.id); if (error) throw error; }
    else { const { error } = await supabase.from("applications").insert({ candidate_id: row.candidate_id, job_id: row.job_id, stage_id: jobStages[0]?.id || null, status: "rejected", rejection_reason: reason || null, source: "rank" }); if (error) throw error; }
    await logActivity("stage_change", `Declined for ${job.title}${reason ? ": " + reason : ""}`, refs, profileId); return "Declined.";
  }); };
  const assign = (uid: string) => run("assign", async () => { const { error } = await supabase.from("candidates").update({ owner_id: uid || null }).eq("id", row.candidate_id); if (error) throw error; await logActivity("assigned", `Assigned to ${uid ? (recMap[uid] || "—") : "—"}`, refs, profileId); return uid ? `Assigned to ${recMap[uid] || "recruiter"}.` : "Unassigned."; });

  const crit: any[] = Array.isArray(r.criteria) ? r.criteria : []; const must = crit.filter(x => !/^n/i.test(x.id || "")); const nice = crit.filter(x => /^n/i.test(x.id || ""));
  const dims = r.dimensions && typeof r.dimensions === "object" ? Object.entries(r.dimensions) : [];
  const engRate = c?.english_rate ?? null; const cefr = row.english_cefr || c?.custom_fields?.english_cefr || null;
  return <>
    <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
    <div className={`fixed top-12 right-0 bottom-0 w-[520px] max-w-full bg-white border-l shadow-2xl z-50 overflow-y-auto transition-transform duration-200 ${vis ? "translate-x-0" : "translate-x-full"}`}>
      <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-start gap-3 z-10"><Av n={name} sz="w-10 h-10 text-sm" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold">{name}</h3>{c?.status && <B s={c.status} />}<button onClick={() => nav("det", { id: row.candidate_id })} className="text-[11px] text-blue-600 hover:underline">Full profile ↗</button></div><div className="text-xs text-gray-500 truncate">{row.current_title || c?.current_title || ""}{row.current_company ? ` @ ${row.current_company}` : ""}</div><div className="text-[10px] text-gray-400 flex gap-3 flex-wrap mt-0.5">{c?.email && <span>{c.email}</span>}{c?.phone && <span>{c.phone}</span>}{(c?.city || c?.country) && <span>{[c.city, c.state, c.country].filter(Boolean).join(", ")}</span>}{row.min_hourly_rate && <span>${row.min_hourly_rate}/h</span>}</div></div><button onClick={onClose} className="text-gray-400 text-xl leading-none">&times;</button></div>
      <div className="p-4">
        <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg"><div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white ${scoreCls(row.score)} ${row.knockout_failed ? "ring-2 ring-red-500 ring-offset-2" : ""}`}>{row.score ?? "–"}</div><div className="flex-1"><div className="flex items-center gap-1.5 flex-wrap"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${row.verdict === "PASS" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{row.verdict}</span>{row.tier && <span className="text-xs font-medium">{row.tier}</span>}<span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ACTION_CLS[row.recommended_action] || "bg-gray-100 text-gray-500"}`}>{ACTION_LABEL[row.recommended_action] || row.recommended_action || "—"}</span>{r.human_review_required && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">human review</span>}</div><div className="text-xs text-gray-600 mt-1">{r.recommended_action_text || row.recommended_action_text || ""}</div><div className="text-[10px] text-gray-400 mt-1 flex gap-2 flex-wrap"><span>coverage <span className={`px-1 rounded ${COV_CLS[row.coverage] || ""}`}>{row.coverage || "?"}</span></span><span>resume: {r.inputs?.resume || row.inputs_resume || "none"}</span><span>transcript: {r.inputs?.transcript ? "yes" : "no"}</span><span>answers: {r.inputs?.answers ? "yes" : "no"}</span>{r.model && <span>{r.model} · {r.rubric_version}</span>}<span>#{row.rank} · {ago(row.screened_at)}</span></div></div></div>
        {(c?.resume_url || c?.voice_recording_url || c?.video_url) && <div className="mb-2"><MediaLink label="Résumé" url={c.resume_url} /><MediaLink label="Voice recording" url={c.voice_recording_url} /><MediaLink label="Video" url={c.video_url} /></div>}
        {!latest && hist.length === 0 && <p className="text-xs text-gray-400 mb-4">Loading screening…</p>}
        {r.summary && <Sec t="Summary"><p className="text-sm text-gray-700">{r.summary}</p></Sec>}
        {row.knockout_failed && r.knockout_failed && <div className="mb-4 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><b>Knockout failed:</b> {r.knockout_failed.id} — {r.knockout_failed.evidence}</div>}
        {Array.isArray(r.knockouts) && r.knockouts.length > 0 && <Sec t="Knockouts">{r.knockouts.map((k: any, i: number) => <div key={i} className="flex gap-2 items-start py-1 border-b border-gray-50 text-xs"><Pill s={k.status} /><span className="text-gray-600"><span className="font-medium">{k.id}</span>{k.evidence ? ` — ${k.evidence}` : ""}</span></div>)}</Sec>}
        {crit.length > 0 && <Sec t={`Criteria (${crit.filter(x => x.status === "met").length}/${crit.length} met)`}><table className="w-full text-xs"><tbody>{[...must, ...nice].map((x: any, i: number) => <tr key={i} className={`border-b border-gray-50 align-top ${i === must.length && nice.length ? "border-t-2 border-t-gray-100" : ""}`}><td className="py-1.5 pr-2 w-16"><Pill s={x.status} /></td><td className="py-1.5"><div className="text-gray-800">{x.text} <span className="text-gray-300">×{x.weight}</span></div>{x.evidence && <div className="text-gray-500 italic mt-0.5">“{x.evidence}”{x.source ? <span className="not-italic text-gray-300"> · {x.source}</span> : null}</div>}</td></tr>)}</tbody></table></Sec>}
        {dims.length > 0 && <Sec t="Dimensions">{dims.map(([k, v]: any) => <div key={k} className="mb-1.5"><div className="flex items-center gap-2"><span className="text-xs w-32 capitalize text-gray-600">{k.replace(/_/g, " ")}</span><ScoreBar score={v?.score ?? null} w="w-28" /><span className="text-[10px] text-gray-300">w {v?.weight}</span></div>{v?.note && <div className="text-[10px] text-gray-400 ml-32 pl-2">{v.note}</div>}</div>)}</Sec>}
        {Array.isArray(r.red_flags) && r.red_flags.length > 0 && <Sec t="Red flags">{r.red_flags.map((f: any, i: number) => <div key={i} className="text-xs text-red-700 py-0.5">⚑ <span className="font-medium">{f.type}</span>{f.note ? ` — ${f.note}` : ""}</div>)}</Sec>}
        {r.authenticity && <Sec t="Authenticity"><div className="text-xs"><span className="font-medium capitalize">{r.authenticity.level || "—"}</span>{Array.isArray(r.authenticity.signals) && r.authenticity.signals.length > 0 && <ul className="list-disc ml-4 text-gray-500 mt-0.5">{r.authenticity.signals.map((s: any, i: number) => <li key={i}>{typeof s === "string" ? s : JSON.stringify(s)}</li>)}</ul>}</div></Sec>}
        {Array.isArray(r.missing_data) && r.missing_data.length > 0 && <Sec t="Missing data"><ul className="list-disc ml-4 text-xs text-gray-500">{r.missing_data.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul></Sec>}
        {Array.isArray(r.interview_questions) && r.interview_questions.length > 0 && <Sec t="Interview questions"><ol className="list-decimal ml-4 text-xs text-gray-700 space-y-0.5">{r.interview_questions.map((m: string, i: number) => <li key={i}>{m}</li>)}</ol></Sec>}
        {hist.length > 0 && <Sec t={`Screen history (${hist.length})`}>{hist.map((h: any) => <div key={h.id} className="flex justify-between text-xs py-0.5 border-b border-gray-50"><span className="text-gray-500">{new Date(h.created_at).toLocaleString()}</span><span><span className={`font-semibold ${scoreText(h.score)}`}>{h.score ?? "–"}</span> <span className="text-gray-400">{h.verdict} · {h.tier}</span></span></div>)}</Sec>}
        {(c?.adam_rating != null || c?.roe_rating != null || engRate != null || cefr) && <Sec t="Human ratings"><div className="flex gap-3 text-xs flex-wrap">{c?.adam_rating != null && <span>Adam <b>{c.adam_rating}</b></span>}{c?.roe_rating != null && <span>Roe <b>{c.roe_rating}</b></span>}{engRate != null && <span>English rate <b>{engRate}</b></span>}{cefr && <span>CEFR <b>{cefr}</b></span>}</div></Sec>}
        {editable && <div className="border-t pt-3 mt-2"><div className="text-[10px] text-gray-400 mb-2">{app ? <>Application: <B s={app.status} /> · {stageOf(app.stage_id)?.name || jobStages[0]?.name || "—"}{app.submitted_to_client_at ? ` · submitted ${ago(app.submitted_to_client_at)}` : ""}</> : "Not in this job's pipeline yet."}</div>
          <div className="flex gap-1.5 flex-wrap"><button disabled={!!busy} onClick={rescreen} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "screen" ? "Screening…" : "✦ Re-screen"}</button><button disabled={!!busy || app?.status === "rejected"} onClick={advance} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">{busy === "advance" ? "…" : app ? "Advance to next stage" : "Add to pipeline"}</button><button disabled={!!busy || app?.status === "rejected"} onClick={submit} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "submit" ? "…" : "Submit to client"}</button><button disabled={!!busy || app?.status === "rejected"} onClick={decline} className="text-xs px-2.5 py-1.5 border border-red-200 text-red-600 rounded-lg disabled:opacity-50">{busy === "decline" ? "…" : "Decline"}</button><select disabled={!!busy} value={c?.owner_id || ""} onChange={e => assign(e.target.value)} className="text-xs px-2 py-1.5 border rounded-lg"><option value="">Assign to…</option>{recs.map(p => <option key={p.id} value={p.id}>{p.first_name || p.email}</option>)}</select></div>
          {err && <p className="text-xs text-red-600 mt-2 whitespace-pre-wrap">{err}</p>}</div>}
      </div>
    </div>
  </>;
}

/* ---------------- Edit brief modal ---------------- */
function List({ label, items, set, p }: { label: string; items: any[]; set: (v: any[]) => void; p: string }) { return <div className="mb-3"><div className="text-xs text-gray-500 mb-1">{label} ({items.length})</div>{items.map((it, i) => <div key={i} className="flex gap-1 mb-1"><input value={it.text} onChange={e => set(items.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} className="flex-1 px-2 py-1 border rounded text-xs" /><button onClick={() => set(items.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500 text-xs px-1">×</button></div>)}<button onClick={() => set([...items, { id: `${p}${items.length + 1}`, text: "" }])} className="text-[11px] text-blue-600 hover:underline">+ add</button></div>; }
function BriefModal({ job, onClose, onSaved }: { job: any; onClose: () => void; onSaved: (regen: boolean) => void }) {
  const rub = job?.custom_fields?.screening_rubric || {};
  const norm = (a: any, p: string) => (Array.isArray(a) ? a : []).map((x: any, i: number) => ({ id: x?.id || `${p}${i + 1}`, text: typeof x === "string" ? x : (x?.text || "") }));
  const [desc, setDesc] = useState(job?.description || ""); const [req, setReq] = useState(job?.requirements || ""); const [must, setMust] = useState<any[]>(norm(rub.must_haves, "m")); const [nice, setNice] = useState<any[]>(norm(rub.nice_to_haves, "n")); const [ko, setKo] = useState<any[]>(norm(rub.knockouts, "k")); const [eng, setEng] = useState(rub.target_english || ""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setErr("");
    const clean = (a: any[]) => a.filter(x => x.text.trim()).map((x, i) => ({ ...x, text: x.text.trim() }));
    const rubric = { ...rub, must_haves: clean(must), nice_to_haves: clean(nice), knockouts: clean(ko), target_english: eng || rub.target_english || null };
    const { error } = await supabase.from("jobs").update({ description: desc, requirements: req, custom_fields: { ...(job?.custom_fields || {}), screening_rubric: rubric } }).eq("id", job.id);
    setBusy(false); if (error) { setErr(error.message); return; } setSaved(true);
  }
  return <Modal title={`Edit brief — ${job?.title || ""}`} onClose={onClose}>
    {saved ? <div className="text-center py-4"><p className="text-sm text-gray-700 mb-3">Brief saved. Regenerate the rubric so future screens use the new brief? Existing scores are kept until candidates are re-screened.</p><div className="flex gap-2 justify-center"><button onClick={() => onSaved(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">Regenerate rubric</button><button onClick={() => onSaved(false)} className="border px-3 py-1.5 rounded-lg text-sm">Not now</button></div></div> : <>
      <label className="block mb-3"><span className="text-xs text-gray-500">Description</span><textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
      <label className="block mb-3"><span className="text-xs text-gray-500">Requirements</span><textarea value={req} onChange={e => setReq(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
      {rub.role_summary && <p className="text-[11px] text-gray-400 mb-3 italic">Rubric summary: {rub.role_summary}</p>}
      <List label="Must-haves" items={must} set={setMust} p="m" /><List label="Nice-to-haves" items={nice} set={setNice} p="n" /><List label="Knockouts" items={ko} set={setKo} p="k" />
      <Field label="Target English (CEFR, e.g. C1)" value={eng} onChange={(e: any) => setEng(e.target.value)} />
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm disabled:opacity-50">{busy ? "Saving…" : "Save brief"}</button></>}
  </Modal>;
}
