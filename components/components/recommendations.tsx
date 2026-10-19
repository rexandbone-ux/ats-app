"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useToast, fn, Btn, Modal } from "@/lib/ui";

/* ---------------- Recommendations (recruit-agent) ----------------
   For every open job the agent ranks people from the ATS and Apollo once a day. Approve the top N
   (or hand-pick), and it imports them, writes each a personalized email, and sends from the team
   mailbox (60/day). Replies get an automatic answer + a task, once a Gmail inbox is connected. */
const ra = (body: any, timeoutMs = 60000) => fn("recruit-agent", body, { timeoutMs });
const STATUS_TABS = [["suggested", "Suggested"], ["approved", "Queued"], ["contacted", "Contacted"], ["replied", "Replied"], ["failed", "Problems"], ["skipped", "Skipped"]] as const;
const scoreCls = (s: number) => s >= 85 ? "bg-green-100 text-green-700" : s >= 70 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500";

export function Recommendations({ nav, editable }: { nav: (p: string, d?: any) => void; editable: boolean }) {
  const { say } = useToast();
  const [jobs, setJobs] = useState<any[]>([]); const [job, setJob] = useState("");
  const [data, setData] = useState<any>(null); const [tab, setTab] = useState("suggested");
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState("");
  const [mailbox, setMailbox] = useState<any>(null); const [confirm, setConfirm] = useState<{ ids?: string[]; top?: number } | null>(null);

  useEffect(() => {
    supabase.from("jobs").select("id,title,location").eq("status", "open").order("created_at", { ascending: false }).then(async ({ data: js }) => {
      const list = js || [];
      const { data: counts } = await supabase.from("job_recommendations").select("job_id,status").in("job_id", list.map(j => j.id)).limit(10000);
      const n: Record<string, number> = {}; (counts || []).forEach((r: any) => { if (r.status === "suggested") n[r.job_id] = (n[r.job_id] || 0) + 1; });
      setJobs(list.map(j => ({ ...j, suggested: n[j.id] || 0 })));
      if (list.length) setJob(j => j || ([...list].sort((a, b) => (n[b.id] || 0) - (n[a.id] || 0))[0]?.id || list[0].id));
    });
    fn("ai-outreach", { action: "status" }, { timeoutMs: 20000 }).then(setMailbox).catch(() => setMailbox({}));
  }, []);
  const load = useCallback(async () => { if (!job) return; setData(null); setSel(new Set()); try { setData(await ra({ action: "list", job_id: job })); } catch (e: any) { say(e.message, false); setData({ recommendations: [] }); } }, [job, say]);
  useEffect(() => { load(); }, [load]);

  const recs: any[] = data?.recommendations || [];
  const shown = recs.filter(r => r.status === tab);
  const count = (s: string) => recs.filter(r => r.status === s).length;
  async function refresh() { setBusy("refresh"); try { const d = await ra({ action: "recommend", job_id: job }, 280000); say(`Found ${d.found?.ats || 0} in your ATS and ${d.found?.apollo || 0} on Apollo; ${d.added} new recommendations.`); load(); } catch (e: any) { say(e.message, false); } setBusy(""); }
  async function approve(c: { ids?: string[]; top?: number }) {
    setBusy("approve");
    try { const d = await ra({ action: "approve", job_id: job, ids: c.ids, top_n: c.top }); say(`${d.approved} queued. The agent starts emailing within 15 minutes (weekdays 9am-7pm ET).`); setConfirm(null); load(); }
    catch (e: any) { say(e.message, false); }
    setBusy("");
  }
  async function skip() { try { await ra({ action: "skip", ids: [...sel] }); load(); } catch (e: any) { say(e.message, false); } }
  async function setAuto(v: boolean) { try { await ra({ action: "settings", job_id: job, auto_reply: v }); load(); } catch (e: any) { say(e.message, false); } }
  function liNote(r: any) {
    const first = String(r.name || "").split(" ")[0] || "there";
    const t = `Hi ${first}, I'm recruiting for a ${data?.job?.title?.split("—")[0]?.trim() || "role"}${data?.job?.location ? ` in ${data.job.location}` : ""} and your background${r.company ? ` at ${r.company}` : ""} stood out. Open to a quick chat?`;
    navigator.clipboard?.writeText(t).then(() => say("LinkedIn note copied. Paste it into a connection request.")).catch(() => say(t));
  }
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const auto = data?.recruit?.auto_reply !== false;
  const pausedUntil = data?.paused_until && new Date(data.paused_until).getTime() > Date.now() ? new Date(data.paused_until) : null;
  const fmtDay = (d: Date) => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const confirmN = confirm?.ids?.length ?? Math.min(confirm?.top || 0, count("suggested"));
  const apolloN = confirm ? (confirm.ids ? recs.filter(r => confirm.ids!.includes(r.id) && r.source === "apollo").length : recs.filter(r => r.status === "suggested").slice(0, confirm.top).filter(r => r.source === "apollo").length) : 0;

  return <div>
    <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
      <div><h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="text-xs text-gray-400">Every open job gets a ranked list of people from your ATS and Apollo, refreshed daily. Approve, and the agent writes and sends each a personal email.</p></div>
      {mailbox && <span className={"text-[11px] px-2.5 py-1 rounded-full " + (mailbox.channel ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800")}>{mailbox.channel ? `Sends from ${mailbox.from} · ${mailbox.sent_today ?? 0}/${mailbox.daily_cap ?? 60} today` : "No sending mailbox connected"}</span>}
    </div>

    {pausedUntil && <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800"><b>Outreach is on hold until {fmtDay(pausedUntil)}.</b> {mailbox?.from || "The mailbox"} is shared with Juicebox, which has a large send queue this week. You can still approve people; they're emailed automatically once the hold ends, at up to {mailbox?.daily_cap ?? 25} a day.</div>}
    <div className="bg-white rounded-xl border p-3 mb-3 flex gap-2 items-center flex-wrap">
      <select value={job} onChange={e => setJob(e.target.value)} className="px-3 py-2 border rounded-lg text-sm bg-white max-w-md">
        {jobs.map(j => <option key={j.id} value={j.id}>{j.title}{j.location ? ` · ${j.location}` : ""} ({j.suggested})</option>)}
      </select>
      <span className="text-[11px] text-gray-400">{data?.recruit?.last_recommended_at ? `Refreshed ${new Date(data.recruit.last_recommended_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not ranked yet"}</span>
      {editable && <Btn small disabled={!!busy || !job} onClick={refresh}>{busy === "refresh" ? "Searching ATS + Apollo…" : "↻ Refresh now"}</Btn>}
      <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto" title={data?.auto_reply_ready ? "" : "Auto-reply needs a Gmail inbox connected in Settings → Integrations so the agent can read replies"}>
        <input type="checkbox" checked={auto} disabled={!editable} onChange={e => setAuto(e.target.checked)} className="w-4 h-4" /> Auto-reply to replies
        {!data?.auto_reply_ready && <span className="text-amber-600">(needs Gmail connected)</span>}
      </label>
      {editable && <Btn small primary disabled={!!busy || !count("suggested")} onClick={() => setConfirm({ top: 100 })}>✉ Reach out to top {Math.min(100, count("suggested"))}</Btn>}
    </div>

    <div className="flex gap-1 mb-2 flex-wrap">{STATUS_TABS.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setSel(new Set()); }} className={"text-xs px-3 py-1.5 rounded-lg border " + (tab === k ? "bg-slate-800 text-white border-slate-800" : "bg-white")}>{l} <span className="opacity-60">{count(k)}</span></button>)}</div>

    {editable && sel.size > 0 && <div className="flex items-center gap-2 mb-2 p-2 bg-slate-800 rounded-lg text-white text-sm"><span className="px-2">{sel.size} selected</span>
      {tab === "suggested" || tab === "failed" ? <button onClick={() => setConfirm({ ids: [...sel] })} className="text-xs px-2 py-1 rounded bg-teal-500 hover:bg-teal-400">✉ Reach out</button> : null}
      {(tab === "suggested" || tab === "approved") && <button onClick={skip} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">Skip</button>}
      <button onClick={() => setSel(new Set())} className="text-xs px-2 py-1 ml-auto">Clear</button></div>}

    {!data ? <p className="text-sm text-gray-400 py-10 text-center">Loading…</p> : shown.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center bg-white rounded-xl border">{tab === "suggested" ? (recs.length ? "Everyone recommended has been handled." : "No recommendations yet. Click Refresh now, or wait for the agent's next daily run.") : "Nobody here yet."}</p> :
      <div className="bg-white rounded-xl border divide-y">
        {editable && <div className="px-4 py-1.5 text-[11px] text-gray-400 flex items-center gap-2"><input type="checkbox" checked={sel.size === shown.length} onChange={e => setSel(e.target.checked ? new Set(shown.map(r => r.id)) : new Set())} className="w-4 h-4" /> select all</div>}
        {shown.map(r => <div key={r.id} className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50">
          {editable && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="w-4 h-4 mt-1" />}
          <span className={"text-xs font-semibold px-2 py-1 rounded-lg shrink-0 " + scoreCls(r.score || 0)}>{r.score ?? "–"}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
              {r.candidate_id ? <button onClick={() => nav("det", { id: r.candidate_id })} className="hover:underline text-left">{r.name || "—"}</button> : <span>{r.name || "—"}</span>}
              <span className={"text-[10px] px-1.5 py-0.5 rounded " + (r.source === "ats" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700")}>{r.source === "ats" ? "In your ATS" : "Apollo"}</span>
              {r.has_email === false && <span className="text-[10px] text-amber-600">no email</span>}
            </div>
            <div className="text-xs text-gray-500">{r.title}{r.company ? ` at ${r.company}` : ""}{r.location ? ` · ${r.location}` : ""}</div>
            {r.reason && <div className="text-[11px] text-gray-400 mt-0.5">{r.reason}</div>}
            {r.error && <div className="text-[11px] text-red-600 mt-0.5">{r.error}</div>}
          </div>
          <div className="flex gap-1.5 shrink-0 items-center">
            {r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border rounded-lg text-blue-700 hover:bg-blue-50">in ↗</a>}
            <button onClick={() => liNote(r)} title="Copy a short LinkedIn connection note" className="text-xs px-2 py-1 border rounded-lg hover:bg-gray-50">Copy LinkedIn note</button>
            {r.contacted_at && <span className="text-[10px] text-gray-400">{new Date(r.contacted_at).toLocaleDateString()}</span>}
          </div>
        </div>)}
      </div>}

    {confirm && <Modal title={`Reach out to ${confirmN} ${confirmN === 1 ? "person" : "people"}?`} onClose={() => setConfirm(null)}>
      <ul className="text-sm text-gray-700 space-y-1.5 mb-4 list-disc pl-5">
        {apolloN > 0 && <li>{apolloN} from Apollo get imported into your ATS. Revealing their emails uses up to {apolloN} Apollo credits.</li>}
        <li>Claude writes each person an email built around their own background and this job.</li>
        <li>Emails go out from <b>{mailbox?.from || "your mailbox"}</b>, at most {mailbox?.daily_cap ?? 25} a day to keep it out of spam, so {confirmN > (mailbox?.daily_cap ?? 25) ? `this takes about ${Math.ceil(confirmN / (mailbox?.daily_cap ?? 25))} days` : "they can all go out in one day"}{pausedUntil ? `, starting ${fmtDay(pausedUntil)} when the outreach hold ends` : ""}.</li>
        <li>{data?.auto_reply_ready && auto ? "Replies get an automatic answer (asking interested people for a call time) and a task for you." : "Replies land in that inbox. Connect Gmail in Settings to turn on auto-replies."}</li>
        <li>People who unsubscribed, have no email, or were placed are skipped automatically.</li>
      </ul>
      <div className="flex justify-end gap-2"><Btn onClick={() => setConfirm(null)}>Cancel</Btn><Btn primary disabled={!!busy || !mailbox?.channel} onClick={() => approve(confirm)}>{busy === "approve" ? "Queuing…" : `Yes, reach out to ${confirmN}`}</Btn></div>
      {!mailbox?.channel && <p className="text-[11px] text-red-600 mt-2">No sending mailbox is connected, so nothing can go out yet.</p>}
    </Modal>}
  </div>;
}
