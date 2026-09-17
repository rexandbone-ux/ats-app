"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Reports ---------------- */
export function Reports() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { (async () => {
    const [{ data: ca }, { data: ap }, { data: iv }, { count: jobsOpen }, { count: placedCount }] = await Promise.all([
      supabase.from("candidates").select("status,source,roe_rating").limit(10000),
      supabase.from("applications").select("status,created_at").limit(20000),
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
