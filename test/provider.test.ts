import { describe, expect, it } from "vitest";

import { AiError, buildRequest, classifyError, parseJsonReply, parseResponse } from "../src/main/ai/provider";
import { buildToolRequest, parseTurn, resultsMessage, userMessage } from "../src/main/ai/tooluse";

describe("requests", () => {
  it("Gemini: key in a header, JSON mode, no thinking on flash", () => {
    const r = buildRequest("gemini", "https://generativelanguage.googleapis.com/", "gemini-2.5-flash", "be brief", "hi", { json: true, maxTokens: 100, temperature: 0.1 });
    expect(r.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(r.keyHeader).toBe("x-goog-api-key");
    expect(r.url).not.toContain("key=");
    const b = r.body as any;
    expect(b.contents[0].parts[0].text).toBe("hi");
    expect(b.systemInstruction.parts[0].text).toBe("be brief");
    expect(b.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } });
  });
  it("Claude: version header, JSON asked in the system prompt, no sampling params", () => {
    const r = buildRequest("claude", "https://api.anthropic.com", "claude-haiku-5-5", "translate", "hello", { json: true, maxTokens: 256 });
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers).toEqual({ "anthropic-version": "2023-06-01" });
    const b = r.body as any;
    expect(b.system).toMatch(/^translate[\s\S]*JSON only/);
    expect(b.temperature).toBeUndefined();
    expect(b.output_config).toEqual({ effort: "low" });
  });
});

describe("responses", () => {
  it("reads Gemini text, skipping thoughts", () => {
    expect(parseResponse("gemini", { candidates: [{ content: { parts: [{ text: "hm", thought: true }, { text: "OK" }] }, finishReason: "STOP" }] })).toBe("OK");
    expect(() => parseResponse("gemini", { promptFeedback: { blockReason: "SAFETY" } })).toThrow(/declined/);
    expect(() => parseResponse("gemini", { candidates: [{ content: { parts: [{ text: "[" }] }, finishReason: "MAX_TOKENS" }] })).toThrow(/cut off/);
  });
  it("reads Claude text", () => {
    expect(parseResponse("claude", { content: [{ type: "text", text: "Bonjour" }], stop_reason: "end_turn" })).toBe("Bonjour");
    expect(() => parseResponse("claude", { content: [], stop_reason: "refusal" })).toThrow(/declined/);
  });
  it("classifies errors", () => {
    const bad = classifyError("gemini", 400, { error: { message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } });
    expect(bad.code).toBe("ai_bad_key");
    expect(classifyError("gemini", 429, { error: { message: "quota" } }).code).toBe("ai_quota");
    const over = classifyError("claude", 529, { error: { type: "overloaded_error" } });
    expect(over).toBeInstanceOf(AiError);
    expect(over.retryable).toBe(true);
  });
  it("tolerates fences and chatter around JSON", () => {
    expect(parseJsonReply('```json\n["a"]\n```')).toEqual(["a"]);
    expect(parseJsonReply('Here:\n{"text": "x"}\nDone')).toEqual({ text: "x" });
    expect(() => parseJsonReply("no json")).toThrow(AiError);
  });
});

describe("tool use", () => {
  const tools = [{ name: "find_free_time", description: "free", parameters: { type: "object", properties: { from: { type: "string" } }, required: ["from"] } }];
  it("Gemini round trip keeps the model's content", () => {
    const r = buildToolRequest("gemini", "http://x", "gemini-2.5-flash", "s", [userMessage("gemini", "hi")], tools, { json: true });
    expect((r.body as any).generationConfig.responseMimeType).toBeUndefined();
    const reply = { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "find_free_time", args: { from: "2026-10-27" } }, thoughtSignature: "sig" }] } }] };
    const t = parseTurn("gemini", reply);
    expect(t.kind).toBe("calls");
    if (t.kind !== "calls") return;
    expect((t.assistant as any).parts[0].thoughtSignature).toBe("sig");
    expect(resultsMessage("gemini", [[t.calls[0], { slots: [] }]]).parts[0].functionResponse.name).toBe("find_free_time");
  });
  it("Claude round trip uses tool_use ids", () => {
    const reply = { content: [{ type: "tool_use", id: "toolu_1", name: "find_free_time", input: { from: "x" } }], stop_reason: "tool_use" };
    const t = parseTurn("claude", reply);
    if (t.kind !== "calls") throw new Error("expected calls");
    expect(resultsMessage("claude", [[t.calls[0], 1]]).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
  });
});
