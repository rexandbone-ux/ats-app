"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Interviews ---------------- */
export const ITYPES = ["phone_screen", "video_call", "in_person", "panel", "technical", "client_interview"];
export const IREC = ["strong_yes", "yes", "maybe", "no", "strong_no"];
export function Interviews({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [list, setList] = useState<any[]>([]); const [add, setAdd] = useState(false); const [fb, setFb] = useState<any>(null);
  const load = useCallback(async () => { const { data } = await supabase.from("interviews").select("*,candidates(first_name,last_name,current_title)").order("scheduled_at", { ascending: true }); setList(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  const now = new Date();
  const upcoming = list.filter(i => i.scheduled_at && new Date(i.scheduled_at) >= now && i.status !== "completed" && i.status !== "cancelled");
  const past = list.filter(i => !upcoming.includes(i));
  function Row({ i }: { i: any }) {
    return <div className="bg-white rounded-xl border p-4 flex justify-between items-center"><div className="flex items-center gap-3"><Av n={`${i.candidates?.first_name || "?"} ${i.candidates?.last_name || ""}`} /><div><div className="text-sm font-medium">{i.candidates?.first_name} {i.candidates?.last_name}</div><div className="text-[11px] text-gray-400">{(i.type || "").replace(/_/g, " ")} · {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "unscheduled"}{i.duration ? ` · ${i.duration}m` : ""}</div>{i.recommendation && <span className="text-[10px] text-gray-500">Rec: {i.recommendation.replace(/_/g, " ")}</span>}</div></div><div className="flex items-center gap-2">{i.location && /^https?:/.test(i.location) && <a href={i.location} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-lg">Join</a>}<B s={i.status || "scheduled"} />{editable && <button onClick={() => setFb(i)} className="text-xs px-2 py-1 border rounded-lg">Feedback</button>}</div></div>;
  }
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Interviews</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Schedule</button>}</div>
    <h3 className="text-sm text-gray-500 mb-2">Upcoming ({upcoming.length})</h3>
    <div className="space-y-2 mb-6">{upcoming.length === 0 ? <p className="text-xs text-gray-400">Nothing scheduled.</p> : upcoming.map(i => <Row key={i.id} i={i} />)}</div>
    <h3 className="text-sm text-gray-500 mb-2">Past ({past.length})</h3>
    <div className="space-y-2">{past.slice(0, 30).map(i => <Row key={i.id} i={i} />)}</div>
    {add && <ScheduleInterview onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}
    {fb && <InterviewFeedback iv={fb} onClose={() => setFb(null)} onSaved={() => { setFb(null); load(); }} />}
  </div>;
}
export function ScheduleInterview({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState(""); const [opts, setOpts] = useState<any[]>([]); const [f, setF] = useState<any>({ candidate_id: "", candidate_name: "", type: "phone_screen", scheduled_at: "", duration: 30, location: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [zoom, setZoom] = useState(false);
  useEffect(() => { if (q.length < 2) { setOpts([]); return; } const t = setTimeout(async () => { const { data } = await supabase.from("candidates").select("id,first_name,last_name").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(6); setOpts(data || []); }, 250); return () => clearTimeout(t); }, [q]);
  async function save() {
    if (!f.candidate_id || !f.scheduled_at) { setErr("Pick a candidate and a date/time"); return; }
    setBusy(true); let location = f.location; let meet: string | null = null;
    if (zoom) {
      try { const { data, error } = await supabase.functions.invoke("zoom-meeting", { body: { topic: `Interview – ${f.candidate_name}`, start_time: new Date(f.scheduled_at).toISOString(), duration: Number(f.duration) || 30 } }); if (error) throw error; if ((data as any).error) throw new Error((data as any).error); meet = (data as any).join_url; location = meet; } catch (e: any) { setBusy(false); setErr("Zoom: " + (e?.message || e)); return; }
    }
    const { error } = await supabase.from("interviews").insert({ candidate_id: f.candidate_id, type: f.type, scheduled_at: new Date(f.scheduled_at).toISOString(), duration: Number(f.duration) || 30, location: location || null, google_meet_link: meet, status: "scheduled" });
    setBusy(false); if (error) { setErr(error.message); return; }
    await logActivity("interview", `Interview scheduled (${f.type.replace(/_/g, " ")})${meet ? " · Zoom" : ""}`, { candidate_id: f.candidate_id }); onSaved();
  }
  return <Modal title="Schedule interview" onClose={onClose}>
    {f.candidate_id ? <div className="flex justify-between items-center mb-3 p-2 bg-gray-50 rounded-lg text-sm"><span>{f.candidate_name}</span><button onClick={() => setF({ ...f, candidate_id: "", candidate_name: "" })} className="text-xs text-gray-400">change</button></div>
      : <div className="mb-3"><Field label="Candidate *" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search name..." />{opts.length > 0 && <div className="border rounded-lg -mt-2 divide-y">{opts.map(o => <div key={o.id} onClick={() => { setF({ ...f, candidate_id: o.id, candidate_name: `${o.first_name} ${o.last_name}` }); setOpts([]); setQ(""); }} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">{o.first_name} {o.last_name}</div>)}</div>}</div>}
    <label className="block mb-3"><span className="text-xs text-gray-500">Type</span><select value={f.type} onChange={(e: any) => setF({ ...f, type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{ITYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
    <Field label="Date & time *" type="datetime-local" value={f.scheduled_at} onChange={(e: any) => setF({ ...f, scheduled_at: e.target.value })} />
    <Field label="Duration (min)" type="number" value={f.duration} onChange={(e: any) => setF({ ...f, duration: e.target.value })} />
    <Field label="Location / meeting link" value={f.location} onChange={(e: any) => setF({ ...f, location: e.target.value })} disabled={zoom} />
    <label className="flex items-center gap-2 mb-3 text-sm"><input type="checkbox" checked={zoom} onChange={e => setZoom(e.target.checked)} />Create a Zoom meeting link automatically</label>
    {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
    <button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Schedule"}</button>
  </Modal>;
}
export function InterviewFeedback({ iv, onClose, onSaved }: { iv: any; onClose: () => void; onSaved: () => void }) {
  const [rec, setRec] = useState(iv.recommendation || ""); const [notes, setNotes] = useState(iv.feedback_notes || ""); const [score, setScore] = useState(iv.scorecard_data?.rating || 0); const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); await supabase.from("interviews").update({ recommendation: rec || null, feedback_notes: notes || null, scorecard_data: { rating: score }, status: "completed", feedback_submitted_at: new Date().toISOString() }).eq("id", iv.id); setBusy(false); onSaved(); }
  return <Modal title="Interview feedback" onClose={onClose}>
    <div className="text-sm mb-3">{iv.candidates?.first_name} {iv.candidates?.last_name} — {(iv.type || "").replace(/_/g, " ")}</div>
    <div className="mb-3"><span className="text-xs text-gray-500">Score</span><div className="flex gap-1 mt-1">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setScore(n)} className={`w-8 h-8 rounded-lg border text-sm ${score >= n ? "bg-amber-400 text-white border-amber-400" : "text-gray-300"}`}>★</button>)}</div></div>
    <label className="block mb-3"><span className="text-xs text-gray-500">Recommendation</span><select value={rec} onChange={e => setRec(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">—</option>{IREC.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></label>
    <label className="block mb-3"><span className="text-xs text-gray-500">Notes</span><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
    <button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save feedback"}</button>
  </Modal>;
}
