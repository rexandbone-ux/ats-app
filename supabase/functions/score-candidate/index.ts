// score-candidate — 7-dimension rubric scoring for every candidate that enters the ATS.
// Ranks only: it never rejects, never moves stages, and never uses protected characteristics.
// Spoken English is scored on comprehensibility from a Deepgram transcript, not accent.
//
// Auth: x-sync-secret header (or ?key=) == app_secrets.sync_secret, or a signed-in staff JWT.
// Actions:
//   {action:"status"}                                      — config + counts
//   {action:"sweep", limit?}                               — score new arrivals since app_secrets.rubric_autoscore_since (cron, every 5 min)
//   {action:"score", candidate_id, job_id?, application_id?} — score one candidate now
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { assessCandidate, DIMENSIONS, type CandidateEvidence, type RoleSpec } from "../_shared/rubric.ts";
import { transcribeUrl, type SpeechResult } from "../_shared/transcribe.ts";
import { HttpError, type ContentBlock } from "../_shared/claude.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENGINE = "rubric";
const RUBRIC_VERSION = "rubric-v1";
const MAX_ATTEMPTS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status} ${path.slice(0, 80)}: ${text.slice(0, 300)}`);
  return data as any;
}
const one = async (path: string) => ((await sb(path)) as any[])?.[0] ?? null;

async function secret(key: string): Promise<string> {
  try { return (await one(`app_secrets?key=eq.${key}&select=value`))?.value ?? ""; } catch { return ""; }
}
const anthropicKey = async () => Deno.env.get("ANTHROPIC_API_KEY") || (await secret("anthropic_api_key"));
const deepgramKey = async () => Deno.env.get("DEEPGRAM_API_KEY") || (await secret("deepgram_api_key"));

async function authorized(req: Request, url: URL): Promise<boolean> {
  const sync = await secret("sync_secret");
  const k = req.headers.get("x-sync-secret") || url.searchParams.get("key") || "";
  if (sync && k && k === sync) return true;
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: auth } });
  if (!u.ok) return false;
  const user = await u.json();
  const p = await one(`profiles?id=eq.${user.id}&select=role,is_active`);
  return !!p && p.is_active !== false && ["super_admin", "admin", "recruiter"].includes(p.role);
}

const clip = (s: unknown, n: number) => { const t = typeof s === "string" ? s : s == null ? "" : JSON.stringify(s); return t.length > n ? t.slice(0, n) + "…" : t; };

// ---------- Media: turn a share link into a URL Deepgram can fetch ----------
function mediaUrl(raw: string): string | null {
  const url = (raw || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const voc = url.match(/(?:voca\.ro|vocaroo\.com)\/(?:embed\/)?([\w]+)/i);
  if (voc) return `https://media.vocaroo.com/mp3/${voc[1]}`;
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/i);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  if (/dropbox\.com/i.test(url)) return url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/([?&])dl=0/, "$1raw=1");
  if (/\.(mp3|m4a|wav|ogg|webm|mp4|mov|m4v|aac|flac)(\?|$)/i.test(url)) return url;
  return null; // Loom, YouTube and web pages are not direct media files
}

async function speechFor(cand: any, key: string, notes: string[]): Promise<SpeechResult | null> {
  const raw = cand.video_url || cand.voice_recording_url || "";
  if (!raw) { notes.push("no video or voice recording on file"); return null; }
  const cached = cand.custom_fields?.speech;
  if (cached?.url === raw && cached?.transcript) return cached as SpeechResult;
  const url = mediaUrl(raw);
  if (!url) { notes.push("recording link is not a direct media file (e.g. Loom/YouTube), so it was not transcribed"); return null; }
  if (!key) { notes.push("recording on file but DEEPGRAM_API_KEY is not set, so spoken English was not assessed"); return null; }
  try {
    const s = await transcribeUrl(url, key);
    if (!s) { notes.push("recording had no recognisable speech"); return null; }
    const cf = { ...(cand.custom_fields || {}), speech: { url: raw, ...s, at: new Date().toISOString() } };
    await sb(`candidates?id=eq.${cand.id}`, { method: "PATCH", body: JSON.stringify({ custom_fields: cf }) });
    cand.custom_fields = cf;
    return s;
  } catch (e) {
    notes.push(`transcription failed: ${clip(String(e), 140)}`);
    return null;
  }
}

