// A fake model provider for tests — never a real AI call. Speaks both wire formats (Gemini
// generateContent, Claude messages) on 127.0.0.1, like ClassicMail's ai/fake.rs.
//
// Deterministic behaviour:
// * translating received messages ({"target", "texts"}) → each text prefixed "[EN] " (the
//   target's first two letters); a batch containing DROP_MARKER comes back one item short;
// * chat.translate → {"text": "[HE] <text>"};
// * chat.review → with tools offered, an instruction about free time / a slot calls
//   find_free_time, one about a picture / photo / file calls find_files, one about a phone /
//   number / e-mail calls find_contact; with the results back the instruction becomes the first
//   slot / the contact's first phone ("[?]" when none), a file instruction disappears and the
//   first file found is attached; any other instruction becomes its own text in capitals.
// Keys: FAKE_KEY works; QUOTA_KEY → HTTP 429; anything else → the provider's bad-key error.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { instructions } from "../../shared/text";

export const FAKE_KEY = "demo-ai-key";
export const QUOTA_KEY = "demo-ai-quota";
export const DROP_MARKER = "<<fake-drop>>";

type Json = any;

function firstJson(s: string): Json {
  const i = s.indexOf("{");
  if (i < 0) return null;
  try {
    return JSON.parse(s.slice(i));
  } catch {
    return null;
  }
}

const tagOf = (lang: string) => (lang || "English").slice(0, 2).toUpperCase();

type Need = "find_free_time" | "find_files" | "find_contact" | null;

function need(instr: string): Need {
  const s = instr.toLowerCase();
  if (/free|slot|availab/.test(s)) return "find_free_time";
  if (/picture|photo|file|image|document/.test(s)) return "find_files";
  if (/phone|number|e-?mail|contact/.test(s)) return "find_contact";
  return null;
}

/** The fake answer: either tool calls or the final text. */
export function answer(prompt: string, toolsOffered: boolean, results: Record<string, Json>): { calls?: { name: string; args: Json }[]; text?: string } {
  const v = firstJson(prompt);
  if (v?.task === "chat.translate") return { text: JSON.stringify({ text: `[${tagOf(v.language)}] ${v.text}` }) };
  if (v?.task === "chat.review") {
    const instrs = instructions(String(v.text ?? ""));
    if (toolsOffered && Object.keys(results).length === 0) {
      const calls = instrs
        .map((i) => ({ i, n: need(i) }))
        .filter((x) => x.n)
        .map(({ i, n }) => ({
          name: n!,
          args:
            n === "find_free_time"
              ? { from: v.today_date, to: v.today_date }
              : n === "find_files"
                ? { query: i.replace(/send|attach|insert|the|picture|photo|file|image|document|of/gi, "").trim(), kind: "any" }
                : { query: i.replace(/phone|number|e-?mail|contact|'s|of|his|her/gi, "").trim() },
        }));
      if (calls.length) return { calls };
    }
    const attachments: string[] = [];
    let text = String(v.text ?? "");
    for (const i of instrs) {
      let rep: string;
      switch (need(i)) {
        case "find_free_time":
          rep = results.find_free_time?.slots?.[0]?.when ?? "[?]";
          break;
        case "find_files": {
          const f = results.find_files?.files?.[0]?.path;
          if (f) attachments.push(f);
          rep = f ? "" : "[?]";
          break;
        }
        case "find_contact":
          rep = results.find_contact?.contacts?.[0]?.phones?.[0] ?? "[?]";
          break;
        default:
          rep = i.toUpperCase();
      }
      text = text.replace(`{${i}}`, rep);
    }
    return { text: JSON.stringify({ text: text.replace(/ {2,}/g, " ").trim(), attachments }) };
  }
  if (v && Array.isArray(v.texts)) {
    const out = v.texts.map((t: string) => `[${tagOf(v.target)}] ${t}`);
    if (v.texts.some((t: string) => String(t).includes(DROP_MARKER))) out.pop();
    return { text: JSON.stringify(out) };
  }
  return { text: "OK" };
}

function keyError(provider: "gemini" | "claude", key: string | undefined): [number, Json] | null {
  if (key === FAKE_KEY) return null;
  if (key === QUOTA_KEY) return [429, { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", type: "rate_limit_error" } }];
  return provider === "gemini"
    ? [400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }]
    : [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }];
}

function gemini(body: Json): Json {
  const contents: Json[] = body.contents ?? [];
  const prompt = contents[0]?.parts?.[0]?.text ?? "";
  const results: Record<string, Json> = {};
  for (const c of contents) for (const p of c.parts ?? []) if (p.functionResponse) results[p.functionResponse.name] = p.functionResponse.response?.result;
  const a = answer(prompt, !!body.tools?.[0]?.functionDeclarations?.length, results);
  const parts = a.calls ? a.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) : [{ text: a.text }];
  return { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] };
}

function claude(body: Json): Json {
  const msgs: Json[] = body.messages ?? [];
  const prompt = typeof msgs[0]?.content === "string" ? msgs[0].content : "";
  // tool_use ids are "toolu_<name>", so results map back to their tool
  const results: Record<string, Json> = {};
  for (const m of msgs)
    if (Array.isArray(m.content))
      for (const b of m.content) if (b.type === "tool_result") results[String(b.tool_use_id).replace(/^toolu_/, "")] = JSON.parse(b.content);
  const a = answer(prompt, !!body.tools?.length, results);
  if (a.calls) {
    return { content: a.calls.map((c) => ({ type: "tool_use", id: `toolu_${c.name}`, name: c.name, input: c.args })), stop_reason: "tool_use" };
  }
  return { content: [{ type: "text", text: a.text }], stop_reason: "end_turn" };
}

/** Starts the fake provider; resolves to its base URL. */
export function startFake(): Promise<string> {
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const provider = req.url?.startsWith("/v1/messages") ? "claude" : "gemini";
      const key = (provider === "gemini" ? req.headers["x-goog-api-key"] : req.headers["x-api-key"]) as string | undefined;
      const err = keyError(provider, key);
      let status = 200;
      let out: Json;
      if (err) [status, out] = err;
      else {
        try {
          out = provider === "gemini" ? gemini(JSON.parse(data)) : claude(JSON.parse(data));
        } catch (e) {
          [status, out] = [400, { error: { message: String(e) } }];
        }
      }
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}
