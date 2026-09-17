"use client";
import { useState, useCallback, createContext, useContext, ReactNode } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";

/* ---------------- Shared types & constants ---------------- */
export type C = { id: string; first_name: string; last_name: string; email?: string; phone?: string; current_title?: string; current_company?: string; status: string; source?: string; city?: string; state?: string; country?: string; skills?: string[]; experience_years?: number; rating?: number; overall_score?: number; resume_text?: string; screening_responses?: any; application_answers?: any; notes?: string; ai_recommendation?: string; ai_analysis?: any; tags?: string[]; owner_id?: string; min_hourly_rate?: number; linkedin_url?: string; resume_url?: string; created_at: string; updated_at?: string };
export const CAND_STATUSES = ["new", "contacted", "screening", "submitted", "interviewing", "offered", "placed", "rejected", "withdrawn", "on_bench", "blacklisted"];
export const SC: Record<string, string> = { new: "bg-blue-100 text-blue-800", contacted: "bg-yellow-100 text-yellow-800", screening: "bg-indigo-100 text-indigo-800", submitted: "bg-cyan-100 text-cyan-800", interviewing: "bg-purple-100 text-purple-800", offered: "bg-orange-100 text-orange-800", hired: "bg-green-100 text-green-800", placed: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", withdrawn: "bg-gray-100 text-gray-700", on_bench: "bg-sky-100 text-sky-800", blacklisted: "bg-rose-100 text-rose-800", active: "bg-green-100 text-green-800", open: "bg-green-100 text-green-800", on_hold: "bg-yellow-100 text-yellow-800", closed: "bg-gray-100 text-gray-700", draft: "bg-gray-100 text-gray-700", filled: "bg-emerald-100 text-emerald-800", prospect: "bg-blue-100 text-blue-800", churned: "bg-red-100 text-red-700", scheduled: "bg-blue-100 text-blue-800", completed: "bg-green-100 text-green-800", cancelled: "bg-gray-100 text-gray-500", pending: "bg-yellow-100 text-yellow-800", sent: "bg-green-100 text-green-800", failed: "bg-red-100 text-red-800", queued: "bg-gray-100 text-gray-600" };

export function days(from: string, to?: string) { return Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 86400000)); }
export function ago(d?: string) { if (!d) return "—"; const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; const dd = Math.round(h / 24); if (dd < 30) return `${dd}d ago`; return new Date(d).toLocaleDateString(); }
export function fullName(c: any) { return `${c?.first_name || ""} ${c?.last_name || ""}`.trim() || c?.email || "?"; }
export function e164(p?: string) { if (!p) return ""; let d = String(p).replace(/[^0-9+]/g, ""); if (!d.startsWith("+")) { if (d.length === 10) d = "+1" + d; else if (d.length === 11 && d.startsWith("1")) d = "+" + d; else d = "+" + d; } return d; }

/* ---------------- Edge function helper (JWT of the signed-in staff user) ---------------- */
export async function fn(path: string, body: any, opts: { timeoutMs?: number } = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const tok = sess?.session?.access_token || SUPABASE_ANON_KEY;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeoutMs || 120000);
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/" + path, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + tok }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text(); let d: any = {}; try { d = JSON.parse(text); } catch { d = { raw: text }; }
    if (!r.ok || d?.error || d?.ok === false) throw new Error(typeof d?.error === "string" ? d.error : d?.error?.message || d?.message || (typeof d?.detail === "string" ? d.detail : "") || (text || "").slice(0, 200) || `Request failed (${r.status})`);
    return d;
  } finally { clearTimeout(t); }
}

