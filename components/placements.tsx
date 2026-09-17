"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Placements ---------------- */
export function Placements({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [list, setList] = useState<any[]>([]); const [add, setAdd] = useState(false);
  const load = useCallback(async () => { const { data } = await supabase.from("placements").select("*,candidates(first_name,last_name),clients(company_name),jobs(title)").order("created_at", { ascending: false }); setList(data || []); }, []);
  useEffect(() => { load(); }, [load]);
  const active = list.filter(p => p.status === "active").length;
  const margin = (p: any) => (p.client_bill_rate && p.candidate_pay_rate) ? `$${(p.client_bill_rate - p.candidate_pay_rate).toFixed(2)}/${p.pay_period || "hr"}` : "—";
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Placements ({list.length})</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ Record placement</button>}</div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{[["Active", active], ["Total", list.length]].map(([l, v]) => <div key={l as string} className="bg-white rounded-xl border p-4"><div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{l}</div><div className="text-2xl font-semibold">{v}</div></div>)}</div>
    <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b text-left">{["Candidate", "Client", "Role", "Pay", "Bill", "Margin", "Start", "Status"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{list.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-gray-400 text-sm">No placements yet.</td></tr> : list.map(p => <tr key={p.id} className="hover:bg-gray-50"><td className="px-3 py-2 font-medium cursor-pointer" onClick={() => p.candidate_id && nav("det", { id: p.candidate_id })}>{p.candidates?.first_name} {p.candidates?.last_name}</td><td className="px-3 py-2 capitalize">{p.clients?.company_name || "—"}</td><td className="px-3 py-2 text-gray-500">{p.jobs?.title || "—"}</td><td className="px-3 py-2">{p.candidate_pay_rate ? `$${p.candidate_pay_rate}` : "—"}</td><td className="px-3 py-2">{p.client_bill_rate ? `$${p.client_bill_rate}` : "—"}</td><td className="px-3 py-2 text-green-700">{margin(p)}</td><td className="px-3 py-2 text-xs text-gray-400">{p.start_date ? new Date(p.start_date).toLocaleDateString() : "—"}</td><td className="px-3 py-2"><B s={p.status} /></td></tr>)}</tbody></table></div>
    {add && <RecordPlacement onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}
  </div>;
}
export function RecordPlacement({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [q, setQ] = useState(""); const [opts, setOpts] = useState<any[]>([]); const [clients, setClients] = useState<any[]>([]); const [jobs, setJobs] = useState<any[]>([]);
  const [f, setF] = useState<any>({ candidate_id: "", candidate_name: "", client_id: "", job_id: "", candidate_pay_rate: "", client_bill_rate: "", pay_period: "hour", start_date: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { supabase.from("clients").select("id,company_name").order("company_name").then(({ data }) => setClients(data || [])); supabase.from("jobs").select("id,title").order("created_at", { ascending: false }).then(({ data }) => setJobs(data || [])); }, []);
  useEffect(() => { if (q.length < 2) { setOpts([]); return; } const t = setTimeout(async () => { const { data } = await supabase.from("candidates").select("id,first_name,last_name").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(6); setOpts(data || []); }, 250); return () => clearTimeout(t); }, [q]);
  async function save() {
    if (!f.candidate_id || !f.client_id) { setErr("Pick a candidate and a client"); return; }
    setBusy(true);
    const { error } = await supabase.from("placements").insert({ candidate_id: f.candidate_id, client_id: f.client_id, job_id: f.job_id || null, status: "active", start_date: f.start_date || null, candidate_pay_rate: f.candidate_pay_rate ? Number(f.candidate_pay_rate) : null, client_bill_rate: f.client_bill_rate ? Number(f.client_bill_rate) : null, pay_period: f.pay_period });
    if (error) { setBusy(false); setErr(error.message); return; }
    await supabase.from("candidates").update({ status: "placed" }).eq("id", f.candidate_id);
    await logActivity("placement", `Placed ${f.candidate_name}`, { candidate_id: f.candidate_id, client_id: f.client_id, job_id: f.job_id || undefined }, profile?.id);
    setBusy(false); onSaved();
  }
  return <Modal title="Record placement" onClose={onClose}>
    {f.candidate_id ? <div className="flex justify-between items-center mb-3 p-2 bg-gray-50 rounded-lg text-sm"><span>{f.candidate_name}</span><button onClick={() => setF({ ...f, candidate_id: "", candidate_name: "" })} className="text-xs text-gray-400">change</button></div>
      : <div className="mb-3"><Field label="Candidate *" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search name..." />{opts.length > 0 && <div className="border rounded-lg -mt-2 divide-y">{opts.map(o => <div key={o.id} onClick={() => { setF({ ...f, candidate_id: o.id, candidate_name: `${o.first_name} ${o.last_name}` }); setOpts([]); setQ(""); }} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">{o.first_name} {o.last_name}</div>)}</div>}</div>}
    <label className="block mb-3"><span className="text-xs text-gray-500">Client *</span><select value={f.client_id} onChange={(e: any) => setF({ ...f, client_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">— select —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
    <label className="block mb-3"><span className="text-xs text-gray-500">Role (optional)</span><select value={f.job_id} onChange={(e: any) => setF({ ...f, job_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">— none —</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
    <div className="grid grid-cols-3 gap-2"><Field label="Pay rate" type="number" value={f.candidate_pay_rate} onChange={(e: any) => setF({ ...f, candidate_pay_rate: e.target.value })} /><Field label="Bill rate" type="number" value={f.client_bill_rate} onChange={(e: any) => setF({ ...f, client_bill_rate: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Per</span><select value={f.pay_period} onChange={(e: any) => setF({ ...f, pay_period: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="hour">hour</option><option value="month">month</option><option value="year">year</option></select></label></div>
    <Field label="Start date" type="date" value={f.start_date} onChange={(e: any) => setF({ ...f, start_date: e.target.value })} />
    {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
    <button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Record placement"}</button>
  </Modal>;
}
