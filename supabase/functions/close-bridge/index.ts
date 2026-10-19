// close-bridge v4 - Close.com (VoIP + SMS + lead sync) for the ATS.
// Actions (POST JSON {action,...}); always HTTP 200 with {error} on failure.
//   status                         -> key ok?, Close user, phone numbers, webhook state, last sync
//   open   {candidate_id}          -> find-or-create the Close lead, return its URL (dialer lives in Close)
//   call   {candidate_id}          -> same as open + the phone to dial (Close web/desktop app dials on click)
//   sms    {candidate_id, text}    -> send an SMS from your Close number (status=outbox), log it on the timeline
//   sync_activities {since?}       -> pull calls + SMS logged in Close into ATS activities (cron every 15 min)
//   register_webhook               -> subscribe Close -> /close-bridge/webhook for real-time call/SMS logging (admin)
//   POST /close-bridge/webhook     -> Close webhook receiver (HMAC verified, 5-min replay window)
// Auth: active STAFF user JWT (profiles.role), or x-sync-secret / x-cron-key / x-app-key header for server jobs.
// Key: app_secrets.close_api_key (Settings -> Integrations), env fallback.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SB_URL, SERVICE);
const WEBHOOK_URL = `${SB_URL}/functions/v1/close-bridge/webhook`;
const STAFF = ["super_admin", "admin", "recruiter", "hiring_manager"];
const ADMIN = ["super_admin", "admin"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key, x-cron-key, x-sync-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function secret(key: string): Promise<string | null> { const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle(); const v = (data?.value || "").trim(); return v || null; }
async function setSecret(key: string, value: string) { await db.from("app_secrets").upsert({ key, value }, { onConflict: "key" }); }
async function cfg(key: string): Promise<string | null> { const { data } = await db.from("config").select("value").eq("key", key).maybeSingle(); return data?.value ?? null; }
async function setCfg(key: string, value: string) { await db.from("config").upsert({ key, value }, { onConflict: "key" }); }
function safeEq(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

type Auth = { ok: boolean; user_id: string | null; server: boolean; admin: boolean };
async function authorized(req: Request): Promise<Auth> {
  const no: Auth = { ok: false, user_id: null, server: false, admin: false };
  // Server keys only via headers (never the URL — URLs end up in logs).
  const got = req.headers.get("x-app-key") || req.headers.get("x-cron-key") || req.headers.get("x-sync-secret");
  if (got) {
    const keys = [await cfg("outreach_app_key"), await cfg("outreach_cron_key"), await secret("sync_secret")].filter((k): k is string => !!k);
    if (keys.some((k) => safeEq(k, got))) return { ok: true, user_id: null, server: true, admin: true };
    return no;
  }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return no;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return no;
  const { data: p } = await db.from("profiles").select("role,is_active").eq("id", data.user.id).maybeSingle();
  if (!p || !p.is_active || !STAFF.includes(p.role)) return no;
  return { ok: true, user_id: data.user.id, server: false, admin: ADMIN.includes(p.role) };
}

let cached: { key: string; at: number } | null = null;
async function closeKey(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.key;
  const v = (await secret("close_api_key")) || (Deno.env.get("CLOSE_API_KEY") || "").trim();
  if (!v) return null; cached = { key: v, at: Date.now() }; return v;
}
async function close(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const key = await closeKey(); if (!key) throw new Error("Close is not connected yet. Open Settings -> Integrations and paste your Close API key.");
  const r = await fetch("https://api.close.com/api/v1" + path, { method, headers: { Authorization: "Basic " + btoa(key + ":"), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Close rejected the stored API key. Re-paste it in Settings -> Integrations.");
  return { status: r.status, data };
}

const e164 = (raw: string | null | undefined, defaultCountry = "+1"): string | null => {
  if (!raw) return null; let s = String(raw).trim(); const plus = s.startsWith("+"); s = s.replace(/[^0-9]/g, ""); if (!s) return null;
  if (plus) return "+" + s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.length === 10) return defaultCountry + s;
  if (s.length === 11 && s.startsWith("1")) return "+" + s;
  if (s.length === 11 && s.startsWith("0")) return "+63" + s.slice(1); // PH local format 09xx -> +639xx
  if (s.length === 12 && s.startsWith("63")) return "+" + s;
  return "+" + s;
};
const last9 = (s: string | null | undefined) => (s || "").replace(/[^0-9]/g, "").slice(-9);
async function cand(id: string) { if (!UUID.test(String(id || ""))) return null; const { data } = await db.from("candidates").select("id,first_name,last_name,email,phone,alternate_phone,whatsapp,current_title,current_company,close_lead_id,owner_id,country").eq("id", id).maybeSingle(); return data; }
async function act(type: string, description: string, candidate_id: string | null, userId: string | null, metadata: any = {}) {
  const { error } = await db.from("activities").insert({ type, description, metadata, user_id: userId, candidate_id });
  return !error;
}
// Close search query values: strip quotes/backslashes so a stored email/phone can't break out of the query string.
const q = (s: string) => String(s).replace(/["\\]/g, "").slice(0, 200);

/* ---------------- leads ---------------- */
async function ensureLead(c: any): Promise<{ lead_id: string; contact_id: string | null; created: boolean }> {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
  if (c.close_lead_id && /^lead_[A-Za-z0-9]+$/.test(c.close_lead_id)) { const chk = await close("GET", `/lead/${c.close_lead_id}/?_fields=id,contacts`); if (chk.status < 300) return { lead_id: c.close_lead_id, contact_id: chk.data?.contacts?.[0]?.id || null, created: false }; }
  let lead: any = null;
  for (const qq of [c.email ? `email:"${q(c.email)}"` : null, c.phone ? `phone:"${q(c.phone)}"` : null]) {
    if (!qq || lead) continue;
    const { status, data } = await close("GET", `/lead/?query=${encodeURIComponent(qq)}&_limit=1&_fields=id,display_name,contacts`);
    if (status < 300 && data?.data?.length) lead = data.data[0];
  }
  let created = false;
  if (!lead) {
    const contact: Record<string, unknown> = { name }; if (c.current_title) contact.title = c.current_title;
    if (c.email) contact.emails = [{ type: "office", email: c.email }];
    const ph = e164(c.phone) || e164(c.alternate_phone) || e164(c.whatsapp); if (ph) contact.phones = [{ type: "mobile", phone: ph }];
    const { status, data } = await close("POST", "/lead/", { name: c.current_company ? `${name} - ${c.current_company}` : name, description: "Candidate from Streamlined Staffing ATS (id " + c.id + ")", contacts: [contact] });
    if (status >= 300) throw new Error(data?.error || JSON.stringify(data).slice(0, 300));
    lead = data; created = true;
  }
  await db.from("candidates").update({ close_lead_id: lead.id }).eq("id", c.id);
  return { lead_id: lead.id, contact_id: lead.contacts?.[0]?.id || null, created };
}
async function fromNumber(): Promise<string | null> {
  const pinned = await secret("close_from_number"); if (pinned) return pinned;
  const { status, data } = await close("GET", "/phone_number/?_limit=20");
  if (status >= 300) return null;
  const nums: any[] = data?.data || []; const pick = nums.find(n => n.sms_enabled !== false) || nums[0];
  return pick?.number || null;
}

/* ---------------- activity sync ---------------- */
async function candidateForLead(leadId: string | null, phone?: string | null): Promise<any> {
  if (leadId) { const { data } = await db.from("candidates").select("id,first_name,last_name,owner_id").eq("close_lead_id", leadId).maybeSingle(); if (data) return data; }
  const l9 = last9(phone); if (l9) { const { data } = await db.from("candidates").select("id,first_name,last_name,owner_id").or(`phone.ilike.%${l9},alternate_phone.ilike.%${l9},whatsapp.ilike.%${l9}`).limit(1); if (data?.[0]) { if (leadId) await db.from("candidates").update({ close_lead_id: leadId }).eq("id", data[0].id); return data[0]; } }
  return null;
}
async function userForClose(closeUserId: string | null): Promise<string | null> {
  if (!closeUserId || !/^user_[A-Za-z0-9]+$/.test(closeUserId)) return null;
  const map = JSON.parse((await cfg("close_user_map")) || "{}"); if (map[closeUserId]) return map[closeUserId];
  const { data } = await close("GET", `/user/${closeUserId}/?_fields=email`); const email = (data?.email || "").toLowerCase(); if (!email) return null;
  const { data: p } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (p) { map[closeUserId] = p.id; await setCfg("close_user_map", JSON.stringify(map)); return p.id; }
  return null;
}
const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
async function ingestCall(a: any): Promise<boolean> {
  const c = await candidateForLead(a.lead_id, a.remote_phone || a.phone); if (!c) return false;
  const dir = a.direction === "inbound" ? "Inbound" : "Outbound";
  const parts = [`${dir} call via Close`, a.duration ? fmtDur(Number(a.duration)) : (a.status === "no-answer" || a.disposition === "no-answer" ? "no answer" : a.status || ""), a.disposition && a.disposition !== "answered" ? String(a.disposition).replace(/-/g, " ") : "", a.note ? `- ${String(a.note).replace(/<[^>]+>/g, "").slice(0, 200)}` : ""].filter(Boolean);
  return await act("call", parts.join(" - "), c.id, await userForClose(a.user_id), { close_id: a.id, close_lead_id: a.lead_id, direction: a.direction, duration: a.duration, disposition: a.disposition, status: a.status, phone: a.remote_phone || a.phone, recording_url: a.recording_url || a.voicemail_url || null, at: a.date_created, via: "close" });
}
async function ingestSms(a: any): Promise<boolean> {
  const c = await candidateForLead(a.lead_id, a.remote_phone); if (!c) return false;
  const inbound = a.direction === "inbound";
  return await act("text", `${inbound ? "SMS received" : "SMS sent"} via Close: ${String(a.text || "").slice(0, 240)}`, c.id, await userForClose(a.user_id), { close_id: a.id, close_lead_id: a.lead_id, direction: a.direction, phone: a.remote_phone, status: a.status, at: a.date_created, via: "close", inbound });
}
async function syncActivities(since?: string) {
  const sinceOk = since && !isNaN(Date.parse(since)) ? new Date(since).toISOString() : null;
  const from = sinceOk || (await cfg("close_last_sync")) || new Date(Date.now() - 7 * 86400000).toISOString();
  const startedAt = new Date().toISOString();
  let calls = 0, sms = 0, scanned = 0, skipped = 0;
  for (const kind of ["call", "sms"]) {
    let skip = 0;
    for (let page = 0; page < 10; page++) {
      const { status, data } = await close("GET", `/activity/${kind}/?date_created__gt=${encodeURIComponent(from)}&_limit=100&_skip=${skip}&_order_by=date_created`);
      if (status >= 300) break;
      const rows: any[] = data?.data || []; scanned += rows.length;
      for (const a of rows) { if (kind === "sms" && ["draft", "scheduled", "outbox"].includes(a.status)) continue; const ok = kind === "call" ? await ingestCall(a) : await ingestSms(a); if (ok) { if (kind === "call") calls++; else sms++; } else skipped++; }
      if (!data?.has_more) break; skip += rows.length;
    }
  }
  await setCfg("close_last_sync", startedAt);
  return { since: from, scanned, calls_logged: calls, sms_logged: sms, unmatched_or_duplicate: skipped };
}

/* ---------------- webhook ---------------- */
async function verifySig(req: Request, raw: string): Promise<boolean> {
  const sigKey = await secret("close_webhook_sig"); if (!sigKey) return false;
  const ts = req.headers.get("close-sig-timestamp") || ""; const hash = (req.headers.get("close-sig-hash") || "").toLowerCase();
  const tsn = Number(ts); if (!ts || !Number.isFinite(tsn) || Math.abs(Date.now() / 1000 - tsn) > 300) return false; // replay window
  const keyBytes = new Uint8Array((sigKey.match(/.{1,2}/g) || []).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + raw));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return safeEq(hex, hash);
}
async function registerWebhook() {
  const existing = await cfg("close_webhook_id");
  if (existing) { const { status } = await close("GET", `/webhook/${encodeURIComponent(existing)}/`); if (status < 300) return { ok: true, webhook_id: existing, url: WEBHOOK_URL, note: "already registered" }; }
  const { status, data } = await close("POST", "/webhook/", { url: WEBHOOK_URL, events: [
    { object_type: "activity.call", action: "created" }, { object_type: "activity.call", action: "updated" },
    { object_type: "activity.sms", action: "created" }, { object_type: "activity.sms", action: "updated" },
  ] });
  if (status >= 300) return { error: data?.error || JSON.stringify(data).slice(0, 300) };
  await setCfg("close_webhook_id", data.id); if (data.signature_key) await setSecret("close_webhook_sig", data.signature_key);
  return { ok: true, webhook_id: data.id, url: WEBHOOK_URL };
}

/* ---------------- HTTP ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const last = url.pathname.split("/").filter(Boolean).pop();

  if (last === "webhook" && req.method === "POST") {
    const raw = await req.text();
    if (raw.length > 1_000_000 || !(await verifySig(req, raw))) return new Response("bad signature", { status: 401 });
    let ev: any = {}; try { ev = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
    const e = ev.event || ev; const obj = e.data || {}; const type = e.object_type || "";
    try {
      if (type === "activity.call") { if (e.action === "created" || (e.action === "updated" && obj.status === "completed")) { await ingestCall({ ...obj, id: obj.id || e.object_id }); } }
      else if (type === "activity.sms") { if (["inbox", "sent"].includes(obj.status)) await ingestSms({ ...obj, id: obj.id || e.object_id }); }
    } catch (err) { console.error("webhook", err); }
    return new Response("ok", { status: 200 });
  }

  const auth = await authorized(req);
  if (!auth.ok) return json({ error: "unauthorized" });
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const action = b.action || "status";
  try {
    if (action === "status") {
      const key = await closeKey(); if (!key) return json({ connected: false, error: "Close is not connected yet. Paste your Close API key in Settings -> Integrations." });
      const me = await close("GET", "/me/?_fields=id,email,first_name,last_name,organizations");
      const nums = await close("GET", "/phone_number/?_limit=20");
      const { count: linked } = await db.from("candidates").select("id", { count: "exact", head: true }).not("close_lead_id", "is", null);
      return json({ connected: me.status < 300, user: me.data?.email, org: me.data?.organizations?.[0]?.name, numbers: (nums.data?.data || []).map((n: any) => ({ number: n.number, sms: n.sms_enabled !== false, label: n.label || null })), from_number: await fromNumber(), webhook_registered: !!(await cfg("close_webhook_id")), last_sync: await cfg("close_last_sync"), linked_candidates: linked ?? 0 });
    }
    if (action === "open" || action === "call") {
      // Only look candidates up by id — never trust a client-supplied candidate object.
      const c = await cand(b.candidate_id || b.candidate?.id);
      if (!c) return json({ error: "candidate not found" });
      const lead = await ensureLead(c);
      const phone = e164(c.phone) || e164(c.alternate_phone) || e164(c.whatsapp);
      if (action === "call") await act("call", `Call started from ATS via Close${phone ? " - " + phone : ""}`, c.id, auth.user_id, { via: "close", phone, lead_id: lead.lead_id, initiated: true });
      return json({ ok: true, lead_id: lead.lead_id, created: lead.created, url: `https://app.close.com/lead/${lead.lead_id}/`, phone, tel: phone ? `tel:${phone}` : null });
    }
    if (action === "sms") {
      const c = await cand(b.candidate_id); if (!c) return json({ error: "candidate not found" });
      const text = String(b.text || "").trim(); if (!text) return json({ error: "text is required" });
      if (text.length > 1600) return json({ error: "Text is too long (max 1600 characters)." });
      const to = e164(c.phone) || e164(c.alternate_phone) || e164(c.whatsapp); if (!to) return json({ error: "candidate has no phone number" });
      const from = await fromNumber(); if (!from) return json({ error: "No Close phone number found. Add a number in Close (Settings -> Phone & SMS) or pin one as close_from_number." });
      const lead = await ensureLead(c);
      const { status, data } = await close("POST", "/activity/sms/", { lead_id: lead.lead_id, contact_id: lead.contact_id || undefined, status: "outbox", direction: "outbound", local_phone: from, remote_phone: to, text });
      if (status >= 300) return json({ error: data?.error || data?.errors?.[0] || JSON.stringify(data).slice(0, 300) });
      await act("text", `SMS sent via Close: ${text.slice(0, 240)}`, c.id, auth.user_id, { close_id: data.id, close_lead_id: lead.lead_id, direction: "outbound", phone: to, status: data.status, via: "close", automation: auth.server ? (b.automation || null) : null });
      return json({ ok: true, sms_id: data.id, from, to, status: data.status });
    }
    if (action === "sync_activities") return json(await syncActivities(b.since));
    if (action === "register_webhook") { if (!auth.admin) return json({ error: "Only admins can register the Close webhook." }); return json(await registerWebhook()); }
    if (action === "unlink") { const c = await cand(b.candidate_id); if (!c) return json({ error: "candidate not found" }); await db.from("candidates").update({ close_lead_id: null }).eq("id", c.id); return json({ ok: true }); }
    return json({ error: "unknown action" });
  } catch (e) { console.error("close-bridge", e); return json({ error: String((e as Error)?.message || e).slice(0, 300) }); }
});