/* ---------------- Primitives ---------------- */
export function Empty({ t = "No records found" }: { t?: string }) { return <div className="py-10 text-center text-gray-400 text-sm">{t}</div>; }
export function B({ s }: { s: string }) { return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize whitespace-nowrap ${SC[s] || "bg-gray-100 text-gray-700"}`}>{(s || "").replace(/_/g, " ")}</span>; }
export function Av({ n, sz = "w-8 h-8 text-xs" }: { n: string; sz?: string }) { return <div className={`${sz} rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-semibold shrink-0`}>{(n || "?").split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>; }
export function Chip({ on, children, onClick, cls = "" }: { on?: boolean; children: any; onClick?: () => void; cls?: string }) { return <button type="button" onClick={onClick} className={`text-[11px] px-2 py-1 rounded-full border whitespace-nowrap ${on ? "bg-slate-800 text-white border-slate-800" : "text-gray-600 hover:border-slate-400 bg-white"} ${cls}`}>{children}</button>; }
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: any; wide?: boolean }) {
  return <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}><div className={`bg-white rounded-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-auto`} onClick={e => e.stopPropagation()}><div className="flex justify-between items-center px-5 py-3 border-b sticky top-0 bg-white z-10"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="text-gray-400 text-xl leading-none">&times;</button></div><div className="p-5">{children}</div></div></div>;
}
export function Field({ label, hint, ...p }: any) { return <label className="block mb-3"><span className="text-xs text-gray-500">{label}</span><input {...p} className={"w-full px-3 py-2 border rounded-lg text-sm mt-1 " + (p.className || "")} />{hint && <span className="text-[10px] text-gray-400">{hint}</span>}</label>; }
export function TextArea({ label, ...p }: any) { return <label className="block mb-3"><span className="text-xs text-gray-500">{label}</span><textarea {...p} className={"w-full px-3 py-2 border rounded-lg text-sm mt-1 " + (p.className || "")} /></label>; }
export function Select({ label, options, ...p }: any) { return <label className="block mb-3"><span className="text-xs text-gray-500">{label}</span><select {...p} className={"w-full px-3 py-2 border rounded-lg text-sm mt-1 bg-white " + (p.className || "")}>{options.map((o: any) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{String(o).replace(/_/g, " ")}</option>)}</select></label>; }
export function Btn({ children, primary, danger, small, ...p }: any) { return <button type="button" {...p} className={`${small ? "text-xs px-2.5 py-1.5" : "text-sm px-3 py-2"} rounded-lg disabled:opacity-50 whitespace-nowrap ${primary ? "bg-slate-800 text-white hover:bg-slate-700" : danger ? "border border-red-200 text-red-600 hover:bg-red-50" : "border bg-white hover:bg-gray-50"} ${p.className || ""}`}>{children}</button>; }
export function Card({ children, cls = "" }: { children: any; cls?: string }) { return <div className={`bg-white rounded-xl border ${cls}`}>{children}</div>; }
export function Widget({ title, children, info, right }: { title: string; children: any; info?: string; right?: any }) {
  return <div className="bg-white rounded-xl border"><div className="px-4 py-2.5 border-b flex items-center gap-1.5"><h3 className="text-sm font-medium text-gray-700">{title}</h3>{info && <span title={info} className="text-gray-300 text-xs">ⓘ</span>}<span className="ml-auto">{right}</span></div><div className="p-4">{children}</div></div>;
}
export function scoreCls(s: number | null | undefined) { return s == null ? "bg-gray-300" : s >= 75 ? "bg-green-500" : s >= 60 ? "bg-amber-400" : s >= 40 ? "bg-gray-400" : "bg-red-400"; }
export function scoreText(s: number | null | undefined) { return s == null ? "text-gray-400" : s >= 75 ? "text-green-700" : s >= 60 ? "text-amber-700" : s >= 40 ? "text-gray-600" : "text-red-600"; }
export function Score({ s, big }: { s: number | null | undefined; big?: boolean }) { return <div className={`${big ? "w-14 h-14 text-xl" : "w-9 h-9 text-xs"} rounded-full flex items-center justify-center font-bold text-white shrink-0 ${scoreCls(s)}`}>{s ?? "–"}</div>; }
export function Pct({ p }: { p: number | null | undefined }) { if (p == null) return <span className="text-gray-300 text-xs">—</span>; return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${p >= 80 ? "bg-green-100 text-green-700" : p >= 60 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{p}% match</span>; }

/* ---------------- Inline editing ---------------- */
export function Inline({ value, onSave, placeholder = "—", cls = "", type = "text", multiline, options, editable = true, fmt }: { value: any; onSave: (v: any) => Promise<void> | void; placeholder?: string; cls?: string; type?: string; multiline?: boolean; options?: (string | [string, string])[]; editable?: boolean; fmt?: (v: any) => string }) {
  const [ed, setEd] = useState(false); const [v, setV] = useState(value ?? ""); const [busy, setBusy] = useState(false);
  const shown = fmt ? fmt(value) : (value == null || value === "" ? "" : String(value));
  if (!editable) return <span className={cls}>{shown || <span className="text-gray-300">{placeholder}</span>}</span>;
  if (!ed) return <span onClick={() => { setV(value ?? ""); setEd(true); }} title="Click to edit" className={`cursor-text hover:bg-yellow-50 rounded px-0.5 -mx-0.5 ${cls}`}>{shown || <span className="text-gray-300">{placeholder}</span>}</span>;
  async function commit() { setBusy(true); try { await onSave(type === "number" ? (v === "" ? null : Number(v)) : v); } finally { setBusy(false); setEd(false); } }
  const common = { autoFocus: true, disabled: busy, onBlur: commit, onKeyDown: (e: any) => { if (e.key === "Escape") setEd(false); if (e.key === "Enter" && !multiline) commit(); } } as any;
  if (options) return <select {...common} value={v} onChange={e => setV(e.target.value)} className="px-1 py-0.5 border rounded text-sm bg-white">{options.map((o: any) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{String(o).replace(/_/g, " ")}</option>)}</select>;
  if (multiline) return <textarea {...common} value={v} onChange={e => setV(e.target.value)} rows={6} className="w-full px-2 py-1 border rounded text-sm" />;
  return <input {...common} type={type} value={v} onChange={e => setV(e.target.value)} className="px-1 py-0.5 border rounded text-sm min-w-[120px]" />;
}

/* ---------------- Toasts ---------------- */
type ToastT = { t: string; ok: boolean; id: number };
const ToastCtx = createContext<{ say: (t: string, ok?: boolean) => void }>({ say: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastT[]>([]);
  const say = useCallback((t: string, ok = true) => { const id = Date.now() + Math.random(); setList(l => [...l, { t, ok, id }]); setTimeout(() => setList(l => l.filter(x => x.id !== id)), ok ? 3500 : 9000); }, []);
  return <ToastCtx.Provider value={{ say }}>{children}<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] space-y-2">{list.map(x => <div key={x.id} className={`px-4 py-2 rounded-lg text-sm shadow-lg max-w-md ${x.ok ? "bg-slate-800 text-white" : "bg-red-600 text-white"}`}>{x.t}</div>)}</div></ToastCtx.Provider>;
}
export function Toast() { return null; }

/* ---------------- Activity log ---------------- */
export async function logActivity(type: string, description: string, refs: { candidate_id?: string; job_id?: string; client_id?: string; application_id?: string }, userId?: string) {
  try { await supabase.from("activities").insert({ type, description, ...refs, user_id: userId || null }); } catch { /* non-blocking */ }
}

/* ---------------- CSV export ---------------- */
export function exportCsv(name: string, rows: any[], cols?: string[]) {
  if (!rows.length) return;
  const keys = cols || Array.from(rows.reduce((s: Set<string>, r: any) => { Object.keys(r).forEach(k => { if (typeof r[k] !== "object" || Array.isArray(r[k])) s.add(k); }); return s; }, new Set<string>()));
  const esc = (v: any) => { const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => esc(r[k])).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name.endsWith(".csv") ? name : name + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- Media embeds ---------------- */
export function rawDbx(u: string) { return u.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/([?&])dl=0/, "$1raw=1"); }
export function embedOf(url: string): { type: string; src: string } | null {
  if (!url) return null; const u = url.trim();
  let m = u.match(/voca(?:roo)?\.(?:com|ro)\/(?:embed\/)?([A-Za-z0-9]+)/i);
  if (m && /voca/i.test(u)) return { type: "audio", src: `https://vocaroo.com/embed/${m[1]}?autoplay=0` };
  m = u.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/i);
  if (m) return { type: "iframe", src: `https://www.loom.com/embed/${m[1]}` };
  m = u.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]+)/i);
  if (m) return { type: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
  m = u.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return { type: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)) return { type: "video", src: rawDbx(u) };
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(u)) return { type: "audiofile", src: rawDbx(u) };
  if (/\.pdf(\?|$)/i.test(u)) return { type: "pdf", src: rawDbx(u) };
  return null;
}
export function MediaLink({ label, url }: { label: string; url?: string }) {
  if (!url || !url.trim()) return null;
  const e = embedOf(url);
  return <div className="mb-4"><div className="flex items-center justify-between mb-1"><span className="text-xs font-medium text-gray-600">{label}</span><a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open ↗</a></div>
    {e?.type === "audio" && <iframe src={e.src} className="w-full" height="60" frameBorder="0" />}
    {e?.type === "audiofile" && <audio controls src={e.src} className="w-full" />}
    {(e?.type === "iframe") && <div className="relative w-full" style={{ paddingBottom: "56%" }}><iframe src={e.src} className="absolute inset-0 w-full h-full rounded-lg border" frameBorder="0" allowFullScreen /></div>}
    {e?.type === "video" && <video controls src={e.src} className="w-full rounded-lg border max-h-72" />}
    {e?.type === "pdf" && <iframe src={e.src} className="w-full rounded-lg border" height="420" />}
    {!e && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline break-all">{url}</a>}
  </div>;
}
