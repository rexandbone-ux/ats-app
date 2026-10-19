"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { B, Modal, Field, fn, useToast, Btn, Select } from "@/lib/ui";
import { closeStatus, outreachHealth, anthropicStatus, apolloSeqHealth, appKeys, closeSyncNow, closeRegisterWebhook } from "@/lib/comms";

/* ---------------- Settings: users & roles ---------------- */
export function Settings() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<any[]>([]); const [invite, setInvite] = useState(false); const [clients, setClients] = useState<any[]>([]);
  const load = useCallback(async () => { const { data } = await supabase.from("profiles").select("id,email,first_name,last_name,role,is_active,client_id").order("created_at", { ascending: true }); setUsers(data || []); }, []);
  useEffect(() => { load(); supabase.from("clients").select("id,company_name").order("company_name").then(({ data }) => setClients(data || [])); }, [load]);
  const ROLES: Role[] = ["super_admin", "admin", "recruiter", "hiring_manager", "client_user", "candidate_user"];
  async function setRole(id: string, role: string) { await supabase.from("profiles").update({ role }).eq("id", id); load(); }
  async function setClient(id: string, client_id: string) { await supabase.from("profiles").update({ client_id: client_id || null }).eq("id", id); load(); }
  async function toggle(id: string, active: boolean) { await supabase.from("profiles").update({ is_active: !active }).eq("id", id); load(); }
  return <div><div className="flex justify-between items-center mb-4"><h1 className="text-xl font-semibold">Team &amp; access</h1><Btn primary onClick={() => setInvite(true)}>+ Add employee</Btn></div>
    <div className="bg-white rounded-xl border overflow-hidden"><table className="w-full text-sm"><thead><tr className="border-b text-left">{["Name", "Email", "Role", "Active"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{users.map(u => <tr key={u.id}><td className="px-3 py-2 font-medium">{u.first_name} {u.last_name}</td><td className="px-3 py-2 text-gray-500 text-xs">{u.email}</td><td className="px-3 py-2"><div className="flex items-center gap-2"><select value={u.role} disabled={u.id === profile?.id} onChange={e => setRole(u.id, e.target.value)} className="px-2 py-1 border rounded text-xs">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>{u.role === "client_user" && <select value={u.client_id || ""} onChange={e => setClient(u.id, e.target.value)} className="px-2 py-1 border rounded text-xs"><option value="">— client —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>}</div></td><td className="px-3 py-2"><button onClick={() => toggle(u.id, u.is_active)} disabled={u.id === profile?.id} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{u.is_active ? "Active" : "Disabled"}</button></td></tr>)}</tbody></table></div>
    <p className="text-[11px] text-gray-400 mt-3">Roles control which sections each employee sees. Recruiters get full candidate/job/client access; hiring managers see jobs &amp; interviews; clients and candidates get limited portals.</p>
    <Integrations />
    {invite && <InviteUser onClose={() => setInvite(false)} onSaved={() => { setInvite(false); load(); }} />}
  </div>;
}

/* ---------------- Integrations: keys + live status ----------------
   Keys go through the app-keys edge function → public.app_secrets (RLS, service-role only).
   Values are never sent back to the browser — only a 4-char prefix and length.            */
export function Integrations() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "super_admin" || profile?.role === "admin";
  const [st, setSt] = useState<any>(null); const [busy, setBusy] = useState(false); const [desktop, setDesktop] = useState(false);
  const [keys, setKeys] = useState<any[]>([]); const [draft, setDraft] = useState<Record<string, string>>({}); const [keyMsg, setKeyMsg] = useState<Record<string, { ok: boolean; t: string }>>({}); const [saving, setSaving] = useState("");
  const [closeMsg, setCloseMsg] = useState("");
  useEffect(() => { try { setDesktop(localStorage.getItem("ss_close_desktop") === "1"); } catch { /* */ } }, []);
  const loadKeys = useCallback(async () => { if (!isAdmin) return; try { const d: any = await appKeys({ action: "status" }); setKeys(d.providers || []); } catch (e: any) { setKeyMsg({ _: { ok: false, t: String(e?.message || e) } }); } }, [isAdmin]);
  async function check() {
    setBusy(true);
    const [close, oh, ai, seq] = await Promise.all([closeStatus(), outreachHealth(), anthropicStatus(), apolloSeqHealth().catch((e: any) => ({ error: String(e?.message || e) }))]);
    setSt({ close, oh, ai, seq }); setBusy(false);
  }
  useEffect(() => { check(); loadKeys(); }, [loadKeys]);
  async function saveKey(id: string, force = false): Promise<void> {
    const value = (draft[id] || "").trim(); if (!value) return; setSaving(id);
    try { const d: any = await appKeys({ action: "save", name: id, value, force }); setKeyMsg(m => ({ ...m, [id]: { ok: true, t: d.detail || "Saved." } })); setDraft(x => ({ ...x, [id]: "" })); await loadKeys(); check(); }
    catch (e: any) {
      const t = String(e?.message || e);
      if (/no credit/i.test(t) && confirm(t + "\n\nSave the key anyway?")) { setSaving(""); await saveKey(id, true); return; }
      setKeyMsg(m => ({ ...m, [id]: { ok: false, t } }));
    }
    setSaving("");
  }
  async function testKey(id: string) { setSaving(id); try { const d: any = await appKeys({ action: "test", name: id }); setKeyMsg(m => ({ ...m, [id]: { ok: true, t: d.detail } })); } catch (e: any) { setKeyMsg(m => ({ ...m, [id]: { ok: false, t: String(e?.message || e) } })); } setSaving(""); }
  async function closeTool(kind: "sync" | "webhook") {
    setCloseMsg(kind === "sync" ? "Pulling calls & texts from Close…" : "Registering webhook…");
    try { const d: any = kind === "sync" ? await closeSyncNow() : await closeRegisterWebhook(); setCloseMsg(kind === "sync" ? `Synced: ${d.calls_logged ?? 0} calls, ${d.sms_logged ?? 0} texts logged (${d.scanned ?? 0} scanned since ${d.since ? new Date(d.since).toLocaleString() : "—"}).` : `Webhook ${d.note || "registered"} — calls and texts now log to timelines in real time.`); check(); }
    catch (e: any) { setCloseMsg("Close: " + (e?.message || e)); }
  }
  const Row = ({ name, ok, detail, fix }: { name: string; ok: boolean | null; detail: string; fix?: string }) => <div className="flex items-start gap-3 py-2.5 border-b border-gray-50"><span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${ok == null ? "bg-gray-300" : ok ? "bg-green-500" : "bg-red-500"}`} /><div className="flex-1 min-w-0"><div className="text-sm font-medium">{name}</div><div className="text-xs text-gray-500 break-words">{detail}</div>{!ok && fix && <div className="text-[11px] text-amber-700 mt-0.5">Fix: {fix}</div>}</div></div>;
  const h = st?.oh || {}; const seq = st?.seq || {}; const KEYFIX = isAdmin ? "Paste the key under API keys below." : "Ask an admin to paste the key in Settings → Integrations.";
  return <div className="mt-6 space-y-4">
    <div className="bg-white rounded-xl border p-4"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-medium">Integrations</h3><Btn small disabled={busy} onClick={check}>{busy ? "Checking…" : "Re-check"}</Btn></div>
    {!st ? <p className="text-xs text-gray-400">Checking…</p> : <div>
      <Row name="Claude AI (screening, search, drafts)" ok={st.ai.ok} detail={st.ai.detail} fix={"Add credits at console.anthropic.com. " + KEYFIX} />
      <Row name="Close (calling, texting, lead sync)" ok={st.close.ok} detail={st.close.detail} fix={"Create a key in Close → Settings → Developer → API Keys. " + KEYFIX} />
      <Row name="Apollo search + import" ok={h.error ? false : !!h.apollo_search} detail={h.error || (h.apollo_search ? "Search + import ready" : "Not configured")} fix={KEYFIX} />
      <Row name="Apollo sequences (cold email)" ok={seq.error ? false : !!seq.ok} detail={seq.error || (seq.ok ? `${seq.sequences ?? 0} sequences · ${(seq.mailboxes || []).filter((m: any) => m.active).length} active mailbox(es): ${(seq.mailboxes || []).map((m: any) => m.email).join(", ") || "none"}` : "—")} fix="Sequences need a MASTER key: Apollo → Settings → Integrations → API → create key → tick “Set as master key”, then paste it below." />
      <Row name="Clay (enrichment)" ok={h.error ? null : !!h.clay} detail={h.error ? "—" : h.clay ? "Connected" : "Optional — not configured"} />
      <Row name="Email sending (Resend)" ok={h.error ? null : !!h.resend} detail={h.error ? "—" : h.resend ? `Sending from ${h.from_email || "configured sender"}${h.sandbox_from ? " (sandbox: only delivers to your own inbox)" : ""}` : "Not configured — emails save to history but don't send"} fix={"Add a Resend key and a verified sender domain. " + KEYFIX} />
    </div>}</div>

    <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-1">Close tools</h3>
      <p className="text-[11px] text-gray-400 mb-2">☎ Call creates/opens the lead in Close with the number copied — click dial in Close. Calls, recordings and texts sync back to the candidate timeline (webhook = real time; sync = catch-up).</p>
      <div className="flex gap-2 flex-wrap items-center"><Btn small onClick={() => closeTool("webhook")}>Register webhook</Btn><Btn small onClick={() => closeTool("sync")}>Sync calls &amp; texts now</Btn>
        {st?.close?.ok && st.close.detail && <span className="text-[11px] text-gray-400">{st.close.detail}</span>}</div>
      {closeMsg && <p className="text-xs text-gray-600 mt-2">{closeMsg}</p>}
      <label className="flex items-center gap-2 text-xs text-gray-600 mt-3"><input type="checkbox" checked={desktop} onChange={e => { setDesktop(e.target.checked); try { localStorage.setItem("ss_close_desktop", e.target.checked ? "1" : "0"); } catch { /* */ } }} className="w-4 h-4" /> Open calls in the Close desktop app (closeio://) instead of the browser</label>
    </div>

    {isAdmin && <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-1">API keys</h3>
      <p className="text-[11px] text-gray-400 mb-3">Each key is tested live before it&rsquo;s saved. Stored server-side only — this page never sees the full value again.</p>
      {keyMsg._ && <p className="text-xs text-red-600 mb-2">{keyMsg._.t}</p>}
      <div className="divide-y divide-gray-50">{keys.map(k => <div key={k.id} className="py-2.5">
        <div className="flex items-center gap-2 flex-wrap"><span className={`w-2 h-2 rounded-full ${k.set ? "bg-green-500" : "bg-gray-300"}`} /><span className="text-sm font-medium">{k.label}</span><span className="text-[11px] text-gray-400">{k.set ? `${k.prefix}… (${k.len} chars, ${k.source === "env" ? "from Supabase secrets" : "saved here"})` : "not set"}</span><a href={k.where} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline ml-auto">get key ↗</a></div>
        <div className="text-[11px] text-gray-400 mb-1.5 ml-4">{k.hint}</div>
        <div className="flex gap-2 ml-4"><input type="password" autoComplete="off" value={draft[k.id] || ""} onChange={e => setDraft(x => ({ ...x, [k.id]: e.target.value }))} onKeyDown={e => e.key === "Enter" && saveKey(k.id)} placeholder={k.set ? "Paste a new key to replace" : "Paste key"} className="flex-1 px-2.5 py-1.5 border rounded-lg text-xs font-mono" /><Btn small primary disabled={saving === k.id || !(draft[k.id] || "").trim()} onClick={() => saveKey(k.id)}>{saving === k.id ? "Testing…" : "Test & save"}</Btn>{k.set && <Btn small disabled={saving === k.id} onClick={() => testKey(k.id)}>Test</Btn>}</div>
        {keyMsg[k.id] && <div className={`text-[11px] mt-1 ml-4 ${keyMsg[k.id].ok ? "text-green-700" : "text-red-600"}`}>{keyMsg[k.id].t}</div>}
      </div>)}</div>
    </div>}
  </div>;
}

export function InviteUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ email: "", first_name: "", last_name: "", role: "recruiter", password: "" }); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const ROLES: Role[] = ["admin", "recruiter", "hiring_manager", "client_user", "candidate_user"];
  async function save() {
    if (!f.email || !f.password) { setMsg("Email and temporary password required"); return; }
    setBusy(true); setMsg("");
    try { const { data, error } = await supabase.functions.invoke("admin-create-user", { body: f }); if (error) throw error; if ((data as any)?.error) throw new Error((data as any).error); onSaved(); }
    catch (e: any) { setMsg("Could not create user: " + (e?.message || e) + ". (The user-invite function may not be deployed yet.)"); }
    setBusy(false);
  }
  return <Modal title="Add employee" onClose={onClose}><Field label="Email *" value={f.email} onChange={(e: any) => setF({ ...f, email: e.target.value })} /><Field label="First name" value={f.first_name} onChange={(e: any) => setF({ ...f, first_name: e.target.value })} /><Field label="Last name" value={f.last_name} onChange={(e: any) => setF({ ...f, last_name: e.target.value })} /><label className="block mb-3"><span className="text-xs text-gray-500">Role</span><select value={f.role} onChange={(e: any) => setF({ ...f, role: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label><Field label="Temporary password *" type="text" value={f.password} onChange={(e: any) => setF({ ...f, password: e.target.value })} />{msg && <p className="text-xs text-red-500 mb-2">{msg}</p>}<button disabled={busy} onClick={save} className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm">{busy ? "Creating..." : "Create login"}</button></Modal>;
}
