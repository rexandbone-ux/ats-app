"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { logError, must } from "@/lib/errors";

export type Role = "super_admin" | "admin" | "recruiter" | "hiring_manager" | "client_user" | "candidate_user";

export type Profile = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: Role;
  is_active?: boolean;
};

// Nav sections each role can see.
export const SECTIONS = ["dash", "cands", "pipeline", "jobs", "clients", "placements", "pools", "interviews", "tasks", "reports", "search", "sourcing", "outreach", "settings"] as const;
export type Section = (typeof SECTIONS)[number];

const ACCESS: Record<Role, Section[]> = {
  super_admin: ["dash", "cands", "pipeline", "jobs", "clients", "placements", "pools", "interviews", "tasks", "reports", "search", "sourcing", "outreach", "settings"],
  admin: ["dash", "cands", "pipeline", "jobs", "clients", "placements", "pools", "interviews", "tasks", "reports", "search", "outreach", "settings"],
  recruiter: ["dash", "cands", "pipeline", "jobs", "clients", "placements", "pools", "interviews", "tasks", "reports", "search", "sourcing", "outreach"],
  hiring_manager: ["dash", "cands", "pipeline", "jobs", "interviews", "reports"],
  client_user: ["dash", "jobs", "cands"],
  candidate_user: ["dash"],
};

export function can(role: Role | undefined, section: Section): boolean {
  if (!role) return false;
  return ACCESS[role]?.includes(section) ?? false;
}
export function canEdit(role: Role | undefined): boolean {
  return role === "super_admin" || role === "admin" || role === "recruiter";
}
export function canManageUsers(role: Role | undefined): boolean {
  return role === "super_admin" || role === "admin";
}
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring Manager",
  client_user: "Client",
  candidate_user: "Candidate",
};

type AuthCtx = {
  profile: Profile | null;
  loading: boolean;
  /** Session or profile load failure — the app cannot assume a role when this is set. */
  error: string | null;
  reload: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<string | null>;
};
const Ctx = createContext<AuthCtx>({ profile: null, loading: true, error: null, reload: () => {}, signIn: async () => null, signOut: async () => null });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(a => a + 1), []);

  // Returns an error message instead of falling back to a default role: a failed
  // profile read must not be mistaken for "this user is a recruiter".
  const loadProfile = useCallback(async (userId: string, email: string): Promise<string | null> => {
    try {
      const data = await must("load profile", supabase.from("profiles").select("id,email,first_name,last_name,role,is_active").eq("id", userId).maybeSingle());
      // No row yet (new signup) is a legitimate state, unlike a query failure.
      setProfile(data ? (data as Profile) : { id: userId, email, role: "recruiter" });
      return null;
    } catch (e) {
      setProfile(null);
      return logError("load profile", e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    // Initial session check (safe to await here — not inside the auth lock callback).
    supabase.auth.getSession().then(async ({ data: { session }, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) { setError(logError("get session", sessionError)); setLoading(false); return; }
      if (session?.user) {
        const message = await loadProfile(session.user.id, session.user.email || "");
        if (mounted && message) setError(message);
      }
      if (mounted) setLoading(false);
    }).catch(e => { if (mounted) { setError(logError("get session", e)); setLoading(false); } });
    // IMPORTANT: do NOT await Supabase DB calls directly inside onAuthStateChange —
    // the auth lock is held during the callback and a DB call would deadlock.
    // Defer with setTimeout so the lock is released first.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      if (session?.user) {
        const uid = session.user.id, em = session.user.email || "";
        setTimeout(async () => {
          const message = await loadProfile(uid, em);
          if (mounted) setError(message);
        }, 0);
      } else {
        setProfile(null);
        setError(null);
      }
      setLoading(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadProfile, attempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      return signInError ? logError("sign in", signInError) : null;
    } catch (e) {
      // Network/CORS failures reject rather than returning an error field.
      return logError("sign in", e);
    }
  }, []);
  const signOut = useCallback(async () => {
    let message: string | null = null;
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) message = logError("sign out", signOutError);
    } catch (e) {
      message = logError("sign out", e);
    }
    // Local state is cleared either way so the user is not stuck in a signed-in UI.
    setProfile(null);
    setError(null);
    return message;
  }, []);

  return <Ctx.Provider value={{ profile, loading, error, reload, signIn, signOut }}>{children}</Ctx.Provider>;
}
