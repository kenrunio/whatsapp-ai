// Real model calls — run only when LIVE_GEMINI_KEY is set (never in the normal test run):
//   LIVE_GEMINI_KEY=… npx vitest run test/live.test.ts
import { describe, expect, it } from "vitest";

import { AiConfig } from "../src/main/ai/client";
import { review, translateOut } from "../src/main/ai/compose";
import { PROVIDERS } from "../src/main/ai/provider";
import { translateTexts } from "../src/main/ai/translate";
import { SPECS } from "../src/main/tools";
import { scriptOf } from "../src/shared/lang";

const key = process.env.LIVE_GEMINI_KEY;
const cfg: AiConfig = { provider: "gemini", model: "gemini-2.5-flash", base: PROVIDERS.gemini.base, key: key ?? "", demo: false };
const ctx = {
  chat: "Dan Amir",
  isGroup: false,
  messages: [
    { from: "Dan Amir", me: false, time: "09:58", text: "היי אלכס, מה שלומך? מתי נוח לך להיפגש שבוע הבא לגבי Acme?" },
    { from: "Dan Amir", me: false, time: "09:59", text: "אגב תשלח לי את המצגת של הרבעון בבקשה 🙏" },
  ],
};
const me = { name: "Alex Stone", gender: "" as const };

describe.skipIf(!key)("live Gemini", () => {
  it("translates received Hebrew into English", async () => {
    const cache = new Map<string, string>();
    const r = await translateTexts(() => cfg, { get: (k) => cache.get(k), set: (k, v) => void cache.set(k, v) }, "English", ctx.messages.map((m) => m.text));
    console.log(r.translations);
    expect(r.failed).toBe(0);
    expect(r.translations[0]).toMatch(/Alex/);
    expect(r.translations[0]).toMatch(/Acme/);
    expect(scriptOf(r.translations[1])).toBe("Latin");
  }, 60_000);

  it("translates my English into WhatsApp Hebrew", async () => {
    const t = await translateOut(cfg, "Hi Dan, all good thanks! Tuesday at 14:00 works for me. I'll send the Q3 deck tonight.", "Hebrew", ctx, me);
    console.log(t);
    expect(scriptOf(t)).toBe("Hebrew");
    expect(t).toMatch(/14:00/);
    expect(t).toMatch(/Q3|רבעון/);
  }, 60_000);

  it("carries out an instruction with the chat as context", async () => {
    const clock = { today: "Friday 23 October 2026", todayDate: "2026-10-23", timeNow: "10:00", timeZone: "Asia/Jerusalem" };
    const r = await review(cfg, "Hi {his first name}, {say I'll send the deck he asked for tonight}", ctx, me, "English", clock, SPECS, async () => ({ error: "not available in this test" }), () => new Set());
    console.log(r);
    expect(r.applied).toBe(2);
    expect(r.text).toMatch(/^Hi Dan/);
    expect(r.text).not.toMatch(/[{}]/);
  }, 90_000);
});
