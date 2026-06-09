"use client";
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

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
export const SECTIONS = ["dash", "cands", "pipeline", "jobs", "clients", "interviews", "tasks", "search", "settings"] as const;
export type Section = (typeof SECTIONS)[number];

const ACCESS: Record<Role, Section[]> = {
  super_admin: ["dash", "cands", "pipeline", "jobs", "clients", "interviews", "tasks", "search", "settings"],
  admin: ["dash", "cands", "pipeline", "jobs", "clients", "interviews", "tasks", "search", "settings"],
  recruiter: ["dash", "cands", "pipeline", "jobs", "clients", "interviews", "tasks", "search"],
  hiring_manager: ["dash", "cands", "pipeline", "jobs", "interviews"],
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
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>({ profile: null, loading: true, signIn: async () => null, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string, email: string) => {
    const { data } = await supabase.from("profiles").select("id,email,first_name,last_name,role,is_active").eq("id", userId).single();
    if (data) setProfile(data as Profile);
    else setProfile({ id: userId, email, role: "recruiter" });
  }, []);

  useEffect(() => {
    let mounted = true;
    // Initial session check (safe to await here — not inside the auth lock callback).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) await loadProfile(session.user.id, session.user.email || "");
      if (mounted) setLoading(false);
    }).catch(() => { if (mounted) setLoading(false); });
    // IMPORTANT: do NOT await Supabase DB calls directly inside onAuthStateChange —
    // the auth lock is held during the callback and a DB call would deadlock.
    // Defer with setTimeout so the lock is released first.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      if (session?.user) {
        const uid = session.user.id, em = session.user.email || "";
        setTimeout(() => { if (mounted) loadProfile(uid, em); }, 0);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); }, []);

  return <Ctx.Provider value={{ profile, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}