// ---------- Resume ----------
function resumeFetchUrl(url: string): string | null {
  url = (url || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const g = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (g) return `https://drive.google.com/uc?export=download&id=${g[1]}`;
  const doc = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/);
  if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=pdf`;
  if (url.includes("dropbox.com")) return url.replace(/([?&])dl=0/, "$1dl=1");
  return url;
}

async function resumePdf(url: string, notes: string[]): Promise<ContentBlock | null> {
  const u = resumeFetchUrl(url);
  if (!u) { notes.push("resume link is not a fetchable URL"); return null; }
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!res.ok) { notes.push(`resume fetch failed (HTTP ${res.status})`); return null; }
    const buf = new Uint8Array(await res.arrayBuffer());
    const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (!isPdf) { notes.push("resume link is not a readable PDF (may need sharing permission)"); return null; }
    if (buf.length > 12 * 1024 * 1024) { notes.push("resume PDF too large"); return null; }
    let bin = "";
    for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(bin) } };
  } catch (e) {
    notes.push(`resume fetch error: ${clip(String(e), 120)}`);
    return null;
  }
}

function toAnswers(raw: unknown): Array<{ question: string; answer: string }> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const out = raw.map((r: any) => ({ question: String(r?.question ?? r?.q ?? r?.label ?? ""), answer: clip(r?.answer ?? r?.a ?? r?.value ?? r, 2000) })).filter((r) => r.answer);
    return out.length ? out : null;
  }
  if (typeof raw === "object") {
    const out = Object.entries(raw as Record<string, unknown>).map(([q, a]) => ({ question: q, answer: clip(a, 2000) })).filter((r) => r.answer);
    return out.length ? out : null;
  }
  return [{ question: "Application answers", answer: clip(raw, 4000) }];
}

// ---------- Role ----------
async function roleFor(cand: any, jobId: string | null): Promise<{ role: RoleSpec; job: any | null }> {
  let job = jobId ? await one(`jobs?id=eq.${jobId}&select=*`) : null;
  if (!job) {
    const rec = (await one(`job_recommendations?candidate_id=eq.${cand.id}&job_id=not.is.null&order=score.desc.nullslast&limit=1&select=job_id`))
      || (await one(`sourcing_recommendations?candidate_id=eq.${cand.id}&order=score.desc.nullslast&limit=1&select=job_id`));
    if (rec?.job_id) job = await one(`jobs?id=eq.${rec.job_id}&select=*`);
  }
  if (job) {
    const pay = job.salary_min ? `${job.salary_min}${job.salary_max ? `-${job.salary_max}` : ""} ${job.currency || "USD"} ${job.salary_period || ""}`.trim() : null;
    return {
      job,
      role: {
        title: job.title,
        department: job.department,
        description: clip([job.description, job.responsibilities].filter(Boolean).join("\n\n"), 4000),
        required_skills: clip([job.requirements, (job.skills || []).join(", ")].filter(Boolean).join("\n"), 2000) || null,
        pay,
        schedule: job.location_type ? `${job.location_type}${job.job_type ? `, ${job.job_type}` : ""}` : null,
      },
    };
  }
  // No role on file yet: rank against their own stated line of work.
  return { job: null, role: { title: cand.current_title || "Remote professional", description: "No specific job attached yet. Assess general fit for remote work with US clients in the candidate's stated field." } };
}

// ---------- Score one ----------
async function scoreOne(apiKey: string, dgKey: string, candidateId: string, jobId: string | null, applicationId: string | null) {
  const cand = await one(`candidates?id=eq.${candidateId}&select=*`);
  if (!cand) throw new HttpError(404, "candidate not found");
  const app = applicationId ? await one(`applications?id=eq.${applicationId}&select=*`) : null;
  const { role, job } = await roleFor(cand, jobId ?? app?.job_id ?? null);
  const notes: string[] = [];

  const speech = await speechFor(cand, dgKey, notes);
  const hasText = (cand.resume_text || "").length > 200;
  const pdf = !hasText && cand.resume_url ? await resumePdf(cand.resume_url, notes) : null;
  if (!hasText && !cand.resume_url) notes.push("no resume on file");

  // Only job-related facts. Name, photo, location, age and similar are deliberately left out.
  const evidence: CandidateEvidence = {
    name: "Candidate",
    resume_text: hasText ? clip(cand.resume_text, 15000) : null,
    application_answers: toAnswers(app?.screening_answers || app?.candidate_answers || app?.screening_responses || cand.application_answers || cand.screening_responses),
    cover_letter: clip(app?.cover_letter || cand.cover_letter, 4000) || null,
    profile: {
      current_title: cand.current_title, current_company: cand.current_company, experience_years: cand.experience_years,
      skills: cand.skills, certifications: cand.certifications, education: cand.education, timezone: cand.timezone,
      hands_on_experience: clip(cand.hands_on_experience, 2000) || null, min_hourly_rate: cand.min_hourly_rate,
      desired_salary: cand.desired_salary ? `${cand.desired_salary} ${cand.desired_salary_period || ""}`.trim() : null,
      linkedin_headline: cand.resume_parsed_data?.headline ?? null,
    },
    video_transcript: speech?.transcript ? clip(speech.transcript, 8000) : null,
    speech_metrics: speech?.metrics ?? null,
    source: cand.source,
  };

  const r = await assessCandidate(apiKey, role, evidence, pdf);
  const a = r.assessment;
  const concerns = [...a.concerns, ...notes.map((n) => `Data: ${n}`)].slice(0, 6);
  const tierLabel: Record<string, string> = { top: "Top match", strong: "Strong", possible: "Possible", low: "Low match", review: "Needs review" };
  // Never a rejection: the lowest outcome is "recruiter review".
  const action = r.tier === "top" || r.tier === "strong" ? "human_call" : "human_review";
  const actionText = action === "human_call" ? "recruiter call to confirm" : "recruiter review — scores rank, recruiters decide";
  const result = {
    engine: ENGINE, rubric_version: RUBRIC_VERSION, model: r.model, screened_at: new Date().toISOString(),
    job_id: job?.id ?? null, job_title: job?.title ?? role.title, application_id: app?.id ?? null,
    score: r.overall_score, confidence: r.confidence, family: r.family, tier: r.tier, tier_label: tierLabel[r.tier],
    coverage: r.confidence >= 75 ? "high" : r.confidence >= 45 ? "medium" : "low",
    recommended_action: action, recommended_action_text: actionText, human_review_required: true,
    dimensions: a.dimensions, missing_dimensions: r.missing_dimensions,
    writing_errors: a.writing_errors, writing_error_count: r.writing_error_count,
    strengths: a.strengths, concerns, red_flags: a.red_flags, interview_questions: a.interview_questions, summary: a.summary,
    speech: speech ? { metrics: speech.metrics, duration_seconds: speech.duration_seconds } : null,
    inputs: { resume: hasText ? "text" : pdf ? "pdf" : "none", transcript: !!speech, answers: !!evidence.application_answers, notes },
    usage: r.usage,
  };

  if (job) {
    await sb(`screening_results`, {
      method: "POST",
      body: JSON.stringify({ candidate_id: cand.id, job_id: job.id, application_id: app?.id ?? null, score: r.overall_score, verdict: action === "human_call" ? "PASS" : "REVIEW", tier: tierLabel[r.tier], recommended_action: action, result }),
    });
  }
  const cf = { ...(cand.custom_fields || {}) };
  delete cf.rubric_error;
  await sb(`candidates?id=eq.${cand.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      overall_score: r.overall_score,
      ai_recommendation: `${tierLabel[r.tier]} ${r.overall_score}/100 — recruiter decides`,
      ai_analysis: { ...(cand.ai_analysis || {}), rubric: result, score: r.overall_score, summary: a.summary, strengths: a.strengths, concerns, recommendation: tierLabel[r.tier] },
      custom_fields: cf,
      updated_at: new Date().toISOString(),
    }),
  });
  await sb(`activities`, {
    method: "POST",
    body: JSON.stringify({
      type: "ai_scoring",
      description: `Rubric score${job ? ` vs ${job.title}` : ""}: ${r.overall_score}/100 (${tierLabel[r.tier]}, ${r.confidence}% evidence). ${clip(a.summary, 300)}`,
      candidate_id: cand.id, job_id: job?.id ?? null, application_id: app?.id ?? null,
      metadata: { engine: ENGINE, score: r.overall_score, tier: r.tier, confidence: r.confidence, family: r.family },
    }),
  });
  return result;
}

