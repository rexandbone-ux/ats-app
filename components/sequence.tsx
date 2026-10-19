"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Modal, Btn, useToast, fullName } from "@/lib/ui";
import { apolloSequences, enrollInSequence, toSeqPerson } from "@/lib/comms";

/* ---------------- Send to Apollo sequence ----------------
   Pick a live Apollo sequence + sending mailbox, enroll the selected ATS people.
   People without an email are listed and skipped. */
export function SequenceModal({ cands, onClose, onDone }: { cands: any[]; onClose: () => void; onDone?: () => void }) {
  const { profile } = useAuth(); const { say } = useToast();
  const [seqs, setSeqs] = useState<any[] | null>(null); const [boxes, setBoxes] = useState<any[]>([]); const [err, setErr] = useState("");
  const [seqId, setSeqId] = useState(""); const [box, setBox] = useState(""); const [strict, setStrict] = useState(false); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null); const [q, setQ] = useState("");
  useEffect(() => {
    apolloSequences().then((d: any) => {
      const list = (d.sequences || []).sort((a: any, b: any) => Number(b.active) - Number(a.active) || String(b.last_used_at || "").localeCompare(String(a.last_used_at || "")));
      setSeqs(list); setBoxes(d.mailboxes || []);
      const def = (d.mailboxes || []).find((m: any) => m.default) || (d.mailboxes || [])[0]; if (def) setBox(def.id);
      const first = list.find((s: any) => s.active) || list[0]; if (first) setSeqId(first.id);
    }).catch((e: any) => { setErr(String(e?.message || e)); setSeqs([]); });
  }, []);
  const withEmail = cands.filter(c => c.email); const noEmail = cands.filter(c => !c.email);
  const seq = (seqs || []).find(s => s.id === seqId);
  const shown = (seqs || []).filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  async function go() {
    if (!seq || !box || !withEmail.length) return; setBusy(true);
    try {
      const d = await enrollInSequence(withEmail.map(toSeqPerson), seq, box, profile?.id, strict); setRes(d);
      say(`${d.enrolled} enrolled in “${seq.name}”${d.skipped?.length ? `, ${d.skipped.length} skipped` : ""}${d.failed?.length ? `, ${d.failed.length} failed` : ""}.`, !d.failed?.length);
      onDone?.();
    } catch (e: any) { say(String(e?.message || e), false); }
    setBusy(false);
  }
  const name = (id?: string) => { const c = cands.find(x => x.id === id); return c ? fullName(c) : "—"; };
  return <Modal title={`Send ${cands.length} to an Apollo sequence`} onClose={onClose} wide>
    {err ? <div className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 mb-3">{err}</div> : seqs == null ? <p className="text-sm text-gray-400 py-6 text-center">Loading your Apollo sequences…</p> : res ? <div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">{[["Enrolled", res.enrolled, "text-green-700"], ["Skipped", res.skipped?.length || 0, "text-amber-700"], ["Failed", res.failed?.length || 0, "text-red-600"]].map(([l, n, cls]) => <div key={l as string} className="border rounded-lg py-2"><div className={`text-xl font-semibold ${cls}`}>{n as number}</div><div className="text-[10px] text-gray-400 uppercase">{l as string}</div></div>)}</div>
      {(res.skipped || []).length > 0 && <div className="text-xs mb-2"><div className="font-medium mb-1">Skipped</div>{res.skipped.map((s: any, i: number) => <div key={i} className="text-gray-500">{name(s.candidate_id)} — {s.reason}</div>)}</div>}
      {(res.failed || []).length > 0 && <div className="text-xs mb-2"><div className="font-medium mb-1">Failed</div>{res.failed.map((s: any, i: number) => <div key={i} className="text-red-600">{s.email} — {s.error}</div>)}</div>}
      <div className="flex justify-end"><Btn primary onClick={onClose}>Done</Btn></div>
    </div> : seqs.length === 0 ? <p className="text-sm text-gray-500 py-4">No sequences in Apollo yet. Create one in Apollo → Engage → Sequences, then come back.</p> : <div>
      <div className="flex gap-2 mb-2"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter sequences…" className="flex-1 px-3 py-1.5 border rounded-lg text-sm" /></div>
      <div className="border rounded-lg divide-y max-h-64 overflow-auto mb-3">{shown.map(s => <label key={s.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${seqId === s.id ? "bg-slate-50" : "hover:bg-gray-50"}`}>
        <input type="radio" checked={seqId === s.id} onChange={() => setSeqId(s.id)} />
        <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{s.name} {!s.active && <span className="text-[10px] text-amber-600 font-normal">(paused)</span>}{s.poor && <span className="text-[10px] text-red-500 font-normal"> · performing poorly</span>}</div><div className="text-[11px] text-gray-400">{s.num_steps || s.steps?.length || 0} steps · {s.delivered} delivered · {Math.round((s.open_rate || 0) * 100)}% open · {Math.round((s.reply_rate || 0) * 100)}% reply</div></div>
      </label>)}</div>
      <label className="block mb-3"><span className="text-xs text-gray-500">Send from</span><select value={box} onChange={e => setBox(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{boxes.length === 0 && <option value="">No active mailbox — connect one in Apollo</option>}{boxes.map(m => <option key={m.id} value={m.id}>{m.email}{m.default ? " (default)" : ""}</option>)}</select></label>
      <label className="flex items-center gap-2 text-xs text-gray-600 mb-3"><input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} className="w-4 h-4" /> Only send to Apollo-verified emails (safer for deliverability)</label>
      {seq && !seq.active && <p className="text-[11px] text-amber-700 mb-2">This sequence is paused in Apollo — people will be added but nothing sends until you activate it.</p>}
      {noEmail.length > 0 && <p className="text-[11px] text-gray-500 mb-2">{noEmail.length} without an email will be skipped: {noEmail.slice(0, 5).map(fullName).join(", ")}{noEmail.length > 5 ? "…" : ""}. Use Enrich to find emails first.</p>}
      <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={busy || !seq || !box || !withEmail.length} onClick={go}>{busy ? "Enrolling…" : `Enroll ${withEmail.length}`}</Btn></div>
    </div>}
  </Modal>;
}
