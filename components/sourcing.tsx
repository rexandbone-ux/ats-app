"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

/* ---------------- Login ---------------- */
/* ---------------- Sourcing + Campaigns (Apollo / Clay / multichannel outreach) ---------------- */
export const REGIONS = [
  { l: "United States", v: "United States" },
  { l: "South Africa", v: "South Africa" },
  { l: "Philippines", v: "Philippines" },
];
export async function srcCall(path: string, body: any) {
  const { data: sess } = await supabase.auth.getSession();
  const tok = sess?.session?.access_token || SUPABASE_ANON_KEY;
  const r = await fetch(SUPABASE_URL + "/functions/v1/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + tok },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || ("Request failed (" + r.status + ")"));
  return d;
}
export function RegionChips({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  return <div className="flex gap-1.5 flex-wrap mt-1">{REGIONS.map(r =>
    <button key={r.v} type="button" onClick={() => onPick(value && value.includes(r.v) ? value : (value ? value + ", " : "") + r.v)}
      className={"text-[11px] px-2 py-1 rounded-full border " + (value && value.includes(r.v) ? "bg-slate-800 text-white border-slate-800" : "text-gray-600 hover:border-slate-400")}>{r.l}</button>)}
  </div>;
}

export function ClaudeSearch({ editable }: { editable: boolean }) {
  const EXAMPLES = ["Philippine CPAs with cell numbers I can call", "Find DONs in New Jersey and import the 10 best", "Who at CareOne is in nursing leadership?", "Show me everyone in my ATS with a phone number"];
  const [q, setQ] = useState("");
  const [log, setLog] = useState<any[]>([]);
  const [convo, setConvo] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [model, setModel] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);
  async function send(text?: string) {
    const msg = (text ?? q).trim();
    if (!msg || busy) return;
    setQ(""); setErr(null); setBusy(true);
    setLog(l => [...l, { who: "you", text: msg }]);
    const next = [...convo, { role: "user", content: msg }];
    try {
      const d = await srcCall("claude-agent", { messages: next });
      if (d.model) setModel(d.model);
      setConvo(d.messages || next);
      setLog(l => [...l, { who: "claude", text: d.reply || "(no reply)", steps: d.steps || [] }]);
    } catch (e: any) {
      const m = String(e.message || e);
      if (m.includes("ANTHROPIC_API_KEY")) setNeedsKey(true);
      setErr(m);
    }
    setBusy(false);
  }
  function reset() { setLog([]); setConvo([]); setErr(null); }
  return <div className="max-w-4xl">
    <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
      <div><h1 className="text-xl font-semibold">Claude Search</h1>
      <p className="text-xs text-gray-400">Ask for who you need. Claude searches Apollo, checks your ATS for duplicates, imports, and pulls cell numbers.</p></div>
      <div className="flex gap-2 items-center">
        {model && <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-600">{model}</span>}
        {log.length > 0 && <button onClick={reset} className="text-xs px-2.5 py-1.5 border rounded-lg">New search</button>}
      </div>
    </div>
    {needsKey && <div className="mb-4 text-xs px-3 py-2.5 rounded-lg bg-red-50 text-red-700">
      <b>Claude is not connected yet.</b> Add <code>ANTHROPIC_API_KEY</code> at Supabase &rarr; Settings &rarr; Edge Functions &rarr; Secrets. Nothing else to change; it works on the next message.
    </div>}
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="p-4 space-y-4 min-h-[320px] max-h-[560px] overflow-y-auto">
        {log.length === 0 && !busy && <div className="text-center py-10">
          <p className="text-sm text-gray-400 mb-3">Try one of these:</p>
          <div className="flex gap-1.5 flex-wrap justify-center">{EXAMPLES.map(x =>
            <button key={x} onClick={() => send(x)} className="text-[11px] px-2.5 py-1.5 rounded-full border text-gray-600 hover:border-slate-400">{x}</button>)}</div>
        </div>}
        {log.map((m, i) => m.who === "you"
          ? <div key={i} className="flex justify-end"><div className="bg-slate-800 text-white px-3.5 py-2 rounded-2xl rounded-br-sm text-sm max-w-[80%]">{m.text}</div></div>
          : <div key={i}>
              {(m.steps || []).length > 0 && <div className="mb-2 space-y-1">{m.steps.map((s: any, j: number) =>
                <div key={j} className="text-[11px] text-gray-400 flex gap-1.5 items-center">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">{s.tool}</span>
                  <span>{s.summary}</span>
                </div>)}</div>}
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</div>
            </div>)}
        {busy && <div className="text-xs text-gray-400">Searching...</div>}
        {err && !needsKey && <div className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600">{err}</div>}
        <div ref={endRef} />
      </div>
      {editable && <div className="border-t p-3 flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Philippine CPAs with cell numbers I can call" className="flex-1 px-3 py-2.5 border rounded-lg text-sm" />
        <button disabled={busy || !q.trim()} onClick={() => send()} className="bg-slate-800 text-white px-5 py-2.5 rounded-lg text-sm disabled:opacity-40">Send</button>
      </div>}
    </div>
    <p className="text-[11px] text-gray-400 mt-2">Searching is free. Claude asks before importing, since that spends Apollo credits and reveals real names and emails.</p>
  </div>;
}

export function Sourcing({ editable }: { editable: boolean }) {
  const SENIOR = ["owner","founder","c_suite","vp","head","director","manager","senior","entry"];
  const SIZES = [["1,10","1-10"],["11,50","11-50"],["51,200","51-200"],["201,500","201-500"],["501,1000","501-1K"],["1001,5000","1K-5K"],["5001,10000","5K+"]];
  const [mode, setMode] = useState<"people" | "companies">("people");
  const [jobs, setJobs] = useState<any[]>([]); const [jobId, setJobId] = useState("");
  const [camps, setCamps] = useState<any[]>([]); const [campId, setCampId] = useState("");
  const [saved, setSaved] = useState<any[]>([]);
  const [f, setF] = useState<any>({ titles: "", locations: "", seniorities: [], sizes: [], industries: "", domains: "", verified: true });
  const [cf, setCf] = useState<any>({ name: "", locations: "", sizes: [] });
  const [rows, setRows] = useState<any[]>([]); const [comps, setComps] = useState<any[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [pg, setPg] = useState(1); const [totPg, setTotPg] = useState(1); const [tot, setTot] = useState<number | null>(null);
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const loadSaved = useCallback(() => { srcCall("outreach-agent", { action: "list_searches" }).then(d => setSaved(d.searches || [])).catch(() => {}); }, []);
  useEffect(() => {
    supabase.from("jobs").select("id,title,location,status").eq("status", "open").order("created_at", { ascending: false }).then(({ data }) => setJobs(data || []));
    supabase.from("outreach_campaigns").select("id,name,status").eq("status", "active").order("created_at", { ascending: false }).then(({ data }) => setCamps(data || []));
    loadSaved();
  }, [loadSaved]);
  function pickJob(id: string) {
    setJobId(id); const j = jobs.find(x => x.id === id); if (!j) return;
    setF((v: any) => ({ ...v, titles: v.titles || String(j.title || "").split("(")[0].trim(), locations: v.locations || (j.location && j.location.toLowerCase() !== "remote" ? j.location : v.locations) }));
  }
  const csv = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
  const peoplePayload = (page: number) => ({ action: "search", page, per_page: 25,
    titles: csv(f.titles), locations: csv(f.locations), seniorities: f.seniorities,
    employee_ranges: f.sizes, industry_keywords: csv(f.industries), company_domains: csv(f.domains), verified_only: f.verified });
  async function search(page = 1) {
    if (!csv(f.titles).length && !csv(f.domains).length && !csv(f.industries).length) { setMsg({ t: "Add titles, companies, or industry keywords.", ok: false }); return; }
    setBusy("search"); setMsg(null); if (page === 1) setSel({});
    try {
      const d = await srcCall("outreach-agent", peoplePayload(page));
      setRows(d.people || []); setPg(d.page || page); setTotPg(d.total_pages || 1); setTot(d.total ?? 0);
      if (!(d.people || []).length) setMsg({ t: "No matches on this page.", ok: false });
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function searchComps(page = 1) {
    setBusy("search"); setMsg(null);
    try {
      const d = await srcCall("outreach-agent", { action: "company_search", page, per_page: 25, name: cf.name || undefined, locations: csv(cf.locations), employee_ranges: cf.sizes });
      setComps(d.companies || []); setPg(d.page || page); setTotPg(d.total_pages || 1); setTot(d.total ?? 0);
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  const selIds = Object.keys(sel).filter(k => sel[k]);
  async function importSel(toCampaign: boolean) {
    if (!selIds.length) { setMsg({ t: "Select people first.", ok: false }); return; }
    if (toCampaign && !campId) { setMsg({ t: "Pick a campaign.", ok: false }); return; }
    if (!confirm("Import " + selIds.length + " selected people? Reveals emails and uses up to " + selIds.length + " Apollo credits.")) return;
    setBusy("import"); setMsg(null);
    try {
      const d = await srcCall("outreach-agent", { action: "import", apollo_ids: selIds.slice(0, 25), job_id: jobId || null, campaign_id: toCampaign ? campId : null, source_label: "manual sourcing" });
      setMsg({ ok: true, t: (d.imported || 0) + " imported" + (d.dupes ? ", " + d.dupes + " already in ATS" : "") + (d.no_email ? ", " + d.no_email + " no email" : "") + (toCampaign ? ". Added to campaign; next run enrolls them." : ".") });
      setSel({});
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function saveSearch() {
    const name = prompt("Name this search:"); if (!name) return;
    try { await srcCall("outreach-agent", { action: "save_search", name, kind: "people", filters: f }); loadSaved(); setMsg({ ok: true, t: "Search saved." }); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  const toggleArr = (key: string, v: string) => setF((o: any) => ({ ...o, [key]: o[key].includes(v) ? o[key].filter((x: string) => x !== v) : [...o[key], v] }));
  const chipCls = (on: boolean) => "text-[11px] px-2 py-1 rounded-full border cursor-pointer " + (on ? "bg-slate-800 text-white border-slate-800" : "text-gray-600 hover:border-slate-400");
  return <div>
    <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
      <div><h1 className="text-xl font-semibold">Sourcing</h1><p className="text-xs text-gray-400">Apollo inside your ATS: search 275M people and 35M companies, cherry-pick, import, sequence.</p></div>
      <div className="flex rounded-lg border overflow-hidden text-sm">
        <button onClick={() => { setMode("people"); setTot(null); }} className={"px-4 py-1.5 " + (mode === "people" ? "bg-slate-800 text-white" : "bg-white")}>People</button>
        <button onClick={() => { setMode("companies"); setTot(null); }} className={"px-4 py-1.5 " + (mode === "companies" ? "bg-slate-800 text-white" : "bg-white")}>Companies</button>
      </div>
    </div>
    {saved.length > 0 && mode === "people" && <div className="flex gap-1.5 flex-wrap mb-3">
      {saved.map(s => <span key={s.id} className="text-[11px] px-2 py-1 rounded-full border bg-white flex items-center gap-1">
        <button onClick={() => { setF({ titles: "", locations: "", seniorities: [], sizes: [], industries: "", domains: "", verified: true, ...(s.filters || {}) }); }} className="hover:underline">{s.name}</button>
        <button onClick={async () => { await srcCall("outreach-agent", { action: "delete_search", id: s.id }); loadSaved(); }} className="text-gray-400 hover:text-red-500">\u00d7</button>
      </span>)}
    </div>}
    {mode === "people" && <div className="bg-white rounded-xl border p-4 mb-4">
      <div className="grid md:grid-cols-3 gap-3">
        <label className="block"><span className="text-xs text-gray-500">Fill for position</span>
          <select value={jobId} onChange={e => pickJob(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1"><option value="">Not linked</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select></label>
        <Field label="Job titles" value={f.titles} onChange={(e: any) => setF({ ...f, titles: e.target.value })} placeholder="director of nursing, ADON" />
        <Field label="Industry keywords" value={f.industries} onChange={(e: any) => setF({ ...f, industries: e.target.value })} placeholder="skilled nursing, home care" />
        <label className="block md:col-span-2"><span className="text-xs text-gray-500">Person locations</span>
          <input value={f.locations} onChange={e => setF({ ...f, locations: e.target.value })} placeholder="New Jersey, United States, South Africa, Philippines" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
          <RegionChips value={f.locations} onPick={(v: string) => setF({ ...f, locations: v })} />
        </label>
        <Field label="Company domains (optional)" value={f.domains} onChange={(e: any) => setF({ ...f, domains: e.target.value })} placeholder="care-one.com, rwjbh.org" />
      </div>
      <div className="mt-3"><span className="text-xs text-gray-500">Seniority</span><div className="flex gap-1.5 flex-wrap mt-1">{SENIOR.map(s => <button key={s} type="button" onClick={() => toggleArr("seniorities", s)} className={chipCls(f.seniorities.includes(s))}>{s.replace("_", "-")}</button>)}</div></div>
      <div className="mt-2"><span className="text-xs text-gray-500">Company size</span><div className="flex gap-1.5 flex-wrap mt-1">{SIZES.map(([v, l]) => <button key={v} type="button" onClick={() => toggleArr("sizes", v)} className={chipCls(f.sizes.includes(v))}>{l}</button>)}</div></div>
      <div className="flex gap-2 items-center flex-wrap mt-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.verified} onChange={e => setF({ ...f, verified: e.target.checked })} className="w-4 h-4" /> Verified emails only</label>
        <button disabled={!!busy} onClick={() => search(1)} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "search" ? "Searching..." : "Search"}</button>
        <button onClick={saveSearch} className="border px-3 py-2 rounded-lg text-sm">Save search</button>
        {tot !== null && <span className="text-xs text-gray-400">{tot.toLocaleString()} matches</span>}
      </div>
      {msg && <div className={"mt-3 text-xs px-3 py-2 rounded-lg " + (msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg.t}</div>}
    </div>}
    {mode === "people" && rows.length > 0 && <div className="bg-white rounded-xl border overflow-hidden">
      {editable && <div className="flex gap-2 items-center flex-wrap px-3 py-2 border-b bg-gray-50/60">
        <span className="text-xs text-gray-500">{selIds.length} selected</span>
        <button onClick={() => { const n: any = {}; rows.forEach(r => n[r.apollo_id] = true); setSel(n); }} className="text-xs px-2 py-1 border rounded-lg bg-white">Select page</button>
        <button onClick={() => setSel({})} className="text-xs px-2 py-1 border rounded-lg bg-white">Clear</button>
        <button disabled={!!busy || !selIds.length} onClick={() => importSel(false)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">{busy === "import" ? "Importing..." : "Import to ATS"}</button>
        <select value={campId} onChange={e => setCampId(e.target.value)} className="text-xs px-2 py-1.5 border rounded-lg bg-white"><option value="">Pick campaign...</option>{camps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button disabled={!!busy || !selIds.length} onClick={() => importSel(true)} className="text-xs px-2.5 py-1.5 border rounded-lg bg-white disabled:opacity-50">Import + add to campaign</button>
      </div>}
      <table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60"><th className="px-3 py-2 w-8"></th>{["Name", "Title", "Company", "Location", "Contact", ""].map((h, i) => <th key={i} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">{rows.map(r => <tr key={r.apollo_id} className="hover:bg-gray-50">
        <td className="px-3 py-2"><input type="checkbox" checked={!!sel[r.apollo_id]} onChange={e => setSel({ ...sel, [r.apollo_id]: e.target.checked })} className="w-4 h-4" /></td>
        <td className="px-3 py-2 font-medium">{r.name}</td>
        <td className="px-3 py-2 text-gray-500">{r.title}</td>
        <td className="px-3 py-2 text-gray-500">{r.company}{r.company_size ? <span className="text-[10px] text-gray-400 ml-1">({r.company_size})</span> : null}</td>
        <td className="px-3 py-2 text-gray-500 text-xs">{[r.city, r.state, r.country].filter(Boolean).join(", ")}</td>
        <td className="px-3 py-2"><span className={"px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 " + (r.has_email ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>@</span><span className={"px-1.5 py-0.5 rounded text-[10px] font-semibold " + (r.has_phone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>tel</span></td>
        <td className="px-3 py-2">{r.linkedin_url ? <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs hover:underline">in</a> : null}</td>
      </tr>)}</tbody></table>
      <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-gray-500">
        <button disabled={pg <= 1 || !!busy} onClick={() => search(pg - 1)} className="px-2 py-1 border rounded-lg disabled:opacity-40">Prev</button>
        <span>Page {pg} of {totPg.toLocaleString()}</span>
        <button disabled={pg >= totPg || !!busy} onClick={() => search(pg + 1)} className="px-2 py-1 border rounded-lg disabled:opacity-40">Next</button>
        <span className="text-gray-400">Names unblur on import. Import reveals emails only for people you pick.</span>
      </div>
    </div>}
    {mode === "companies" && <div className="bg-white rounded-xl border p-4 mb-4">
      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Company name" value={cf.name} onChange={(e: any) => setCf({ ...cf, name: e.target.value })} placeholder="CareOne" />
        <label className="block"><span className="text-xs text-gray-500">Locations</span>
          <input value={cf.locations} onChange={e => setCf({ ...cf, locations: e.target.value })} placeholder="New Jersey" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
          <RegionChips value={cf.locations} onPick={(v: string) => setCf({ ...cf, locations: v })} />
        </label>
        <div><span className="text-xs text-gray-500">Size</span><div className="flex gap-1.5 flex-wrap mt-1">{SIZES.map(([v, l]) => <button key={v} type="button" onClick={() => setCf((o: any) => ({ ...o, sizes: o.sizes.includes(v) ? o.sizes.filter((x: string) => x !== v) : [...o.sizes, v] }))} className={chipCls(cf.sizes.includes(v))}>{l}</button>)}</div></div>
      </div>
      <div className="flex gap-2 items-center mt-3">
        <button disabled={!!busy} onClick={() => searchComps(1)} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "search" ? "Searching..." : "Search companies"}</button>
        {tot !== null && <span className="text-xs text-gray-400">{tot.toLocaleString()} matches</span>}
      </div>
      {msg && <div className={"mt-3 text-xs px-3 py-2 rounded-lg " + (msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg.t}</div>}
    </div>}
    {mode === "companies" && comps.length > 0 && <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60">{["Company", "Industry", "Size", "Location", "", ""].map((h, i) => <th key={i} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">{comps.map(o => <tr key={o.apollo_org_id} className="hover:bg-gray-50">
        <td className="px-3 py-2 font-medium">{o.name}</td>
        <td className="px-3 py-2 text-gray-500">{o.industry}</td>
        <td className="px-3 py-2 text-gray-500">{o.size || ""}</td>
        <td className="px-3 py-2 text-gray-500 text-xs">{[o.city, o.state, o.country].filter(Boolean).join(", ")}</td>
        <td className="px-3 py-2">{o.linkedin_url ? <a href={o.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs hover:underline">in</a> : null}</td>
        <td className="px-3 py-2"><button onClick={() => { setMode("people"); setF((v: any) => ({ ...v, domains: o.domain || "", titles: v.titles, industries: o.domain ? "" : o.name })); setTot(null); setRows([]); }} className="text-xs px-2 py-1 border rounded-lg">Find people</button></td>
      </tr>)}</tbody></table>
      <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-gray-500">
        <button disabled={pg <= 1 || !!busy} onClick={() => searchComps(pg - 1)} className="px-2 py-1 border rounded-lg disabled:opacity-40">Prev</button>
        <span>Page {pg} of {totPg.toLocaleString()}</span>
        <button disabled={pg >= totPg || !!busy} onClick={() => searchComps(pg + 1)} className="px-2 py-1 border rounded-lg disabled:opacity-40">Next</button>
      </div>
    </div>}
  </div>;
}

export function Campaigns({ editable }: { editable: boolean }) {
  const [data, setData] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [prev, setPrev] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [f, setF] = useState<any>({ name: "", job_id: "", titles: "", locations: "", limit: 10, verified: true, clay: false, auto: true });
  const load = useCallback(async () => {
    try {
      const h = await srcCall("outreach-agent", { action: "health" });
      const l = await srcCall("outreach-agent", { action: "list" });
      setData({ health: h, campaigns: l.campaigns || [] });
    } catch (e: any) { setData({ health: {}, campaigns: [] }); setMsg({ t: e.message, ok: false }); }
  }, []);
  useEffect(() => {
    load();
    supabase.from("jobs").select("id,title,location,status").eq("status", "open").order("created_at", { ascending: false }).then(({ data }) => setJobs(data || []));
  }, [load]);
  function pickJob(id: string) {
    const j = jobs.find(x => x.id === id);
    setF((prevF: any) => ({ ...prevF, job_id: id,
      name: prevF.name || (j ? j.title : ""),
      titles: prevF.titles || (j ? String(j.title || "").split("(")[0].trim() : ""),
      locations: prevF.locations || (j && j.location && j.location.toLowerCase() !== "remote" ? j.location : "") }));
  }
  const payload = () => ({ name: f.name.trim(), job_id: f.job_id || null,
    titles: f.titles.split(",").map((s: string) => s.trim()).filter(Boolean),
    locations: f.locations.split(",").map((s: string) => s.trim()).filter(Boolean),
    verified_only: f.verified, enrich_with_clay: f.clay, auto_enroll: f.auto,
    daily_source_limit: Number(f.limit) || 10 });
  async function preview() {
    setBusy("preview"); setMsg(null); setPrev(null);
    try { setPrev(await srcCall("outreach-agent", { action: "preview", ...payload() })); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function create() {
    const pl = payload();
    if (!pl.name) { setMsg({ t: "Give the campaign a name.", ok: false }); return; }
    if (!pl.titles.length) { setMsg({ t: "Add at least one job title.", ok: false }); return; }
    setBusy("create"); setMsg(null);
    try {
      await srcCall("outreach-agent", { action: "create", ...pl });
      setMsg({ t: "Campaign created. Sequence written; sourcing runs hourly 9-5 weekdays.", ok: true });
      setF({ name: "", job_id: "", titles: "", locations: "", limit: 10, verified: true, clay: false, auto: true });
      setPrev(null); load();
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function run(id?: string) {
    setBusy("run"); setMsg(null);
    try {
      const d = await srcCall("outreach-agent", { action: "run", campaign_id: id });
      const r = (d.results && d.results[0]) || {};
      const src = r.source || {}; const enr = r.enroll || {};
      setMsg({ ok: true, t: "Sourced " + (src.sourced || 0) + ", enrolled " + (enr.enrolled || 0) + ", emails sent " + ((d.send && d.send.emails_sent) || 0) + "." + (src.error ? " " + src.error : "") + (src.note ? " " + src.note : "") });
      load();
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function toggle(c: any) {
    try { await srcCall("outreach-agent", { action: c.status === "active" ? "pause" : "resume", campaign_id: c.id }); load(); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this campaign? People already sourced stay in your ATS.")) return;
    try { await srcCall("outreach-agent", { action: "delete", campaign_id: id }); setDetail(null); load(); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  async function showPeople(c: any) {
    const { data: rows } = await supabase.from("campaign_members")
      .select("id,stage,note,sourced_at,candidates(id,first_name,last_name,email,phone,current_title,current_company,last_outreach_at)")
      .eq("campaign_id", c.id).order("sourced_at", { ascending: false }).limit(200);
    setDetail({ campaign: c, rows: rows || [] });
  }
  if (!data) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const h = data.health || {};
  const chip = (on: boolean) => on ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600";
  return <div>
    <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
      <div><h1 className="text-xl font-semibold">Campaigns</h1>
      <p className="text-xs text-gray-400">Automated pipeline: Apollo sourcing, Clay enrichment, then multichannel outreach (email + text auto-send, calls become tasks). Runs hourly, 9-5 weekdays.</p></div>
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + chip(!!h.apollo_search)}>Apollo</span>
        <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + chip(!!h.clay)}>Clay</span>
        <span className={"px-2 py-0.5 rounded-full text-[10px] font-semibold " + chip(!!h.resend)}>Email</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600">{h.active_enrollments || 0} in sequence</span>
      </div>
    </div>
    {h.resend === false && <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600"><b>Emails cannot send yet.</b> Add RESEND_API_KEY in Supabase secrets. Sourcing, texting, and call tasks still work; emails queue and go out once configured.</div>}
    {h.resend && h.sandbox_from && <div className="mb-4 text-xs px-3 py-2 rounded-lg bg-yellow-50 text-yellow-800"><b>Sandbox sender.</b> {h.from_email} only delivers to your own inbox.</div>}
    {editable && <div className="bg-white rounded-xl border p-4 mb-4">
      <h3 className="text-sm font-medium mb-3">New campaign</h3>
      <div className="grid md:grid-cols-3 gap-3">
        <label className="block"><span className="text-xs text-gray-500">Fill for position</span>
          <select value={f.job_id} onChange={e => pickJob(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">
            <option value="">Not linked</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select></label>
        <Field label="Campaign name" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} placeholder="DON North Jersey" />
        <Field label="Job titles (comma separated)" value={f.titles} onChange={(e: any) => setF({ ...f, titles: e.target.value })} placeholder="director of nursing, ADON" />
        <label className="block md:col-span-2"><span className="text-xs text-gray-500">Locations</span>
          <input value={f.locations} onChange={e => setF({ ...f, locations: e.target.value })} placeholder="New Jersey / United States / South Africa / Philippines" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
          <RegionChips value={f.locations} onPick={(v: string) => setF({ ...f, locations: v })} />
        </label>
        <Field label="People per day" type="number" value={f.limit} onChange={(e: any) => setF({ ...f, limit: e.target.value })} />
      </div>
      <div className="flex items-center gap-4 flex-wrap mb-3 mt-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.verified} onChange={e => setF({ ...f, verified: e.target.checked })} className="w-4 h-4" /> Verified emails only</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.clay} onChange={e => setF({ ...f, clay: e.target.checked })} className="w-4 h-4" /> Enrich via Clay first</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.auto} onChange={e => setF({ ...f, auto: e.target.checked })} className="w-4 h-4" /> Auto-enroll into sequence</label>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button disabled={!!busy} onClick={preview} className="border px-3 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "preview" ? "Checking..." : "Preview matches (free)"}</button>
        <button disabled={!!busy} onClick={create} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "create" ? "Creating..." : "Create campaign"}</button>
        <span className="text-xs text-gray-400">Titles + location do the work. Keywords usually narrow to zero.</span>
      </div>
      {msg && <div className={"mt-3 text-xs px-3 py-2 rounded-lg " + (msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg.t}</div>}
      {prev && <div className="mt-3">
        <div className="text-xs text-green-700 mb-2"><b>{(prev.total || 0).toLocaleString()}</b> people match. No credits used.</div>
        <table className="w-full text-sm"><thead><tr className="border-b text-left">{["Name", "Title", "Company"].map(x => <th key={x} className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">{x}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{(prev.sample || []).map((pp: any, i: number) => <tr key={i}><td className="px-2 py-1.5">{pp.name}</td><td className="px-2 py-1.5 text-gray-500">{pp.title}</td><td className="px-2 py-1.5 text-gray-500">{pp.company}</td></tr>)}</tbody></table>
      </div>}
    </div>}
    <div className="space-y-3">
      {(data.campaigns || []).length === 0 && <p className="text-sm text-gray-400">No campaigns yet.</p>}
      {(data.campaigns || []).map((c: any) => {
        const fn = c.funnel || {};
        return <div key={c.id} className="bg-white rounded-xl border p-4">
          <div className="flex justify-between items-start flex-wrap gap-2">
            <div>
              <span className="font-semibold mr-2">{c.name}</span>
              <span className={"text-[10px] px-2 py-0.5 rounded-full " + (c.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{c.status}</span>
              <div className="text-[11px] text-gray-400 mt-1">{c.jobs ? c.jobs.title + " / " : ""}{(c.titles || []).join(", ")}{c.locations && c.locations.length ? " / " + c.locations.join(", ") : ""} / {c.daily_source_limit} per day / last run {c.last_run_at ? new Date(c.last_run_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never"}</div>
            </div>
            {editable && <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => showPeople(c)} className="text-xs px-2.5 py-1.5 border rounded-lg">People</button>
              <button disabled={!!busy} onClick={() => run(c.id)} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "run" ? "Running..." : "Run now"}</button>
              <button onClick={() => toggle(c)} className="text-xs px-2.5 py-1.5 border rounded-lg">{c.status === "active" ? "Pause" : "Resume"}</button>
              <button onClick={() => remove(c.id)} className="text-xs px-2.5 py-1.5 border rounded-lg text-red-600">Delete</button>
            </div>}
          </div>
          <div className="flex mt-3 rounded-lg border overflow-hidden">
            {["sourced", "enriching", "enriched", "enrolled", "skipped"].map(k =>
              <div key={k} className="flex-1 text-center py-2 border-r last:border-r-0 bg-gray-50/60">
                <div className="text-lg font-semibold">{fn[k] || 0}</div>
                <div className="text-[9px] text-gray-400 uppercase tracking-wide">{k}</div>
              </div>)}
          </div>
        </div>;
      })}
    </div>
    {detail && <div className="bg-white rounded-xl border p-4 mt-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-medium">{detail.campaign.name} ({detail.rows.length} people)</h3>
        <button onClick={() => setDetail(null)} className="text-xs px-2 py-1 border rounded-lg">Close</button>
      </div>
      <table className="w-full text-sm"><thead><tr className="border-b text-left">{["Name", "Title", "Company", "Email", "Phone", "Stage"].map(x => <th key={x} className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">{x}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">{detail.rows.map((m: any) => {
        const cc = m.candidates || {};
        return <tr key={m.id} className="hover:bg-gray-50">
          <td className="px-2 py-1.5 font-medium">{cc.first_name} {cc.last_name}</td>
          <td className="px-2 py-1.5 text-gray-500">{cc.current_title || ""}</td>
          <td className="px-2 py-1.5 text-gray-500">{cc.current_company || ""}</td>
          <td className="px-2 py-1.5 text-gray-500 text-xs">{cc.email || ""}</td>
          <td className="px-2 py-1.5 text-gray-500 text-xs">{cc.phone || "-"}</td>
          <td className="px-2 py-1.5"><span className={"text-[10px] px-2 py-0.5 rounded-full " + (m.stage === "enrolled" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{m.stage}</span>{m.note ? <span className="text-[10px] text-gray-400 ml-1">{m.note}</span> : null}</td>
        </tr>;
      })}</tbody></table>
    </div>}
  </div>;
}
