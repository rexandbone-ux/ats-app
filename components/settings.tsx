"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { B, Modal, Field, fn, useToast, Btn, Select } from "@/lib/ui";
import { closeStatus, outreachHealth, anthropicStatus } from "@/lib/comms";

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

/* ---------------- Integrations status ---------------- */
export function Integrations() {
  const [st, setSt] = useState<any>(null); const [busy, setBusy] = useState(false); const [desktop, setDesktop] = useState(false);
  useEffect(() => { try { setDesktop(localStorage.getItem("ss_close_desktop") === "1"); } catch { /* */ } }, []);
  async function check() { setBusy(true); const [close, oh, ai] = await Promise.all([closeStatus(), outreachHealth(), anthropicStatus()]); setSt({ close, oh, ai }); setBusy(false); }
  useEffect(() => { check(); }, []);
  const Row = ({ name, ok, detail, fix }: { name: string; ok: boolean | null; detail: string; fix?: string }) => <div className="flex items-start gap-3 py-2.5 border-b border-gray-50"><span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${ok == null ? "bg-gray-300" : ok ? "bg-green-500" : "bg-red-500"}`} /><div className="flex-1 min-w-0"><div className="text-sm font-medium">{name}</div><div className="text-xs text-gray-500 break-words">{detail}</div>{!ok && fix && <div className="text-[11px] text-amber-700 mt-0.5">Fix: {fix}</div>}</div></div>;
  const h = st?.oh || {};
  return <div className="bg-white rounded-xl border p-4 mt-6"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-medium">Integrations</h3><Btn small disabled={busy} onClick={check}>{busy ? "Checking…" : "Re-check"}</Btn></div>
    {!st ? <p className="text-xs text-gray-400">Checking…</p> : <div>
      <Row name="Claude AI (screening, search, drafts)" ok={st.ai.ok} detail={st.ai.detail} fix="Add credits / auto-reload at console.anthropic.com, and make sure ANTHROPIC_API_KEY is set in Supabase → Edge Functions → Secrets." />
      <Row name="Close (calling & texting)" ok={st.close.ok} detail={st.close.detail} fix="Create an API key in Close → Settings → Developer, then add it as CLOSE_API_KEY in Supabase → Edge Functions → Secrets." />
      <Row name="Apollo (sourcing)" ok={h.error ? false : !!h.apollo_search} detail={h.error || (h.apollo_search ? "Search + import ready" : "Not configured")} fix="Add APOLLO_API_KEY in Supabase secrets." />
      <Row name="Clay (enrichment)" ok={h.error ? null : !!h.clay} detail={h.error ? "—" : h.clay ? "Connected" : "Optional — not configured"} />
      <Row name="Email sending (Resend)" ok={h.error ? null : !!h.resend} detail={h.error ? "—" : h.resend ? `Sending from ${h.from_email || "configured sender"}${h.sandbox_from ? " (sandbox: only delivers to your own inbox)" : ""}` : "Not configured — emails save to history but don't send"} fix="Add RESEND_API_KEY and a verified sender domain in Supabase secrets. Until then, use the Open in Gmail button." />
      <label className="flex items-center gap-2 text-xs text-gray-600 mt-3"><input type="checkbox" checked={desktop} onChange={e => { setDesktop(e.target.checked); try { localStorage.setItem("ss_close_desktop", e.target.checked ? "1" : "0"); } catch { /* */ } }} className="w-4 h-4" /> Open calls in the Close desktop app (closeio://) instead of the browser</label>
      <p className="text-[11px] text-gray-400 mt-2">How calling works: the ☎ Call button creates/opens the lead in Close with the number copied to your clipboard — click dial in Close. Calls and recordings log in Close and sync back to the candidate timeline.</p>
    </div>}</div>;
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
