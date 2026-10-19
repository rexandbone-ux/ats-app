"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Modal, Btn, useToast, fullName, fn } from "@/lib/ui";

/* ---------------- AI-personalized outreach (Juicebox-style) ----------------
   Claude writes one email per person from their profile + the job. The recruiter reviews and
   edits each draft, unticks any they don't want, then sends from their own Gmail (google-bridge).
   Drafts persist in outreach_drafts, so closing the modal loses nothing. */
const ai = (body: any, timeoutMs = 120000) => fn("ai-outreach", body, { timeoutMs });

export function AIOutreachModal({ cands, onClose, onDone, jobId }: { cands: any[]; onClose: () => void; onDone?: () => void; jobId?: string }) {
  const { say } = useToast();
  const [jobs, setJobs] = useState<any[]>([]); const [job, setJob] = useState(jobId || ""); const [instr, setInstr] = useState("");
  const [st, setSt] = useState<any>(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [drafts, setDrafts] = useState<any[] | null>(null); const [skipped, setSkipped] = useState<any[]>([]);
  const [on, setOn] = useState<Record<string, boolean>>({}); const [res, setRes] = useState<Record<string, any>>({});
  useEffect(() => {
    supabase.from("jobs").select("id,title,location").eq("status", "open").order("created_at", { ascending: false }).then(({ data }) => setJobs(data || []));
    ai({ action: "status" }, 20000).then(setSt).catch(() => setSt({}));
  }, []);
  const withEmail = cands.filter(c => c.email && !c.unsubscribed);
  const name = (id: string) => { const c = cands.find(x => x.id === id); return c ? fullName(c) : "—"; };

  async function write() {
    setBusy("draft"); setErr("");
    try {
      const d = await ai({ action: "draft", candidate_ids: withEmail.map(c => c.id).slice(0, 25), job_id: job || null, instructions: instr }, 240000);
      setDrafts(d.drafts || []); setSkipped(d.skipped || []);
      setOn(Object.fromEntries((d.drafts || []).map((x: any) => [x.id, true])));
    } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy("");
  }
  function edit(id: string, patch: any) { setDrafts(ds => (ds || []).map(d => d.id === id ? { ...d, ...patch } : d)); }
  async function save(d: any) { try { await ai({ action: "update", id: d.id, subject: d.subject, body: d.body }, 20000); } catch (e: any) { say("Couldn't save edit: " + (e?.message || e), false); } }
  async function send() {
    const ids = (drafts || []).filter(d => on[d.id] && !res[d.id]?.ok).map(d => d.id); if (!ids.length) return;
    setBusy("send"); setErr("");
    try {
      // Persist any unsaved edits first, then send.
      await Promise.all((drafts || []).filter(d => ids.includes(d.id)).map(d => ai({ action: "update", id: d.id, subject: d.subject, body: d.body }, 20000)));
      const d = await ai({ action: "send", draft_ids: ids }, 240000);
      setRes(r => ({ ...r, ...Object.fromEntries((d.results || []).map((x: any) => [x.id, x])) }));
      say(`${d.sent} sent from ${d.from}${d.failed ? `, ${d.failed} failed` : ""}.`, !d.failed);
      if (d.sent) onDone?.();
    } catch (e: any) { setErr(String(e?.message || e)); }
    setBusy("");
  }
  const gmailLink = (d: any) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(d.to_email || "")}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
  const picked = (drafts || []).filter(d => on[d.id] && !res[d.id]?.ok).length;

  return <Modal title={drafts ? `Review ${drafts.length} personalized email${drafts.length === 1 ? "" : "s"}` : `AI emails for ${cands.length} ${cands.length === 1 ? "person" : "people"}`} onClose={onClose} wide>
    {st && <div className={"text-[11px] px-3 py-2 rounded-lg mb-3 " + (st.channel ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800")}>
      {st.channel === "gmail" ? <>Sends from your Gmail: <b>{st.from}</b>. Replies land in your inbox and sync to the candidate timeline.</>
        : st.channel === "apollo" ? <>Sends through Apollo from <b>{st.from}</b> ({st.sent_today || 0}/{st.daily_cap} sent today). Replies land in that inbox and in Apollo.</>
        : <>No mailbox is connected, so emails can't send from the ATS yet. <a href="#/settings" onClick={onClose} className="underline font-medium">Connect Gmail in Settings → Integrations</a>. Until then each draft has an "Open in Gmail" button.</>}
    </div>}
    {err && <div className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 mb-3">{err}</div>}

    {!drafts ? <div>
      <label className="block mb-3"><span className="text-xs text-gray-500">For which job?</span>
        <select value={job} onChange={e => setJob(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1 bg-white">
          <option value="">No specific job (general intro)</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}{j.location ? ` · ${j.location}` : ""}</option>)}
        </select></label>
      <label className="block mb-3"><span className="text-xs text-gray-500">Anything Claude should know? (optional)</span>
        <textarea value={instr} onChange={e => setInstr(e.target.value)} rows={2} placeholder="e.g. mention the $10k sign-on bonus, keep it under 80 words, they can start in 2 weeks" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" /></label>
      <p className="text-[11px] text-gray-500 mb-3">Claude reads each person's title, employer, experience, skills and resume, and writes an email around one real detail. Nothing is sent until you review it.{cands.length > 25 ? " Up to 25 at a time." : ""}</p>
      {cands.length - withEmail.length > 0 && <p className="text-[11px] text-amber-700 mb-3">{cands.length - withEmail.length} skipped (no email or unsubscribed). Use Enrich to find emails.</p>}
      <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!!busy || !withEmail.length} onClick={write}>{busy ? `Writing ${Math.min(withEmail.length, 25)} emails…` : `✦ Write ${Math.min(withEmail.length, 25)} email${withEmail.length === 1 ? "" : "s"}`}</Btn></div>
    </div> : <div>
      {skipped.length > 0 && <div className="text-[11px] text-gray-500 mb-2">Skipped: {skipped.map(s => `${name(s.candidate_id)} (${s.reason})`).join(", ")}</div>}
      {drafts.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No drafts were written.</p>}
      <div className="space-y-3 mb-3">{drafts.map(d => {
        const r = res[d.id]; const c = d.candidate || {};
        return <div key={d.id} className={"border rounded-xl p-3 " + (r?.ok ? "bg-green-50/50 border-green-200" : !on[d.id] ? "opacity-50" : "")}>
          <div className="flex items-start gap-2 mb-2">
            <input type="checkbox" disabled={!!r?.ok} checked={!!on[d.id]} onChange={e => setOn(o => ({ ...o, [d.id]: e.target.checked }))} className="w-4 h-4 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{fullName(c)} <span className="text-xs text-gray-400 font-normal">{d.to_email}</span></div>
              <div className="text-[11px] text-gray-500">{c.current_title || ""}{c.current_company ? " at " + c.current_company : ""}</div>
            </div>
            {d.hook && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 max-w-[45%] truncate" title="The detail this email is built around">✦ {d.hook}</span>}
            {r?.ok && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Sent</span>}
          </div>
          <input value={d.subject} disabled={!!r?.ok} onChange={e => edit(d.id, { subject: e.target.value })} onBlur={() => save(d)} className="w-full px-2.5 py-1.5 border rounded-lg text-sm font-medium mb-1.5" />
          <textarea value={d.body} disabled={!!r?.ok} onChange={e => edit(d.id, { body: e.target.value })} onBlur={() => save(d)} rows={Math.min(12, d.body.split("\n").length + 2)} className="w-full px-2.5 py-1.5 border rounded-lg text-sm leading-relaxed" />
          {r && !r.ok && <div className="text-[11px] text-red-600 mt-1">Not sent: {r.error}</div>}
          {!r?.ok && !st?.channel && <a href={gmailLink(d)} target="_blank" rel="noreferrer" className="inline-block mt-1.5 text-xs px-2.5 py-1 border rounded-lg hover:bg-gray-50">Open in Gmail ↗</a>}
        </div>;
      })}</div>
      <div className="flex justify-between items-center gap-2 sticky bottom-0 bg-white pt-2">
        <button onClick={() => { setDrafts(null); setRes({}); }} className="text-xs text-gray-500 hover:underline">← Rewrite with different instructions</button>
        <div className="flex gap-2"><Btn onClick={onClose}>Close</Btn>
          <Btn primary disabled={!!busy || !picked || !st?.channel} onClick={send} title={st?.channel ? "" : "Connect a mailbox first"}>{busy === "send" ? "Sending…" : `Send ${picked} from ${st?.from || "Gmail"}`}</Btn></div>
      </div>
    </div>}
  </Modal>;
}
