// Calling the model: one HTTP round trip (with one retry when the provider is overloaded), plain
// or JSON answers, and the tool-use loop.

import { AiError, BuiltRequest, CompleteOpts, Provider, buildRequest, classifyError, parseJsonReply, parseResponse } from "./provider";
import { ToolCall, ToolSpec, buildToolRequest, parseTurn, resultsMessage, userMessage } from "./tooluse";

export interface AiConfig {
  provider: Provider;
  model: string;
  base: string;
  key: string;
  /** the built-in fake model (tests / demo) */
  demo: boolean;
}

type Json = any;

async function send(cfg: AiConfig, req: BuiltRequest, timeoutMs: number): Promise<Json> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: "POST",
        headers: { "content-type": "application/json", [req.keyHeader]: cfg.key, ...req.headers },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new AiError(
        timedOut ? "ai_timeout" : "ai_network",
        timedOut ? "The AI took too long to answer. Try again." : "Couldn't reach the AI service. Check the internet connection.",
      );
    }
    const text = await res.text();
    let body: Json = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (res.ok) {
      if (body === null) throw new AiError("ai_bad_reply", "The AI service sent an unreadable answer.");
      return body;
    }
    const err = classifyError(cfg.provider, res.status, body);
    if (err.retryable && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw err;
  }
}

export async function complete(cfg: AiConfig, system: string, prompt: string, opts: CompleteOpts = {}): Promise<string> {
  const req = buildRequest(cfg.provider, cfg.base, cfg.model, system, prompt, opts);
  return parseResponse(cfg.provider, await send(cfg, req, opts.timeoutMs ?? 60_000));
}

export async function completeJson<T = Json>(cfg: AiConfig, system: string, prompt: string, opts: CompleteOpts = {}): Promise<T> {
  return parseJsonReply(await complete(cfg, system, prompt, { ...opts, json: true })) as T;
}

/** Runs a tool the model asked for; problems come back as {error} for the model to deal with. */
export type ToolRunner = (call: ToolCall) => Promise<unknown>;

const MAX_ROUNDS = 8;

/** A JSON answer from a model that may call `tools` first (each round's calls run in parallel). */
export async function completeJsonTools<T = Json>(cfg: AiConfig, system: string, prompt: string, tools: ToolSpec[], run: ToolRunner, opts: CompleteOpts = {}): Promise<T> {
  const history: Json[] = [userMessage(cfg.provider, prompt)];
  const o = { ...opts, json: true };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // the last round offers no tools, so the model has to answer
    const offer = round < MAX_ROUNDS - 1 ? tools : [];
    const req = buildToolRequest(cfg.provider, cfg.base, cfg.model, system, history, offer, o);
    const turn = parseTurn(cfg.provider, await send(cfg, req, o.timeoutMs ?? 90_000));
    if (turn.kind === "text") return parseJsonReply(turn.text) as T;
    history.push(turn.assistant);
    const results = await Promise.all(
      turn.calls.map(async (c): Promise<[ToolCall, unknown]> => {
        try {
          return [c, await run(c)];
        } catch (e) {
          return [c, { error: e instanceof Error ? e.message : String(e) }];
        }
      }),
    );
    history.push(resultsMessage(cfg.provider, results));
  }
  throw new AiError("ai_bad_reply", "The AI kept looking things up without answering. Try a simpler instruction.");
}
