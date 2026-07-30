"use client";
import { useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { errorMessage, ilikeOr } from "@/lib/db";
import { fullName, humanize, initials } from "@/lib/format";

/* ---------------- Primitives ---------------- */

export const STATUS_COLORS: Record<string, string> = { new: "bg-blue-100 text-blue-800", contacted: "bg-yellow-100 text-yellow-800", screening: "bg-indigo-100 text-indigo-800", submitted: "bg-cyan-100 text-cyan-800", interviewing: "bg-purple-100 text-purple-800", offered: "bg-orange-100 text-orange-800", hired: "bg-green-100 text-green-800", placed: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", withdrawn: "bg-gray-100 text-gray-700", on_bench: "bg-sky-100 text-sky-800", blacklisted: "bg-rose-100 text-rose-800", active: "bg-green-100 text-green-800", open: "bg-green-100 text-green-800", on_hold: "bg-yellow-100 text-yellow-800", closed: "bg-gray-100 text-gray-700", draft: "bg-gray-100 text-gray-700", filled: "bg-emerald-100 text-emerald-800", prospect: "bg-blue-100 text-blue-800", churned: "bg-red-100 text-red-700" };

export function Badge({ s }: { s: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[s] || "bg-gray-100 text-gray-700"}`}>{humanize(s)}</span>;
}

export function Avatar({ n, sz = "w-8 h-8 text-xs" }: { n: string; sz?: string }) {
  return <div className={`${sz} rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-semibold shrink-0`}>{initials(n)}</div>;
}

export function Loading() { return <div className="py-20 text-center text-gray-400">Loading...</div>; }
export function Empty() { return <div className="py-10 text-center text-gray-400 text-sm">No records found</div>; }
export function EmptyNote({ children }: { children: ReactNode }) { return <p className="p-6 text-center text-gray-400 text-sm">{children}</p>; }
export function ErrorText({ children }: { children: ReactNode }) { return <p className="text-xs text-red-500 mb-2">{children}</p>; }

export function BackButton({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="text-sm text-gray-400 mb-4 block">&larr; Back</button>;
}

export function StatCard({ label, value, onClick, rounded = "rounded-xl" }: { label: ReactNode; value: ReactNode; onClick?: () => void; rounded?: string }) {
  return <div onClick={onClick} className={`bg-white ${rounded} border p-4${onClick ? " cursor-pointer hover:shadow-sm" : ""}`}>
    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
  </div>;
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border p-4 ${className}`}>{title && <h3 className="text-sm font-medium mb-3">{title}</h3>}{children}</div>;
}

export function TableHead({ cols }: { cols: string[] }) {
  return <thead><tr className="border-b text-left">{cols.map((h, i) => <th key={`${h}-${i}`} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>;
}

/** Label + value rows, e.g. the contact/professional detail cards. */
export function DetailRows({ rows, capitalize }: { rows: [string, any][]; capitalize?: boolean }) {
  return <>{rows.map(([label, value]) => value ? <div key={label} className="flex justify-between py-1 border-b border-gray-50 text-xs"><span className="text-gray-400">{label}</span><span className={capitalize ? "capitalize" : undefined}>{String(value)}</span></div> : null)}</>;
}

/** Renders a JSON answers blob (object or plain string). */
export function AnswersCard({ title, value }: { title: string; value: any }) {
  return <Card title={title}>
    {typeof value === "object"
      ? Object.entries(value).map(([k, v]) => <div key={k} className="mb-3 p-3 bg-gray-50 rounded-lg"><div className="text-[10px] font-medium text-gray-400 mb-1">{k}</div><div className="text-sm">{String(v)}</div></div>)
      : <p className="text-sm">{String(value)}</p>}
  </Card>;
}

export function RecommendationBadge({ recommendation, score, size = "text-[10px]" }: { recommendation?: string | null; score?: number | null; size?: string }) {
  if (!recommendation) return null;
  const tone = recommendation === "ADVANCE" ? "bg-green-100 text-green-700" : recommendation === "REJECT" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700";
  return <span className={`${size} px-2 py-0.5 rounded-full font-semibold ${tone}`}>{recommendation}{score ? ` ${score}` : ""}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px]">{children}</span>;
}

/* ---------------- Modal + form controls ---------------- */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}><div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}><div className="flex justify-between items-center px-5 py-3 border-b"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="text-gray-400 text-xl leading-none">&times;</button></div><div className="p-5">{children}</div></div></div>;
}

