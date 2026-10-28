// The translation and {instruction} flows against the built-in fake model (no real AI).
import { beforeAll, describe, expect, it } from "vitest";

import { AiConfig } from "../src/main/ai/client";
import { chatTranscript, review, translateOut } from "../src/main/ai/compose";
import { DROP_MARKER, FAKE_KEY, QUOTA_KEY, startFake } from "../src/main/ai/fake";
import { batches, translateTexts, translateUncached, validateReply } from "../src/main/ai/translate";
import { SPECS } from "../src/main/tools";

let base = "";
beforeAll(async () => {
  base = await startFake();
});
const cfg = (provider: "gemini" | "claude" = "gemini", key = FAKE_KEY): AiConfig => ({ provider, model: "gemini-2.5-flash", base, key, demo: true });
const me = { name: "Alex Stone", gender: "" as const };
const clock = { today: "Friday 23 October 2026", todayDate: "2026-10-23", timeNow: "10:00", timeZone: "Asia/Jerusalem" };
const ctx = { chat: "Dan Amir", isGroup: false, messages: [{ from: "Dan Amir", me: false, time: "09:58, 23/10/2026", text: "מתי נוח לך להיפגש?" }] };

describe("batching", () => {
  it("covers every item once", () => {
    expect(batches([], 10, 5)).toEqual([]);
    expect(batches([3, 3, 3, 3], 7, 10)).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(batches([2, 50, 2], 10, 10)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });
  it("validates replies", () => {
    expect(validateReply(["a", "b"], 2)).toEqual(["a", "b"]);
    expect(validateReply(["a"], 2)).toBeNull();
    expect(validateReply({ translations: ["a"] }, 1)).toEqual(["a"]);
    expect(validateReply(["a", 1], 2)).toBeNull();
  });
});

describe("translating received messages", () => {
  it("halves a bad batch down to the bad text, which keeps its original", async () => {
    const out = await translateUncached(cfg(), "English", ["a", "b", `c ${DROP_MARKER}`, "d"]);
    expect(out).toEqual(["[EN] a", "[EN] b", null, "[EN] d"]);
  });
  it("caches, dedupes and keeps whitespace outside", async () => {
    const store = new Map<string, string>();
    const cache = { get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v) };
    const texts = ["שלום אלכס", "  מה נשמע?\n", "שלום אלכס"];
    const a = await translateTexts(() => cfg(), cache, "English", texts);
    expect(a.translations).toEqual(["[EN] שלום אלכס", "  [EN] מה נשמע?\n", "[EN] שלום אלכס"]);
    expect(a.translated).toBe(2);
    const b = await translateTexts(
      () => {
        throw new Error("no model call expected");
      },
      cache,
      "English",
      texts,
    );
    expect(b.cached).toBe(2);
    expect(b.translations).toEqual(a.translations);
  });
  it("reports a bad key and a quota clearly, for both providers", async () => {
    await expect(translateUncached(cfg("gemini", "nope"), "English", ["x"])).rejects.toMatchObject({ code: "ai_bad_key" });
    await expect(translateUncached(cfg("claude", "nope"), "English", ["x"])).rejects.toMatchObject({ code: "ai_bad_key" });
    await expect(translateUncached(cfg("gemini", QUOTA_KEY), "English", ["x"])).rejects.toMatchObject({ code: "ai_quota" });
  });
});

describe("writing", () => {
  it("translates my message", async () => {
    expect(await translateOut(cfg(), "Tuesday works, see you then", "Hebrew", ctx, me)).toBe("[HE] Tuesday works, see you then");
    expect(await translateOut(cfg("claude"), "Thanks!", "Hebrew", ctx, me)).toBe("[HE] Thanks!");
    await expect(translateOut(cfg(), "  ", "Hebrew", ctx, me)).rejects.toMatchObject({ code: "ai_nothing" });
  });

  for (const provider of ["gemini", "claude"] as const) {
    it(`carries out {instructions} with tools (${provider})`, async () => {
      const found = new Set<string>();
      const calls: string[] = [];
      const run = async (c: { name: string; args: Record<string, unknown> }) => {
        calls.push(c.name);
        if (c.name === "find_free_time") return { slots: [{ when: "Tuesday 27 October 2026, 14:00–14:45" }] };
        if (c.name === "find_files") {
          found.add("C:\\Pics\\acme logo.png");
          return { files: [{ path: "C:\\Pics\\acme logo.png" }] };
        }
        if (c.name === "find_contact") return { contacts: [{ phones: ["+972 50-123-4567"] }] };
        return {};
      };
      const r = await review(cfg(provider), "How about {a free slot}? {send the acme logo picture} {thank him} [ref]", ctx, me, "English", clock, SPECS, run, () => found);
      expect(calls.sort()).toEqual(["find_files", "find_free_time"]);
      expect(r.text).toBe("How about Tuesday 27 October 2026, 14:00–14:45? THANK HIM [ref]");
      expect(r.attachments).toEqual(["C:\\Pics\\acme logo.png"]);
      expect(r.applied).toBe(3);
    });
  }

  it("never attaches a file the tools didn't offer", async () => {
    const run = async () => ({ files: [{ path: "C:\\Windows\\secret.txt" }] });
    const r = await review(cfg(), "Here it is {send the file}", ctx, me, "English", clock, SPECS, run, () => new Set());
    expect(r.attachments).toEqual([]);
    expect(r.text).toBe("Here it is");
  });

  it("does nothing without instructions", async () => {
    const r = await review(cfg("gemini", "bad"), "plain", ctx, me, "English", clock, SPECS, async () => ({}), () => new Set());
    expect(r).toEqual({ text: "plain", attachments: [], applied: 0 });
  });

  it("gives the model the newest part of a long chat", () => {
    const long = { chat: "Dan", isGroup: false, messages: Array.from({ length: 2000 }, (_, i) => ({ from: "Dan", me: i % 2 === 0, time: `${i}`, text: `message ${i}` })) };
    const t = chatTranscript(long, "Alex");
    expect(t.length).toBeLessThanOrEqual(12_000);
    expect(t.endsWith("message 1999")).toBe(true);
    expect(t).toContain("Alex (me): message 1998");
  });
});
