"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Assistant chat widget ---------------- */
export function ChatWidget() {
  const [open, setOpen] = useState(false); const [msgs, setMsgs] = useState<{ role: string; content: string }[]>([]); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  async function send() {
    if (!input.trim() || busy) return;
    const next = [...msgs, { role: "user", content: input }]; setMsgs(next); setInput(""); setBusy(true);
    try { const { data, error } = await supabase.functions.invoke("chat", { body: { messages: next } }); if (error) throw error; if ((data as any).error) throw new Error((data as any).error); setMsgs(m => [...m, { role: "assistant", content: (data as any).reply }]); }
    catch (e: any) { setMsgs(m => [...m, { role: "assistant", content: "Sorry — " + (e?.message || e) }]); }
    setBusy(false);
  }
  const suggestions = ["How many candidates are placed?", "Draft a follow-up to a candidate", "What should I do next on this pipeline?"];
  return <>
    {!open && <button onClick={() => setOpen(true)} title="Assistant" className="fixed bottom-5 right-5 w-12 h-12 rounded-full bg-slate-900 text-white shadow-lg z-50 flex items-center justify-center hover:bg-slate-800">✦</button>}
    {open && <div className="fixed bottom-5 right-5 w-80 h-[30rem] bg-white rounded-2xl shadow-2xl border flex flex-col z-50">
      <div className="flex justify-between items-center px-4 py-2.5 bg-slate-900 text-white rounded-t-2xl"><span className="text-sm font-medium">✦ Assistant</span><button onClick={() => setOpen(false)} className="text-slate-300 hover:text-white text-lg leading-none">×</button></div>
      <div className="flex-1 overflow-auto p-3 space-y-2">{msgs.length === 0 && <div className="text-xs text-gray-400 p-1 space-y-2"><p>Ask about your pipeline, draft messages, or get recruiting help.</p>{suggestions.map(s => <button key={s} onClick={() => setInput(s)} className="block text-left w-full px-2 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-[11px] text-gray-600">{s}</button>)}</div>}{msgs.map((m, i) => <div key={i} className={`text-sm px-3 py-2 rounded-2xl max-w-[88%] whitespace-pre-wrap ${m.role === "user" ? "bg-slate-800 text-white ml-auto" : "bg-gray-100 text-gray-800"}`}>{m.content}</div>)}{busy && <div className="text-xs text-gray-400 px-2">thinking…</div>}</div>
      <div className="p-2 border-t flex gap-2"><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask anything…" className="flex-1 px-3 py-2 border rounded-lg text-sm" /><button onClick={send} disabled={busy} className="bg-slate-800 text-white px-3 rounded-lg text-sm disabled:opacity-50">→</button></div>
    </div>}
  </>;
}