const CONTROL = "w-full px-3 py-2 border rounded-lg text-sm mt-1";

export function Labelled({ label, action, children }: { label: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <label className="block mb-3">
    {action ? <div className="flex justify-between items-center"><span className="text-xs text-gray-500">{label}</span>{action}</div> : <span className="text-xs text-gray-500">{label}</span>}
    {children}
  </label>;
}

export function Field({ label, ...p }: any) {
  return <Labelled label={label}><input {...p} className={CONTROL} /></Labelled>;
}

export function SelectField({ label, children, ...p }: any) {
  return <Labelled label={label}><select {...p} className={CONTROL}>{children}</select></Labelled>;
}

export function TextareaField({ label, action, ...p }: any) {
  return <Labelled label={label} action={action}><textarea {...p} className={CONTROL} /></Labelled>;
}

/** `<option>`s for a list of enum-ish values, humanized. */
export function Options({ values, humanized = true }: { values: readonly string[]; humanized?: boolean }) {
  return <>{values.map(v => <option key={v} value={v}>{humanized ? humanize(v) : v}</option>)}</>;
}

export function SubmitButton({ busy, label, busyLabel, onClick, className = "" }: { busy?: boolean; label: string; busyLabel?: string; onClick?: () => void; className?: string }) {
  return <button disabled={busy} onClick={onClick} className={`w-full bg-slate-800 text-white py-2 rounded-lg text-sm disabled:opacity-50 ${className}`}>{busy ? (busyLabel || "Saving...") : label}</button>;
}

/**
 * Local form state for the "add record" modals: field bindings plus busy/error
 * handling around a save call.
 */
export function useRecordForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch: Record<string, any>) => setValues(v => ({ ...v, ...patch }));
  const field = (name: string) => ({
    value: values[name] ?? "",
    onChange: (e: any) => set({ [name]: e.target.value }),
  });
  const checkbox = (name: string) => ({
    checked: !!values[name],
    onChange: (e: any) => set({ [name]: e.target.checked }),
  });
  /** Runs `save`, surfacing `{ error }` results and thrown errors; true when it succeeded. */
  async function submit(save: () => PromiseLike<{ error?: any } | void>) {
    setBusy(true); setErr("");
    try {
      const res = await save();
      const error = (res as any)?.error;
      if (error) { setErr(errorMessage(error)); return false; }
      return true;
    } catch (e: any) {
      setErr(errorMessage(e));
      return false;
    } finally { setBusy(false); }
  }
  return { values, set, field, checkbox, busy, setBusy, err, setErr, submit };
}

/* ---------------- Candidate lookup ---------------- */

export type CandidateOption = { id: string; first_name?: string; last_name?: string; current_title?: string };

/** Debounced candidate typeahead shared by the header search and the pickers. */
export function useCandidateSearch(q: string, opts: { columns?: string; searchColumns?: string[]; limit?: number; minLength?: number; delay?: number } = {}) {
  const { columns = "id,first_name,last_name", searchColumns = ["first_name", "last_name"], limit = 6, minLength = 2, delay = 250 } = opts;
  const [results, setResults] = useState<CandidateOption[]>([]);
  useEffect(() => {
    if (q.trim().length < minLength) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("candidates").select(columns).or(ilikeOr(searchColumns, q)).limit(limit);
      setResults((data as any as CandidateOption[]) || []);
    }, delay);
    return () => clearTimeout(t);
  }, [q, columns, limit, minLength, delay, searchColumns.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return results;
}

/** Search-and-select a candidate, or show the current pick with a "change" link. */
export function CandidatePicker({ id, name, onSelect }: { id?: string; name?: string; onSelect: (id: string, name: string) => void }) {
  const [q, setQ] = useState("");
  const opts = useCandidateSearch(q);
  if (id) {
    return <div className="flex justify-between items-center mb-3 p-2 bg-gray-50 rounded-lg text-sm">
      <span>{name}</span>
      <button onClick={() => onSelect("", "")} className="text-xs text-gray-400">change</button>
    </div>;
  }
  return <div className="mb-3">
    <Field label="Candidate *" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Search name..." />
    {opts.length > 0 && <div className="border rounded-lg -mt-2 divide-y">{opts.map(o => <div key={o.id} onClick={() => { onSelect(o.id, fullName(o)); setQ(""); }} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">{fullName(o)}</div>)}</div>}
  </div>;
}

/* ---------------- Media embeds ---------------- */

function rawDbx(u: string) { return u.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/([?&])dl=0/, "$1raw=1"); }

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
