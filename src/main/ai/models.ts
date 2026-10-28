// Which models the user's key can use, asked from the provider itself (model names change: Google
// retires models for new keys), ranked with a recommended default. Ported from ClassicMail's
// ai/models.rs.
//
// * Gemini: GET {base}/v1beta/models?pageSize=1000 → {models: [{name: "models/gemini-…", displayName, supportedGenerationMethods}]}
// * Claude: GET {base}/v1/models?limit=1000 → {data: [{id, display_name}]}

import { AiConfig } from "./client";
import { ANTHROPIC_VERSION, AiError, Provider, classifyError } from "./provider";

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ModelList {
  models: ModelInfo[];
  recommended: string | null;
}

/** Gemini models that can't do plain text generation for us. */
const GEMINI_SKIP = ["embedding", "embed", "tts", "image", "audio", "live", "native-audio", "computer-use", "robotics", "aqa", "veo", "imagen", "learnlm"];

/** The version in an id as [major, minor]: "gemini-3.8-flash" → [3, 8], "claude-haiku-5-5" → [5, 5]. A date after the number is not a minor version. */
export function version(id: string): [number, number] {
  const parts = id.split(/[-_]/);
  const small = (s: string | undefined) => (s && s.length <= 2 && /^\d+$/.test(s) ? Number(s) : null);
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+)\.(\d+)$/.exec(parts[i]);
    if (m) return [Number(m[1]), Number(m[2])];
    if (/^\d+$/.test(parts[i])) return [Number(parts[i]), small(parts[i + 1]) ?? 0];
  }
  return [0, 0];
}

/** Lower is better: stable before preview / experimental; flash > flash-lite > pro, haiku > sonnet > opus (chat wants fast and cheap). */
export function tier(id: string): number {
  const l = id.toLowerCase();
  const unstable = l.includes("preview") || l.includes("exp") || l.includes("latest");
  const base = l.includes("lite") ? 2 : l.includes("flash") || l.includes("haiku") ? 1 : l.includes("sonnet") ? 3 : 4;
  return base + (unstable ? 10 : 0);
}

export function rank(models: ModelInfo[]): ModelList {
  const seen = new Set<string>();
  const out = models
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => {
      const [va, vb] = [version(a.id), version(b.id)];
      return tier(a.id) - tier(b.id) || vb[0] - va[0] || vb[1] - va[1] || a.id.localeCompare(b.id);
    });
  return { models: out, recommended: out[0]?.id ?? null };
}

type Json = any;

export function parseGemini(body: Json): ModelInfo[] {
  const list: Json[] = Array.isArray(body?.models) ? body.models : [];
  return list
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => ({ id: String(m.name ?? "").replace(/^models\//, ""), label: String(m.displayName ?? m.name ?? "") }))
    .filter((m) => m.id.toLowerCase().startsWith("gemini") && !GEMINI_SKIP.some((s) => m.id.toLowerCase().includes(s)));
}

export function parseClaude(body: Json): ModelInfo[] {
  const list: Json[] = Array.isArray(body?.data) ? body.data : [];
  return list.filter((m) => typeof m.id === "string").map((m) => ({ id: m.id, label: String(m.display_name ?? m.id) }));
}

/** Ask the provider (the fake one has no list: its default stands). */
export async function fetchModels(cfg: Omit<AiConfig, "model">, fallback: string): Promise<ModelList> {
  if (cfg.demo) return rank([{ id: fallback, label: `${fallback} (demo)` }]);
  const base = cfg.base.replace(/\/+$/, "");
  const [url, headers]: [string, Record<string, string>] =
    cfg.provider === "gemini"
      ? [`${base}/v1beta/models?pageSize=1000`, { "x-goog-api-key": cfg.key }]
      : [`${base}/v1/models?limit=1000`, { "x-api-key": cfg.key, "anthropic-version": ANTHROPIC_VERSION }];
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new AiError("ai_network", "Couldn't reach the AI service. Check the internet connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw classifyError(cfg.provider as Provider, res.status, body);
  return rank(cfg.provider === "gemini" ? parseGemini(body) : parseClaude(body));
}
