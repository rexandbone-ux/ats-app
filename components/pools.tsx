"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Talent Pools ---------------- */
export function Pools({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const [pools, setPools] = useState<any[]>([]); const [counts, setCounts] = useState<Record<string, number>>({}); const [add, setAdd] = useState(false); const [name, setName] = useState("");
  const load = useCallback(async () => { const { data } = await supabase.from("talent_pools").select("*").order("name"); setPools(data || []); const { data: tpc } = await supabase.from("talent_pool_candidates").select("talent_pool_id").limit(20000); const c: Record<string, number> = {}; (tpc || []).forEach((r: any) => { c[r.talent_pool_id] = (c[r.talent_pool_id] || 0) + 1; }); setCounts(c); }, []);
  useEffect(() => { load(); }, [load]);
  async function create() { if (!name.trim()) return; await supabase.from("talent_pools").insert({ name: name.trim() }); setName(""); setAdd(false); load(); }
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Talent pools ({pools.length})</h1>{editable && <button onClick={() => setAdd(true)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm">+ New pool</button>}</div>
    <div className="grid md:grid-cols-3 gap-3">{pools.map(p => <div key={p.id} onClick={() => nav("pool", { id: p.id, name: p.name })} className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-sm"><div className="font-medium">{p.name}</div><div className="text-xs text-gray-400 mt-1">{counts[p.id] || 0} candidates</div>{p.description && <div className="text-xs text-gray-500 mt-2">{p.description}</div>}</div>)}</div>
    {add && <Modal title="New talent pool" onClose={() => setAdd(false)}><Field label="Pool name *" value={name} onChange={(e: any) => setName(e.target.value)} /><button onClick={create} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">Create pool</button></Modal>}
  </div>;
}
export function PoolDetail({ nav, pr, editable }: { nav: (p: string, d?: any) => void; pr: any; editable: boolean }) {
  const [members, setMembers] = useState<any[]>([]);
  const load = useCallback(async () => { const { data } = await supabase.from("talent_pool_candidates").select("id,candidate_id,candidates(first_name,last_name,current_title,status)").eq("talent_pool_id", pr.id); setMembers(data || []); }, [pr.id]);
  useEffect(() => { load(); }, [load]);
  async function remove(rowId: string) { await supabase.from("talent_pool_candidates").delete().eq("id", rowId); load(); }
  return <div><button onClick={() => nav("pools")} className="text-sm text-gray-400 mb-4 block">&larr; Back</button>
    <h1 className="text-xl font-semibold mb-4">{pr.name || "Pool"} ({members.length})</h1>
    <div className="bg-white rounded-xl border divide-y">{members.length === 0 ? <p className="p-6 text-center text-gray-400 text-sm">No candidates yet. Add them from the Candidates list (select &rarr; Add to pool).</p> : members.map(m => <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"><Av n={`${m.candidates?.first_name || ""} ${m.candidates?.last_name || ""}`} sz="w-7 h-7 text-[10px]" /><div className="flex-1 min-w-0 cursor-pointer" onClick={() => m.candidate_id && nav("det", { id: m.candidate_id })}><div className="text-sm font-medium">{m.candidates?.first_name} {m.candidates?.last_name}</div><div className="text-[10px] text-gray-400">{m.candidates?.current_title || ""}</div></div><B s={m.candidates?.status || "new"} />{editable && <button onClick={() => remove(m.id)} className="text-gray-300 hover:text-red-500 text-xs">remove</button>}</div>)}</div>
  </div>;
}
