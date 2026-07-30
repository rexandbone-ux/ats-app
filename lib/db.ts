import { SUPABASE_URL, supabase } from "@/lib/supabase";
import { Role } from "@/lib/auth";

/** Roles that can own/recruit on records. */
export const STAFF_ROLES: Role[] = ["super_admin", "admin", "recruiter", "hiring_manager"];

export type NamedProfile = { id: string; first_name?: string | null; last_name?: string | null; email?: string | null };

export function displayName(p?: NamedProfile | null) {
  return p?.first_name || p?.email || "?";
}

/** id -> display name, for rendering owner/recruiter columns. */
export function nameMap(profiles: NamedProfile[]) {
  const m: Record<string, string> = {};
  profiles.forEach(p => { m[p.id] = displayName(p); });
  return m;
}

export async function fetchStaff() {
  const { data } = await supabase.from("profiles").select("id,first_name,last_name,email,role").in("role", STAFF_ROLES);
  return data || [];
}

/** Public URL of a deployed edge function, e.g. for iframing an embedded app. */
export function functionUrl(name: string) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

/** Builds a Supabase `.or()` filter matching `term` against each column. */
export function ilikeOr(columns: string[], term: string) {
  return columns.map(c => `${c}.ilike.%${term}%`).join(",");
}

export function errorMessage(e: any) {
  return e?.message || String(e);
}

/**
 * Calls an edge function and normalizes its two failure modes (transport error
 * and `{ error }` payload) into a thrown Error.
 */
export async function invokeFn<T = any>(name: string, body?: any): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, body === undefined ? {} : { body });
  if (error) throw error;
  if (data && (data as any).error) throw new Error((data as any).error);
  return data as T;
}

export async function logActivity(
  type: string,
  description: string,
  refs: { candidate_id?: string; job_id?: string; client_id?: string; application_id?: string },
  userId?: string,
) {
  try { await supabase.from("activities").insert({ type, description, ...refs, user_id: userId || null }); } catch { /* non-blocking */ }
}

export function setCandidateStatus(candidateId: string, status: string) {
  return supabase.from("candidates").update({ status }).eq("id", candidateId);
}

export function saveCandidateTags(candidateId: string, tags: string[]) {
  return supabase.from("candidates").update({ tags }).eq("id", candidateId);
}
