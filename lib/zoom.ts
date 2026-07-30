/** Zoom Phone embed constants and the bridge to the docked softphone. */
export const ZOOM_EMBED_URL = "https://applications.zoom.us/integration/phone/embeddablePhone/home";
export const ZOOM_EMBED_ORIGIN = "https://applications.zoom.us";

/**
 * Dials or texts a number through the docked softphone when it is mounted,
 * falling back to the Zoom desktop app's URL scheme.
 */
export function zoomPhone(kind: "call" | "sms", phone?: string | null) {
  if (!phone) { alert("No phone number on file."); return; }
  const number = phone.replace(/[^0-9+]/g, "");
  const bridge = (window as any)[kind === "call" ? "__zpCall" : "__zpSms"];
  if (bridge) bridge(number);
  else window.location.href = `zoomphone${kind}://${number}`;
}
