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

export async function callCandidate(c: any, say: Say, userId?: string) {
  if (!c?.phone) { say("No phone number on file.", false); return; }
  const num = e164(c.phone);
  try { await navigator.clipboard?.writeText(num); } catch { /* ignore */ }
  try {
    const d: any = await fn("close-bridge", { action: "call", candidate_id: c.id, phone: num }, { timeoutMs: 20000 });
    const url: string = d.url || d.lead_url || (d.lead_id ? `https://app.close.com/lead/${d.lead_id}/` : "");
    if (url) {
      const desktop = (() => { try { return localStorage.getItem("ss_close_desktop") === "1"; } catch { return false; } })();
      window.open(desktop ? url.replace(/^https:\/\//, "closeio://") : url, "_blank");
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

export async function outreachHealth(): Promise<any> { try { return await fn("outreach-agent", { action: "health" }, { timeoutMs: 15000 }); } catch (e: any) { return { error: String(e?.message || e) }; } }

export async function anthropicStatus(): Promise<{ ok: boolean; detail: string }> {
  try { const d: any = await fn("ai-assist", { action: "search_parse", query: "nurse" }, { timeoutMs: 20000 }); return { ok: !!d && !d.error, detail: d?.model || "responding" }; }
  catch (e: any) { const m = String(e?.message || e); return { ok: false, detail: /credit|balance|billing/i.test(m) ? "Anthropic account out of credits — add credits at console.anthropic.com" : m }; }
}

export async function ensureProfileRow() { try { const { data: { user } } = await supabase.auth.getUser(); return user; } catch { return null; } }
