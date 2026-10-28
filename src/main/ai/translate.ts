// Translating received messages (the Translate link on a Hebrew message, and Translate chat).
//
// Texts go to the model as a JSON array and must come back as an array of the same length; a bad
// batch is split in halves and retried down to single texts (one that still fails keeps its
// original). Results are cached per (target language, text) on disk, so translating a message
// again costs nothing. Ported from ClassicMail's ai/translate.rs.

import { createHash } from "node:crypto";

import { AiConfig, completeJson } from "./client";
import { AiError } from "./provider";

export const SYSTEM =
  "You translate WhatsApp messages. You receive a JSON object {\"target\": language, \"texts\": [strings]} — messages from one chat, in order. " +
  "Translate every text into the target language naturally and accurately, the way a native speaker would write it in a chat: keep the tone " +
  "(casual stays casual, short stays short), the emojis and the line breaks. Keep URLs, e-mail addresses, numbers, amounts, dates, phone numbers " +
  "and ticker symbols exactly. Write people's names the way they are normally written in the target language (אלכס → Alex, יעל → Yael). " +
  "Hebrew slang and abbreviations (בקיצור, סבבה, אחלה, בע\"ה, תנצב\"ה) become their natural equivalent, not a literal rendering. " +
  "A text already in the target language comes back unchanged. " +
  "Return ONLY a JSON array of strings with exactly one translation per input text, in the same order.";

export const MAX_BATCH_CHARS = 3500;
export const MAX_BATCH_ITEMS = 40;
const MAX_TOTAL_CHARS = 100_000;

export const prompt = (target: string, texts: string[]) => JSON.stringify({ target, texts });

/** Split consecutive items into batches of at most maxChars characters / maxItems items (an over-long item gets a batch of its own). */
export function batches(lens: number[], maxChars: number, maxItems: number): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let chars = 0;
  lens.forEach((l, i) => {
    if (i > start && (chars + l > maxChars || i - start >= maxItems)) {
      out.push([start, i]);
      start = i;
      chars = 0;
    }
    chars += l;
  });
  if (start < lens.length) out.push([start, lens.length]);
  return out;
}

/** The model's reply for a batch, if it is an array of exactly n strings (or {"x": [...]} wrapping one). */
export function validateReply(v: unknown, n: number): string[] | null {
  let a: unknown = v;
  if (!Array.isArray(a) && a && typeof a === "object") {
    const vals = Object.values(a);
    a = vals.length === 1 ? vals[0] : null;
  }
  if (!Array.isArray(a) || a.length !== n || !a.every((x) => typeof x === "string")) return null;
  return a as string[];
}

/** A reply problem that a smaller batch may fix (anything else — bad key, quota, network — is final). */
const isBatchFault = (e: unknown) => e instanceof AiError && ["ai_bad_reply", "ai_too_long", "ai_empty"].includes(e.code);

/** Translate texts with the model: batched, validated, halved on a bad reply. null = keep the original. */
export async function translateUncached(cfg: AiConfig, target: string, texts: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = texts.map(() => null);
  let queue = batches(
    texts.map((t) => t.length),
    MAX_BATCH_CHARS,
    MAX_BATCH_ITEMS,
  );
  while (queue.length) {
    const round = queue;
    queue = [];
    const results = await Promise.all(
      round.map(async ([a, b]) => {
        const slice = texts.slice(a, b);
        const maxTokens = Math.min(16_000, Math.max(512, slice.reduce((n, s) => n + s.length, 0) * 3 + 256));
        try {
          const v = await completeJson(cfg, SYSTEM, prompt(target, slice), { maxTokens, temperature: 0.1, timeoutMs: 90_000 });
          return { a, b, tr: validateReply(v, slice.length) };
        } catch (e) {
          if (isBatchFault(e)) return { a, b, tr: null };
          throw e;
        }
      }),
    );
    for (const { a, b, tr } of results) {
      if (tr) tr.forEach((t, i) => (out[a + i] = t));
      else if (b - a > 1) {
        const mid = a + Math.floor((b - a) / 2);
        queue.push([a, mid], [mid, b]);
      }
    }
  }
  return out;
}

// ---- cache --------------------------------------------------------------------------------------

export interface TranslationCache {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export const cacheKey = (target: string, text: string) => `${target.toLowerCase()}:${createHash("sha256").update(text).digest("hex").slice(0, 32)}`;

export interface TranslateResult {
  translations: string[];
  target: string;
  cached: number;
  translated: number;
  failed: number;
}

/** Translate `texts` into `target`, from the cache where possible (surrounding whitespace is kept outside). */
export async function translateTexts(cfg: () => AiConfig, cache: TranslationCache, target: string, texts: string[]): Promise<TranslateResult> {
  if (texts.reduce((n, t) => n + t.length, 0) > MAX_TOTAL_CHARS) throw new AiError("ai_too_long", "That's too much text to translate at once.");
  const cores = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const known = new Map<string, string>();
  for (const c of cores) {
    const hit = cache.get(cacheKey(target, c));
    if (hit !== undefined) known.set(c, hit);
  }
  const cached = known.size;
  const missing = cores.filter((c) => !known.has(c));
  let translated = 0;
  if (missing.length) {
    const res = await translateUncached(cfg(), target, missing);
    missing.forEach((src, i) => {
      const t = res[i];
      if (t === null) return;
      translated++;
      known.set(src, t);
      cache.set(cacheKey(target, src), t);
    });
  }
  const translations = texts.map((t) => {
    const core = t.trim();
    const tr = core ? known.get(core) : undefined;
    if (tr === undefined) return t;
    const lead = t.slice(0, t.length - t.trimStart().length);
    const trail = t.slice(t.trimEnd().length);
    return `${lead}${tr}${trail}`;
  });
  return { translations, target, cached, translated, failed: cores.length - cached - translated };
}
