// Ported from global-talent-growth-hub api/_lib/transcribe.ts. Feeds spoken_english (comprehensibility, not accent).
import { HttpError } from "./claude.ts";

type DeepgramWord = { word: string; punctuated_word?: string; start: number; end: number; confidence: number };
type DeepgramResponse = {
  metadata?: { duration?: number };
  results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number; words?: DeepgramWord[] }> }> };
};

export type SpeechResult = {
  transcript: string;
  duration_seconds: number;
  metrics: { words_per_minute: number; filler_rate: number; transcription_confidence: number; speaking_seconds: number };
};

const FILLERS = new Set(["uh", "um", "uhm", "erm", "er", "ah", "hmm", "mm"]);

/** Transcribe a candidate video or audio file from a URL Deepgram can fetch (public or signed). */
export async function transcribeUrl(url: string, key: string): Promise<SpeechResult | null> {
  if (!key) throw new HttpError(500, "Missing DEEPGRAM_API_KEY (Supabase Edge Function secret).");
  const params = new URLSearchParams({ model: "nova-3", language: "en", smart_format: "true", filler_words: "true", punctuate: "true" });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(502, `Deepgram returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return speechFromDeepgram((await res.json()) as DeepgramResponse);
}

export function speechFromDeepgram(data: DeepgramResponse): SpeechResult | null {
  const alt = data.results?.channels?.[0]?.alternatives?.[0];
  const words = alt?.words ?? [];
  if (!alt?.transcript?.trim() || words.length === 0) return null;

  const spoken = words.filter((w) => !FILLERS.has(w.word.toLowerCase()));
  // Speaking time excludes pauses longer than 2s so long silences don't drag the pace down.
  let speaking = 0;
  for (let i = 0; i < words.length; i++) {
    speaking += words[i].end - words[i].start;
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : 0;
    speaking += Math.min(Math.max(gap, 0), 2);
  }
  const minutes = speaking / 60;
  const fillers = words.length - spoken.length;
  return {
    transcript: alt.transcript.trim(),
    duration_seconds: Math.round(data.metadata?.duration ?? words[words.length - 1].end),
    metrics: {
      words_per_minute: minutes > 0 ? Math.round(spoken.length / minutes) : 0,
      filler_rate: Math.round((fillers / words.length) * 1000) / 10,
      transcription_confidence: Math.round((alt.confidence ?? spoken.reduce((s, w) => s + w.confidence, 0) / Math.max(spoken.length, 1)) * 100) / 100,
      speaking_seconds: Math.round(speaking),
    },
  };
}
