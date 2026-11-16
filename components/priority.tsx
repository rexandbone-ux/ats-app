"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Empty, ago, fullName, logActivity, useToast, e164 } from "@/lib/ui";

/* Contact next: one ranked call list per priority role (jobs tagged "priority"). No AI calls. */
const CONTACT_TYPES = ["call", "email", "contacted", "sms", "whatsapp", "sequence_enrolled"];
type Row = { key: string; candidate_id?: string; rec_id?: string; name: string; title?: string; where?: string; score: number | null; status: string; phone?: string; email?: string; linkedin?: string; last?: string; owner?: string; inPipe: boolean; why?: string };

export function Priority({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const { profile } = useAuth(); const { say } = useToast();
  const [jobs, setJobs] = useState<any[]>([]); const [jid, setJid] = useState(""); const [rows, setRows] = useState<Row[]>([]); const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(true); const [q, setQ] = useState(""); const [recs, setRecs] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("jobs").select("id,title,location,status,tags").contains("tags", ["priority"]).in("status", ["open", "on_hold"]).order("created_at").then(({ data }) => { setJobs(data || []); if (data?.length) setJid(j => j || data[0].id); });
    supabase.from("profiles").select("id,first_name,email").in("role", ["super_admin", "admin", "recruiter", "hiring_manager"]).then(({ data }) => { const m: Record<string, string> = {}; (data || []).forEach((p: any) => m[p.id] = p.first_name || p.email); setRecs(m); });
  }, []);
  const load = useCallback(async () => {
    if (!jid) return; setBusy(true);
    const [{ data: apps }, { data: lb }, { data: jr }, { data: st }] = await Promise.all([
      supabase.from("applications").select("id,candidate_id,status,stage_id,created_at").eq("job_id", jid).neq("status", "rejected").limit(2000),
      supabase.from("v_job_leaderboard").select("candidate_id,score,verdict,summary").eq("job_id", jid).order("score", { ascending: false }).limit(500),
      supabase.from("job_recommendations").select("id,candidate_id,name,title,company,location,linkedin_url,score,reason,status,contacted_at").eq("job_id", jid).not("status", "in", "(skipped,failed)").order("score", { ascending: false }).limit(500),
      supabase.from("pipeline_stages").select("id,name"),
    ]);
    const stageName: Record<string, string> = {}; (st || []).forEach((s: any) => stageName[s.id] = s.name);
    const ids = Array.from(new Set([...(apps || []).map((a: any) => a.candidate_id), ...(lb || []).map((l: any) => l.candidate_id), ...(jr || []).filter((r: any) => r.candidate_id).map((r: any) => r.candidate_id)])).filter(Boolean);
    const cands: Record<string, any> = {}; const last: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [{ data: cs }, { data: ac }] = await Promise.all([
        supabase.from("candidates").select("id,first_name,last_name,current_title,city,state,country,phone,whatsapp,email,linkedin_url,status,owner_id").in("id", chunk),
        supabase.from("activities").select("candidate_id,created_at").in("candidate_id", chunk).in("type", CONTACT_TYPES).order("created_at", { ascending: false }).limit(2000),
      ]);
      (cs || []).forEach((c: any) => cands[c.id] = c); (ac || []).forEach((a: any) => { if (!last[a.candidate_id]) last[a.candidate_id] = a.created_at; });
    }
    const m: Record<string, Row> = {};
    const base = (cid: string): Row => { const c = cands[cid] || {}; return { key: cid, candidate_id: cid, name: fullName(c), title: c.current_title, where: [c.city, c.country].filter(Boolean).join(", "), score: null, status: c.status || "new", phone: c.whatsapp || c.phone, email: c.email, linkedin: c.linkedin_url, last: last[cid], owner: c.owner_id, inPipe: false }; };
    (lb || []).forEach((l: any) => { if (!l.candidate_id) return; const r = m[l.candidate_id] || base(l.candidate_id); r.score = Math.max(r.score ?? 0, l.score ?? 0); r.why = r.why || l.verdict || l.summary; m[l.candidate_id] = r; });
    (jr || []).forEach((x: any) => { if (x.candidate_id) { const r = m[x.candidate_id] || base(x.candidate_id); r.score = r.score ?? x.score; r.why = r.why || x.reason; r.rec_id = x.id; if (x.contacted_at && (!r.last || x.contacted_at > r.last)) r.last = x.contacted_at; m[x.candidate_id] = r; } else m["rec:" + x.id] = { key: "rec:" + x.id, rec_id: x.id, name: x.name || "Unnamed prospect", title: [x.title, x.company].filter(Boolean).join(" · "), where: x.location, score: x.score, status: "prospect", linkedin: x.linkedin_url, last: x.contacted_at, inPipe: false, why: x.reason }; });
    (apps || []).forEach((a: any) => { const r = m[a.candidate_id] || base(a.candidate_id); r.inPipe = true; r.status = stageName[a.stage_id] || a.status; m[a.candidate_id] = r; });
    setRows(Object.values(m)); setBusy(false);
  }, [jid]);
  useEffect(() => { load(); }, [load]);

  const stale = (r: Row) => !r.last || Date.now() - new Date(r.last).getTime() > 3 * 864e5;
  const shown = rows.filter(r => (!fresh || stale(r)) && (!q || `${r.name} ${r.title} ${r.where}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (Number(b.inPipe) - Number(a.inPipe)) || ((b.score ?? -1) - (a.score ?? -1)));
  async function contacted(r: Row) {
    const now = new Date().toISOString();
    setRows(rs => rs.map(x => x.key === r.key ? { ...x, last: now } : x));
    if (r.rec_id) await supabase.from("job_recommendations").update({ contacted_at: now, status: "contacted" }).eq("id", r.rec_id);
    if (r.candidate_id) await logActivity("contacted", `Contacted about ${jobs.find(j => j.id === jid)?.title || "role"}`, { candidate_id: r.candidate_id, job_id: jid }, profile?.id);
    say(`${r.name} marked contacted.`);
  }
  async function addToPipe(r: Row) {
    if (!r.candidate_id) return;
    const { data: s } = await supabase.from("pipeline_stages").select("id").order("sort_order").limit(1);
    const { error } = await supabase.from("applications").insert({ candidate_id: r.candidate_id, job_id: jid, stage_id: s?.[0]?.id || null, status: "active", source: "priority" });
    if (error) { say(error.message, false); return; } say(`${r.name} added to pipeline.`); load();
  }
  const job = jobs.find(j => j.id === jid);
  return <div>
    <div className="mb-4"><h1 className="text-xl font-semibold">Contact next</h1><p className="text-xs text-gray-400">Priority roles. Who to reach out to, best first. People not contacted in 3+ days are shown by default.</p></div>
    {jobs.length === 0 ? <Empty t='No priority roles yet. Add the tag "priority" to a job.' /> : <>
      <div className="flex gap-2 mb-3 flex-wrap">{jobs.map(j => <button key={j.id} onClick={() => setJid(j.id)} className={`px-3 py-1.5 rounded-lg text-sm border ${j.id === jid ? "bg-slate-800 text-white" : "bg-white hover:bg-gray-50"}`}>{j.title}</button>)}</div>
      <div className="flex gap-2 mb-3 items-center flex-wrap"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter name, title, country…" className="px-3 py-1.5 border rounded-lg text-sm w-56" /><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} /> Hide contacted in last 3 days</label><span className="text-xs text-gray-400">{shown.length} of {rows.length}</span>{job && <button onClick={() => nav("job", { id: job.id })} className="ml-auto text-xs text-blue-600">Open job ›</button>}</div>
      <div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60">{["#", "Candidate", "Where", "Score", "Status", "Reach", "Last contact", "Owner", ""].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{busy && rows.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-gray-400">Loading…</td></tr> : shown.length === 0 ? <tr><td colSpan={9} className="p-8 text-center text-gray-400">Nobody left to contact here. Add candidates to this job or from sourcing.</td></tr> : shown.map((r, i) => <tr key={r.key} className="hover:bg-gray-50 align-top">
          <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
          <td className="px-3 py-2 min-w-[200px]"><div className={`font-medium ${r.candidate_id ? "cursor-pointer hover:underline" : ""}`} onClick={() => r.candidate_id && nav("det", { id: r.candidate_id })}>{r.name}</div><div className="text-[11px] text-gray-400 truncate max-w-[260px]">{r.title || ""}</div>{r.why && <div className="text-[11px] text-gray-500 line-clamp-2 max-w-[300px]">{r.why}</div>}</td>
          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.where || "—"}</td>
          <td className="px-3 py-2 text-xs font-semibold">{r.score ?? "—"}</td>
          <td className="px-3 py-2 text-xs capitalize whitespace-nowrap">{r.inPipe ? <span className="text-cyan-700">{r.status}</span> : r.status.replace(/_/g, " ")}</td>
          <td className="px-3 py-2 text-xs whitespace-nowrap space-x-2">{r.phone && <><a href={`tel:${e164(r.phone)}`} className="text-blue-600">Call</a><a href={`https://wa.me/${e164(r.phone).replace("+", "")}`} target="_blank" rel="noreferrer" className="text-green-700">WhatsApp</a></>}{r.email && <a href={`mailto:${r.email}`} className="text-blue-600">Email</a>}{r.linkedin && <a href={r.linkedin} target="_blank" rel="noreferrer" className="text-blue-600">LinkedIn</a>}{!r.phone && !r.email && !r.linkedin && <span className="text-gray-300">no contact info</span>}</td>
          <td className={`px-3 py-2 text-xs whitespace-nowrap ${r.last ? "text-gray-500" : "text-amber-700 font-semibold"}`}>{r.last ? ago(r.last) : "never"}</td>
          <td className="px-3 py-2 text-xs text-gray-500">{(r.owner && recs[r.owner]) || "—"}</td>
          <td className="px-3 py-2 whitespace-nowrap">{editable && <div className="flex gap-1"><button onClick={() => contacted(r)} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-white">Contacted</button>{r.candidate_id && !r.inPipe && <button onClick={() => addToPipe(r)} className="text-[10px] px-2 py-1 rounded border">Add to pipeline</button>}</div>}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
