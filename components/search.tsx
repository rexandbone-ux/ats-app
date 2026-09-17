"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { B, Av, Modal, Field, logActivity, fn, useToast, Chip, Pct, Btn, exportCsv, fullName, scoreText, Empty } from "@/lib/ui";

/* ---------------- Search (Juicebox / PeopleGPT style) ----------------
   One box. Plain English in, ranked people out — from your own ATS first
   (3,000+ candidates, resumes, transcripts, AI screens) and from Apollo for
   people you don't have yet. Every result shows a match % and the hiring
   signals behind it. Select → add to a job slate, a pool, or export.       */

type Filters = { titles: string[]; skills: string[]; keywords: string[]; locations: string[]; min_years?: number | null; raw: string };
const STOP = new Set(["with", "and", "the", "for", "who", "that", "have", "has", "from", "are", "can", "call", "find", "show", "me", "all", "any", "in", "of", "to", "a", "an", "or", "near", "years", "year", "experience", "exp", "candidates", "people", "someone", "looking", "want", "need", "good", "best", "top"]);
function tokenize(q: string) { return Array.from(new Set(q.toLowerCase().replace(/[^a-z0-9+#.\s-]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)))); }
function localParse(q: string): Filters {
  const t = tokenize(q); const years = q.match(/(\d+)\+?\s*(?:years|yrs|yr)/i);
  const locs = ["philippines", "philippine", "filipino", "south africa", "south african", "new jersey", "new york", "nj", "ny", "florida", "texas", "california", "remote", "manila", "cebu", "johannesburg", "cape town", "durban"].filter(l => q.toLowerCase().includes(l));
  return { titles: [], skills: [], keywords: t.filter(w => !locs.some(l => l.includes(w))), locations: locs.map(l => l.replace(/^philippine$|^filipino$/, "philippines").replace("south african", "south africa")), min_years: years ? Number(years[1]) : null, raw: q };
}
async function aiParse(q: string): Promise<Filters> {
  const base = localParse(q);
  try {
    const d: any = await fn("ai-assist", { action: "search_parse", query: q }, { timeoutMs: 15000 });
    const f = d?.filters || {};
    const arr = (x: any) => Array.isArray(x) ? x.map((s: any) => String(s).toLowerCase().trim()).filter(Boolean) : [];
    const out = { ...base, titles: arr(f.titles), skills: arr(f.skills), keywords: Array.from(new Set([...arr(f.keywords), ...base.keywords])), locations: Array.from(new Set([...arr(f.locations), ...base.locations])), min_years: f.min_years ?? f.experience_years ?? base.min_years };
    const covered = (k: string) => [...out.titles, ...out.skills, ...out.locations].some(t => t.includes(k) || t.includes(k.replace(/s$/, "")) || k.includes(t));
    out.keywords = out.keywords.filter(k => !covered(k));
    if (!out.titles.length && !out.skills.length && !out.keywords.length) return base;
    return out;
  } catch { return base; }
}
const ilikeOr = (cols: string[], terms: string[]) => terms.flatMap(t => cols.map(c => `${c}.ilike.%${t.replace(/[,()]/g, " ")}%`)).join(",");

export type Hit = { c: any; pct: number; signals: string[]; evidence: string[]; ai?: { score: number; job: string; verdict: string; rank: number } | null };
export function rankCandidates(cands: any[], f: Filters, aiByCand: Record<string, any[]>, jobTitle: Record<string, string>): Hit[] {
  const terms = Array.from(new Set([...f.titles, ...f.skills, ...f.keywords])).filter(Boolean);
  return cands.map(c => {
    const title = (c.current_title || "").toLowerCase(); const company = (c.current_company || "").toLowerCase();
    const skills = (c.skills || []).map((s: string) => String(s).toLowerCase()); const text = (c.resume_text || "").toLowerCase();
    const loc = [c.city, c.state, c.country].filter(Boolean).join(", ").toLowerCase();
    let pts = 0, max = 0; const signals: string[] = []; const evidence: string[] = [];
    // Title (40)
    max += 40; const th = f.titles.filter(t => title.includes(t)); const tk = f.titles.length ? [] : f.keywords.filter(k => title.includes(k));
    if (th.length) { pts += 40; signals.push(`Title: ${c.current_title}`); } else if (tk.length) { pts += Math.min(40, 14 * tk.length); signals.push(`Title mentions ${tk.join(", ")}`); } else if (f.titles.length && f.titles.some(t => text.includes(t))) { pts += 18; signals.push("Held the title before (résumé)"); }
    // Skills / keywords (35)
    const kws = Array.from(new Set([...f.skills, ...f.keywords])).filter(k => !f.titles.includes(k)); if (kws.length) { max += 35; const hitS = kws.filter(k => skills.some((s: string) => s.includes(k))); const hitT = kws.filter(k => !hitS.includes(k) && (text.includes(k) || company.includes(k) || title.includes(k))); const n = hitS.length + hitT.length; pts += Math.round(35 * Math.min(1, n / Math.max(1, Math.min(kws.length, 4)))); if (hitS.length) signals.push(`Skills: ${hitS.join(", ")}`); if (hitT.length) signals.push(`Résumé mentions ${hitT.join(", ")}`); kws.forEach(k => { const i = text.indexOf(k); if (i >= 0 && evidence.length < 3) evidence.push("…" + (c.resume_text || "").slice(Math.max(0, i - 70), i + 90).replace(/\s+/g, " ") + "…"); }); }
    // Location (10)
    if (f.locations.length) { max += 10; const lh = f.locations.filter(l => loc.includes(l) || (l === "philippines" && /philippin|manila|cebu|davao|quezon/.test(loc)) || (l === "south africa" && /south africa|johannesburg|cape town|durban|pretoria/.test(loc))); if (lh.length) { pts += 10; signals.push(`Located: ${[c.city, c.state, c.country].filter(Boolean).join(", ")}`); } }
    // Experience (10)
    if (f.min_years) { max += 10; if ((c.experience_years || 0) >= f.min_years) { pts += 10; signals.push(`${c.experience_years} yrs experience`); } } else if (c.experience_years) signals.push(`${c.experience_years} yrs experience`);
    // Reachability + data richness (5)
    max += 5; if (c.phone) { pts += 3; signals.push("Phone on file"); } if (c.resume_text) { pts += 2; }
    if (c.min_hourly_rate) signals.push(`Asks $${c.min_hourly_rate}/h`); if (c.english_rate) signals.push(`English ${c.english_rate}`); if (c.adam_rating != null) signals.push(`Adam rated ${c.adam_rating}`); if (c.roe_rating != null) signals.push(`Roe rated ${c.roe_rating}`);
    // AI screening bonus
    const ai = (aiByCand[c.id] || []).sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0] || null;
    let aiInfo = null; if (ai) { aiInfo = { score: ai.score, job: jobTitle[ai.job_id] || "job", verdict: ai.verdict, rank: ai.rank }; signals.push(`AI screen ${ai.score}/100 for ${aiInfo.job}${ai.verdict === "PASS" ? " (pass)" : ""}`); if (ai.score >= 60) pts += 4; }
    const pct = Math.max(0, Math.min(100, Math.round((pts / Math.max(max, 1)) * 100)));
    return { c, pct, signals, evidence, ai: aiInfo };
  }).sort((a, b) => b.pct - a.pct || (b.ai?.score || 0) - (a.ai?.score || 0));
}

export function Search({ nav, editable, pr }: { nav: (p: string, d?: any) => void; editable: boolean; pr?: any }) {
  const { profile } = useAuth(); const { say } = useToast();
  const EXAMPLES = ["Registered nurses in New Jersey with DME experience", "Philippine CPAs with QuickBooks and a phone number", "Clinical liaison with home health background, 3+ years", "Commercial insurance CSR, remote, South Africa", "Director of nursing who worked at a skilled nursing facility"];
  const [q, setQ] = useState(pr?.q || ""); const [busy, setBusy] = useState(false); const [f, setF] = useState<Filters | null>(null);
  const [hits, setHits] = useState<Hit[]>([]); const [done, setDone] = useState(false); const [sel, setSel] = useState<Set<string>>(new Set());
  const [minPct, setMinPct] = useState(0); const [onlyPhone, setOnlyPhone] = useState(false); const [status, setStatus] = useState("all"); const [scope, setScope] = useState<"ats" | "apollo">("ats");
  const [jobs, setJobs] = useState<any[]>([]); const [pools, setPools] = useState<any[]>([]); const [stages, setStages] = useState<any[]>([]);
  const [ext, setExt] = useState<any[]>([]); const [extBusy, setExtBusy] = useState(false); const [extTot, setExtTot] = useState<number | null>(null); const [extSel, setExtSel] = useState<Record<string, boolean>>({}); const [extErr, setExtErr] = useState("");
  const [saved, setSaved] = useState<any[]>([]);
  useEffect(() => { supabase.from("jobs").select("id,title,status").in("status", ["open", "on_hold", "draft"]).order("created_at", { ascending: false }).then(({ data }) => setJobs(data || [])); supabase.from("talent_pools").select("id,name").order("name").then(({ data }) => setPools(data || [])); supabase.from("pipeline_stages").select("id,name,sort_order,pipeline_id").order("sort_order").then(({ data }) => setStages(data || [])); }, []);
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem("ss_saved_searches") || "[]")); } catch { /* ignore */ } }, []);
  const [autoRan, setAutoRan] = useState(false);

  const go = useCallback(async (text?: string) => {
    const query = (text ?? q).trim(); if (!query) return; if (text) setQ(text);
    setBusy(true); setDone(false); setSel(new Set()); setExt([]); setExtTot(null); setExtErr("");
    const filters = await aiParse(query); setF(filters);
    const terms = Array.from(new Set([...filters.titles, ...filters.skills, ...filters.keywords])).slice(0, 10);
    const locTerms = filters.locations.slice(0, 4);
    const cols = "id,first_name,last_name,email,phone,current_title,current_company,status,source,city,state,country,skills,experience_years,resume_text,min_hourly_rate,english_rate,adam_rating,roe_rating,owner_id,tags,created_at,linkedin_url,resume_url";
    const seen = new Map<string, any>();
    const add = (rows: any[] | null) => (rows || []).forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r); });
    try {
      const qs: any[] = [];
      if (terms.length) { qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["current_title", "current_company"], terms)).limit(300)); qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["resume_text"], terms.slice(0, 6))).limit(300)); }
      if (locTerms.length) qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["city", "state", "country"], locTerms)).limit(300));
      if (!terms.length && !locTerms.length) qs.push(supabase.from("candidates").select(cols).or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`).limit(100));
      const res = await Promise.all(qs); res.forEach(r => add(r.data));
      const list = Array.from(seen.values());
      // AI screening context for these people (leaderboard is job-scoped)
      const ids = list.map(c => c.id).slice(0, 400); const aiBy: Record<string, any[]> = {}; const jt: Record<string, string> = {};
      if (ids.length) { const { data: lb } = await supabase.from("v_job_leaderboard").select("candidate_id,job_id,score,verdict,rank").in("candidate_id", ids); (lb || []).forEach((r: any) => { (aiBy[r.candidate_id] = aiBy[r.candidate_id] || []).push(r); }); const { data: jj } = await supabase.from("jobs").select("id,title"); (jj || []).forEach((j: any) => { jt[j.id] = j.title; }); }
      const ranked = rankCandidates(list, filters, aiBy, jt).filter(h => h.pct > 0 || !terms.length);
      setHits(ranked);
    } catch (e: any) { say("Search failed: " + (e?.message || e), false); }
    setBusy(false); setDone(true);
  }, [q, say]);

  useEffect(() => { if (pr?.q && !autoRan) { setAutoRan(true); go(pr.q); } /* eslint-disable-next-line */ }, [pr?.q, autoRan]);
  const shown = useMemo(() => hits.filter(h => h.pct >= minPct && (!onlyPhone || h.c.phone) && (status === "all" || h.c.status === status)), [hits, minPct, onlyPhone, status]);
  const ids = () => Array.from(sel);
  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  /* --- Actions on selected ATS people --- */
  const [act, setAct] = useState<"" | "job" | "pool" | "screen">("");
  async function addToJob(jobId: string) {
    if (!ids().length || !jobId) return; const job = jobs.find(j => j.id === jobId);
    const { data: existing } = await supabase.from("applications").select("candidate_id").eq("job_id", jobId).in("candidate_id", ids());
    const have = new Set((existing || []).map((x: any) => x.candidate_id)); const st = stages[0]?.id || null;
    const rows = ids().filter(id => !have.has(id)).map(id => ({ candidate_id: id, job_id: jobId, stage_id: st, status: "active", source: "search" }));
    if (rows.length) { const { error } = await supabase.from("applications").insert(rows); if (error) { say(error.message, false); return; } await Promise.all(rows.map(r => logActivity("application_received", `Added to ${job?.title || "job"} from Search`, { candidate_id: r.candidate_id, job_id: jobId }, profile?.id))); }
    say(`${rows.length} added to ${job?.title || "job"}${have.size ? ` (${have.size} already there)` : ""}.`); setAct(""); setSel(new Set());
  }
  async function addToPool(poolId: string) {
    if (!ids().length || !poolId) return; const { data: ex } = await supabase.from("talent_pool_candidates").select("candidate_id").eq("talent_pool_id", poolId).in("candidate_id", ids()); const have = new Set((ex || []).map((x: any) => x.candidate_id));
    const rows = ids().filter(id => !have.has(id)).map(id => ({ talent_pool_id: poolId, candidate_id: id })); if (rows.length) { const { error } = await supabase.from("talent_pool_candidates").insert(rows); if (error) { say(error.message, false); return; } }
    say(`${rows.length} added to pool.`); setAct(""); setSel(new Set());
  }
  async function screenFor(jobId: string) {
    if (!ids().length || !jobId) return; const job = jobs.find(j => j.id === jobId); setAct(""); say(`Screening ${ids().length} for ${job?.title}… this runs in the background (~20s each).`);
    let ok = 0, bad = 0; for (const id of ids()) { try { await fn("screening-agent", { action: "screen", candidate_id: id, job_id: jobId }, { timeoutMs: 180000 }); ok++; } catch { bad++; } }
    say(`Screened ${ok}${bad ? `, ${bad} failed` : ""}. See the Slate on ${job?.title}.`, !bad); setSel(new Set());
  }
  function saveSearch() { if (!q.trim()) return; const next = [{ q: q.trim(), at: Date.now() }, ...saved.filter(s => s.q !== q.trim())].slice(0, 12); setSaved(next); try { localStorage.setItem("ss_saved_searches", JSON.stringify(next)); } catch { /* ignore */ } say("Search saved."); }

  /* --- Apollo (people you don't have yet) --- */
  async function searchApollo(page = 1) {
    if (!f) return; setExtBusy(true); setExtErr("");
    const titles = f.titles.length ? f.titles : f.keywords.slice(0, 3); const locations = f.locations.map(l => l.replace(/\b\w/g, ch => ch.toUpperCase()));
    try { const d: any = await fn("outreach-agent", { action: "search", page, per_page: 25, titles, locations, seniorities: [], employee_ranges: [], industry_keywords: f.skills.slice(0, 3), company_domains: [], verified_only: false }); setExt(d.people || []); setExtTot(d.total ?? 0); }
    catch (e: any) { setExtErr(e?.message || String(e)); }
    setExtBusy(false);
  }
  async function importApollo() {
    const picks = Object.keys(extSel).filter(k => extSel[k]); if (!picks.length) return;
    if (!confirm(`Import ${picks.length} people from Apollo? Reveals emails and uses up to ${picks.length} credits.`)) return;
    try { const d: any = await fn("outreach-agent", { action: "import", apollo_ids: picks.slice(0, 25), job_id: null, campaign_id: null, source_label: "search" }); say(`${d.imported || 0} imported${d.dupes ? `, ${d.dupes} already in ATS` : ""}.`); setExtSel({}); } catch (e: any) { say(e?.message || String(e), false); }
  }
  useEffect(() => { if (scope === "apollo" && f && !ext.length && !extBusy && !extErr) searchApollo(1); /* eslint-disable-next-line */ }, [scope]);

  return <div className="max-w-6xl">
    <div className="mb-4"><h1 className="text-xl font-semibold">Search</h1><p className="text-xs text-gray-400">Describe who you need in plain English. Ranked against your ATS first, then Apollo for people you don&rsquo;t have yet.</p></div>
    <div className="bg-white rounded-2xl border shadow-sm p-2 flex gap-2 items-center mb-3">
      <span className="pl-2 text-gray-300">🔍</span>
      <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} placeholder="e.g. Registered nurses in New Jersey with DME experience and a phone number" className="flex-1 px-2 py-2.5 text-sm outline-none" />
      {q && <button onClick={() => { setQ(""); setHits([]); setDone(false); setF(null); }} className="text-gray-300 hover:text-gray-500 px-1">×</button>}
      <Btn primary disabled={busy || !q.trim()} onClick={() => go()}>{busy ? "Searching…" : "Search"}</Btn>
    </div>
    {!done && !busy && <div className="mb-4">
      <div className="flex gap-1.5 flex-wrap">{EXAMPLES.map(x => <Chip key={x} onClick={() => go(x)}>{x}</Chip>)}</div>
      {saved.length > 0 && <div className="mt-3"><div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Saved searches</div><div className="flex gap-1.5 flex-wrap">{saved.map(s => <span key={s.q} className="flex items-center gap-1"><Chip onClick={() => go(s.q)}>{s.q}</Chip><button onClick={() => { const n = saved.filter(x => x.q !== s.q); setSaved(n); try { localStorage.setItem("ss_saved_searches", JSON.stringify(n)); } catch { /* */ } }} className="text-gray-300 hover:text-red-500 text-xs">×</button></span>)}</div></div>}
    </div>}
    {f && done && <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px] text-gray-500">
      <span>Understood as:</span>{f.titles.map(t => <span key={"t" + t} className="px-2 py-0.5 rounded-full bg-slate-800 text-white">title: {t}</span>)}{f.skills.map(t => <span key={"s" + t} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">skill: {t}</span>)}{f.keywords.filter(k => !f.titles.includes(k) && !f.skills.includes(k)).map(t => <span key={"k" + t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t}</span>)}{f.locations.map(t => <span key={"l" + t} className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">📍 {t}</span>)}{f.min_years ? <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{f.min_years}+ yrs</span> : null}
      <button onClick={saveSearch} className="ml-auto text-blue-600 hover:underline">Save search</button>
    </div>}
    {done && <div className="flex gap-2 mb-3 border-b"><button onClick={() => setScope("ats")} className={`px-3 py-2 text-sm border-b-2 ${scope === "ats" ? "border-slate-800 font-medium" : "border-transparent text-gray-400"}`}>Your ATS <span className="text-xs text-gray-400">({shown.length})</span></button><button onClick={() => setScope("apollo")} className={`px-3 py-2 text-sm border-b-2 ${scope === "apollo" ? "border-slate-800 font-medium" : "border-transparent text-gray-400"}`}>Beyond your ATS · Apollo {extTot != null && <span className="text-xs text-gray-400">({extTot.toLocaleString()})</span>}</button></div>}

    {scope === "ats" && done && <>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <select value={minPct} onChange={e => setMinPct(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-xs bg-white"><option value={0}>Any match</option><option value={40}>40%+</option><option value={60}>60%+</option><option value={80}>80%+</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs bg-white"><option value="all">Any status</option>{["new", "contacted", "screening", "submitted", "interviewing", "on_bench", "placed"].map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={onlyPhone} onChange={e => setOnlyPhone(e.target.checked)} />has phone</label>
        <span className="text-xs text-gray-400 ml-auto">{shown.length} people</span>
        <Btn small onClick={() => exportCsv("search-results", shown.map(h => ({ match: h.pct, name: fullName(h.c), title: h.c.current_title, company: h.c.current_company, email: h.c.email, phone: h.c.phone, location: [h.c.city, h.c.state, h.c.country].filter(Boolean).join(", "), status: h.c.status, ai_score: h.ai?.score, signals: h.signals.join(" | ") })))}>Export CSV</Btn>
      </div>
      {editable && sel.size > 0 && <div className="flex items-center gap-2 mb-3 p-2 bg-slate-800 rounded-lg text-white text-sm flex-wrap"><span className="px-2">{sel.size} selected</span>
        <select onChange={e => { if (e.target.value) addToJob(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">Add to job slate…</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select onChange={e => { if (e.target.value) screenFor(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">✦ AI-screen for job…</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select onChange={e => { if (e.target.value) addToPool(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">Add to pool…</option>{pools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={() => setSel(new Set())} className="text-xs px-2 py-1 ml-auto">Clear</button></div>}
      {shown.length === 0 ? <Empty t={hits.length ? "Nothing passes these filters." : "No one in your ATS matches yet. Try the Apollo tab, or loosen the query."} /> : <div className="bg-white rounded-xl border divide-y">
        {editable && <div className="px-4 py-1.5 text-[11px] text-gray-400 flex items-center gap-2"><input type="checkbox" checked={sel.size > 0 && sel.size === shown.length} onChange={e => setSel(e.target.checked ? new Set(shown.map(h => h.c.id)) : new Set())} className="w-4 h-4" /> select all shown</div>}
        {shown.slice(0, 150).map(h => <div key={h.c.id} className="px-4 py-3 flex gap-3 hover:bg-gray-50">
          {editable && <input type="checkbox" checked={sel.has(h.c.id)} onChange={() => toggle(h.c.id)} className="w-4 h-4 mt-2" />}
          <Av n={fullName(h.c)} sz="w-9 h-9 text-xs" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><span onClick={() => nav("det", { id: h.c.id })} className="font-medium cursor-pointer hover:underline">{fullName(h.c)}</span><Pct p={h.pct} /><B s={h.c.status} />{h.ai && <span className={`text-[10px] font-semibold ${scoreText(h.ai.score)}`}>AI {h.ai.score} · #{h.ai.rank} {h.ai.job}</span>}</div>
            <div className="text-xs text-gray-500 mt-0.5">{h.c.current_title || "—"}{h.c.current_company ? ` @ ${h.c.current_company}` : ""}{(h.c.city || h.c.country) ? ` · ${[h.c.city, h.c.state, h.c.country].filter(Boolean).join(", ")}` : ""}{h.c.source ? ` · via ${h.c.source}` : ""}</div>
            <div className="flex gap-1 flex-wrap mt-1.5">{h.signals.slice(0, 6).map((s, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ {s}</span>)}</div>
            {h.evidence.length > 0 && <div className="text-[11px] text-gray-400 italic mt-1 truncate" title={h.evidence.join("\n")}>{h.evidence[0]}</div>}
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0 text-xs">{h.c.phone && <a href={"tel:" + h.c.phone} className="text-gray-500 hover:text-slate-800">{h.c.phone}</a>}{h.c.email && <span className="text-gray-400 truncate max-w-[180px]">{h.c.email}</span>}<button onClick={() => nav("det", { id: h.c.id })} className="text-blue-600 hover:underline">Open ↗</button></div>
        </div>)}
      </div>}
    </>}

    {scope === "apollo" && done && <div>
      {extErr && <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600">{extErr}</div>}
      {extBusy ? <Empty t="Searching Apollo…" /> : ext.length === 0 ? <Empty t={extErr ? "" : "No Apollo matches for these titles/locations. Try the Sourcing tab for more filters."} /> : <div className="bg-white rounded-xl border overflow-hidden">
        {editable && <div className="flex gap-2 items-center px-3 py-2 border-b bg-gray-50/60 text-xs"><span className="text-gray-500">{Object.values(extSel).filter(Boolean).length} selected</span><Btn small onClick={() => { const n: any = {}; ext.forEach(r => n[r.apollo_id] = true); setExtSel(n); }}>Select page</Btn><Btn small primary onClick={importApollo} disabled={!Object.values(extSel).some(Boolean)}>Import to ATS</Btn><span className="text-gray-400 ml-auto">Searching is free; import spends Apollo credits and reveals emails.</span></div>}
        <table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60"><th className="px-3 py-2 w-8"></th>{["Name", "Title", "Company", "Location", "Contact"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{ext.map(r => <tr key={r.apollo_id} className="hover:bg-gray-50"><td className="px-3 py-2"><input type="checkbox" checked={!!extSel[r.apollo_id]} onChange={e => setExtSel({ ...extSel, [r.apollo_id]: e.target.checked })} className="w-4 h-4" /></td><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 text-gray-500">{r.title}</td><td className="px-3 py-2 text-gray-500">{r.company}</td><td className="px-3 py-2 text-gray-500 text-xs">{[r.city, r.state, r.country].filter(Boolean).join(", ")}</td><td className="px-3 py-2 text-[10px]"><span className={"px-1.5 py-0.5 rounded font-semibold mr-1 " + (r.has_email ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>@</span><span className={"px-1.5 py-0.5 rounded font-semibold " + (r.has_phone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>tel</span>{r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="ml-2 text-blue-600">in</a>}</td></tr>)}</tbody></table>
      </div>}
    </div>}
  </div>;
}
