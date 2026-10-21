// Ported from global-talent-growth-hub api/_lib/claude.ts for Supabase Edge (Deno).
import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.132.1/helpers/beta/zod";
import * as z from "npm:zod@4.5.4/v4";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5-5";
const clients = new Map<string, Anthropic>();
function anthropic(apiKey: string): Anthropic {
  if (!apiKey) throw new HttpError(500, "Missing ANTHROPIC_API_KEY (Supabase Edge Function secret).");
  let c = clients.get(apiKey);
  if (!c) { c = new Anthropic({ apiKey }); clients.set(apiKey, c); }
  return c;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

/** One structured-output call. The system prompt is stable per task, so it is marked for caching. */
export async function structured<S extends z.ZodType>(opts: {
  apiKey: string;
  system: string;
  user: string | ContentBlock[];
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<{ output: z.infer<S>; usage: unknown; model: string }> {
  const response = await anthropic(opts.apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
  });
  if (response.stop_reason === "refusal") throw new HttpError(422, "The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new HttpError(502, "The model response was cut off.");
  if (!response.parsed_output) throw new HttpError(502, "The model returned output that did not match the expected format.");
  return { output: response.parsed_output, usage: response.usage, model: response.model };
}
