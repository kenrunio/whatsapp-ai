// Request building and response parsing for the two model providers (pure functions, so the
// JSON shapes are unit-tested without any network). Ported from ClassicMail's ai/provider.rs.
//
// * Gemini: POST {base}/v1beta/models/{model}:generateContent, header x-goog-api-key.
// * Claude: POST {base}/v1/messages, headers x-api-key + anthropic-version: 2023-06-01.
//
// The API key only ever goes into a request header; never into a URL, an error message or a log.

export type Provider = "gemini" | "claude";

export const PROVIDERS: Record<Provider, { label: string; defaultModel: string; base: string; keyHeader: string }> = {
  gemini: { label: "Google Gemini", defaultModel: "gemini-3.8-flash", base: "https://generativelanguage.googleapis.com", keyHeader: "x-goog-api-key" },
  claude: { label: "Anthropic Claude", defaultModel: "claude-haiku-5-5", base: "https://api.anthropic.com", keyHeader: "x-api-key" },
};

export const ANTHROPIC_VERSION = "2023-06-01";
export const JSON_ONLY = "Reply with valid JSON only — no prose, no Markdown code fences.";

export interface CompleteOpts {
  /** ask for a JSON reply (Gemini responseMimeType; Claude: instruction in the system prompt) */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface BuiltRequest {
  url: string;
  /** header carrying the key */
  keyHeader: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function systemText(system: string, json: boolean): string {
  if (!json) return system;
  return system ? `${system}\n\n${JSON_ONLY}` : JSON_ONLY;
}

export function geminiConfig(model: string, opts: CompleteOpts): Record<string, unknown> {
  const g: Record<string, unknown> = { maxOutputTokens: opts.maxTokens ?? 8192 };
  if (opts.temperature !== undefined) g.temperature = opts.temperature;
  // 2.5 Flash thinks by default; short text tasks don't need it (cheaper, faster)
  if (model.includes("flash")) g.thinkingConfig = { thinkingBudget: 0 };
  return g;
}

export function buildRequest(provider: Provider, base: string, model: string, system: string, prompt: string, opts: CompleteOpts): BuiltRequest {
  base = base.replace(/\/+$/, "");
  if (provider === "gemini") {
    const gcfg = geminiConfig(model, opts);
    if (opts.json) gcfg.responseMimeType = "application/json";
    const body: Record<string, unknown> = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gcfg };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return { url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, keyHeader: PROVIDERS.gemini.keyHeader, headers: {}, body };
  }
  const sys = systemText(system, !!opts.json);
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8192,
    messages: [{ role: "user", content: prompt }],
    // short utility tasks: keep thinking light
    output_config: { effort: "low" },
  };
  if (sys) body.system = sys;
  return { url: `${base}/v1/messages`, keyHeader: PROVIDERS.claude.keyHeader, headers: { "anthropic-version": ANTHROPIC_VERSION }, body };
}

/** Why a call failed, in words the user can act on. */
export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public retryable = false,
  ) {
    super(message);
  }
}

type Json = any;

function providerMessage(body: Json): string {
  const m = body?.error?.message;
  return typeof m === "string" ? m.trim().slice(0, 300) : "";
}

/** Map an HTTP error response to a clear error. */
export function classifyError(provider: Provider, status: number, body: Json): AiError {
  const name = PROVIDERS[provider].label;
  const detail = providerMessage(body);
  const geminiReason = Array.isArray(body?.error?.details) ? (body.error.details.find((d: Json) => d?.reason)?.reason ?? "") : "";
  const claudeType = body?.error?.type ?? "";
  const badKey =
    status === 401 ||
    status === 403 ||
    geminiReason === "API_KEY_INVALID" ||
    claudeType === "authentication_error" ||
    claudeType === "permission_error" ||
    (status === 400 && detail.toLowerCase().includes("api key"));
  const suffix = detail ? ` (${detail})` : "";
  if (badKey) return new AiError("ai_bad_key", `${name} didn't accept the API key. Check it in Settings.`, status);
  if (status === 429)
    return new AiError("ai_quota", `${name}: quota or rate limit reached. Try again in a minute, or check the plan / billing for your API key.${suffix}`, status);
  if (status === 404) return new AiError("ai_model", `${name} doesn't know the model you chose. Pick another one in Settings.${suffix}`, status);
  if (status >= 500 || status === 529) return new AiError("ai_unavailable", `${name} is unavailable right now (HTTP ${status}). Try again shortly.`, status, true);
  return new AiError("ai_error", `${name} error (HTTP ${status})${detail ? `: ${detail}` : ""}`, status);
}

/** The model's text from a successful (HTTP 200) response. */
export function parseResponse(provider: Provider, body: Json): string {
  const name = PROVIDERS[provider].label;
  const fail = (code: string, msg: string) => new AiError(code, msg, 200);
  if (provider === "gemini") {
    const block = body?.promptFeedback?.blockReason;
    if (block) throw fail("ai_blocked", `${name} declined this request (${block}).`);
    const c = body?.candidates?.[0];
    if (!c) throw fail("ai_empty", `${name} returned no answer.`);
    const parts: Json[] = Array.isArray(c.content?.parts) ? c.content.parts : [];
    const text = parts
      .filter((p) => p.thought !== true)
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
    const reason = c.finishReason ?? "";
    if (!text) {
      if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION", "SPII"].includes(reason)) throw fail("ai_blocked", `${name} declined this request (${reason}).`);
      if (reason === "MAX_TOKENS") throw fail("ai_too_long", `${name}'s answer was cut off (too long).`);
      throw fail("ai_empty", `${name} returned an empty answer.`);
    }
    if (reason === "MAX_TOKENS") throw fail("ai_too_long", `${name}'s answer was cut off (too long).`);
    return text;
  }
  const stop = body?.stop_reason ?? "";
  if (stop === "refusal") throw fail("ai_blocked", `${name} declined this request.`);
  const blocks: Json[] = Array.isArray(body?.content) ? body.content : [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (stop === "max_tokens") throw fail("ai_too_long", `${name}'s answer was cut off (too long).`);
  if (!text) throw fail("ai_empty", `${name} returned an empty answer.`);
  return text;
}

/** Parse a JSON reply, tolerating Markdown fences and text around the JSON. */
export function parseJsonReply(text: string): Json {
  let t = text.trim();
  for (const p of ["```json", "```JSON", "```"]) {
    if (t.startsWith(p)) {
      t = t.slice(p.length);
      break;
    }
  }
  if (t.endsWith("```")) t = t.slice(0, -3);
  t = t.trim();
  try {
    return JSON.parse(t);
  } catch {
    // the first [...] or {...} span
  }
  const start = t.search(/[[{]/);
  if (start < 0) throw new AiError("ai_bad_reply", "The AI's reply wasn't JSON.");
  const close = t[start] === "[" ? "]" : "}";
  const end = t.lastIndexOf(close);
  if (end <= start) throw new AiError("ai_bad_reply", "The AI's reply wasn't JSON.");
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new AiError("ai_bad_reply", "The AI's reply wasn't JSON.");
  }
}