async function markFailure(candidateId: string, err: unknown) {
  try {
    const c = await one(`candidates?id=eq.${candidateId}&select=custom_fields`);
    const prev = c?.custom_fields?.rubric_error;
    const cf = { ...(c?.custom_fields || {}), rubric_error: { attempts: (prev?.attempts || 0) + 1, last: clip(String(err), 300), at: new Date().toISOString() } };
    await sb(`candidates?id=eq.${candidateId}`, { method: "PATCH", body: JSON.stringify({ custom_fields: cf }) });
  } catch { /* ignore */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  try {
    if (!(await authorized(req, url))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action || url.searchParams.get("action") || "status";
    const [apiKey, dgKey, since] = await Promise.all([anthropicKey(), deepgramKey(), secret("rubric_autoscore_since")]);

    if (action === "status") {
      const pending = await sb(`rpc/rubric_pending`, { method: "POST", body: JSON.stringify({ max_rows: 500, max_attempts: MAX_ATTEMPTS }) });
      return json({ ok: true, engine: ENGINE, version: RUBRIC_VERSION, dimensions: DIMENSIONS, anthropic_key: !!apiKey, deepgram_key: !!dgKey, autoscore_since: since || null, pending: (pending || []).length });
    }
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set for Supabase Edge Functions." }, 400);

    if (action === "score") {
      if (!body.candidate_id) return json({ error: "candidate_id required" }, 400);
      const result = await scoreOne(apiKey, dgKey, body.candidate_id, body.job_id ?? null, body.application_id ?? null);
      return json({ ok: true, result });
    }

    if (action === "sweep") {
      if (!since) return json({ ok: true, scored: 0, note: "auto-scoring is off (app_secrets.rubric_autoscore_since not set)" });
      const limit = Math.max(1, Math.min(9, Number(body.limit) || 6));
      const todo = (await sb(`rpc/rubric_pending`, { method: "POST", body: JSON.stringify({ max_rows: limit, max_attempts: MAX_ATTEMPTS }) })) as any[];
      const started = Date.now();
      const results: any[] = [];
      // Three at a time keeps each sweep inside the edge-function time limit.
      for (let i = 0; i < (todo || []).length; i += 3) {
        if (Date.now() - started > 90000) { results.push({ note: "time budget reached; the rest run next sweep" }); break; }
        const batch = todo.slice(i, i + 3);
        results.push(...(await Promise.all(batch.map(async (t) => {
          try {
            const r = await scoreOne(apiKey, dgKey, t.candidate_id, t.job_id, t.application_id);
            return { candidate_id: t.candidate_id, job_id: t.job_id, score: r.score, tier: r.tier };
          } catch (e) {
            await markFailure(t.candidate_id, e);
            return { candidate_id: t.candidate_id, error: clip(String(e), 200) };
          }
        }))));
      }
      return json({ ok: true, scored: results.filter((r) => r.score != null).length, results });
    }

    return json({ error: `unknown action '${action}'` }, 400);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: String((e as Error)?.message || e) }, status);
  }
});
