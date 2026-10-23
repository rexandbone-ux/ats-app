"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { B, Av, Modal, Field, logActivity, fn, useToast, Chip, Pct, Btn, exportCsv, fullName, scoreText, Empty, pgq } from "@/lib/ui";
import { callCandidate, smsCandidate, pushToClose, openInClose } from "@/lib/comms";
import { SequenceModal } from "@/components/sequence";
import { AIOutreachModal } from "@/components/outreach";

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
const ilikeOr = (cols: string[], terms: string[]) => terms.flatMap(t => cols.map(c => `${c}.ilike.%${pgq(t)}%`)).join(",");

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
  const [minPct, setMinPct] = useState(0); const [onlyPhone, setOnlyPhone] = useState(false); const [status, setStatus] = useState("all"); const [scope, setScope] = useState<"ats" | "apollo" | "insights">("ats");
  const [jobs, setJobs] = useState<any[]>([]); const [pools, setPools] = useState<any[]>([]); const [stages, setStages] = useState<any[]>([]);
  const [ext, setExt] = useState<any[]>([]); const [extBusy, setExtBusy] = useState(false); const [extTot, setExtTot] = useState<number | null>(null); const [extSel, setExtSel] = useState<Record<string, boolean>>({}); const [extErr, setExtErr] = useState("");
  const [saved, setSaved] = useState<any[]>([]);
  const [apF, setApF] = useState<any>(null); const [extPage, setExtPage] = useState(1);
  useEffect(() => { supabase.from("jobs").select("id,title,status").in("status", ["open", "on_hold", "draft"]).order("created_at", { ascending: false }).then(({ data }) => setJobs(data || [])); supabase.from("talent_pools").select("id,name").order("name").then(({ data }) => setPools(data || [])); supabase.from("pipeline_stages").select("id,name,sort_order,pipeline_id").order("sort_order").then(({ data }) => setStages(data || [])); }, []);
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem("ss_saved_searches") || "[]")); } catch { /* ignore */ } }, []);
  const [autoRan, setAutoRan] = useState(false);

  const [lbRows, setLbRows] = useState<any[]>([]);
  const run = useCallback(async (filters: Filters, query: string) => {
    setBusy(true); setDone(false); setSel(new Set()); setExt([]); setExtTot(null); setExtErr(""); setApF(null); setExtPage(1);
    setF(filters);
    const terms = Array.from(new Set([...filters.titles, ...filters.skills, ...filters.keywords])).slice(0, 10);
    const locTerms = filters.locations.slice(0, 4);
    const cols = "id,first_name,last_name,email,phone,current_title,current_company,status,source,city,state,country,skills,experience_years,resume_text,min_hourly_rate,english_rate,adam_rating,roe_rating,owner_id,tags,created_at,linkedin_url,resume_url,ai_analysis,overall_score,ai_recommendation,ai_match_score,ai_match_reason,education,certifications";
    const seen = new Map<string, any>();
    const add = (rows: any[] | null) => (rows || []).forEach(r => { if (!seen.has(r.id)) seen.set(r.id, r); });
    try {
      const qs: any[] = [];
      if (terms.length) { qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["current_title", "current_company"], terms)).limit(300)); qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["resume_text"], terms.slice(0, 6))).limit(300)); }
      if (locTerms.length) qs.push(supabase.from("candidates").select(cols).or(ilikeOr(["city", "state", "country"], locTerms)).limit(300));
      if (!terms.length && !locTerms.length) qs.push(supabase.from("candidates").select(cols).or(`first_name.ilike.%${pgq(query)}%,last_name.ilike.%${pgq(query)}%,email.ilike.%${pgq(query)}%`).limit(100));
      const res = await Promise.all(qs); res.forEach(r => add(r.data));
      const list = Array.from(seen.values());
      // AI screening context for these people (leaderboard is job-scoped)
      const ids = list.map(c => c.id).slice(0, 400); const aiBy: Record<string, any[]> = {}; const jt: Record<string, string> = {};
      let lb: any[] = [];
      if (ids.length) { const r = await supabase.from("v_job_leaderboard").select("candidate_id,job_id,score,verdict,rank").in("candidate_id", ids); lb = r.data || []; lb.forEach((x: any) => { (aiBy[x.candidate_id] = aiBy[x.candidate_id] || []).push(x); }); const { data: jj } = await supabase.from("jobs").select("id,title"); (jj || []).forEach((j: any) => { jt[j.id] = j.title; }); }
      setLbRows(lb);
      const ranked = rankCandidates(list, filters, aiBy, jt).filter(h => h.pct > 0 || !terms.length);
      setHits(ranked);
    } catch (e: any) { say("Search failed: " + (e?.message || e), false); }
    setBusy(false); setDone(true);
  }, [say]);
  const go = useCallback(async (text?: string) => {
    const query = (text ?? q).trim(); if (!query) return; if (text) setQ(text);
    setBusy(true); const filters = await aiParse(query); await run(filters, query);
  }, [q, run]);
  // Juicebox-style editable filters: remove/add a chip → re-run instantly with the edited filters.
  const editF = (fn2: (x: Filters) => Filters) => { if (f) run(fn2({ ...f, titles: [...f.titles], skills: [...f.skills], keywords: [...f.keywords], locations: [...f.locations] }), q); };
  const dropChip = (kind: "titles" | "skills" | "keywords" | "locations", v: string) => editF(x => ({ ...x, [kind]: x[kind].filter(t => t !== v) }));
  const [addKind, setAddKind] = useState<"titles" | "skills" | "keywords" | "locations">("skills"); const [addVal, setAddVal] = useState("");
  function addChip() { const v = addVal.trim().toLowerCase(); if (!v) return; setAddVal(""); editF(x => ({ ...x, [addKind]: Array.from(new Set([...x[addKind], v])) })); }

  useEffect(() => { if (pr?.q && !autoRan) { setAutoRan(true); go(pr.q); } /* eslint-disable-next-line */ }, [pr?.q, autoRan]);
  const shown = useMemo(() => hits.filter(h => h.pct >= minPct && (!onlyPhone || h.c.phone) && (status === "all" || h.c.status === status)), [hits, minPct, onlyPhone, status]);
  const ids = () => Array.from(sel);
  function toggle(id: string) { setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  /* --- Actions on selected ATS people --- */
  const [act, setAct] = useState<"" | "job" | "pool" | "screen">("");
  const [seqFor, setSeqFor] = useState<any[] | null>(null); const [aiFor, setAiFor] = useState<any[] | null>(null); const [closeBusy, setCloseBusy] = useState("");
  const selCands = () => hits.filter(h => sel.has(h.c.id)).map(h => h.c);
  async function bulkClose() {
    const list = ids(); if (!list.length) return; setCloseBusy(`0/${list.length}`);
    const r = await pushToClose(list, (d, t) => setCloseBusy(`${d}/${t}`)); setCloseBusy("");
    await Promise.all(list.map(id => logActivity("note", "Synced to Close as a lead from Search", { candidate_id: id }, profile?.id)));
    say(`${r.ok} in Close (${r.created} new leads)${r.failed.length ? ` · ${r.failed.length} failed: ${r.failed[0]}` : ""}.`, !r.failed.length);
  }
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
  const [apJob, setApJob] = useState(""); const [apN, setApN] = useState(25); const [apRun, setApRun] = useState<{ done: number; total: number; ok: number; bad: number } | null>(null);
  async function autopilot() {
    if (!apJob || apRun) return; const job = jobs.find(j => j.id === apJob);
    const already = new Set(lbRows.filter(r => r.job_id === apJob).map(r => r.candidate_id));
    const todo = shown.map(h => h.c.id).filter(id => !already.has(id)).slice(0, apN);
    if (!todo.length) { say(`Everyone in the top ${apN} is already ranked for ${job?.title}. Open Rank to review.`); return; }
    if (!confirm(`Autopilot will AI-screen ${todo.length} people against “${job?.title}” (uses Claude credits, ~20s each, 3 at a time). Continue?`)) return;
    const st = { done: 0, total: todo.length, ok: 0, bad: 0 }; setApRun({ ...st });
    for (let i = 0; i < todo.length; i += 3) {
      await Promise.all(todo.slice(i, i + 3).map(async id => { try { await fn("screening-agent", { action: "screen", candidate_id: id, job_id: apJob }, { timeoutMs: 180000 }); st.ok++; } catch { st.bad++; } st.done++; setApRun({ ...st }); }));
    }
    setApRun(null); say(`Autopilot ranked ${st.ok} for ${job?.title}${st.bad ? ` (${st.bad} failed)` : ""}. Opening the ranked slate…`, !st.bad);
    nav("rank", { job_id: apJob });
  }
  function saveSearch() { if (!q.trim()) return; const next = [{ q: q.trim(), at: Date.now() }, ...saved.filter(s => s.q !== q.trim())].slice(0, 12); setSaved(next); try { localStorage.setItem("ss_saved_searches", JSON.stringify(next)); } catch { /* ignore */ } say("Search saved."); }

  /* --- Apollo (people you don't have yet) --- */
  async function searchApollo(page = 1) {
    if (!f) return; setExtBusy(true); setExtErr(""); setExtPage(page);
    const titles = f.titles.length ? f.titles : f.keywords.slice(0, 3); const locations = f.locations.map(l => l.replace(/\b\w/g, ch => ch.toUpperCase()));
    try {
      let d: any;
      if (page === 1 && !apF) {
        // Let Claude turn the plain-English query into Apollo filters (seniority, company size, industry…)
        try { d = await fn("outreach-agent", { action: "nl_search", query: q, per_page: 25 }, { timeoutMs: 45000 }); setApF(d.filters || null); }
        catch { d = await fn("outreach-agent", { action: "search", page, per_page: 25, titles, locations, industry_keywords: f.skills.slice(0, 3), verified_only: false }); }
      } else {
        const base = apF || { titles, locations, industry_keywords: f.skills.slice(0, 3), verified_only: false };
        d = await fn("outreach-agent", { action: "search", ...base, page, per_page: 25 });
      }
      setExt(d.people || []); setExtTot(d.total ?? 0);
    }
    catch (e: any) { setExtErr(e?.message || String(e)); }
    setExtBusy(false);
  }
  async function importApollo() {
    const picks = Object.keys(extSel).filter(k => extSel[k]); if (!picks.length) return;
    if (!confirm(`Import ${picks.length} people from Apollo? Reveals emails and uses up to ${picks.length} credits.`)) return;
    try { const d: any = await fn("outreach-agent", { action: "import", apollo_ids: picks.slice(0, 25), job_id: null, campaign_id: null, source_label: "search" }); say(`${d.imported || 0} imported${d.dupes ? `, ${d.dupes} already in ATS` : ""}. Re-ranking — select them on the Your ATS tab to sequence or push to Close.`); setExtSel({}); if (d.imported) { setScope("ats"); go(); } } catch (e: any) { say(e?.message || String(e), false); }
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
    {f && done && <div className="flex items-center gap-1.5 flex-wrap mb-3 text-[11px] text-gray-500">
      <span>Filters:</span>
      {([["titles", "bg-slate-800 text-white", "title: "], ["skills", "bg-blue-50 text-blue-700", "skill: "], ["keywords", "bg-gray-100 text-gray-600", ""], ["locations", "bg-emerald-50 text-emerald-700", "📍 "]] as const).map(([k, cls, pre]) => (f[k] as string[]).filter(t => k !== "keywords" || (!f.titles.includes(t) && !f.skills.includes(t))).map(t => <span key={k + t} className={`pl-2 pr-1 py-0.5 rounded-full flex items-center gap-1 ${cls}`}>{pre}{t}<button onClick={() => dropChip(k, t)} title="Remove filter and re-run" className="opacity-60 hover:opacity-100 px-0.5">×</button></span>))}
      {f.min_years ? <span className="pl-2 pr-1 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">{f.min_years}+ yrs<button onClick={() => editF(x => ({ ...x, min_years: null }))} className="opacity-60 hover:opacity-100 px-0.5">×</button></span> : null}
      <span className="flex items-center gap-1 ml-1"><select value={addKind} onChange={e => setAddKind(e.target.value as any)} className="border rounded px-1 py-0.5 bg-white"><option value="titles">title</option><option value="skills">skill</option><option value="keywords">keyword</option><option value="locations">location</option></select><input value={addVal} onChange={e => setAddVal(e.target.value)} onKeyDown={e => e.key === "Enter" && addChip()} placeholder="+ add filter" className="border rounded px-1.5 py-0.5 w-28" /></span>
      <button onClick={saveSearch} className="ml-auto text-blue-600 hover:underline">Save search</button>
    </div>}
    {done && <div className="flex gap-2 mb-3 border-b"><button onClick={() => setScope("ats")} className={`px-3 py-2 text-sm border-b-2 ${scope === "ats" ? "border-slate-800 font-medium" : "border-transparent text-gray-400"}`}>Your ATS <span className="text-xs text-gray-400">({shown.length})</span></button><button onClick={() => setScope("apollo")} className={`px-3 py-2 text-sm border-b-2 ${scope === "apollo" ? "border-slate-800 font-medium" : "border-transparent text-gray-400"}`}>Beyond your ATS · Apollo {extTot != null && <span className="text-xs text-gray-400">({extTot.toLocaleString()})</span>}</button><button onClick={() => setScope("insights")} className={`px-3 py-2 text-sm border-b-2 ${scope === "insights" ? "border-slate-800 font-medium" : "border-transparent text-gray-400"}`}>Talent insights</button></div>}

    {scope === "ats" && done && <>
      <div className="flex gap-2 items-center flex-wrap mb-3">
        <select value={minPct} onChange={e => setMinPct(Number(e.target.value))} className="px-2 py-1.5 border rounded-lg text-xs bg-white"><option value={0}>Any match</option><option value={40}>40%+</option><option value={60}>60%+</option><option value={80}>80%+</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs bg-white"><option value="all">Any status</option>{["new", "contacted", "screening", "submitted", "interviewing", "on_bench", "placed", "terminated"].map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={onlyPhone} onChange={e => setOnlyPhone(e.target.checked)} />has phone</label>
        <span className="text-xs text-gray-400 ml-auto">{shown.length} people</span>
        <Btn small onClick={() => exportCsv("search-results", shown.map(h => ({ match: h.pct, name: fullName(h.c), title: h.c.current_title, company: h.c.current_company, email: h.c.email, phone: h.c.phone, location: [h.c.city, h.c.state, h.c.country].filter(Boolean).join(", "), status: h.c.status, ai_score: h.ai?.score, signals: h.signals.join(" | ") })))}>Export CSV</Btn>
      </div>
      {editable && shown.length > 0 && <div className="flex items-center gap-2 mb-3 p-2 rounded-lg border border-teal-200 bg-teal-50/60 text-xs flex-wrap">
        <span className="font-semibold text-teal-800">✦ Autopilot</span><span className="text-teal-700">AI-rank the top</span>
        <select value={apN} onChange={e => setApN(Number(e.target.value))} className="px-1.5 py-1 border rounded bg-white">{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select>
        <span className="text-teal-700">against</span>
        <select value={apJob} onChange={e => setApJob(e.target.value)} className="px-1.5 py-1 border rounded bg-white max-w-[220px]"><option value="">pick a job…</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <Btn small primary disabled={!apJob || !!apRun} onClick={autopilot}>{apRun ? `Ranking ${apRun.done}/${apRun.total}…` : "Run"}</Btn>
        <span className="text-gray-500 ml-auto">Per-criterion verdicts land on the Rank page; people already ranked for that job are skipped.</span>
      </div>}
      {editable && sel.size > 0 && <div className="flex items-center gap-2 mb-3 p-2 bg-slate-800 rounded-lg text-white text-sm flex-wrap"><span className="px-2">{sel.size} selected</span>
        <select onChange={e => { if (e.target.value) addToJob(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">Add to job slate…</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select onChange={e => { if (e.target.value) screenFor(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">✦ AI-screen for job…</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select onChange={e => { if (e.target.value) addToPool(e.target.value); e.target.value = ""; }} className="px-2 py-1 rounded text-slate-800 text-xs"><option value="">Add to pool…</option>{pools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={() => setAiFor(selCands())} className="text-xs px-2 py-1 rounded bg-violet-500 hover:bg-violet-400 text-white font-medium" title="Claude writes a personalized email for each person; you review, then send from Gmail">✦ AI emails</button>
        <button onClick={() => setSeqFor(selCands())} className="text-xs px-2 py-1 rounded bg-teal-500 hover:bg-teal-400 text-white font-medium">➤ Apollo sequence</button>
        <button disabled={!!closeBusy} onClick={bulkClose} className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20">{closeBusy ? `Syncing ${closeBusy}…` : "⇪ Push to Close"}</button>
        <button onClick={() => setSel(new Set())} className="text-xs px-2 py-1 ml-auto">Clear</button></div>}
      {shown.length === 0 ? <Empty t={hits.length ? "Nothing passes these filters." : "No one in your ATS matches yet. Try the Apollo tab, or loosen the query."} /> : <div className="bg-white rounded-xl border divide-y">
        {editable && <div className="px-4 py-1.5 text-[11px] text-gray-400 flex items-center gap-2"><input type="checkbox" checked={sel.size > 0 && sel.size === shown.length} onChange={e => setSel(e.target.checked ? new Set(shown.map(h => h.c.id)) : new Set())} className="w-4 h-4" /> select all shown</div>}
        {shown.slice(0, 150).map(h => <div key={h.c.id} className="px-4 py-3 flex gap-3 hover:bg-gray-50">
          {editable && <input type="checkbox" checked={sel.has(h.c.id)} onChange={() => toggle(h.c.id)} className="w-4 h-4 mt-2" />}
          <Av n={fullName(h.c)} sz="w-9 h-9 text-xs" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><span className="relative group"><span onClick={() => nav("det", { id: h.c.id })} className="font-medium cursor-pointer hover:underline">{fullName(h.c)}</span><Preview h={h} /></span><Pct p={h.pct} /><Fit p={h.pct} /><B s={h.c.status} />{h.ai && <span className={`text-[10px] font-semibold ${scoreText(h.ai.score)}`}>AI {h.ai.score} · #{h.ai.rank} {h.ai.job}</span>}</div>
            <div className="text-xs text-gray-500 mt-0.5">{h.c.current_title || "—"}{h.c.current_company ? ` @ ${h.c.current_company}` : ""}{(h.c.city || h.c.country) ? ` · ${[h.c.city, h.c.state, h.c.country].filter(Boolean).join(", ")}` : ""}{h.c.source ? ` · via ${h.c.source}` : ""}</div>
            <div className="flex gap-1 flex-wrap mt-1.5">{h.signals.slice(0, 6).map((s, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ {s}</span>)}</div>
            {summaryOf(h.c) && <div className="text-[11px] text-gray-600 mt-1 line-clamp-2">✦ {summaryOf(h.c)}</div>}
            {h.evidence.length > 0 && <div className="text-[11px] text-gray-400 italic mt-1 truncate" title={h.evidence.join("\n")}>{h.evidence[0]}</div>}
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0 text-xs">{h.c.phone && <span className="text-gray-500">{h.c.phone}</span>}{h.c.email && <span className="text-gray-400 truncate max-w-[180px]">{h.c.email}</span>}
            {editable && <div className="flex gap-1 mt-0.5">{h.c.phone && <button onClick={() => callCandidate(h.c, say, profile?.id)} title="Call via Close" className="px-1.5 py-0.5 border rounded hover:bg-white">☎</button>}{h.c.phone && <button onClick={() => smsCandidate(h.c, say, profile?.id)} title="Text via Close" className="px-1.5 py-0.5 border rounded hover:bg-white">💬</button>}{h.c.email && <button onClick={() => setSeqFor([h.c])} title="Add to Apollo sequence" className="px-1.5 py-0.5 border rounded hover:bg-white">➤</button>}<button onClick={() => openInClose(h.c, say)} title="Open / create lead in Close" className="px-1.5 py-0.5 border rounded hover:bg-white">Close</button></div>}
            <button onClick={() => nav("det", { id: h.c.id })} className="text-blue-600 hover:underline">Open ↗</button></div>
        </div>)}
      </div>}
    </>}

    {scope === "insights" && done && <Insights hits={shown} ext={ext} extTot={extTot} />}
    {seqFor && <SequenceModal cands={seqFor} onClose={() => setSeqFor(null)} onDone={() => setSel(new Set())} />}
    {aiFor && <AIOutreachModal cands={aiFor} onClose={() => setAiFor(null)} onDone={() => setSel(new Set())} />}
    {scope === "apollo" && done && <div>
      {extErr && <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600">{extErr}</div>}
      {apF && <div className="flex gap-1.5 flex-wrap items-center mb-2 text-[11px] text-gray-500"><span>Apollo filters (AI):</span>{[...(apF.titles || []).map((t: string) => "title: " + t), ...(apF.locations || []).map((t: string) => "📍 " + t), ...(apF.seniorities || []).map((t: string) => "seniority: " + t), ...(apF.employee_ranges || []).map((t: string) => "company size: " + t.replace(",", "–")), ...(apF.industry_keywords || []).map((t: string) => "industry: " + t), ...(apF.keywords ? ["keywords: " + apF.keywords] : [])].map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">{t}</span>)}<button onClick={() => { setApF(null); setTimeout(() => searchApollo(1), 0); }} className="text-blue-600 hover:underline ml-1">re-parse</button></div>}
      {extTot != null && extTot > 25 && !extBusy && <div className="flex items-center gap-2 mb-2 text-xs text-gray-500"><Btn small disabled={extPage <= 1} onClick={() => searchApollo(extPage - 1)}>← Prev</Btn><span>Page {extPage} of {Math.min(Math.ceil(extTot / 25), 500).toLocaleString()}</span><Btn small disabled={extPage * 25 >= extTot} onClick={() => searchApollo(extPage + 1)}>Next →</Btn></div>}
      {extBusy ? <Empty t="Searching Apollo…" /> : ext.length === 0 ? <Empty t={extErr ? "" : "No Apollo matches for these titles/locations. Try the Sourcing tab for more filters."} /> : <div className="bg-white rounded-xl border overflow-hidden">
        {editable && <div className="flex gap-2 items-center px-3 py-2 border-b bg-gray-50/60 text-xs"><span className="text-gray-500">{Object.values(extSel).filter(Boolean).length} selected</span><Btn small onClick={() => { const n: any = {}; ext.forEach(r => n[r.apollo_id] = true); setExtSel(n); }}>Select page</Btn><Btn small primary onClick={importApollo} disabled={!Object.values(extSel).some(Boolean)}>Import to ATS</Btn><span className="text-gray-400 ml-auto">Searching is free; import spends Apollo credits and reveals emails.</span></div>}
        <table className="w-full text-sm"><thead><tr className="border-b text-left bg-gray-50/60"><th className="px-3 py-2 w-8"></th>{["Name", "Title", "Company", "Location", "Contact"].map(h => <th key={h} className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{ext.map(r => <tr key={r.apollo_id} className="hover:bg-gray-50"><td className="px-3 py-2"><input type="checkbox" checked={!!extSel[r.apollo_id]} onChange={e => setExtSel({ ...extSel, [r.apollo_id]: e.target.checked })} className="w-4 h-4" /></td><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 text-gray-500">{r.title}</td><td className="px-3 py-2 text-gray-500">{r.company}</td><td className="px-3 py-2 text-gray-500 text-xs">{[r.city, r.state, r.country].filter(Boolean).join(", ")}</td><td className="px-3 py-2 text-[10px]"><span className={"px-1.5 py-0.5 rounded font-semibold mr-1 " + (r.has_email ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>@</span><span className={"px-1.5 py-0.5 rounded font-semibold " + (r.has_phone ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400")}>tel</span>{r.linkedin_url && <a href={r.linkedin_url} target="_blank" rel="noreferrer" className="ml-2 text-blue-600">in</a>}</td></tr>)}</tbody></table>
      </div>}
    </div>}
  </div>;
}

/* ---------------- Fit label, AI summary, hover preview ---------------- */
function Fit({ p }: { p: number }) { const [t, cls] = p >= 70 ? ["Good match", "bg-green-50 text-green-700"] : p >= 40 ? ["Potential fit", "bg-amber-50 text-amber-700"] : ["Not a match", "bg-gray-100 text-gray-500"]; return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{t}</span>; }
function aiObj(c: any) { const a = c?.ai_analysis; if (!a) return null; if (typeof a === "object") return a; try { return JSON.parse(a); } catch { return { summary: String(a) }; } }
function summaryOf(c: any): string { const a = aiObj(c); return String(a?.summary || c?.ai_match_reason || "").slice(0, 260); }
function txt(v: any): string { if (v == null || v === "") return ""; if (Array.isArray(v)) return v.map(x => typeof x === "object" ? Object.values(x || {}).filter(Boolean).join(" · ") : String(x)).join("; "); if (typeof v === "object") return Object.values(v).filter(Boolean).join(" · "); return String(v); }
function Preview({ h }: { h: Hit }) {
  const c = h.c; const a = aiObj(c);
  return <div className="hidden group-hover:block absolute z-40 left-0 top-5 w-[26rem] bg-white border rounded-xl shadow-xl p-3 text-xs text-gray-700 cursor-default">
    <div className="flex items-center gap-2 mb-1"><span className="font-semibold text-sm">{fullName(c)}</span><Pct p={h.pct} /><Fit p={h.pct} />{c.overall_score != null && <span className={`text-[10px] font-semibold ${scoreText(c.overall_score)}`}>AI {c.overall_score}</span>}</div>
    <div className="text-gray-500 mb-2">{c.current_title || "—"}{c.current_company ? ` @ ${c.current_company}` : ""}{c.experience_years ? ` · ${c.experience_years} yrs` : ""}{(c.city || c.country) ? ` · ${[c.city, c.state, c.country].filter(Boolean).join(", ")}` : ""}</div>
    {summaryOf(c) && <p className="mb-2">✦ {summaryOf(c)}</p>}
    {a?.strengths?.length > 0 && <div className="mb-1.5"><span className="font-medium text-green-700">Strengths: </span>{a.strengths.slice(0, 3).join(" · ")}</div>}
    {a?.concerns?.length > 0 && <div className="mb-1.5"><span className="font-medium text-red-600">Concerns: </span>{a.concerns.slice(0, 2).join(" · ")}</div>}
    {(c.skills || []).length > 0 && <div className="flex flex-wrap gap-1 mb-1.5">{c.skills.slice(0, 12).map((s: string) => <span key={s} className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">{s}</span>)}</div>}
    {txt(c.education) && <div className="mb-1"><span className="text-gray-400">Education: </span>{txt(c.education).slice(0, 160)}</div>}
    {txt(c.certifications) && <div className="mb-1"><span className="text-gray-400">Licenses/certs: </span>{txt(c.certifications).slice(0, 160)}</div>}
    {h.signals.length > 0 && <div className="mt-1.5 text-emerald-700">{h.signals.slice(0, 6).map(s => "✓ " + s).join("  ")}</div>}
    {h.evidence[0] && <div className="mt-1.5 italic text-gray-400">{h.evidence[0]}</div>}
  </div>;
}

/* ---------------- Talent insights (market map of the current results) ---------------- */
function tally(xs: string[], n = 8) { const m = new Map<string, number>(); xs.filter(Boolean).forEach(x => { const k = x.trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n); }
function Bars({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  return <div className="bg-white rounded-xl border p-4"><h3 className="text-sm font-medium mb-2">{title}</h3>{rows.length === 0 ? <p className="text-xs text-gray-400">No data</p> : rows.map(([k, n]) => <div key={k} className="mb-1.5"><div className="flex justify-between text-xs"><span className="truncate pr-2">{k}</span><span className="text-gray-400 tabular-nums">{n} · {Math.round((n / Math.max(total, 1)) * 100)}%</span></div><div className="h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-teal-500" style={{ width: `${(n / Math.max(rows[0][1], 1)) * 100}%` }} /></div></div>)}</div>;
}
function Insights({ hits, ext, extTot }: { hits: Hit[]; ext: any[]; extTot: number | null }) {
  const cs = hits.map(h => h.c); const n = cs.length;
  const exp = cs.map(c => Number(c.experience_years)).filter(x => x > 0).sort((a, b) => a - b); const med = exp.length ? exp[Math.floor(exp.length / 2)] : null;
  const band = (y: number) => y < 2 ? "0–2 yrs" : y < 5 ? "2–5 yrs" : y < 10 ? "5–10 yrs" : "10+ yrs";
  const rates = cs.map(c => Number(c.min_hourly_rate)).filter(x => x > 0).sort((a, b) => a - b); const medRate = rates.length ? rates[Math.floor(rates.length / 2)] : null;
  const pct = (k: (c: any) => boolean) => n ? Math.round((cs.filter(k).length / n) * 100) : 0;
  const Stat = ({ l, v }: { l: string; v: string }) => <div className="bg-white rounded-xl border p-3"><div className="text-[10px] uppercase tracking-wider text-gray-400">{l}</div><div className="text-lg font-semibold">{v}</div></div>;
  return <div>
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
      <Stat l="In your ATS" v={n.toLocaleString()} /><Stat l="In the market (Apollo)" v={extTot != null ? extTot.toLocaleString() : "open Apollo tab"} /><Stat l="Good matches (70%+)" v={String(hits.filter(h => h.pct >= 70).length)} />
      <Stat l="Reachable by phone" v={pct(c => !!c.phone) + "%"} /><Stat l="Median experience" v={med != null ? `${med} yrs` : "—"} /><Stat l="Median ask" v={medRate != null ? `$${medRate}/h` : "—"} />
    </div>
    <div className="grid md:grid-cols-3 gap-3">
      <Bars title="Where they are" rows={tally(cs.map(c => [c.state || c.city, c.country].filter(Boolean).join(", ")))} total={n} />
      <Bars title="Current titles" rows={tally(cs.map(c => c.current_title || ""))} total={n} />
      <Bars title="Top skills" rows={tally(cs.flatMap(c => (c.skills || []).map((s: string) => String(s).toLowerCase())), 10)} total={n} />
      <Bars title="Current employers" rows={tally(cs.map(c => c.current_company || ""))} total={n} />
      <Bars title="Experience" rows={tally(exp.map(band), 4)} total={exp.length} />
      <Bars title="Pipeline status" rows={tally(cs.map(c => String(c.status || "").replace(/_/g, " ")))} total={n} />
      {ext.length > 0 && <Bars title={`Apollo sample: locations (${ext.length})`} rows={tally(ext.map(p => [p.state || p.city, p.country].filter(Boolean).join(", ")))} total={ext.length} />}
      {ext.length > 0 && <Bars title="Apollo sample: employers" rows={tally(ext.map(p => p.company))} total={ext.length} />}
      {ext.length > 0 && <Bars title="Apollo sample: industries" rows={tally(ext.map(p => p.company_industry || ""))} total={ext.length} />}
    </div>
    <p className="text-[11px] text-gray-400 mt-3">Built from the current search results (after filters). Apollo panels use the current Apollo page; total market size is Apollo&rsquo;s full match count.</p>
  </div>;
}
