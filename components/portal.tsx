"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Client Portal ---------------- */
export function ClientPortal() {
  const { profile, signOut } = useAuth();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const { data, error } = await supabase.functions.invoke("client-portal", { body: { action: "overview" } }); if (error) throw error; if ((data as any).error) throw new Error((data as any).error); setD(data); } catch (e: any) { setErr(e?.message || String(e)); } setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(appId: string, decision: string) { const fb = window.prompt("Add a note for the recruiter (optional):") || ""; await supabase.functions.invoke("client-portal", { body: { action: "feedback", application_id: appId, decision, feedback: fb } }); load(); }
  const appsFor = (jobId: string) => (d?.applications || []).filter((a: any) => a.job_id === jobId);
  return <div className="min-h-screen bg-gray-50">
    <header className="bg-white border-b px-6 py-3 flex justify-between items-center"><div><span className="font-semibold">Streamlined Staffing</span><span className="text-gray-400 text-sm"> · Client Portal</span></div><div className="flex items-center gap-3 text-sm"><span className="text-gray-500 capitalize">{d?.client?.company_name || profile?.email}</span><button onClick={signOut} className="text-gray-400 hover:text-gray-700 text-xs">Sign out</button></div></header>
    <div className="p-6 max-w-4xl mx-auto">
      {loading ? <div className="py-20 text-center text-gray-400">Loading...</div> : err ? <div className="bg-white border rounded-xl p-8 text-center text-sm text-gray-500">{err}</div> : <div>
        <h1 className="text-xl font-semibold mb-1">Your open positions</h1>
        <p className="text-xs text-gray-400 mb-6">Review candidates submitted for your roles and let us know your decision.</p>
        {(d.jobs || []).length === 0 ? <p className="text-sm text-gray-400">No positions yet.</p> : (d.jobs || []).map((j: any) => <div key={j.id} className="bg-white rounded-xl border mb-4">
          <div className="flex justify-between items-center px-5 py-3 border-b"><div><div className="font-medium">{j.title}</div><div className="text-xs text-gray-400">{j.location || "Remote"}</div></div><B s={j.status} /></div>
          <div className="divide-y">{appsFor(j.id).length === 0 ? <div className="px-5 py-4 text-xs text-gray-400">No candidates submitted yet.</div> : appsFor(j.id).map((a: any) => <div key={a.id} className="px-5 py-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Av n={`${a.candidates?.first_name || ""} ${a.candidates?.last_name || ""}`} /><div><div className="text-sm font-medium">{a.candidates?.first_name} {a.candidates?.last_name}</div><div className="text-[11px] text-gray-400">{a.candidates?.current_title || ""}</div></div></div><div className="flex items-center gap-2">{a.candidates?.resume_url && <a href={a.candidates.resume_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Résumé</a>}{a.candidates?.voice_recording_url && <a href={a.candidates.voice_recording_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Recording</a>}</div></div>
            <div className="flex items-center gap-2 mt-2">{a.client_decision ? <span className={`text-[11px] px-2 py-0.5 rounded-full ${a.client_decision === "interview" || a.client_decision === "accept" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>You: {a.client_decision}</span> : <><button onClick={() => decide(a.id, "interview")} className="text-xs px-3 py-1 bg-slate-800 text-white rounded-lg">Request interview</button><button onClick={() => decide(a.id, "pass")} className="text-xs px-3 py-1 border rounded-lg">Pass</button></>}{a.client_feedback && <span className="text-[11px] text-gray-400 italic">“{a.client_feedback}”</span>}</div>
          </div>)}</div>
        </div>)}
      </div>}
    </div>
  </div>;
}
