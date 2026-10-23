"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useToast, Btn } from "@/lib/ui";

// Professional categories and recorded location are kept apart from status and title:
// categories live in candidate_category_links, location in candidate_locations.
// Links are never deleted; removing one switches it off (active = false).
export const US = "United States";
export type Cat = { id: string; slug: string; name: string; kind: string; country: string | null; group_by_state: boolean; sort_order: number };
export type Link = { category_id: string; source: string; evidence?: string | null; active: boolean };
export type Loc = { country: string | null; us_state: string | null; source?: string; raw?: string | null } | null;

let catCache: Cat[] | null = null;
export function useCategories() {
  const [cats, setCats] = useState<Cat[]>(catCache || []);
  useEffect(() => { if (catCache) return; supabase.from("candidate_categories").select("id,slug,name,kind,country,group_by_state,sort_order").eq("active", true).order("sort_order").then(({ data }) => { catCache = (data || []) as Cat[]; setCats(catCache); }); }, []);
  return cats;
}
export function useLocationOptions() {
  const [opts, setOpts] = useState<{ country: string; us_state: string | null; n: number }[]>([]);
  useEffect(() => { supabase.from("candidate_location_options").select("country,us_state,n").order("country").then(({ data }) => setOpts((data || []) as any)); }, []);
  return opts;
}

/** "Registered Nurse - US" becomes "Registered Nurse - Texas" when the candidate's US state is known. */
export function catLabel(cat: Cat, loc?: Loc) {
  if (!cat.group_by_state) return cat.name;
  const base = cat.name.replace(/\s*[-–]\s*US$/, "");
  return `${base} - ${loc?.us_state || "Other US Locations"}`;
}

const TONE: Record<string, string> = { profession: "bg-teal-50 text-teal-800 border-teal-100", experience: "bg-amber-50 text-amber-800 border-amber-100" };
export function CategoryChips({ links, cats, loc, max = 3 }: { links?: Link[]; cats: Cat[]; loc?: Loc; max?: number }) {
  const on = (links || []).filter(l => l.active).map(l => ({ l, cat: cats.find(c => c.id === l.category_id) })).filter(x => x.cat && x.cat.kind === "profession") as { l: Link; cat: Cat }[];
  if (!on.length) return null;
  on.sort((a, b) => a.cat.sort_order - b.cat.sort_order);
  return <div className="flex flex-wrap gap-1 mt-1">{on.slice(0, max).map(({ l, cat }) => <span key={cat.id} title={l.evidence ? `Matched: "${l.evidence}"` : l.source} className={`px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${TONE[cat.kind] || TONE.profession}`}>{catLabel(cat, loc)}</span>)}{on.length > max && <span className="text-[10px] text-gray-400">+{on.length - max}</span>}</div>;
}

/** Profile card: recorded location plus categories, with manual add / remove / location override. */
export function CategoryPanel({ candidateId, editable }: { candidateId: string; editable: boolean }) {
  const { say } = useToast(); const cats = useCategories();
  const [links, setLinks] = useState<Link[]>([]); const [loc, setLoc] = useState<Loc>(null); const [editLoc, setEditLoc] = useState(false); const [ctry, setCtry] = useState(""); const [st, setSt] = useState("");
  const load = useCallback(async () => {
    const [{ data: l }, { data: lc }] = await Promise.all([
      supabase.from("candidate_category_links").select("category_id,source,evidence,active").eq("candidate_id", candidateId),
      supabase.from("candidate_locations").select("country,us_state,source,raw").eq("candidate_id", candidateId).maybeSingle(),
    ]);
    setLinks((l || []) as Link[]); setLoc((lc as any) || null); setCtry((lc as any)?.country || ""); setSt((lc as any)?.us_state || "");
  }, [candidateId]);
  useEffect(() => { load(); }, [load]);
  async function setLink(category_id: string, active: boolean) {
    // A manual choice is sticky: automatic re-classification only touches links whose source is "auto".
    const { error } = await supabase.from("candidate_category_links").upsert({ candidate_id: candidateId, category_id, source: "manual", active, evidence: active ? "Added by recruiter" : "Removed by recruiter" }, { onConflict: "candidate_id,category_id" });
    if (error) { say(error.message, false); return; } load();
  }
  async function saveLoc() {
    const country = ctry.trim() || null; const us_state = country === US ? (st.trim() || null) : null;
    const { error } = await supabase.from("candidate_locations").upsert({ candidate_id: candidateId, country, us_state, source: "manual", raw: [us_state, country].filter(Boolean).join(", ") || null, updated_at: new Date().toISOString() }, { onConflict: "candidate_id" });
    if (error) { say(error.message, false); return; } setEditLoc(false); say("Location saved."); load();
  }
  const active = links.filter(l => l.active).map(l => ({ l, cat: cats.find(c => c.id === l.category_id) })).filter(x => x.cat) as { l: Link; cat: Cat }[];
  active.sort((a, b) => a.cat.sort_order - b.cat.sort_order);
  const addable = cats.filter(c => !active.some(a => a.cat.id === c.id) && (!c.country || c.country === loc?.country));
  return <div className="bg-white rounded-xl border p-4">
    <h3 className="text-sm font-medium mb-3">Categories &amp; location</h3>
    <div className="flex justify-between items-start py-1 border-b border-gray-50 text-xs gap-3 mb-3"><span className="text-gray-400 shrink-0">Recorded location</span>
      {editLoc ? <div className="flex flex-wrap gap-1 justify-end"><input value={ctry} onChange={e => setCtry(e.target.value)} placeholder="Country" list="cat-countries" className="px-2 py-1 border rounded text-xs w-32" /><datalist id="cat-countries"><option value="Philippines" /><option value={US} /></datalist>{ctry === US && <input value={st} onChange={e => setSt(e.target.value)} placeholder="State" className="px-2 py-1 border rounded text-xs w-28" />}<Btn small primary onClick={saveLoc}>Save</Btn><Btn small onClick={() => setEditLoc(false)}>Cancel</Btn></div>
        : <span className="text-right">{loc?.country ? <>{[loc.us_state, loc.country].filter(Boolean).join(", ")} <span className="text-gray-400">({loc.source === "resume" ? "from résumé" : loc.source === "manual" ? "set by recruiter" : "from profile"})</span></> : <span className="text-gray-400">Not recorded — left unclassified</span>}{editable && <button onClick={() => setEditLoc(true)} className="ml-2 text-blue-600 hover:underline">edit</button>}</span>}
    </div>
    {active.length ? <div className="flex flex-wrap gap-1.5">{active.map(({ l, cat }) => <span key={cat.id} title={l.evidence ? `${l.source === "auto" ? "Matched" : ""} ${l.evidence}`.trim() : ""} className={`px-2 py-0.5 rounded-full border text-[11px] flex items-center gap-1 ${TONE[cat.kind] || TONE.profession}`}>{catLabel(cat, loc)}{l.source === "manual" && <span className="text-[9px] opacity-60">manual</span>}{editable && <button onClick={() => setLink(cat.id, false)} className="opacity-50 hover:opacity-100" aria-label={`Remove ${cat.name}`}>×</button>}</span>)}</div>
      : <p className="text-xs text-gray-400">No category yet. Categories are added automatically when the profile or résumé shows the experience and a location is recorded.</p>}
    {editable && addable.length > 0 && <select value="" onChange={e => e.target.value && setLink(e.target.value, true)} className="mt-3 px-2 py-1 border rounded-lg text-xs bg-white"><option value="">+ Add category…</option>{addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
  </div>;
}
