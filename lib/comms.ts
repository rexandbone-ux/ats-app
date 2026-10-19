"use client";
import { supabase } from "@/lib/supabase";
import { fn, e164, logActivity } from "@/lib/ui";

/* ---------------- Calling & texting ----------------
   Close (close.com) is the VoIP. Close's API cannot place a call, so the flow is:
   close-bridge {action:"call"} → find/create the Close lead → return {url, phone}
   → we copy the number and open the lead (web or desktop app) → click dial in Close.
   Calls/recordings log in Close; close-bridge's webhook writes them to the timeline.
   Fallbacks: Zoom Phone deep link, then plain tel: link.                      */

export type Say = (t: string, ok?: boolean) => void;
// Only ever open real Close lead URLs, in a new tab with no opener access back to the ATS.
const CLOSE_LEAD = /^https:\/\/app\.close\.com\/lead\/lead_[A-Za-z0-9]+\/?$/;
function openClose(url: string, desktop = false) { if (!CLOSE_LEAD.test(url)) return false; window.open(desktop ? url.replace(/^https:\/\//, "closeio://") : url, "_blank", "noopener,noreferrer"); return true; }

export async function callCandidate(c: any, say: Say, userId?: string) {
  if (!c?.phone) { say("No phone number on file.", false); return; }
  const num = e164(c.phone);
  try { await navigator.clipboard?.writeText(num); } catch { /* ignore */ }
  try {
    const d: any = await fn("close-bridge", { action: "call", candidate_id: c.id, phone: num }, { timeoutMs: 20000 });
    const url: string = d.url || (d.lead_id ? `https://app.close.com/lead/${d.lead_id}/` : "");
    if (url) {
      const desktop = (() => { try { return localStorage.getItem("ss_close_desktop") === "1"; } catch { return false; } })();
      openClose(url, desktop);
      say(`${num} copied — click Call in Close.`); logActivity("call", `Call started via Close · ${num}`, { candidate_id: c.id }, userId); return;
    }
    throw new Error(d.error || "Close did not return a lead");
  } catch (e: any) {
    const m = String(e?.message || e);
    // Close not configured → fall back to Zoom Phone / tel:
    say(`Close: ${m}. Opening your phone app instead.`, false);
    logActivity("call", `Call attempted (${num}) — Close unavailable: ${m.slice(0, 80)}`, { candidate_id: c.id }, userId);
    window.location.href = "tel:" + num;
  }
}

export async function smsCandidate(c: any, say: Say, userId?: string, text?: string) {
  if (!c?.phone) { say("No phone number on file.", false); return; }
  const m = text ?? window.prompt(`Text ${c.first_name || "candidate"} (${c.phone}):`); if (!m) return;
  try {
    const d: any = await fn("close-bridge", { action: "sms", candidate_id: c.id, phone: e164(c.phone), text: m, body: m }, { timeoutMs: 20000 });
    say(d.status === "sent" || d.ok || d.sent ? "Text sent via Close." : "Text queued in Close."); logActivity("text", `SMS: ${m.slice(0, 140)}`, { candidate_id: c.id }, userId);
  } catch (e: any) {
    const err = String(e?.message || e);
    say(`Close SMS: ${err}. Opening Messages instead.`, false);
    window.location.href = `sms:${e164(c.phone)}${/iphone|ipad|mac/i.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(m)}`;
  }
}

export async function closeStatus(): Promise<{ ok: boolean; detail: string }> {
  try { const d: any = await fn("close-bridge", { action: "status" }, { timeoutMs: 15000 }); return { ok: !!(d.ok ?? d.configured ?? d.connected ?? !d.error), detail: d.org || d.organization || d.message || (d.key_present === false ? "API key missing" : JSON.stringify(d).slice(0, 120)) }; }
  catch (e: any) { return { ok: false, detail: String(e?.message || e) }; }
}

/* ---------------- Close lead sync ----------------
   close-bridge {action:"open"} finds or creates the Close lead and stores close_lead_id. */
export async function pushToClose(ids: string[], onProgress?: (done: number, total: number) => void) {
  let ok = 0, created = 0; const failed: string[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map(async id => {
      try { const d: any = await fn("close-bridge", { action: "open", candidate_id: id }, { timeoutMs: 30000 }); ok++; if (d.created) created++; }
      catch (e: any) { failed.push(String(e?.message || e)); }
    }));
    onProgress?.(Math.min(i + 4, ids.length), ids.length);
  }
  return { ok, created, failed };
}
export async function openInClose(c: any, say: Say) {
  try {
    const d: any = await fn("close-bridge", { action: "open", candidate_id: c.id }, { timeoutMs: 20000 });
    if (d.url) openClose(d.url); say(d.created ? "Lead created in Close." : "Opened in Close.");
  } catch (e: any) { say(`Close: ${e?.message || e}`, false); }
}
export const closeSyncNow = () => fn("close-bridge", { action: "sync_activities" }, { timeoutMs: 60000 });
export const closeRegisterWebhook = () => fn("close-bridge", { action: "register_webhook" }, { timeoutMs: 30000 });

/* ---------------- Apollo sequences ----------------
   apollo-sequences needs an Apollo MASTER API key. Enroll upserts each person as an
   Apollo contact (label "ATS") then adds them to the sequence from the chosen mailbox. */
export type SeqPerson = { candidate_id: string; first_name?: string; last_name?: string; email?: string; title?: string; company?: string; phone?: string; linkedin_url?: string };
export const toSeqPerson = (c: any): SeqPerson => ({ candidate_id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email, title: c.current_title, company: c.current_company, phone: c.phone, linkedin_url: c.linkedin_url });
export const apolloSequences = () => fn("apollo-sequences", { action: "sequences" }, { timeoutMs: 30000 });
export const apolloSeqHealth = () => fn("apollo-sequences", { action: "health" }, { timeoutMs: 20000 });
export async function enrollInSequence(people: SeqPerson[], sequence: { id: string; name: string }, mailbox_id: string, userId?: string, strict = false) {
  const d: any = await fn("apollo-sequences", { action: "enroll", sequence_id: sequence.id, mailbox_id, people, strict }, { timeoutMs: 120000 });
  const skipped = new Set((d.skipped || []).map((s: any) => s.candidate_id));
  await Promise.all((d.contacts || []).filter((c: any) => c.candidate_id && !skipped.has(c.candidate_id)).map((c: any) => logActivity("email", `Enrolled in Apollo sequence “${sequence.name}”`, { candidate_id: c.candidate_id }, userId)));
  return d as { enrolled: number; skipped: { candidate_id?: string; reason: string }[]; failed: { email: string; error: string }[] };
}

/* ---------------- In-app API keys (admin only, values never returned) ---------------- */
export const appKeys = (body: any) => fn("app-keys", body, { timeoutMs: 30000 });

export async function outreachHealth(): Promise<any> { try { return await fn("outreach-agent", { action: "health" }, { timeoutMs: 15000 }); } catch (e: any) { return { error: String(e?.message || e) }; } }

export async function anthropicStatus(): Promise<{ ok: boolean; detail: string }> {
  try { const d: any = await fn("ai-assist", { action: "search_parse", query: "nurse" }, { timeoutMs: 20000 }); return { ok: !!d && !d.error, detail: d?.model || "responding" }; }
  catch (e: any) { const m = String(e?.message || e); return { ok: false, detail: /credit|balance|billing/i.test(m) ? "Anthropic account out of credits — add credits at console.anthropic.com" : m }; }
}

export async function ensureProfileRow() { try { const { data: { user } } = await supabase.auth.getUser(); return user; } catch { return null; } }
