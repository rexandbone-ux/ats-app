"use client";
import { supabase } from "@/lib/supabase";

export const SC: Record<string, string> = { new: "bg-blue-100 text-blue-800", contacted: "bg-yellow-100 text-yellow-800", screening: "bg-indigo-100 text-indigo-800", submitted: "bg-cyan-100 text-cyan-800", interviewing: "bg-purple-100 text-purple-800", offered: "bg-orange-100 text-orange-800", hired: "bg-green-100 text-green-800", placed: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800", withdrawn: "bg-gray-100 text-gray-700", on_bench: "bg-sky-100 text-sky-800", blacklisted: "bg-rose-100 text-rose-800", active: "bg-green-100 text-green-800", open: "bg-green-100 text-green-800", on_hold: "bg-yellow-100 text-yellow-800", closed: "bg-gray-100 text-gray-700", draft: "bg-gray-100 text-gray-700", filled: "bg-emerald-100 text-emerald-800", prospect: "bg-blue-100 text-blue-800", churned: "bg-red-100 text-red-700" };

export function B({ s }: { s: string }) { return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${SC[s] || "bg-gray-100 text-gray-700"}`}>{(s || "").replace(/_/g, " ")}</span>; }
export function Av({ n, sz = "w-8 h-8 text-xs" }: { n: string; sz?: string }) { return <div className={`${sz} rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-semibold shrink-0`}>{(n || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>; }
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}><div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}><div className="flex justify-between items-center px-5 py-3 border-b"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="text-gray-400 text-xl leading-none">&times;</button></div><div className="p-5">{children}</div></div></div>;
}
export function Field({ label, ...p }: any) { return <label className="block mb-3"><span className="text-xs text-gray-500">{label}</span><input {...p} className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>; }
export async function logActivity(type: string, description: string, refs: { candidate_id?: string; job_id?: string; client_id?: string; application_id?: string }, userId?: string) {
  try { await supabase.from("activities").insert({ type, description, ...refs, user_id: userId || null }); } catch { /* non-blocking */ }
}
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

/* ---------------- Dashboard (Zoho-style) ---------------- */
export function Widget({ title, children, info }: { title: string; children: any; info?: string }) {
  return <div className="bg-white rounded-lg border"><div className="px-4 py-2.5 border-b flex items-center gap-1.5"><h3 className="text-sm font-medium text-gray-700">{title}</h3>{info && <span title={info} className="text-gray-300 text-xs">ⓘ</span>}</div><div className="p-4">{children}</div></div>;
}
