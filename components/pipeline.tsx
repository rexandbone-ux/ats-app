"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { logActivity, useToast, Empty, fullName, ago, scoreTone, recruiterTone } from "@/lib/ui";

/* ---------------- Pipeline board (all jobs or one job) ---------------- */
export function Pipeline({ nav, editable, pr }: { nav: (p: string, d?: any) => void; editable: boolean; pr?: any }) {
  const { profile } = useAuth(); const { say } = useToast();
  const [stages, setStages] = useState<any[]>([]); const [apps, setApps] = useState<any[]>([]); const [drag, setDrag] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [recMap, setRecMap] = useState<Record<string, string>>({}); const [jobs, setJobs] = useState<any[]>([]); const [jobId, setJobId] = useState<string>(pr?.job_id || "all"); const [scores, setScores] = useState<Record<string, number>>({}); const [q, setQ] = useState("");
  const load = useCallback(async () => {
    const [{ data: st }, { data: pr2 }, { data: jb }] = await Promise.all([supabase.from("pipeline_stages").select("*").order("sort_order"), supabase.from("profiles").select("id,first_name,last_name,email"), supabase.from("jobs").select("id,title,status,pipeline_id").in("status", ["open", "on_hold"]).order("title")]);
    const m: Record<string, string> = {}; (pr2 || []).forEach((p: any) => { m[p.id] = p.first_name || p.email || "?"; }); setRecMap(m); setStages(st || []); setJobs(jb || []);
    let qr = supabase.from("applications").select("id,stage_id,status,candidate_id,job_id,created_at,submitted_to_client_at,candidates(first_name,last_name,current_title,owner_id,phone),jobs(title)").neq("status", "rejected").order("created_at", { ascending: false }).limit(1000);
    if (jobId !== "all") qr = qr.eq("job_id", jobId);
    const { data: ap } = await qr; setApps(ap || []); setLoading(false);
    const pairs = (ap || []).map((a: any) => a.candidate_id); if (pairs.length) { let lq = supabase.from("v_job_leaderboard").select("candidate_id,job_id,score").in("candidate_id", pairs.slice(0, 500)); if (jobId !== "all") lq = lq.eq("job_id", jobId); const { data: lb } = await lq; const sm: Record<string, number> = {}; (lb || []).forEach((r: any) => { sm[r.candidate_id + ":" + r.job_id] = r.score; }); setScores(sm); }
  }, [jobId]);
  useEffect(() => { load(); }, [load]);
  const jobStages = useMemo(() => { if (jobId === "all") return stages.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i); const pid = jobs.find(j => j.id === jobId)?.pipeline_id; const own = pid ? stages.filter(s => s.pipeline_id === pid) : []; return own.length ? own : stages; }, [stages, jobs, jobId]);
  const firstStage = jobStages[0]?.id;
  const stageKey = (a: any) => { const s = stages.find(x => x.id === a.stage_id); if (!s) return firstStage; if (jobId === "all") return jobStages.find(x => x.name === s.name)?.id || firstStage; return s.id; };
  async function drop(stageId: string) {
    if (!drag) return; const id = drag; setDrag(null); const a = apps.find(x => x.id === id); if (!a) return; const from = stages.find(s => s.id === a.stage_id)?.name; const to = stages.find(s => s.id === stageId)?.name; if (a.stage_id === stageId) return;
    setApps(list => list.map(x => x.id === id ? { ...x, stage_id: stageId } : x));
    const { error } = await supabase.from("applications").update({ stage_id: stageId }).eq("id", id); if (error) { say(error.message, false); load(); return; }
    logActivity("stage_change", `Stage: ${from || "—"} → ${to || "—"} (${a.jobs?.title || "job"})`, { candidate_id: a.candidate_id, job_id: a.job_id, application_id: id }, profile?.id);
  }
  const shown = apps.filter(a => !q || fullName(a.candidates).toLowerCase().includes(q.toLowerCase()) || (a.jobs?.title || "").toLowerCase().includes(q.toLowerCase()));
  if (loading) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div>
    <div className="flex justify-between items-center mb-4 flex-wrap gap-2"><div><h1 className="text-xl font-semibold">Pipeline</h1><p className="text-xs text-gray-400">{shown.length} active applications{jobId !== "all" ? "" : " across all open jobs"}. Drag cards between stages.</p></div>
      <div className="flex flex-wrap gap-2"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" className="px-3 py-1.5 border rounded-lg text-sm w-40" /><select value={jobId} onChange={e => setJobId(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm bg-white max-w-full sm:max-w-[260px]"><option value="all">All open jobs</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></div></div>
    {shown.length === 0 ? <Empty t="Nobody in the pipeline yet. Add people from a job's AI slate, from Search, or from a candidate profile." /> : <div className="flex gap-3 overflow-x-auto pb-4">{jobStages.map(s => { const col = shown.filter(a => stageKey(a) === s.id); return <div key={s.id} onDragOver={e => editable && e.preventDefault()} onDrop={() => editable && drop(s.id)} className="w-60 shrink-0 rounded-lg bg-slate-100/70 p-2"><div className="flex items-center gap-2 mb-2 px-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{s.name}</span><span className="ml-auto rounded-full bg-white px-2 text-[10px] font-semibold tabular-nums text-gray-600">{col.length}</span></div><div className="space-y-2 min-h-[120px]">{col.map(a => { const sc = scores[a.candidate_id + ":" + a.job_id]; return <div key={a.id} draggable={editable} onDragStart={() => setDrag(a.id)} onClick={() => a.candidate_id && nav("det", { id: a.candidate_id })} className="bg-white rounded-md border p-2.5 cursor-pointer shadow-sm transition-colors hover:border-indigo-300"><div className="flex justify-between items-start gap-1"><div className="min-w-0"><div className="text-sm font-medium truncate">{fullName(a.candidates)}</div><div className="text-[10px] text-gray-400 truncate">{a.jobs?.title || a.candidates?.current_title || ""}</div></div><span title="AI match score" className={`shrink-0 rounded px-1.5 text-xs font-semibold tabular-nums ${scoreTone(sc)}`}>{sc ?? "–"}</span></div>{a.candidates?.owner_id && recMap[a.candidates.owner_id] && <span className={`inline-block mt-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${recruiterTone(Object.keys(recMap), a.candidates.owner_id).chip}`}>{recMap[a.candidates.owner_id]}</span>}<div className="text-[10px] text-gray-400 mt-1">{ago(a.created_at)}{a.submitted_to_client_at ? " · submitted" : ""}</div></div>; })}</div></div>; })}</div>}
  </div>;
}
