// Free meeting slots: pure, so it is unit-tested without a calendar. Candidates start on the
// quarter hour inside the day's window (work hours, or the part of day asked for), don't touch a
// busy period widened by the usual gap, and — when the other side is abroad — fall inside their
// hours too. Days take turns, so the answer offers different days before more times on one day.

import { DateTime } from "luxon";

export interface Interval {
  start: number;
  end: number;
}

export interface SlotQuery {
  /** YYYY-MM-DD, in tz */
  from: string;
  to: string;
  minutes: number;
  gap: number;
  tz: string;
  /** 0 = Sunday */
  workDays: number[];
  /** minutes after midnight */
  workStart: number;
  workEnd: number;
  partOfDay?: string;
  /** HH:MM */
  earliest?: string;
  latest?: string;
  theirZone?: string;
  /** HH:MM-HH:MM in their zone */
  theirHours?: string;
  max: number;
  now: number;
  busy: Interval[];
}

const STEP = 15;
const MAX_DAYS = 31;

export function hm(s: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

function dayWindow(q: SlotQuery): [number, number] {
  let [a, b] = [q.workStart, q.workEnd];
  switch (q.partOfDay) {
    case "morning":
      b = Math.min(b, 12 * 60);
      break;
    case "afternoon":
      a = Math.max(a, 12 * 60);
      break;
    case "evening":
      [a, b] = [17 * 60, 21 * 60];
      break;
  }
  a = hm(q.earliest) ?? a;
  b = hm(q.latest) ?? b;
  return [a, b];
}

export function freeSlots(q: SlotQuery): Interval[] {
  const len = q.minutes * 60_000;
  const gap = q.gap * 60_000;
  const busy = q.busy.map((b) => ({ start: b.start - gap, end: b.end + gap }));
  const [winA, winB] = dayWindow(q);
  const their = q.theirZone ? (q.theirHours ?? "09:00-18:00").split("-").map((x) => hm(x)) : null;
  const earliestStart = q.now + 15 * 60_000;
  const first = DateTime.fromISO(q.from, { zone: q.tz }).startOf("day");
  const last = DateTime.fromISO(q.to || q.from, { zone: q.tz }).startOf("day");
  if (!first.isValid || !last.isValid) throw new Error("Dates must be YYYY-MM-DD.");

  const perDay: Interval[][] = [];
  for (let d = first, n = 0; d <= last && n < MAX_DAYS; d = d.plus({ days: 1 }), n++) {
    if (!q.workDays.includes(d.weekday % 7)) continue;
    const day: Interval[] = [];
    for (let m = Math.ceil(winA / STEP) * STEP; m + q.minutes <= winB; m += STEP) {
      const start = d.plus({ minutes: m }).toMillis();
      const end = start + len;
      if (start < earliestStart) continue;
      if (busy.some((b) => b.start < end && start < b.end)) continue;
      if (their && q.theirZone) {
        const s = DateTime.fromMillis(start, { zone: q.theirZone });
        const sm = s.hour * 60 + s.minute;
        const em = sm + q.minutes;
        if (their[0] !== null && sm < their[0]) continue;
        if (their[1] !== null && em > their[1]) continue;
      }
      day.push({ start, end });
    }
    if (day.length) perDay.push(day);
  }

  // round robin over days; a second time on the same day is at least an hour after the first
  const picked: Interval[] = [];
  const lastPicked = new Map<number, number>();
  for (let round = 0; picked.length < q.max && round < 12; round++) {
    let any = false;
    perDay.forEach((day, i) => {
      if (picked.length >= q.max) return;
      const after = lastPicked.get(i);
      const s = day.find((c) => after === undefined || c.start >= after + 60 * 60_000);
      if (!s) return;
      picked.push(s);
      lastPicked.set(i, s.end);
      any = true;
    });
    if (!any) break;
  }
  return picked.sort((a, b) => a.start - b.start);
}

/** "Tuesday 27 October 2026, 14:00–14:45" in a zone. */
export function describe(i: Interval, zone: string): string {
  const s = DateTime.fromMillis(i.start, { zone });
  const e = DateTime.fromMillis(i.end, { zone });
  return `${s.toFormat("cccc d LLLL yyyy, HH:mm")}–${e.toFormat("HH:mm")}`;
}
