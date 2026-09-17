"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Section } from "@/lib/auth";
import { Av, ToastProvider, fullName } from "@/lib/ui";
import { Rank } from "./rank";
import { Dash } from "@/components/dashboard";
import { Search } from "@/components/search";
import { Cands, Det } from "@/components/candidates";
import { Jobs, JobDetail } from "@/components/jobs";
import { Pipeline } from "@/components/pipeline";
import { Clients, ClientDetail } from "@/components/clients";
import { Interviews } from "@/components/interviews";
import { Tasks } from "@/components/tasks";
import { Reports } from "@/components/reports";
import { Placements } from "@/components/placements";
import { Pools, PoolDetail } from "@/components/pools";
import { Settings } from "@/components/settings";
import { ClientPortal } from "@/components/portal";
import { ChatWidget } from "@/components/chat";
import { Sourcing, Campaigns, ClaudeSearch } from "@/components/sourcing";
import { Login } from "@/components/login";

/* ---------------- Shell ---------------- */
type NavItem = { id: Section; l: string; i: string };
const GROUPS: { t: string; items: NavItem[] }[] = [
  { t: "Work", items: [{ id: "dash", l: "Dashboard", i: "▦" }, { id: "search", l: "Search", i: "⌕" }, { id: "jobs", l: "Jobs", i: "◧" }, { id: "cands", l: "Candidates", i: "◉" }, { id: "pipeline", l: "Pipeline", i: "⇶" }, { id: "rank", l: "Rank", i: "★" }, { id: "interviews", l: "Interviews", i: "▤" }, { id: "tasks", l: "Tasks", i: "✓" }] },
  { t: "Grow", items: [{ id: "sourcing", l: "Sourcing (Apollo)", i: "◎" }, { id: "claudesearch", l: "Claude Search", i: "✦" }, { id: "campaigns", l: "Campaigns", i: "➤" }] },
  { t: "Manage", items: [{ id: "clients", l: "Clients", i: "▣" }, { id: "placements", l: "Placements", i: "◆" }, { id: "pools", l: "Talent pools", i: "❖" }, { id: "reports", l: "Reports", i: "▥" }, { id: "settings", l: "Settings", i: "⚙" }] },
];
const PARENT: Record<string, string> = { det: "cands", job: "jobs", client: "clients", pool: "pools" };

