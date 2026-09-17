"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
import { useAuth, can, canEdit, canManageUsers, ROLE_LABELS, Role, Section } from "@/lib/auth";
import { SC, B, Av, Modal, Field, logActivity, MediaLink, Widget, Empty, days, CAND_STATUSES, C, fn, Toast, useToast, Chip, Score, exportCsv, TextArea, Select } from "@/lib/ui";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: any) { e.preventDefault(); setBusy(true); setErr(""); const m = await signIn(email, pw); setBusy(false); if (m) setErr(m); }
  return <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4"><form onSubmit={submit} className="bg-white rounded-2xl p-8 w-full max-w-sm"><div className="text-center mb-6"><div className="text-lg font-semibold">Streamlined Staffing</div><div className="text-xs text-gray-400">Applicant Tracking System</div></div><Field label="Email" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} /><Field label="Password" type="password" value={pw} onChange={(e: any) => setPw(e.target.value)} />{err && <p className="text-xs text-red-500 mb-2">{err}</p>}<button disabled={busy} className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium">{busy ? "Signing in..." : "Sign in"}</button></form></div>;
}
