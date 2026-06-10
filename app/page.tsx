"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";

type C = { id: string; first_name: string; last_name: string; email?: string; phone?: string; current_title?: string; current_company?: string; status: string; source?: string; city?: string; state?: string; skills?: string[]; experience_years?: number; rating?: number; overall_score?: number; resume_text?: string; screening_responses?: any; application_answers?: any; notes?: string; ai_recommendation?: string; ai_analysis?: any; created_at: string };

const SC: Record<string, string> = { new: "bg-blue-100 text-blue-800", contacted: "bg-yellow-100 text-yellow-800", screening: "bg-indigo-100 text-indigo-800", submitted: "bg-cyan-100 text-cyan-800", interviewing: "bg-purple-100 text-purple-800", offered: "bg-orange-100 text-orange-800", hired: "bg-green-100 text-green-800", placed: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", withdrawn: "bg-gray-100 text-gray-700", on_bench: "bg-sky-100 text-sky-800", blacklisted: "bg-rose-100 text-rose-800", active: "bg-green-100 text-green-800", open: "bg-green-100 text-green-800", on_hold: "bg-yellow-100 text-yellow-800", closed: "bg-gray-100 text-gray-700", draft: "bg-gray-100 text-gray-700", filled: "bg-emerald-100 text-emerald-800", prospect: "bg-blue-100 text-blue-800", churned: "bg-red-100 text-red-700" };
const CAND_STATUSES = ["new", "contacted", "screening", "submitted", "interviewing", "offered", "placed", "rejected", "withdrawn", "on_bench", "blacklisted"];

function B({ s }: { s: string }) { return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${SC[s] || "bg-gray-100 text-gray-700"}`}>{(s || "").replace(/_/g, " ")}</span>; }
function Av({ n, sz = "w-8 h-8 text-xs" }: { n: string; sz?: string }) { return <div className={`${sz} rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-semibold shrink-0`}>{(n || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}><div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}><div className="flex justify-between items-center px-5 py-3 border-b"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="text-gray-400 text-xl leading-none">&times;</button></div><div className="p-5">{children}</div></div></div>;
}
function Field({ label, ...p }: any) { return <label className="block mb-3"><span className="text-xs text-gray-500">{label}</span><input {...p} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>; }

/* ---------------- Dashboard ---------------- */
function Dash({ nav }: { nav: (p: string, d?: any) => void }) {
  const [d, setD] = useState<any>(null); const [rec, setRec] = useState<C[]>([]);
  useEffect(() => { (async () => {
    const [{ data: ca }, { data: jo }, { data: ap }, { data: cl }, { data: st }] = await Promise.all([
      supabase.from("candidates").select("id,status,source"), supabase.from("jobs").select("id,status"), supabase.from("applications").select("id"), supabase.from("clients").select("id,status"), supabase.from("pipeline_stages").select("*").order("sort_order")]);
    const { data: r } = await supabase.from("candidates").select("*").order("created_at", { ascending: false }).limit(8);
    setD({ t: ca?.length || 0, oj: jo?.filter((j: any) => j.status === "open").length || 0, ap: ap?.length || 0, ac: cl?.filter((c: any) => c.status === "active").length || 0, sb: (ca || []).reduce((a: any, c: any) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {}), src: (ca || []).reduce((a: any, c: any) => { a[c.source || "unknown"] = (a[c.source || "unknown"] || 0) + 1; return a; }, {}), st: st || [] }); setRec(r || []);
  })(); }, []);
  if (!d) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div>
    <h1 className="text-xl font-semibold mb-6">Dashboard</h1>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">{[["Candidates", d.t], ["Open jobs", d.oj], ["Applications", d.ap], ["Active clients", d.ac]].map(([l, v]) => <div key={l as string} className="bg-white rounded-xl border p-4"><div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{l}</div><div className="text-2xl font-semibold">{v}</div></div>)}</div>
    <div className="grid md:grid-cols-2 gap-4 mb-6">
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm text-gray-500 mb-3">By status</h3>{Object.entries(d.sb).sort((a: any, b: any) => b[1] - a[1]).map(([s, c]: any) => <div key={s} className="flex items-center gap-2 mb-1"><B s={s} /><div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${(c / d.t) * 100}%` }} /></div><span className="text-xs w-7 text-right">{c}</span></div>)}</div>
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm text-gray-500 mb-3">By source</h3>{Object.entries(d.src).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6).map(([s, c]: any) => <div key={s} className="flex items-center gap-2 mb-2"><span className="text-xs text-gray-400 w-20 capitalize truncate">{s}</span><div className="flex-1 h-2 bg-gray-100 rounded-full"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${(c / Math.max(...Object.values(d.src) as number[])) * 100}%` }} /></div><span className="text-xs w-7 text-right">{c}</span></div>)}</div>
    </div>
    <div className="bg-white rounded-xl border p-4 mb-6"><h3 className="text-sm text-gray-500 mb-3">Pipeline</h3><div className="flex gap-1 flex-wrap">{d.st.map((s: any) => <div key={s.id} className="flex-1 min-w-[80px] text-center py-2 rounded-lg" style={{ background: s.color + "18", border: `1px solid ${s.color}30` }}><div className="text-[9px] font-semibold" style={{ color: s.color }}>{s.name}</div></div>)}</div></div>
    <h3 className="text-sm text-gray-500 mb-3">Recent candidates</h3>
    <div className="bg-white rounded-xl border divide-y">{rec.map(c => <div key={c.id} onClick={() => nav("det", { id: c.id })} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"><Av n={`${c.first_name} ${c.last_name}`} /><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{c.first_name} {c.last_name}</div><div className="text-xs text-gray-400 truncate">{c.current_title || c.email || ""}</div></div><B s={c.status} /></div>)}</div>
  </div>;
}

/* ---------------- Candidates list ---------------- */
function Cands({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [cs, setCs] = useState<C[]>([]); const [q, setQ] = useState(""); const [f, setF] = useState("all"); const [pg, setPg] = useState(0); const [tot, setTot] = useState(0); const [add, setAdd] = useState(false); const [sel, setSel] = useState<Set<string>>(new Set()); const [bulkTag, setBulkTag] = useState("");
  const load = useCallback(async () => { let qr = supabase.from("candidates").select("*", { count: "exact" }); if (q) qr = qr.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,current_title.ilike.%${q}%`); if (f !== "all") qr = qr.eq("status", f); const { data, count } = await qr.order("created_at", { ascending: false }).range(pg * 25, (pg + 1) * 25 - 1); setCs(data || []); setTot(count || 0); }, [q, f, pg]);
  useEffect(() => { load(); }, [load]);
  const ids = () => Array.from(sel);
  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  async function bulkStatus(s: string) { if (!sel.size) return; await supabase.from("candidates").update({ status: s }).in("id", ids()); setSel(new Set()); load(); }
  async function applyBulkTag() { const t = bulkTag.trim(); if (!t || !sel.size) return; for (const c of cs.filter(x => sel.has(x.id))) { const tags = Array.from(new Set([...(((c as any).tags) || []), t])); await supabase.from("candidates").update({ tags }).eq("id", c.id); } setBulkTag(""); setSel(new Set()); load(); }
  return <div>
    <div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Candidates ({tot})</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Add candidate</button>}</div>
    <div className="flex gap-2 mb-4"><input value={q} onChange={e => { setQ(e.target.value); setPg(0); }} placeholder="Search..." className="flex-1 px-3 py-2 border rounded-lg text-sm" /><select value={f} onChange={e => { setF(e.target.value); setPg(0); }} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All</option>{CAND_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
    {editable && sel.size > 0 && <div className="flex items-center gap-2 mb-3 p-2 bg-slate-800 rounded-lg text-white text-sm flex-wrap"><span className="px-2">{sel.size} selected</span><select onChange={e => { if (e.target.value) bulkStatus(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">Set status…</option>{CAND_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select><input value={bulkTag} onChange={e => setBulkTag(e.target.value)} onKeyDown={e => e.key === "Enter" && applyBulkTag()} placeholder="add tag…" className="px-2 py-1 rounded text-slate-800 text-xs w-28" /><button onClick={applyBulkTag} className="text-xs px-2 py-1 bg-white/20 rounded">Tag</button><button onClick={() => setSel(new Set())} className="text-xs px-2 py-1 ml-auto">Clear</button></div>}
    <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b text-left">{["", "Name", "Title", "Status", "Source", "Date"].map((h, hi) => <th key={hi} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{cs.map(c => <tr key={c.id} className="hover:bg-gray-50"><td className="px-3 py-2" onClick={e => e.stopPropagation()}>{editable && <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="w-4 h-4" />}</td><td className="px-3 py-2 cursor-pointer" onClick={() => nav("det", { id: c.id })}><div className="flex items-center gap-2"><Av n={`${c.first_name} ${c.last_name}`} sz="w-6 h-6 text-[9px]" /><div><div className="font-medium">{c.first_name} {c.last_name}</div><div className="text-[10px] text-gray-400">{c.email || ""}</div></div></div></td><td className="px-3 py-2 text-gray-500">{c.current_title || ""}</td><td className="px-3 py-2"><B s={c.status} /></td><td className="px-3 py-2 text-gray-400 capitalize text-xs">{c.source || ""}</td><td className="px-3 py-2 text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>
      <div className="flex justify-between px-3 py-2 border-t text-xs text-gray-400"><span>{tot ? pg * 25 + 1 : 0}-{Math.min((pg + 1) * 25, tot)} of {tot}</span><div className="flex gap-1"><button disabled={pg === 0} onClick={() => setPg(p => p - 1)} className="px-2 py-1 border rounded disabled:opacity-30">Prev</button><button disabled={(pg + 1) * 25 >= tot} onClick={() => setPg(p => p + 1)} className="px-2 py-1 border rounded disabled:opacity-30">Next</button></div></div></div>
    {add && <AddCandidate onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}
  </div>;
}
function AddCandidate({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ first_name: "", last_name: "", email: "", phone: "", current_title: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() { if (!f.first_name) { setErr("First name required"); return; } setBusy(true); const { error } = await supabase.from("candidates").insert({ ...f, status: "new", source: "manual" }); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Add candidate" onClose={onClose}><Field label="First name *" value={f.first_name} onChange={(e: any) => setF({ ...f, first_name: e.target.value })} /><Field label="Last name" value={f.last_name} onChange={(e: any) => setF({ ...f, last_name: e.target.value })} /><Field label="Email" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} /><Field label="Phone" value={f.phone} onChange={(e: any) => setF({ ...f, phone: e.target.value })} /><Field label="Current title" value={f.current_title} onChange={(e: any) => setF({ ...f, current_title: e.target.value })} />{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save candidate"}</button></Modal>;
}

/* ---------------- Candidate detail ---------------- */
function Det({ nav, pr, editable }: { nav: (p: string, d?: any) => void; pr: any; editable: boolean }) {
  const { profile } = useAuth();
  const [c, setC] = useState<any>(null); const [tab, setTab] = useState("overview"); const [apps, setApps] = useState<any[]>([]); const [notes, setNotes] = useState<any[]>([]); const [note, setNote] = useState(""); const [scoring, setScoring] = useState(false); const [tag, setTag] = useState(""); const [emailOpen, setEmailOpen] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("candidates").select("*").eq("id", pr.id).single(); setC(data);
    const { data: ap } = await supabase.from("applications").select("id,status,created_at,job_id,jobs(title)").eq("candidate_id", pr.id); setApps(ap || []);
    const { data: nt } = await supabase.from("notes").select("*").eq("candidate_id", pr.id).order("created_at", { ascending: false }); setNotes(nt || []);
  }, [pr.id]);
  useEffect(() => { load(); }, [load]);
  async function setStatus(s: string) { if (!c) return; await supabase.from("candidates").update({ status: s }).eq("id", c.id); setC({ ...c, status: s }); }
  async function addNote() { if (!note.trim()) return; await supabase.from("notes").insert({ candidate_id: pr.id, content: note, user_id: profile?.id }); setNote(""); load(); }
  async function addTag() { const t = tag.trim(); if (!t || !c) return; const tags = Array.from(new Set([...(c.tags || []), t])); await supabase.from("candidates").update({ tags }).eq("id", c.id); setC({ ...c, tags }); setTag(""); }
  async function removeTag(t: string) { if (!c) return; const tags = (c.tags || []).filter((x: string) => x !== t); await supabase.from("candidates").update({ tags }).eq("id", c.id); setC({ ...c, tags }); }
  async function runAI() {
    setScoring(true);
    try { const { data, error } = await supabase.functions.invoke("candidate-scoring", { body: { candidate_id: pr.id } }); if (error) throw error; await load(); } catch (e: any) { alert("AI scoring unavailable: " + (e?.message || e)); }
    setScoring(false);
  }
  if (!c) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const tabs = editable ? ["overview", "responses", "notes", "ai"] : ["overview", "responses", "ai"];
  return <div>
    <button onClick={() => nav("cands")} className="text-sm text-gray-400 mb-4 block">&larr; Back</button>
    <div className="bg-white rounded-xl border p-5 mb-4"><div className="flex gap-4"><Av n={`${c.first_name} ${c.last_name}`} sz="w-14 h-14 text-xl" /><div className="flex-1"><div className="flex items-center gap-3 mb-1 flex-wrap"><h1 className="text-lg font-semibold">{c.first_name} {c.last_name}</h1><B s={c.status} />{c.ai_recommendation && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${c.ai_recommendation === "ADVANCE" ? "bg-green-100 text-green-700" : c.ai_recommendation === "REJECT" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{c.ai_recommendation}{c.overall_score ? ` ${c.overall_score}` : ""}</span>}</div><div className="text-sm text-gray-500">{c.current_title}{c.current_company ? ` at ${c.current_company}` : ""}</div><div className="flex gap-4 mt-2 text-xs text-gray-400 flex-wrap">{c.email && <span>{c.email}</span>}{c.phone && <span>{c.phone}</span>}{(c.city || c.state) && <span>{[c.city, c.state].filter(Boolean).join(", ")}</span>}{c.experience_years ? <span>{c.experience_years}yr exp</span> : null}</div></div>{editable && <div className="flex flex-col gap-2 self-start items-end"><select value={c.status} onChange={e => setStatus(e.target.value)} className="h-9 px-2 border rounded-lg text-xs">{CAND_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select><button onClick={() => setEmailOpen(true)} className="text-xs px-3 py-1.5 border rounded-lg">✉ Email</button></div>}</div>
      <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t">{(c.tags || []).map((t: string) => <span key={t} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[11px] flex items-center gap-1">{t}{editable && <button onClick={() => removeTag(t)} className="text-slate-400 hover:text-slate-700">×</button>}</span>)}{editable && <input value={tag} onChange={e => setTag(e.target.value)} onKeyDown={e => e.key === "Enter" && addTag()} placeholder="+ tag" className="text-[11px] px-2 py-0.5 border rounded-full w-20 focus:w-32 transition-all" />}</div></div>
    <div className="flex border-b mb-4">{tabs.map(t =><button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm border-b-2 capitalize ${tab === t ? "border-slate-800 text-slate-800" : "border-transparent text-gray-400"}`}>{t === "ai" ? "AI analysis" : t}</button>)}</div>
    {tab === "overview" && <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-3">Contact</h3>{[["Email", c.email], ["Phone", c.phone], ["Location", [c.city, c.state].filter(Boolean).join(", ")]].map(([l, v]) => v ? <div key={l as string} className="flex justify-between py-1 border-b border-gray-50 text-xs"><span className="text-gray-400">{l}</span><span>{v as string}</span></div> : null)}</div>
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-3">Professional</h3>{[["Title", c.current_title], ["Company", c.current_company], ["Experience", c.experience_years ? `${c.experience_years}yr` : null], ["Source", c.source]].map(([l, v]) => v ? <div key={l as string} className="flex justify-between py-1 border-b border-gray-50 text-xs"><span className="text-gray-400">{l}</span><span className="capitalize">{v as string}</span></div> : null)}</div>
      {c.skills && c.skills.length > 0 && <div className="md:col-span-2 bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-2">Skills</h3><div className="flex flex-wrap gap-1">{c.skills.map(s => <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px]">{s}</span>)}</div></div>}
      <div className="md:col-span-2 bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-2">Applications ({apps.length})</h3>{apps.length === 0 ? <p className="text-xs text-gray-400">No applications.</p> : apps.map(a => <div key={a.id} className="flex justify-between items-center py-1.5 border-b border-gray-50 text-xs"><span>{a.jobs?.title || "Job"}</span><B s={a.status} /></div>)}</div>
    </div>}
    {tab === "responses" && <div className="space-y-4">
      {c.screening_responses && <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-3">Screening responses</h3>{typeof c.screening_responses === "object" ? Object.entries(c.screening_responses).map(([k, v]) => <div key={k} className="mb-3 p-3 bg-gray-50 rounded-lg"><div className="text-[10px] font-medium text-gray-400 mb-1">{k}</div><div className="text-sm">{String(v)}</div></div>) : <p className="text-sm">{String(c.screening_responses)}</p>}</div>}
      {c.application_answers && <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-3">Application answers</h3>{typeof c.application_answers === "object" ? Object.entries(c.application_answers).map(([k, v]) => <div key={k} className="mb-3 p-3 bg-gray-50 rounded-lg"><div className="text-[10px] font-medium text-gray-400 mb-1">{k}</div><div className="text-sm">{String(v)}</div></div>) : <p className="text-sm">{String(c.application_answers)}</p>}</div>}
      {c.resume_text && <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-3">Resume</h3><p className="text-xs whitespace-pre-wrap max-h-72 overflow-auto">{c.resume_text}</p></div>}
      {!c.screening_responses && !c.application_answers && !c.resume_text && <div className="bg-white rounded-xl border p-10 text-center text-gray-400 text-sm">No responses recorded.</div>}
    </div>}
    {tab === "notes" && <div className="bg-white rounded-xl border p-4"><div className="flex gap-2 mb-4"><input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} placeholder="Add a note..." className="flex-1 px-3 py-2 border rounded-lg text-sm" /><button onClick={addNote} className="bg-slate-800 text-white px-3 rounded-lg text-sm">Add</button></div>{notes.length === 0 ? <p className="text-xs text-gray-400">No notes yet.</p> : notes.map(n => <div key={n.id} className="py-2 border-b border-gray-50"><div className="text-sm">{n.content}</div><div className="text-[10px] text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</div></div>)}</div>}
    {tab === "ai" && <div className="bg-white rounded-xl border p-6">{c.ai_analysis ? <div><div className="flex items-center gap-3 mb-4"><span className="text-3xl font-bold">{c.overall_score ?? "-"}</span><div><B s={c.status} /><div className="text-xs text-gray-400 mt-1">{c.ai_recommendation}</div></div></div><pre className="text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded-lg max-h-80 overflow-auto">{typeof c.ai_analysis === "string" ? c.ai_analysis : JSON.stringify(c.ai_analysis, null, 2)}</pre></div> : <div className="text-center"><p className="text-sm text-gray-500 mb-4">Run AI analysis to score this candidate 1&ndash;100 with an Advance / Hold / Reject recommendation.</p>{editable && <button disabled={scoring} onClick={runAI} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{scoring ? "Analyzing..." : "Run AI analysis"}</button>}</div>}</div>}
    {emailOpen && <EmailModal cand={c} onClose={() => setEmailOpen(false)} />}
  </div>;
}
function EmailModal({ cand, onClose }: { cand: any; onClose: () => void }) {
  const { profile } = useAuth();
  const [tmpls, setTmpls] = useState<any[]>([]); const [subject, setSubject] = useState(""); const [bodyHtml, setBodyHtml] = useState(""); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  useEffect(() => { supabase.from("email_templates").select("*").then(({ data }) => setTmpls(data || [])); }, []);
  function fill(t: any) {
    const repl = (s: string) => (s || "").replace(/{{candidate.firstName}}/g, cand.first_name || "").replace(/{{candidate.lastName}}/g, cand.last_name || "").replace(/{{user.firstName}}/g, profile?.first_name || "").replace(/{{user.lastName}}/g, profile?.last_name || "").replace(/{{job.title}}/g, cand.current_title || "the role");
    setSubject(repl(t.subject)); setBodyHtml(repl(t.body_html));
  }
  async function send() {
    if (!cand.email) { setMsg("This candidate has no email address on file."); return; }
    if (!subject.trim()) { setMsg("Add a subject."); return; }
    setBusy(true); setMsg("");
    let status = "queued";
    try { const { error } = await supabase.functions.invoke("resend-email", { body: { to: cand.email, subject, html: bodyHtml } }); status = error ? "failed" : "sent"; } catch { status = "failed"; }
    await supabase.from("emails").insert({ candidate_id: cand.id, user_id: profile?.id, to_email: cand.email, subject, body_html: bodyHtml, direction: "outbound", status, sent_at: status === "sent" ? new Date().toISOString() : null });
    setBusy(false);
    if (status === "sent") onClose();
    else setMsg("Saved to this candidate's email history, but live delivery isn't active yet — connect a verified sender (Resend domain or Gmail) and it'll send for real.");
  }
  return <Modal title="Email candidate" onClose={onClose}>
    <div className="text-xs text-gray-400 mb-3">To: {cand.email || "— no email on file —"}</div>
    <label className="block mb-3"><span className="text-xs text-gray-500">Template</span><select onChange={e => { const t = tmpls.find(x => x.id === e.target.value); if (t) fill(t); }} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">— blank —</option>{tmpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <Field label="Subject" value={subject} onChange={(e: any) => setSubject(e.target.value)} />
    <label className="block mb-3"><span className="text-xs text-gray-500">Message</span><textarea value={bodyHtml} onChange={(e: any) => setBodyHtml(e.target.value)} rows={8} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
    {msg && <p className="text-xs text-amber-600 mb-2">{msg}</p>}
    <button disabled={busy} onClick={send} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Sending..." : "Send email"}</button>
  </Modal>;
}

/* ---------------- Jobs ---------------- */
function Jobs({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [js, setJs] = useState<any[]>([]); const [cl, setCl] = useState<Record<string, string>>({}); const [add, setAdd] = useState(false);
  const load = useCallback(async () => { const { data: j } = await supabase.from("jobs").select("*").order("created_at", { ascending: false }); const { data: c } = await supabase.from("clients").select("id,company_name"); setJs(j || []); setCl((c || []).reduce((a: any, x: any) => { a[x.id] = x.company_name; return a; }, {})); }, []);
  useEffect(() => { load(); }, [load]);
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Positions ({js.length})</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Add position</button>}</div><div className="space-y-2">{js.map(j => <div key={j.id} onClick={() => nav("job", { id: j.id })} className="bg-white rounded-xl border p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50"><div><div className="font-medium">{j.title}</div><div className="text-xs text-gray-400 flex gap-3 mt-1">{cl[j.client_id] && <span className="capitalize">{cl[j.client_id]}</span>}<span>{j.location || "Remote"}</span></div></div><B s={j.status} /></div>)}</div>{add && <AddJob clients={cl} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}</div>;
}
function AddJob({ clients, onClose, onSaved }: { clients: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ title: "", location: "", description: "", client_id: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() { if (!f.title) { setErr("Title required"); return; } setBusy(true); const payload: any = { title: f.title, location: f.location, description: f.description, status: "open" }; if (f.client_id) payload.client_id = f.client_id; const { error } = await supabase.from("jobs").insert(payload); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Add position" onClose={onClose}><Field label="Title *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Client</span><select value={f.client_id} onChange={(e: any) => setF({ ...f, client_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">— None —</option>{Object.entries(clients).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label><Field label="Location" value={f.location} onChange={(e: any) => setF({ ...f, location: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Description</span><textarea value={f.description} onChange={(e: any) => setF({ ...f, description: e.target.value })} rows={4} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save position"}</button></Modal>;
}
function JobDetail({ nav, pr, editable }: { nav: (p: string, d?: any) => void; pr: any; editable: boolean }) {
  const [j, setJ] = useState<any>(null); const [apps, setApps] = useState<any[]>([]); const [qs, setQs] = useState<string[]>([]); const [qIn, setQIn] = useState("");
  const load = useCallback(async () => { const { data } = await supabase.from("jobs").select("*,clients(company_name)").eq("id", pr.id).single(); setJ(data); setQs(Array.isArray(data?.screening_questions) ? data.screening_questions.map((x: any) => typeof x === "string" ? x : (x.question || "")) : []); const { data: ap } = await supabase.from("applications").select("id,status,created_at,candidate_id,candidates(first_name,last_name,current_title,status)").eq("job_id", pr.id); setApps(ap || []); }, [pr.id]);
  useEffect(() => { load(); }, [load]);
  async function togglePublish() { const np = !j.is_public; await supabase.from("jobs").update({ is_public: np, published_at: np ? new Date().toISOString() : null }).eq("id", j.id); setJ({ ...j, is_public: np }); }
  async function saveQs(next: string[]) { setQs(next); await supabase.from("jobs").update({ screening_questions: next }).eq("id", j.id); }
  if (!j) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div><button onClick={() => nav("jobs")} className="text-sm text-gray-400 mb-4 block">&larr; Back</button>
    <div className="bg-white rounded-xl border p-5 mb-4"><div className="flex justify-between items-start"><div><h1 className="text-lg font-semibold">{j.title}</h1><div className="text-sm text-gray-500 mt-1 capitalize">{j.clients?.company_name || ""}{j.location ? ` · ${j.location}` : ""}</div></div><div className="flex flex-col items-end gap-2"><B s={j.status} />{editable && <button onClick={togglePublish} className={`text-xs px-3 py-1.5 rounded-lg ${j.is_public ? "bg-green-100 text-green-700" : "border"}`}>{j.is_public ? "● Published to careers" : "Publish to careers"}</button>}</div></div>{j.description && <p className="text-sm text-gray-600 mt-4 whitespace-pre-wrap">{j.description}</p>}{j.is_public && <p className="text-[11px] text-gray-400 mt-3">Live on your public careers page and available to the Indeed job feed.</p>}</div>
    {editable && <div className="bg-white rounded-xl border p-4 mb-4"><h3 className="text-sm font-medium mb-2">Screening questions</h3>{qs.length === 0 ? <p className="text-xs text-gray-400 mb-2">None yet — these appear on the application form.</p> : <ol className="list-decimal ml-4 mb-2">{qs.map((q, i) => <li key={i} className="text-sm py-0.5 flex justify-between gap-2"><span>{q}</span><button onClick={() => saveQs(qs.filter((_, x) => x !== i))} className="text-gray-300 hover:text-red-500 text-xs">remove</button></li>)}</ol>}<div className="flex gap-2"><input value={qIn} onChange={e => setQIn(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && qIn.trim()) { saveQs([...qs, qIn.trim()]); setQIn(""); } }} placeholder="Add a screening question…" className="flex-1 px-3 py-2 border rounded-lg text-sm" /><button onClick={() => { if (qIn.trim()) { saveQs([...qs, qIn.trim()]); setQIn(""); } }} className="bg-slate-800 text-white px-3 rounded-lg text-sm">Add</button></div></div>}
    <h3 className="text-sm text-gray-500 mb-2">Applicants ({apps.length})</h3>
    <div className="bg-white rounded-xl border divide-y">{apps.length === 0 ? <p className="p-6 text-center text-gray-400 text-sm">No applicants yet.</p> : apps.map(a => <div key={a.id} onClick={() => a.candidate_id && nav("det", { id: a.candidate_id })} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"><Av n={`${a.candidates?.first_name || ""} ${a.candidates?.last_name || ""}`} sz="w-7 h-7 text-[10px]" /><div className="flex-1 min-w-0"><div className="text-sm font-medium">{a.candidates?.first_name} {a.candidates?.last_name}</div><div className="text-[10px] text-gray-400">{a.candidates?.current_title || ""}</div></div><B s={a.status} /></div>)}</div>
  </div>;
}

/* ---------------- Clients ---------------- */
function Clients({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [cs, setCs] = useState<any[]>([]); const [add, setAdd] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.from("clients").select("*").order("company_name"); setCs(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Clients ({cs.length})</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Add client</button>}</div><div className="space-y-2">{cs.map(c => <div key={c.id} onClick={() => nav("client", { id: c.id })} className="bg-white rounded-xl border p-4 flex justify-between items-center cursor-pointer hover:bg-gray-50"><div className="flex items-center gap-3"><Av n={c.company_name} /><div><div className="font-medium capitalize">{c.company_name}</div><div className="text-xs text-gray-400">{c.industry || ""}</div></div></div><B s={c.status} /></div>)}</div>{add && <AddClient onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}</div>;
}
function AddClient({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ company_name: "", industry: "", website: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() { if (!f.company_name) { setErr("Company name required"); return; } setBusy(true); const { error } = await supabase.from("clients").insert({ ...f, status: "active" }); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Add client" onClose={onClose}><Field label="Company name *" value={f.company_name} onChange={(e: any) => setF({ ...f, company_name: e.target.value })} /><Field label="Industry" value={f.industry} onChange={(e: any) => setF({ ...f, industry: e.target.value })} /><Field label="Website" value={f.website} onChange={(e: any) => setF({ ...f, website: e.target.value })} />{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save client"}</button></Modal>;
}
function ClientDetail({ nav, pr }: { nav: (p: string, d?: any) => void; pr: any }) {
  const [cl, setCl] = useState<any>(null); const [jobs, setJobs] = useState<any[]>([]); const [contacts, setContacts] = useState<any[]>([]);
  useEffect(() => { (async () => { const { data } = await supabase.from("clients").select("*").eq("id", pr.id).single(); setCl(data); const { data: j } = await supabase.from("jobs").select("id,title,status,location").eq("client_id", pr.id); setJobs(j || []); const { data: ct } = await supabase.from("client_contacts").select("*").eq("client_id", pr.id); setContacts(ct || []); })(); }, [pr.id]);
  if (!cl) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div><button onClick={() => nav("clients")} className="text-sm text-gray-400 mb-4 block">&larr; Back</button>
    <div className="bg-white rounded-xl border p-5 mb-4 flex justify-between items-start"><div className="flex items-center gap-3"><Av n={cl.company_name} sz="w-12 h-12 text-lg" /><div><h1 className="text-lg font-semibold capitalize">{cl.company_name}</h1><div className="text-sm text-gray-500">{cl.industry || ""}{cl.website ? ` · ${cl.website}` : ""}</div></div></div><B s={cl.status} /></div>
    <div className="grid md:grid-cols-2 gap-4">
      <div><h3 className="text-sm text-gray-500 mb-2">Positions ({jobs.length})</h3><div className="bg-white rounded-xl border divide-y">{jobs.length === 0 ? <p className="p-4 text-xs text-gray-400">None</p> : jobs.map(j => <div key={j.id} onClick={() => nav("job", { id: j.id })} className="flex justify-between items-center px-4 py-2.5 cursor-pointer hover:bg-gray-50"><div><div className="text-sm">{j.title}</div><div className="text-[10px] text-gray-400">{j.location || "Remote"}</div></div><B s={j.status} /></div>)}</div></div>
      <div><h3 className="text-sm text-gray-500 mb-2">Contacts ({contacts.length})</h3><div className="bg-white rounded-xl border divide-y">{contacts.length === 0 ? <p className="p-4 text-xs text-gray-400">None</p> : contacts.map(ct => <div key={ct.id} className="px-4 py-2.5"><div className="text-sm">{ct.first_name} {ct.last_name}{ct.is_primary ? <span className="ml-2 text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full">Primary</span> : ""}</div><div className="text-[10px] text-gray-400">{[ct.title, ct.email, ct.phone].filter(Boolean).join(" · ")}</div></div>)}</div></div>
    </div>
  </div>;
}

/* ---------------- Pipeline Kanban ---------------- */
function Pipeline({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [stages, setStages] = useState<any[]>([]); const [apps, setApps] = useState<any[]>([]); const [drag, setDrag] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { const { data: st } = await supabase.from("pipeline_stages").select("*").order("sort_order"); const { data: ap } = await supabase.from("applications").select("id,stage_id,status,candidate_id,job_id,candidates(first_name,last_name,current_title),jobs(title)").limit(500); setStages(st || []); setApps(ap || []); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const firstStage = stages[0]?.id;
  async function drop(stageId: string) { if (!drag) return; const id = drag; setDrag(null); setApps(a => a.map(x => x.id === id ? { ...x, stage_id: stageId } : x)); await supabase.from("applications").update({ stage_id: stageId }).eq("id", id); }
  if (loading) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  return <div><h1 className="text-xl font-semibold mb-4">Pipeline</h1>
    <div className="flex gap-3 overflow-x-auto pb-4">{stages.map(s => { const col = apps.filter(a => (a.stage_id || firstStage) === s.id); return <div key={s.id} onDragOver={e => editable && e.preventDefault()} onDrop={() => editable && drop(s.id)} className="w-60 shrink-0"><div className="flex items-center gap-2 mb-2 px-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-xs font-semibold">{s.name}</span><span className="text-[10px] text-gray-400">{col.length}</span></div><div className="space-y-2 min-h-[60px]">{col.map(a => <div key={a.id} draggable={editable} onDragStart={() => setDrag(a.id)} onClick={() => a.candidate_id && nav("det", { id: a.candidate_id })} className="bg-white rounded-lg border p-3 cursor-pointer hover:shadow-sm"><div className="text-sm font-medium">{a.candidates?.first_name} {a.candidates?.last_name}</div><div className="text-[10px] text-gray-400 truncate">{a.jobs?.title || a.candidates?.current_title || ""}</div></div>)}</div></div>; })}</div>
    <p className="text-[11px] text-gray-400 mt-2">{editable ? "Drag cards between stages to update an applicant's progress." : "Read-only view."}</p>
  </div>;
}

/* ---------------- Search ---------------- */
function Search({ nav }: { nav: (p: string, d?: any) => void }) {
  const [q, setQ] = useState(""); const [rs, setRs] = useState<C[]>([]); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  async function go() { if (!q.trim()) return; setBusy(true); setDone(false); const ws = q.toLowerCase().split(/\s+/).filter(w => w.length > 2); const or = ws.length ? ws.map(w => `first_name.ilike.%${w}%,last_name.ilike.%${w}%,current_title.ilike.%${w}%`).join(",") : `first_name.ilike.%${q}%`; const { data } = await supabase.from("candidates").select("*").or(or).limit(30); setRs(data || []); setBusy(false); setDone(true); }
  return <div><h1 className="text-xl font-semibold mb-1">AI Search</h1><p className="text-xs text-gray-400 mb-4">Search by title, name, or skill &mdash; e.g. &ldquo;medical intake coordinator&rdquo;.</p><div className="flex gap-2 mb-4"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Search candidates..." className="flex-1 px-3 py-2 border rounded-lg text-sm" /><button onClick={go} disabled={busy} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy ? "..." : "Search"}</button></div>{done && rs.length === 0 && <p className="text-sm text-gray-400">No matches.</p>}{rs.length > 0 && <div className="bg-white rounded-xl border divide-y">{rs.map(c => <div key={c.id} onClick={() => nav("det", { id: c.id })} className="px-4 py-3 cursor-pointer hover:bg-gray-50 flex justify-between items-center"><div className="flex items-center gap-2"><Av n={`${c.first_name} ${c.last_name}`} sz="w-7 h-7 text-[10px]" /><div><div className="text-sm font-medium">{c.first_name} {c.last_name}</div><div className="text-[10px] text-gray-400">{c.current_title || ""}</div></div></div><B s={c.status} /></div>)}</div>}</div>;
}

/* ---------------- Interviews ---------------- */
const ITYPES = ["phone_screen", "video_call", "in_person", "panel", "technical", "client_interview"];
const IREC = ["strong_yes", "yes", "maybe", "no", "strong_no"];
function Interviews({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [list, setList] = useState<any[]>([]); const [add, setAdd] = useState(false); const [fb, setFb] = useState<any>(null);
  const load = useCallback(async () => { const { data } = await supabase.from("interviews").select("*,candidates(first_name,last_name,current_title)").order("scheduled_at", { ascending: true }); setList(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  const now = new Date();
  const upcoming = list.filter(i => i.scheduled_at && new Date(i.scheduled_at) >= now && i.status !== "completed" && i.status !== "cancelled");
  const past = list.filter(i => !upcoming.includes(i));
  function Row({ i }: { i: any }) {
    return <div className="bg-white rounded-xl border p-4 flex justify-between items-center"><div className="flex items-center gap-3"><Av n={`${i.candidates?.first_name || "?"} ${i.candidates?.last_name || ""}`} /><div><div className="text-sm font-medium">{i.candidates?.first_name} {i.candidates?.last_name}</div><div className="text-[11px] text-gray-400">{(i.type || "").replace(/_/g, " ")} · {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "unscheduled"}{i.duration ? ` · ${i.duration}m` : ""}</div>{i.recommendation && <span className="text-[10px] text-gray-500">Rec: {i.recommendation.replace(/_/g, " ")}</span>}</div></div><div className="flex items-center gap-2"><B s={i.status || "scheduled"} />{editable && <button onClick={() => setFb(i)} className="text-xs px-2 py-1 border rounded-lg">Feedback</button>}</div></div>;
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
function ScheduleInterview({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState(""); const [opts, setOpts] = useState<any[]>([]); const [f, setF] = useState<any>({ candidate_id: "", candidate_name: "", type: "phone_screen", scheduled_at: "", duration: 30, location: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { if (q.length < 2) { setOpts([]); return; } const t = setTimeout(async () => { const { data } = await supabase.from("candidates").select("id,first_name,last_name").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(6); setOpts(data || []); }, 250); return () => clearTimeout(t); }, [q]);
  async function save() { if (!f.candidate_id || !f.scheduled_at) { setErr("Pick a candidate and a date/time"); return; } setBusy(true); const { error } = await supabase.from("interviews").insert({ candidate_id: f.candidate_id, type: f.type, scheduled_at: new Date(f.scheduled_at).toISOString(), duration: Number(f.duration) || 30, location: f.location || null, status: "scheduled" }); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Schedule interview" onClose={onClose}>
    {f.candidate_id ? <div className="flex justify-between items-center mb-3 p-2 bg-gray-50 rounded-lg text-sm"><span>{f.candidate_name}</span><button onClick={() => setF({ ...f, candidate_id: "", candidate_name: "" })} className="text-xs text-gray-400">change</button></div>
      : <div className="mb-3"><Field label="Candidate *" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search name..." />{opts.length > 0 && <div className="border rounded-lg -mt-2 divide-y">{opts.map(o => <div key={o.id} onClick={() => { setF({ ...f, candidate_id: o.id, candidate_name: `${o.first_name} ${o.last_name}` }); setOpts([]); setQ(""); }} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">{o.first_name} {o.last_name}</div>)}</div>}</div>}
    <label className="block mb-3"><span className="text-xs text-gray-500">Type</span><select value={f.type} onChange={(e: any) => setF({ ...f, type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{ITYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
    <Field label="Date & time *" type="datetime-local" value={f.scheduled_at} onChange={(e: any) => setF({ ...f, scheduled_at: e.target.value })} />
    <Field label="Duration (min)" type="number" value={f.duration} onChange={(e: any) => setF({ ...f, duration: e.target.value })} />
    <Field label="Location / meeting link" value={f.location} onChange={(e: any) => setF({ ...f, location: e.target.value })} />
    {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
    <button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Schedule"}</button>
  </Modal>;
}
function InterviewFeedback({ iv, onClose, onSaved }: { iv: any; onClose: () => void; onSaved: () => void }) {
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

/* ---------------- Tasks ---------------- */
const TPRIO = ["low", "medium", "high", "urgent"];
function Tasks() {
  const { profile } = useAuth();
  const [list, setList] = useState<any[]>([]); const [add, setAdd] = useState(false); const [filter, setFilter] = useState("open");
  const load = useCallback(async () => { const { data } = await supabase.from("tasks").select("*,candidates(first_name,last_name)").order("due_date", { ascending: true }); setList(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  async function toggle(t: any) { await supabase.from("tasks").update({ status: t.status === "completed" ? "pending" : "completed", completed_at: t.status === "completed" ? null : new Date().toISOString() }).eq("id", t.id); load(); }
  const shown = list.filter(t => filter === "all" ? true : filter === "open" ? t.status !== "completed" && t.status !== "cancelled" : t.status === "completed");
  const PC: Record<string, string> = { low: "text-gray-400", medium: "text-blue-500", high: "text-orange-500", urgent: "text-red-500" };
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Tasks</h1><div className="flex gap-2"><select value={filter} onChange={e => setFilter(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm"><option value="open">Open</option><option value="completed">Completed</option><option value="all">All</option></select><button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Add task</button></div></div>
    <div className="bg-white rounded-xl border divide-y">{shown.length === 0 ? <p className="p-6 text-center text-gray-400 text-sm">No tasks.</p> : shown.map(t => { const overdue = t.due_date && t.status !== "completed" && new Date(t.due_date) < new Date(); return <div key={t.id} className="flex items-center gap-3 px-4 py-3"><input type="checkbox" checked={t.status === "completed"} onChange={() => toggle(t)} className="w-4 h-4" /><div className="flex-1 min-w-0"><div className={`text-sm ${t.status === "completed" ? "line-through text-gray-400" : ""}`}>{t.title}</div><div className="text-[10px] text-gray-400">{t.candidates ? `${t.candidates.first_name} ${t.candidates.last_name} · ` : ""}{t.due_date ? <span className={overdue ? "text-red-500" : ""}>{new Date(t.due_date).toLocaleDateString()}</span> : "no date"}</div></div><span className={`text-[10px] font-semibold uppercase ${PC[t.priority] || ""}`}>{t.priority}</span></div>; })}</div>
    {add && <AddTask me={profile?.id} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}
  </div>;
}
function AddTask({ me, onClose, onSaved }: { me?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ title: "", due_date: "", priority: "medium" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() { if (!f.title) { setErr("Title required"); return; } setBusy(true); const { error } = await supabase.from("tasks").insert({ title: f.title, due_date: f.due_date ? new Date(f.due_date).toISOString() : null, priority: f.priority, status: "pending", created_by_id: me || null, assigned_to_id: me || null }); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Add task" onClose={onClose}><Field label="Task *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} /><Field label="Due date" type="date" value={f.due_date} onChange={(e: any) => setF({ ...f, due_date: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Priority</span><select value={f.priority} onChange={(e: any) => setF({ ...f, priority: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{TPRIO.map(p => <option key={p} value={p}>{p}</option>)}</select></label>{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save task"}</button></Modal>;
}

/* ---------------- Reports ---------------- */
function Reports() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { (async () => {
    const [{ data: ca }, { data: ap }, { data: iv }, { count: jobsOpen }, { count: placedCount }] = await Promise.all([
      supabase.from("candidates").select("status,source,roe_rating"),
      supabase.from("applications").select("status,created_at"),
      supabase.from("interviews").select("status,recommendation"),
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("candidates").select("id", { count: "exact", head: true }).eq("status", "placed"),
    ]);
    const bySource = (ca || []).reduce((a: any, c: any) => { const k = c.source || "unknown"; a[k] = (a[k] || 0) + 1; return a; }, {});
    const byStatus = (ca || []).reduce((a: any, c: any) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
    const ivDone = (iv || []).filter((x: any) => x.status === "completed").length;
    setD({ totalCand: ca?.length || 0, apps: ap?.length || 0, jobsOpen: jobsOpen || 0, placed: placedCount || 0, bySource, byStatus, ivTotal: iv?.length || 0, ivDone, funnel: ["new", "contacted", "screening", "interviewing", "offered", "placed"].map(s => ({ s, n: (ca || []).filter((c: any) => c.status === s).length })) });
  })(); }, []);
  if (!d) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const Bar = ({ obj, max }: { obj: any; max?: number }) => { const m = max || Math.max(...Object.values(obj).map(Number) as number[], 1); return <div>{Object.entries(obj).sort((a: any, b: any) => b[1] - a[1]).slice(0, 8).map(([k, v]: any) => <div key={k} className="flex items-center gap-2 mb-1.5"><span className="text-xs text-gray-400 w-28 truncate capitalize">{(k || "").replace(/_/g, " ")}</span><div className="flex-1 h-2 bg-gray-100 rounded-full"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${(v / m) * 100}%` }} /></div><span className="text-xs w-8 text-right">{v}</span></div>)}</div>; };
  return <div><h1 className="text-xl font-semibold mb-6">Reports</h1>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">{[["Candidates", d.totalCand], ["Open jobs", d.jobsOpen], ["Applications", d.apps], ["Placed", d.placed], ["Interviews", d.ivTotal], ["Interviews done", d.ivDone]].map(([l, v]) => <div key={l as string} className="bg-white rounded-xl border p-4"><div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{l}</div><div className="text-2xl font-semibold">{v}</div></div>)}</div>
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm text-gray-500 mb-3">Hiring funnel</h3>{d.funnel.map((f: any) => <div key={f.s} className="flex items-center gap-2 mb-1.5"><span className="text-xs text-gray-400 w-24 capitalize">{f.s}</span><div className="flex-1 h-2 bg-gray-100 rounded-full"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(f.n / Math.max(d.funnel[0].n, 1)) * 100}%` }} /></div><span className="text-xs w-8 text-right">{f.n}</span></div>)}</div>
      <div className="bg-white rounded-xl border p-4"><h3 className="text-sm text-gray-500 mb-3">Source effectiveness</h3><Bar obj={d.bySource} /></div>
      <div className="bg-white rounded-xl border p-4 md:col-span-2"><h3 className="text-sm text-gray-500 mb-3">Candidates by status</h3><Bar obj={d.byStatus} /></div>
    </div>
  </div>;
}

/* ---------------- Settings: users & roles ---------------- */
function Settings() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<any[]>([]); const [invite, setInvite] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.from("profiles").select("id,email,first_name,last_name,role,is_active").order("created_at", { ascending: true }); setUsers(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  const ROLES: Role[] = ["super_admin", "admin", "recruiter", "hiring_manager", "client_user", "candidate_user"];
  async function setRole(id: string, role: string) { await supabase.from("profiles").update({ role }).eq("id", id); load(); }
  async function toggle(id: string, active: boolean) { await supabase.from("profiles").update({ is_active: !active }).eq("id", id); load(); }
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Team &amp; access</h1><button onClick={() => setInvite(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Add employee</button></div>
    <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b text-left">{["Name", "Email", "Role", "Active"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{users.map(u => <tr key={u.id}><td className="px-3 py-2 font-medium">{u.first_name} {u.last_name}</td><td className="px-3 py-2 text-gray-500 text-xs">{u.email}</td><td className="px-3 py-2"><select value={u.role} disabled={u.id === profile?.id} onChange={e => setRole(u.id, e.target.value)} className="px-2 py-1 border rounded text-xs">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></td><td className="px-3 py-2"><button onClick={() => toggle(u.id, u.is_active)} disabled={u.id === profile?.id} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{u.is_active ? "Active" : "Disabled"}</button></td></tr>)}</tbody></table></div>
    <p className="text-[11px] text-gray-400 mt-3">Roles control which sections each employee sees. Recruiters get full candidate/job/client access; hiring managers see jobs &amp; interviews; clients and candidates get limited portals.</p>
    {invite && <InviteUser onClose={() => setInvite(false)} onSaved={() => { setInvite(false); load(); }} />}
  </div>;
}
function InviteUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ email: "", first_name: "", last_name: "", role: "recruiter", password: "" }); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const ROLES: Role[] = ["admin", "recruiter", "hiring_manager", "client_user", "candidate_user"];
  async function save() {
    if (!f.email || !f.password) { setMsg("Email and temporary password required"); return; }
    setBusy(true); setMsg("");
    try { const { data, error } = await supabase.functions.invoke("admin-create-user", { body: f }); if (error) throw error; if ((data as any)?.error) throw new Error((data as any).error); onSaved(); }
    catch (e: any) { setMsg("Could not create user: " + (e?.message || e) + ". (The user-invite function may not be deployed yet.)"); }
    setBusy(false);
  }
  return <Modal title="Add employee" onClose={onClose}><Field label="Email *" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} /><Field label="First name" value={f.first_name} onChange={(e: any) => setF({ ...f, first_name: e.target.value })} /><Field label="Last name" value={f.last_name} onChange={(e: any) => setF({ ...f, last_name: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Role</span><select value={f.role} onChange={(e: any) => setF({ ...f, role: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label><Field label="Temporary password *" type="text" value={f.password} onChange={(e: any) => setF({ ...f, password: e.target.value })} />{msg && <p className="text-xs text-red-500 mb-2">{msg}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Creating..." : "Create login"}</button></Modal>;
}

/* ---------------- Login ---------------- */
function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: any) { e.preventDefault(); setBusy(true); setErr(""); const m = await signIn(email, pw); setBusy(false); if (m) setErr(m); }
  return <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4"><form onSubmit={submit} className="bg-white rounded-2xl p-8 w-full max-w-sm"><div className="text-center mb-6"><div className="text-lg font-semibold">Streamlined Staffing</div><div className="text-xs text-gray-400">Applicant Tracking System</div></div><Field label="Email" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} /><Field label="Password" type="password" value={pw} onChange={(e: any) => setPw(e.target.value)} />{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium">{busy ? "Signing in..." : "Sign in"}</button></form></div>;
}

/* ---------------- Shell ---------------- */
const NV: { id: Section; l: string; i: string }[] = [
  { id: "dash", l: "Dashboard", i: "\u{1F4CA}" }, { id: "cands", l: "Candidates", i: "\u{1F465}" }, { id: "pipeline", l: "Pipeline", i: "\u{1F4CB}" }, { id: "jobs", l: "Positions", i: "\u{1F4BC}" }, { id: "clients", l: "Clients", i: "\u{1F3E2}" }, { id: "interviews", l: "Interviews", i: "\u{1F5D3}" }, { id: "tasks", l: "Tasks", i: "✅" }, { id: "reports", l: "Reports", i: "\u{1F4C8}" }, { id: "search", l: "AI Search", i: "\u{1F50D}" }, { id: "settings", l: "Settings", i: "⚙️" }];

export default function Home() {
  const { profile, loading, signOut } = useAuth();
  const [pg, setPg] = useState<string>("dash"); const [pr, setPr] = useState<any>({});
  const nav = useCallback((p: string, d: any = {}) => { setPg(p); setPr(d); }, []);
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!profile) return <Login />;
  const role = profile.role; const editable = canEdit(role);
  const items = NV.filter(it => can(role, it.id));
  const allowed = (s: string) => can(role, s as Section);
  const R = () => {
    switch (pg) {
      case "dash": return <Dash nav={nav} />;
      case "cands": return allowed("cands") ? <Cands nav={nav} editable={editable} /> : <Denied />;
      case "det": return allowed("cands") ? <Det nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "pipeline": return allowed("pipeline") ? <Pipeline nav={nav} editable={editable} /> : <Denied />;
      case "jobs": return allowed("jobs") ? <Jobs nav={nav} editable={editable} /> : <Denied />;
      case "job": return allowed("jobs") ? <JobDetail nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "clients": return allowed("clients") ? <Clients nav={nav} editable={editable} /> : <Denied />;
      case "client": return allowed("clients") ? <ClientDetail nav={nav} pr={pr} /> : <Denied />;
      case "interviews": return allowed("interviews") ? <Interviews nav={nav} editable={editable} /> : <Denied />;
      case "tasks": return allowed("tasks") ? <Tasks /> : <Denied />;
      case "reports": return allowed("reports") ? <Reports /> : <Denied />;
      case "search": return allowed("search") ? <Search nav={nav} /> : <Denied />;
      case "settings": return canManageUsers(role) ? <Settings /> : <Denied />;
      default: return <Dash nav={nav} />;
    }
  };
  return <div className="flex min-h-screen">
    <aside className="w-48 bg-slate-900 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-700"><div className="text-sm font-semibold text-white">Streamlined</div><div className="text-[10px] text-slate-500">Staffing ATS</div></div>
      <nav className="flex-1 p-2">{items.map(it => { const a = pg === it.id || (it.id === "cands" && pg === "det") || (it.id === "jobs" && pg === "job") || (it.id === "clients" && pg === "client"); return <button key={it.id} onClick={() => nav(it.id)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left mb-0.5 ${a ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"}`}><span>{it.i}</span>{it.l}</button>; })}</nav>
      <div className="p-3 border-t border-slate-700"><div className="text-[10px] text-slate-400 mb-2 truncate">{profile.email}<div className="text-slate-500">{ROLE_LABELS[role]}</div></div><button onClick={signOut} className="w-full text-left text-xs text-slate-400 hover:text-white">Sign out</button></div>
    </aside>
    <main className="flex-1 bg-gray-50 overflow-auto"><header className="bg-white border-b px-6 py-3 flex justify-between items-center"><span className="text-sm text-gray-400 capitalize">{pg}</span><Av n={`${profile.first_name || profile.email}`} sz="w-7 h-7 text-[10px]" /></header><div className="p-6 max-w-6xl mx-auto">{R()}</div></main>
  </div>;
}
function Denied() { return <div className="py-20 text-center text-gray-400 text-sm">You don&rsquo;t have access to this section.</div>; }
function ComingSoon({ title, note }: { title: string; note: string }) { return <div><h1 className="text-xl font-semibold mb-4">{title}</h1><div className="bg-white rounded-xl border p-10 text-center"><p className="text-sm text-gray-500">{note}</p></div></div>; }