function readHash(): { pg: string; pr: any } { try { const h = decodeURIComponent(location.hash.replace(/^#\/?/, "")); if (!h) return { pg: "dash", pr: {} }; const [pg, qs] = h.split("?"); const pr: any = {}; new URLSearchParams(qs || "").forEach((v, k) => { pr[k] = v; }); return { pg: pg || "dash", pr }; } catch { return { pg: "dash", pr: {} }; } }
function writeHash(pg: string, pr: any) { try { const qs = new URLSearchParams(); Object.entries(pr || {}).forEach(([k, v]) => { if (v != null && v !== "" && typeof v !== "object" && typeof v !== "boolean") qs.set(k, String(v)); }); const s = "#/" + pg + (qs.toString() ? "?" + qs.toString() : ""); if (location.hash !== s) history.pushState(null, "", s); } catch { /* */ } }

export default function Home() {
  const { profile, loading, signOut } = useAuth();
  const [pg, setPg] = useState<string>("dash"); const [pr, setPr] = useState<any>({}); const [ready, setReady] = useState(false);
  const [gq, setGq] = useState(""); const [gres, setGres] = useState<any[]>([]); const [side, setSide] = useState(true);
  const nav = useCallback((p: string, d: any = {}) => { setPg(p); setPr(d); setGq(""); setGres([]); writeHash(p, d); window.scrollTo({ top: 0 }); }, []);
  useEffect(() => { const h = readHash(); setPg(h.pg); setPr(h.pr); setReady(true); const on = () => { const x = readHash(); setPg(x.pg); setPr(x.pr); }; window.addEventListener("popstate", on); return () => window.removeEventListener("popstate", on); }, []);
  useEffect(() => { try { const s = localStorage.getItem("ss_side"); if (s === "0") setSide(false); } catch { /* */ } }, []);
  useEffect(() => { if (gq.trim().length < 2) { setGres([]); return; } const t = setTimeout(async () => { const { data } = await supabase.from("candidates").select("id,first_name,last_name,current_title,email").or(`first_name.ilike.%${gq}%,last_name.ilike.%${gq}%,email.ilike.%${gq}%,current_title.ilike.%${gq}%,phone.ilike.%${gq}%`).limit(7); setGres(data || []); }, 200); return () => clearTimeout(t); }, [gq]);
  if (loading || !ready) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!profile) return <Login />;
  if (profile.role === "client_user") return <ClientPortal />;
  const role = profile.role; const editable = canEdit(role);
  const allowed = (s: string) => can(role, s as Section);
  const R = () => {
    switch (pg) {
      case "dash": return <Dash nav={nav} />;
      case "search": return allowed("search") ? <Search key={pr.q || ""} nav={nav} editable={editable} pr={pr} /> : <Denied />;
      case "cands": return allowed("cands") ? <Cands nav={nav} editable={editable} pr={pr} /> : <Denied />;
      case "det": return allowed("cands") ? <Det nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "pipeline": return allowed("pipeline") ? <Pipeline nav={nav} editable={editable} pr={pr} /> : <Denied />;
      case "rank": return allowed("rank") ? <Rank nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "jobs": return allowed("jobs") ? <Jobs nav={nav} editable={editable} pr={pr} /> : <Denied />;
      case "job": return allowed("jobs") ? <JobDetail key={pr.id} nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "clients": return allowed("clients") ? <Clients nav={nav} editable={editable} /> : <Denied />;
      case "client": return allowed("clients") ? <ClientDetail nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "placements": return allowed("placements") ? <Placements nav={nav} editable={editable} /> : <Denied />;
      case "pools": return allowed("pools") ? <Pools nav={nav} editable={editable} /> : <Denied />;
      case "pool": return allowed("pools") ? <PoolDetail nav={nav} pr={pr} editable={editable} /> : <Denied />;
      case "interviews": return allowed("interviews") ? <Interviews nav={nav} editable={editable} /> : <Denied />;
      case "tasks": return allowed("tasks") ? <Tasks /> : <Denied />;
      case "reports": return allowed("reports") ? <Reports /> : <Denied />;
      case "sourcing": return allowed("sourcing") ? <Sourcing editable={editable} /> : <Denied />;
      case "claudesearch": return allowed("claudesearch") ? <ClaudeSearch editable={editable} /> : <Denied />;
      case "campaigns": case "outreach": return allowed("campaigns") ? <Campaigns editable={editable} /> : <Denied />;
      case "settings": return canManageUsers(role) ? <Settings /> : <Denied />;
      default: return <Dash nav={nav} />;
    }
  };
  const isActive = (id: string) => pg === id || PARENT[pg] === id;
  return <ToastProvider><div className="min-h-screen bg-gray-50 flex">
    <aside className={`${side ? "w-52" : "w-14"} shrink-0 bg-slate-900 text-slate-300 flex flex-col sticky top-0 h-screen transition-all`}>
      <div className="flex items-center gap-2 px-3 h-14 border-b border-white/10"><span className="w-7 h-7 rounded-lg bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">S</span>{side && <span className="font-semibold text-sm text-white truncate">Streamlined</span>}<button onClick={() => { setSide(s => { try { localStorage.setItem("ss_side", s ? "0" : "1"); } catch { /* */ } return !s; }); }} className="ml-auto text-slate-500 hover:text-white text-xs" title="Collapse">{side ? "«" : "»"}</button></div>
      <nav className="flex-1 overflow-y-auto py-2">{GROUPS.map(g => { const items = g.items.filter(it => can(role, it.id) && (it.id !== "settings" || canManageUsers(role))); if (!items.length) return null; return <div key={g.t} className="mb-3">{side && <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">{g.t}</div>}{items.map(it => <button key={it.id} onClick={() => nav(it.id)} title={it.l} className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-[13px] text-left ${isActive(it.id) ? "bg-white/10 text-white font-medium border-r-2 border-teal-400" : "hover:bg-white/5 hover:text-white"}`}><span className="w-4 text-center text-xs opacity-80">{it.i}</span>{side && <span className="truncate">{it.l}</span>}</button>)}</div>; })}</nav>
      <div className="border-t border-white/10 p-3 flex items-center gap-2"><Av n={fullName(profile)} sz="w-7 h-7 text-[10px]" />{side && <div className="min-w-0 flex-1"><div className="text-xs text-white truncate">{profile.first_name || profile.email}</div><div className="text-[10px] text-slate-500">{ROLE_LABELS[role]}</div></div>}{side && <button onClick={signOut} title="Sign out" className="text-slate-500 hover:text-white text-xs">⏻</button>}</div>
    </aside>
    <div className="flex-1 min-w-0 flex flex-col">
      <header className="bg-white border-b h-14 flex items-center px-5 gap-3 sticky top-0 z-30">
        <div className="relative flex-1 max-w-md"><input value={gq} onChange={e => setGq(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && gq.trim()) nav("search", { q: gq }); }} placeholder="Quick find a candidate… (Enter for full search)" className="w-full bg-gray-100 focus:bg-white border border-transparent focus:border-gray-300 text-[13px] rounded-lg px-3 py-1.5 outline-none" />{gres.length > 0 && <div className="absolute left-0 mt-1 w-full bg-white text-gray-800 rounded-lg shadow-lg border divide-y z-40">{gres.map(r => <div key={r.id} onClick={() => nav("det", { id: r.id })} className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"><div className="font-medium">{fullName(r)}</div><div className="text-[10px] text-gray-400">{r.current_title || r.email || ""}</div></div>)}<div onClick={() => nav("search", { q: gq })} className="px-3 py-2 text-xs text-blue-600 cursor-pointer hover:bg-gray-50">Search everything for &ldquo;{gq}&rdquo; →</div></div>}</div>
        <div className="ml-auto flex items-center gap-2">{editable && <button onClick={() => nav("cands", { add: "1" })} className="text-xs px-2.5 py-1.5 border rounded-lg hover:bg-gray-50">+ Candidate</button>}{editable && <button onClick={() => nav("jobs", { add: "1" })} className="text-xs px-2.5 py-1.5 border rounded-lg hover:bg-gray-50">+ Job</button>}</div>
      </header>
      <main className="flex-1"><div className="p-6 max-w-7xl mx-auto">{R()}</div></main>
    </div>
    <ChatWidget />
  </div></ToastProvider>;
}
function Denied() { return <div className="py-20 text-center text-gray-400 text-sm">You don&rsquo;t have access to this section.</div>; }
