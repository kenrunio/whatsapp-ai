import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { describe as say, freeSlots } from "../src/main/slots";

const TZ = "Asia/Jerusalem";
const at = (iso: string, zone = TZ) => DateTime.fromISO(iso, { zone }).toMillis();
const base = {
  minutes: 45,
  gap: 15,
  tz: TZ,
  workDays: [0, 1, 2, 3, 4],
  workStart: 9 * 60,
  workEnd: 18 * 60,
  max: 4,
  now: at("2026-10-25T08:00"),
  busy: [],
};

describe("free slots", () => {
  it("skips busy time plus the gap, and takes different days first", () => {
    const s = freeSlots({ ...base, from: "2026-10-25", to: "2026-10-26", busy: [{ start: at("2026-10-25T09:00"), end: at("2026-10-25T10:00") }] });
    const when = s.map((x) => say(x, TZ));
    // Sunday 25th: 09:00–10:00 busy + 15 min gap → 10:15; Monday 26th: from 09:00
    expect(when[0]).toBe("Sunday 25 October 2026, 10:15–11:00");
    expect(when[1]).toBe("Sunday 25 October 2026, 12:00–12:45");
    expect(when).toContain("Monday 26 October 2026, 09:00–09:45");
    expect(s).toHaveLength(4);
  });

  it("leaves out the weekend and the past", () => {
    const s = freeSlots({ ...base, from: "2026-10-23", to: "2026-10-24", now: at("2026-10-23T08:00") });
    expect(s).toEqual([]); // Friday and Saturday
    const today = freeSlots({ ...base, from: "2026-10-25", to: "2026-10-25", now: at("2026-10-25T17:10") });
    expect(today).toEqual([]); // 17:30 + 45 min passes 18:00
  });

  it("fits the other side's hours abroad", () => {
    const s = freeSlots({ ...base, from: "2026-10-26", to: "2026-10-26", theirZone: "America/New_York", max: 1 });
    // 26 Oct: Israel is back on winter time (UTC+2), New York still on summer time (UTC-4): 09:00 there = 15:00 here
    expect(say(s[0], TZ)).toBe("Monday 26 October 2026, 15:00–15:45");
    expect(say(s[0], "America/New_York")).toBe("Monday 26 October 2026, 09:00–09:45");
  });

  it("honours part of day and earliest", () => {
    const s = freeSlots({ ...base, from: "2026-10-26", to: "2026-10-26", partOfDay: "afternoon", max: 1 });
    expect(say(s[0], TZ)).toBe("Monday 26 October 2026, 12:00–12:45");
    const e = freeSlots({ ...base, from: "2026-10-26", to: "2026-10-26", earliest: "14:30", max: 1 });
    expect(say(e[0], TZ)).toBe("Monday 26 October 2026, 14:30–15:15");
  });
});
