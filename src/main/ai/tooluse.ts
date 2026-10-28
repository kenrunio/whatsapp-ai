// Tool use ("function calling") for both providers, so the model can ask for facts mid-answer
// ({a free slot Tuesday} → the calendar). Pure request building and response parsing, like
// provider.ts; the loop that runs the tools is client.completeJsonTools. Ported from
// ClassicMail's ai/tooluse.rs.
//
// * Gemini: tools: [{functionDeclarations}]; the model answers with functionCall parts, we send
//   functionResponse parts back (its own content, thought signatures included, goes back
//   unchanged). JSON mode isn't allowed together with tools, so JSON is asked for in the prompt.
// * Claude: tools: [{name, description, input_schema}]; the model answers with tool_use blocks,
//   we send tool_result blocks back.

import { ANTHROPIC_VERSION, BuiltRequest, CompleteOpts, PROVIDERS, Provider, geminiConfig, parseResponse, systemText } from "./provider";

/** A tool the model may call: its parameters are a JSON schema (object, plain types only). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** Claude's tool_use id (Gemini has none: the name) */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Turn = { kind: "text"; text: string } | { kind: "calls"; calls: ToolCall[]; assistant: unknown };

type Json = any;

export function userMessage(provider: Provider, prompt: string): Json {
  return provider === "gemini" ? { role: "user", parts: [{ text: prompt }] } : { role: "user", content: prompt };
}

/** The tools' results, as the message that answers the model's calls. */
export function resultsMessage(provider: Provider, results: [ToolCall, unknown][]): Json {
  if (provider === "gemini") {
    return { role: "user", parts: results.map(([c, v]) => ({ functionResponse: { name: c.name, response: { result: v } } })) };
  }
  return { role: "user", content: results.map(([c, v]) => ({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(v) })) };
}

export function buildToolRequest(provider: Provider, base: string, model: string, system: string, history: Json[], tools: ToolSpec[], opts: CompleteOpts): BuiltRequest {
  base = base.replace(/\/+$/, "");
  const sys = systemText(system, !!opts.json);
  if (provider === "gemini") {
    const decls = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
    const body: Record<string, unknown> = { contents: history, generationConfig: geminiConfig(model, opts), tools: [{ functionDeclarations: decls }] };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return { url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, keyHeader: PROVIDERS.gemini.keyHeader, headers: {}, body };
  }
  const decls = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const body: Record<string, unknown> = { model, max_tokens: opts.maxTokens ?? 8192, messages: history, tools: decls, output_config: { effort: "low" } };
  if (sys) body.system = sys;
  return { url: `${base}/v1/messages`, keyHeader: PROVIDERS.claude.keyHeader, headers: { "anthropic-version": ANTHROPIC_VERSION }, body };
}

/** What the model did: asked for tools, or answered. Errors as parseResponse. */
export function parseTurn(provider: Provider, body: Json): Turn {
  if (provider === "gemini") {
    const content = body?.candidates?.[0]?.content;
    const parts: Json[] = Array.isArray(content?.parts) ? content.parts : [];
    const calls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p) => ({ id: String(p.functionCall.name ?? ""), name: String(p.functionCall.name ?? ""), args: p.functionCall.args ?? {} }));
    if (calls.length) return { kind: "calls", calls, assistant: content };
  } else {
    const blocks: Json[] = Array.isArray(body?.content) ? body.content : [];
    const calls: ToolCall[] = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id ?? ""), name: String(b.name ?? ""), args: b.input ?? {} }));
    if (calls.length) return { kind: "calls", calls, assistant: { role: "assistant", content: body.content } };
  }
  return { kind: "text", text: parseResponse(provider, body) };
}
