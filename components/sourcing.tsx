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

export const AUTONOMY: { v: string; l: string; d: string }[] = [
  { v: "auto", l: "Fully automatic", d: "Sources, shortlists and sequences on its own. Review is optional feedback." },
  { v: "review_before_shortlist", l: "Review before shortlist", d: "New people wait in your queue; only approved people reach the job shortlist and outreach." },
  { v: "review_before_sequence", l: "Review before sequencing", d: "People are shortlisted (and enriched) automatically; only approved people get emailed." },
];
const FIELD_LABELS: Record<string, string> = {
  titles: "Titles", locations: "Locations", seniorities: "Seniority", employee_ranges: "Company size", industry_keywords: "Industries",
  company_domains: "Companies", exclude_titles: "Skip titles", exclude_companies: "Skip companies", exclude_locations: "Skip locations",
  keywords: "Keywords", verified_only: "Verified only", daily_source_limit: "Per day",
};

function ChangeList({ changes }: { changes: any[] }) {
  if (!changes?.length) return <div className="text-[11px] text-gray-400">No filter changes.</div>;
  return <div className="space-y-1">{changes.map((ch, i) => <div key={i} className="text-[11px] flex gap-1.5 flex-wrap items-center">
    <span className="text-gray-500 w-24 shrink-0">{FIELD_LABELS[ch.field] || ch.field}</span>
    {(ch.added || []).map((x: string) => <span key={"a" + x} className="px-1.5 py-0.5 rounded bg-green-50 text-green-700">+ {x}</span>)}
    {(ch.removed || []).map((x: string) => <span key={"r" + x} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 line-through">{x}</span>)}
    {"to" in ch && <span className="text-gray-600">{String(ch.from ?? "none")} &rarr; <b>{String(ch.to ?? "none")}</b></span>}
  </div>)}</div>;
}

function ReviewQueue({ campaign, editable, onChange }: { campaign: any; editable: boolean; onChange: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [rej, setRej] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [ex, setEx] = useState<any>({ company: false, title: false, location: false });
  const [busy, setBusy] = useState(""); const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("campaign_members")
      .select("id,stage,sourced_at,candidates(id,first_name,last_name,current_title,current_company,city,state,country,linkedin_url,ai_match_score,ai_match_reason)")
      .eq("campaign_id", campaign.id).eq("review_status", "pending").order("sourced_at", { ascending: false }).limit(100);
    setRows(data || []);
  }, [campaign.id]);
  useEffect(() => { load(); }, [load]);
  async function decide(ids: string[], decision: "approve" | "reject") {
    setBusy(ids.length > 1 ? "bulk" : ids[0]); setMsg(null);
    try {
      const d = await srcCall("outreach-agent", { action: "review", campaign_id: campaign.id, member_ids: ids, decision,
        reason: decision === "reject" ? reason.trim() || null : null, exclude: decision === "reject" ? ex : null });
      const skipped = decision === "reject" ? [ex.company && "company", ex.title && "title", ex.location && "location"].filter(Boolean) : [];
      setMsg({ ok: true, t: (decision === "approve" ? "Approved " : "Rejected ") + d.reviewed + (d.sequences_stopped ? ", stopped " + d.sequences_stopped + " sequence(s)" : "") + (skipped.length ? ". Agent will skip that " + skipped.join(" / ") + " from now on." : ".") });
      setRej(null); setReason(""); setEx({ company: false, title: false, location: false });
      setRows(r => (r || []).filter(x => !ids.includes(x.id))); onChange();
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  if (!rows) return <div className="text-xs text-gray-400 py-4">Loading queue...</div>;
  const gate = campaign.autonomy === "review_before_shortlist" ? "They are not shortlisted until you approve." : campaign.autonomy === "review_before_sequence" ? "They will not be emailed until you approve." : "Fully automatic: outreach is already running; rejecting stops it and teaches the agent.";
  return <div>
    <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
      <p className="text-[11px] text-gray-500">{rows.length} new {rows.length === 1 ? "person" : "people"} to review. {gate}</p>
      {editable && rows.length > 1 && <button disabled={!!busy} onClick={() => decide(rows.map(r => r.id), "approve")} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "bulk" ? "Approving..." : "Approve all " + rows.length}</button>}
    </div>
    {msg && <div className={"mb-2 text-xs px-3 py-2 rounded-lg " + (msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600")}>{msg.t}</div>}
    {rows.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">Queue is empty. New people show up here after each hourly run.</p>}
    <div className="divide-y divide-gray-100">{rows.map(m => {
      const cc = m.candidates || {};
      const loc = [cc.city, cc.state, cc.country].filter(Boolean).join(", ");
      return <div key={m.id} className="py-2.5">
        <div className="flex justify-between items-start gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-medium">{cc.first_name} {cc.last_name}
              {cc.linkedin_url && <a href={cc.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs ml-1.5 hover:underline">in</a>}
              {typeof cc.ai_match_score === "number" && <span className={"ml-2 text-[10px] px-1.5 py-0.5 rounded font-semibold " + (cc.ai_match_score >= 75 ? "bg-green-100 text-green-700" : cc.ai_match_score >= 50 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500")}>{cc.ai_match_score}</span>}
            </div>
            <div className="text-xs text-gray-500">{cc.current_title || "?"}{cc.current_company ? " at " + cc.current_company : ""}{loc ? " / " + loc : ""}</div>
            {cc.ai_match_reason && <div className="text-[11px] text-gray-400 mt-0.5">{cc.ai_match_reason}</div>}
          </div>
          {editable && <div className="flex gap-1.5 shrink-0">
            <button disabled={!!busy} onClick={() => decide([m.id], "approve")} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-50">Approve</button>
            <button disabled={!!busy} onClick={() => { setRej(rej === m.id ? null : m.id); setReason(""); setEx({ company: false, title: false, location: false }); }} className={"text-xs px-3 py-1.5 rounded-lg border " + (rej === m.id ? "border-red-400 text-red-600" : "")}>Reject</button>
          </div>}
        </div>
        {rej === m.id && <div className="mt-2 p-2.5 rounded-lg bg-red-50/50 border border-red-100">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === "Enter") decide([m.id], "reject"); }}
            placeholder="Why? (optional, the agent learns from it) e.g. too junior, agency recruiter" className="w-full px-2.5 py-1.5 border rounded-lg text-xs bg-white" />
          <div className="flex gap-3 items-center flex-wrap mt-2">
            <span className="text-[11px] text-gray-500">Also skip from now on:</span>
            {cc.current_company && <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={ex.company} onChange={e => setEx({ ...ex, company: e.target.checked })} /> {cc.current_company}</label>}
            {cc.current_title && <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={ex.title} onChange={e => setEx({ ...ex, title: e.target.checked })} /> &ldquo;{cc.current_title}&rdquo;</label>}
            {(cc.state || cc.country) && <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={ex.location} onChange={e => setEx({ ...ex, location: e.target.checked })} /> {cc.state || cc.country}</label>}
            <button disabled={!!busy} onClick={() => decide([m.id], "reject")} className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">{busy === m.id ? "Rejecting..." : "Reject"}</button>
          </div>
        </div>}
      </div>;
    })}</div>
  </div>;
}

function Recalibrate({ campaign, editable, onChange }: { campaign: any; editable: boolean; onChange: () => void }) {
  const EXAMPLES = ["more senior", "skip agencies", "NJ only", "add assistant directors too", "only companies over 200 people"];
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const history: any[] = campaign.recalibrations || [];
  async function send(text?: string) {
    const instruction = (text ?? q).trim(); if (!instruction || busy) return;
    setBusy(true); setErr(null); setQ("");
    try {
      const d = await srcCall("outreach-agent", { action: "recalibrate", campaign_id: campaign.id, instruction });
      setLog(l => [{ instruction, summary: d.summary, changes: d.changes || [] }, ...l]);
      onChange();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function undo() {
    if (!confirm("Undo the last recalibration?")) return;
    try { await srcCall("outreach-agent", { action: "undo_recalibration", campaign_id: campaign.id }); setLog(l => [{ instruction: "Undo", summary: "Restored the previous filters.", changes: (history[0]?.changes || []).map((c: any) => ({ ...c, added: c.removed, removed: c.added, from: c.to, to: c.from })) }, ...l]); onChange(); }
    catch (e: any) { setErr(e.message); }
  }
  const L = campaign.learned || null;
  const list = (k: string) => (campaign[k] || []).length ? (campaign[k] || []).join(", ") : null;
  return <div className="grid md:grid-cols-5 gap-4">
    <div className="md:col-span-3">
      {editable && <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Tell the agent what to change: more senior, skip agencies, NJ only" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
        <button disabled={busy || !q.trim()} onClick={() => send()} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40">{busy ? "Thinking..." : "Recalibrate"}</button>
      </div>}
      {editable && <div className="flex gap-1.5 flex-wrap mt-2">{EXAMPLES.map(x => <button key={x} disabled={busy} onClick={() => send(x)} className="text-[11px] px-2 py-1 rounded-full border text-gray-600 hover:border-slate-400">{x}</button>)}</div>}
      {err && <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600">{err}</div>}
      <div className="mt-3 space-y-3">
        {log.map((e, i) => <div key={i} className="rounded-lg border p-2.5">
          <div className="flex justify-end mb-1.5"><span className="bg-slate-800 text-white px-3 py-1 rounded-2xl rounded-br-sm text-xs">{e.instruction}</span></div>
          {e.summary && <div className="text-xs text-gray-700 mb-1.5">{e.summary}</div>}
          <ChangeList changes={e.changes} />
        </div>)}
        {log.length === 0 && history.length > 0 && <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Earlier recalibrations</div>
          {history.slice(0, 5).map((h, i) => <div key={i} className="rounded-lg border p-2.5 mb-2">
            <div className="text-xs mb-1"><b>&ldquo;{h.instruction}&rdquo;</b> <span className="text-gray-400">{new Date(h.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
            <ChangeList changes={h.changes} />
          </div>)}
        </div>}
        {editable && history.length > 0 && <button onClick={undo} className="text-xs px-2.5 py-1.5 border rounded-lg">Undo last recalibration</button>}
      </div>
    </div>
    <div className="md:col-span-2 text-xs space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">Current filters</div>
      {["titles", "locations", "seniorities", "employee_ranges", "industry_keywords", "company_domains"].map(k => list(k) && <div key={k}><span className="text-gray-400">{FIELD_LABELS[k]}:</span> {list(k)}</div>)}
      {campaign.keywords && <div><span className="text-gray-400">Keywords:</span> {campaign.keywords}</div>}
      {["exclude_titles", "exclude_companies", "exclude_locations"].map(k => list(k) && <div key={k} className="text-red-600"><span className="text-red-400">{FIELD_LABELS[k]}:</span> {list(k)}</div>)}
      {L && (L.approved + L.rejected) > 0 && <div className="pt-2 border-t">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Learned from {L.approved} approvals / {L.rejected} rejections</div>
        {[...(L.prefer?.titles || []), ...(L.prefer?.companies || []), ...(L.prefer?.locations || [])].length > 0 && <div><span className="text-gray-400">Prefers:</span> {[...(L.prefer.titles || []), ...(L.prefer.companies || []), ...(L.prefer.locations || [])].join(", ")}</div>}
        {[...(L.exclude?.titles || []), ...(L.exclude?.companies || []), ...(L.exclude?.locations || [])].length > 0 && <div className="text-red-600"><span className="text-red-400">Auto-skipping:</span> {[...(L.exclude.titles || []), ...(L.exclude.companies || []), ...(L.exclude.locations || [])].join(", ")}</div>}
        {(L.avoid_reasons || []).length > 0 && <div><span className="text-gray-400">Rejection reasons:</span> {L.avoid_reasons.join("; ")}</div>}
      </div>}
    </div>
  </div>;
}

export function Campaigns({ editable }: { editable: boolean }) {
  const [data, setData] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [prev, setPrev] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [f, setF] = useState<any>({ name: "", job_id: "", titles: "", locations: "", limit: 10, verified: true, clay: false, auto: true, autonomy: "review_before_sequence" });
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
    daily_source_limit: Number(f.limit) || 10, autonomy: f.autonomy });
  async function preview() {
    setBusy("preview"); setMsg(null); setPrev(null);
    try { setPrev(await srcCall("outreach-agent", { action: "preview", ...payload() })); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function create() {
    const pl = payload();
    if (!pl.name) { setMsg({ t: "Give the agent a name.", ok: false }); return; }
    if (!pl.titles.length) { setMsg({ t: "Add at least one job title.", ok: false }); return; }
    setBusy("create"); setMsg(null);
    try {
      await srcCall("outreach-agent", { action: "create", ...pl });
      setMsg({ t: "Agent created. Sequence written; it sources hourly 9-5 weekdays.", ok: true });
      setF({ name: "", job_id: "", titles: "", locations: "", limit: 10, verified: true, clay: false, auto: true, autonomy: "review_before_sequence" });
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
      setMsg({ ok: true, t: "Sourced " + (src.sourced || 0) + ", enrolled " + (enr.enrolled || 0) + ", emails sent " + ((d.send && d.send.emails_sent) || 0) + "." + (src.excluded ? " Skipped " + src.excluded + " excluded by your feedback." : "") + (src.error ? " " + src.error : "") + (src.note ? " " + src.note : "") });
      load();
    } catch (e: any) { setMsg({ t: e.message, ok: false }); }
    setBusy("");
  }
  async function toggle(c: any) {
    try { await srcCall("outreach-agent", { action: c.status === "active" ? "pause" : "resume", campaign_id: c.id }); load(); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this agent? People already sourced stay in your ATS.")) return;
    try { await srcCall("outreach-agent", { action: "delete", campaign_id: id }); setDetail(null); load(); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  async function open(c: any, tab: "review" | "tune" | "people") {
    if (detail && detail.id === c.id && detail.tab === tab) { setDetail(null); return; }
    let rows: any[] = [];
    if (tab === "people") {
      const { data } = await supabase.from("campaign_members")
        .select("id,stage,note,review_status,sourced_at,candidates(id,first_name,last_name,email,phone,current_title,current_company,last_outreach_at)")
        .eq("campaign_id", c.id).order("sourced_at", { ascending: false }).limit(200);
      rows = data || [];
    }
    setDetail({ id: c.id, tab, rows });
  }
  async function setAutonomy(c: any, autonomy: string) {
    try { await srcCall("outreach-agent", { action: "update_agent", campaign_id: c.id, autonomy }); load(); }
    catch (e: any) { setMsg({ t: e.message, ok: false }); }
  }
  if (!data) return <div className="py-20 text-center text-gray-400">Loading...</div>;
  const h = data.health || {};
  const chip = (on: boolean) => on ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600";
  return <div>
    <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
      <div><h1 className="text-xl font-semibold">Agents</h1>
      <p className="text-xs text-gray-400">One sourcing agent per open job: Apollo sourcing, Clay enrichment, multichannel outreach. Runs hourly 9-5 weekdays and learns from every approve / reject.</p></div>
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
      <h3 className="text-sm font-medium mb-3">New agent</h3>
      <div className="grid md:grid-cols-3 gap-3">
        <label className="block"><span className="text-xs text-gray-500">Fill for position</span>
          <select value={f.job_id} onChange={e => pickJob(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-1">
            <option value="">Not linked</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select></label>
        <Field label="Agent name" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} placeholder="DON North Jersey" />
        <Field label="Job titles (comma separated)" value={f.titles} onChange={(e: any) => setF({ ...f, titles: e.target.value })} placeholder="director of nursing, ADON" />
        <label className="block md:col-span-2"><span className="text-xs text-gray-500">Locations</span>
          <input value={f.locations} onChange={e => setF({ ...f, locations: e.target.value })} placeholder="New Jersey / United States / South Africa / Philippines" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
          <RegionChips value={f.locations} onPick={(v: string) => setF({ ...f, locations: v })} />
        </label>
        <Field label="People per day" type="number" value={f.limit} onChange={(e: any) => setF({ ...f, limit: e.target.value })} />
        <label className="block md:col-span-3"><span className="text-xs text-gray-500">Autonomy</span>
          <div className="grid md:grid-cols-3 gap-2 mt-1">{AUTONOMY.map(a =>
            <button key={a.v} type="button" onClick={() => setF({ ...f, autonomy: a.v })} className={"text-left p-2.5 rounded-lg border " + (f.autonomy === a.v ? "border-slate-800 bg-slate-50" : "hover:border-slate-400")}>
              <div className="text-xs font-medium">{a.l}</div><div className="text-[11px] text-gray-500 mt-0.5">{a.d}</div>
            </button>)}</div>
        </label>
      </div>
      <div className="flex items-center gap-4 flex-wrap mb-3 mt-1">
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.verified} onChange={e => setF({ ...f, verified: e.target.checked })} className="w-4 h-4" /> Verified emails only</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.clay} onChange={e => setF({ ...f, clay: e.target.checked })} className="w-4 h-4" /> Enrich via Clay first</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={f.auto} onChange={e => setF({ ...f, auto: e.target.checked })} className="w-4 h-4" /> Auto-enroll into sequence</label>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button disabled={!!busy} onClick={preview} className="border px-3 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "preview" ? "Checking..." : "Preview matches (free)"}</button>
        <button disabled={!!busy} onClick={create} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{busy === "create" ? "Creating..." : "Create agent"}</button>
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
      {(data.campaigns || []).length === 0 && <p className="text-sm text-gray-400">No agents yet. Create one per open job above.</p>}
      {(data.campaigns || []).map((c: any) => {
        const fn = c.funnel || {};
        const pending = (c.review && c.review.pending) || 0;
        const tabBtn = (tab: string) => "text-xs px-2.5 py-1.5 border rounded-lg " + (detail && detail.id === c.id && detail.tab === tab ? "bg-slate-800 text-white border-slate-800" : "");
        return <div key={c.id} className="bg-white rounded-xl border p-4">
          <div className="flex justify-between items-start flex-wrap gap-2">
            <div>
              <span className="font-semibold mr-2">{c.name}</span>
              <span className={"text-[10px] px-2 py-0.5 rounded-full " + (c.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{c.status}</span>
              {editable
                ? <select value={c.autonomy || "auto"} onChange={e => setAutonomy(c, e.target.value)} title={(AUTONOMY.find(a => a.v === (c.autonomy || "auto")) || AUTONOMY[0]).d} className="ml-1 text-[10px] px-1.5 py-0.5 border rounded-full bg-white text-gray-600">{AUTONOMY.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}</select>
                : <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{(AUTONOMY.find(a => a.v === (c.autonomy || "auto")) || AUTONOMY[0]).l}</span>}
              <div className="text-[11px] text-gray-400 mt-1">{c.jobs ? c.jobs.title + " / " : ""}{(c.titles || []).join(", ")}{c.locations && c.locations.length ? " / " + c.locations.join(", ") : ""} / {c.daily_source_limit} per day / last run {c.last_run_at ? new Date(c.last_run_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never"}</div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => open(c, "review")} className={tabBtn("review")}>Review{pending ? <span className="ml-1 px-1.5 rounded-full bg-orange-500 text-white text-[10px]">{pending}</span> : null}</button>
              <button onClick={() => open(c, "tune")} className={tabBtn("tune")}>Recalibrate</button>
              <button onClick={() => open(c, "people")} className={tabBtn("people")}>People</button>
              {editable && <>
              <button disabled={!!busy} onClick={() => run(c.id)} className="text-xs px-2.5 py-1.5 border rounded-lg disabled:opacity-50">{busy === "run" ? "Running..." : "Run now"}</button>
              <button onClick={() => toggle(c)} className="text-xs px-2.5 py-1.5 border rounded-lg">{c.status === "active" ? "Pause" : "Resume"}</button>
              <button onClick={() => remove(c.id)} className="text-xs px-2.5 py-1.5 border rounded-lg text-red-600">Delete</button>
              </>}
            </div>
          </div>
          <div className="flex mt-3 rounded-lg border overflow-hidden">
            {[...(c.autonomy === "review_before_shortlist" || fn.review ? ["review"] : []), "sourced", "enriching", "enriched", "enrolled", "rejected", "skipped"].map(k =>
              <div key={k} className="flex-1 text-center py-2 border-r last:border-r-0 bg-gray-50/60">
                <div className="text-lg font-semibold">{fn[k] || 0}</div>
                <div className="text-[9px] text-gray-400 uppercase tracking-wide">{k}</div>
              </div>)}
          </div>
          {detail && detail.id === c.id && <div className="mt-4 pt-4 border-t">
            {detail.tab === "review" && <ReviewQueue campaign={c} editable={editable} onChange={load} />}
            {detail.tab === "tune" && <Recalibrate campaign={c} editable={editable} onChange={load} />}
            {detail.tab === "people" && <PeopleTable rows={detail.rows} />}
          </div>}
        </div>;
      })}
    </div>
  </div>;
}

function PeopleTable({ rows }: { rows: any[] }) {
  return <div className="overflow-x-auto">
      <div className="text-[11px] text-gray-400 mb-2">{rows.length} people</div>
      <table className="w-full text-sm"><thead><tr className="border-b text-left">{["Name", "Title", "Company", "Email", "Phone", "Stage"].map(x => <th key={x} className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase">{x}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">{rows.map((m: any) => {
        const cc = m.candidates || {};
        return <tr key={m.id} className="hover:bg-gray-50">
          <td className="px-2 py-1.5 font-medium">{cc.first_name} {cc.last_name}</td>
          <td className="px-2 py-1.5 text-gray-500">{cc.current_title || ""}</td>
          <td className="px-2 py-1.5 text-gray-500">{cc.current_company || ""}</td>
          <td className="px-2 py-1.5 text-gray-500 text-xs">{cc.email || ""}</td>
          <td className="px-2 py-1.5 text-gray-500 text-xs">{cc.phone || "-"}</td>
          <td className="px-2 py-1.5"><span className={"text-[10px] px-2 py-0.5 rounded-full " + (m.stage === "enrolled" ? "bg-green-100 text-green-700" : m.stage === "rejected" ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-600")}>{m.stage}</span>{m.review_status && m.review_status !== "approved" ? <span className={"text-[10px] ml-1 " + (m.review_status === "rejected" ? "text-red-500" : "text-orange-500")}>{m.review_status}</span> : null}{m.note ? <span className="text-[10px] text-gray-400 ml-1">{m.note}</span> : null}</td>
        </tr>;
      })}</tbody></table>
    </div>;
}
