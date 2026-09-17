"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Tasks ---------------- */
export const TPRIO = ["low", "medium", "high", "urgent"];
export function Tasks() {
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
export function AddTask({ me, onClose, onSaved }: { me?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ title: "", due_date: "", priority: "medium" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function save() { if (!f.title) { setErr("Title required"); return; } setBusy(true); const { error } = await supabase.from("tasks").insert({ title: f.title, due_date: f.due_date ? new Date(f.due_date).toISOString() : null, priority: f.priority, status: "pending", created_by_id: me || null, assigned_to_id: me || null }); setBusy(false); if (error) setErr(error.message); else onSaved(); }
  return <Modal title="Add task" onClose={onClose}><Field label="Task *" value={f.title} onChange={(e: any) => setF({ ...f, title: e.target.value })} /><Field label="Due date" type="date" value={f.due_date} onChange={(e: any) => setF({ ...f, due_date: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Priority</span><select value={f.priority} onChange={(e: any) => setF({ ...f, priority: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{TPRIO.map(p => <option key={p} value={p}>{p}</option>)}</select></label>{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Saving..." : "Save task"}</button></Modal>;
}
