// What the AI may look up for {instructions}, all read-only. Only the answer to each question goes
// to the model, never the whole calendar or address book:
// * find_free_time / whats_on / find_meeting / meeting_details — Google Calendar;
// * find_contact — Google Contacts;
// * find_files — files on this computer (the folders in Settings), to attach;
// * convert_time — exact time-zone conversion.

import { DateTime } from "luxon";

import { ToolCall } from "./ai/tooluse";
import { ToolSpec } from "./ai/tooluse";
import { FoundFile, findFiles } from "./files";
import { blocksTime, brief, eventTimes, full, getEvent, listEvents, resolveCalendars } from "./google/calendar";
import { searchContacts } from "./google/contacts";
import { Settings } from "./settings";
import { describe, freeSlots } from "./slots";

const date = (d: string) => ({ type: "string", description: `${d} (YYYY-MM-DD, in the user's time zone)` });
const calendarParam = {
  type: "string",
  description: 'Only when the user names someone else\'s / another calendar (e.g. "Sam"); otherwise leave out: the user\'s own primary calendar. "all" = every calendar.',
};

export const SPECS: ToolSpec[] = [
  {
    name: "find_free_time",
    description: "Free time slots in the user's calendar within their work hours, keeping the usual gap around existing meetings. Use for any request to suggest or offer meeting times.",
    parameters: {
      type: "object",
      properties: {
        from: date("First day"),
        to: date("Last day (inclusive)"),
        minutes: { type: "integer", description: "Meeting length; leave out for the user's usual length" },
        part_of_day: { type: "string", enum: ["any", "morning", "afternoon", "evening"] },
        earliest: { type: "string", description: "Not before this time of day, HH:MM (user's zone)" },
        latest: { type: "string", description: "Ending by this time of day, HH:MM (user's zone)" },
        their_time_zone: { type: "string", description: "IANA zone of the other side (e.g. America/New_York) when they are abroad: slots then also fit their hours and show their time" },
        their_hours: { type: "string", description: "Their acceptable hours, HH:MM-HH:MM in their zone (default 09:00-18:00)" },
        calendar: calendarParam,
        max: { type: "integer", description: "How many slots (default 4)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "whats_on",
    description: "The user's events in a period (time, title, place, attendees, video link). Use to check whether the user is free at a given time, or what they have on a day.",
    parameters: {
      type: "object",
      properties: {
        from: date("First day"),
        to: date("Last day (inclusive; default = from)"),
        query: { type: "string", description: "Only events matching these words" },
        calendar: calendarParam,
      },
      required: ["from"],
    },
  },
  {
    name: "find_meeting",
    description: 'Find meetings by company, person or words (e.g. "Acme", "Dan Amir", "results call"): the next ones, the most recent ones, or all in a period.',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        which: { type: "string", enum: ["next", "last", "all"], description: "next (default) = upcoming; last = most recent past; all = in from–to" },
        from: date("Start of the period for which=all"),
        to: date("End of the period for which=all"),
        calendar: calendarParam,
      },
      required: ["query"],
    },
  },
  {
    name: "meeting_details",
    description: "One event in full by its id and calendar (from the other tools): notes, dial-in / Zoom / Teams / Meet links, address, organizer, attendees and their responses.",
    parameters: { type: "object", properties: { id: { type: "string" }, calendar: { type: "string" } }, required: ["id"] },
  },
  {
    name: "find_contact",
    description: "Look up people in the user's Google Contacts by name, company, phone or e-mail: phone numbers, e-mail addresses, company, job title, address.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "find_files",
    description:
      "Find files on the user's computer by words in the file or folder name (e.g. \"acme logo\", \"passport\"), newest first. Use when an instruction asks to send, attach or insert a picture, photo, document or file; put the chosen file's exact path in \"attachments\".",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the file name, without words like picture / file" },
        kind: { type: "string", enum: ["any", "image", "video", "audio", "document"] },
      },
      required: ["query"],
    },
  },
  {
    name: "convert_time",
    description: "Convert a date and time between time zones exactly (daylight saving included). Use instead of converting yourself.",
    parameters: {
      type: "object",
      properties: {
        time: { type: "string", description: "YYYY-MM-DD HH:MM" },
        from_zone: { type: "string", description: "IANA zone of `time` (default: the user's)" },
        to_zones: { type: "array", items: { type: "string" }, description: 'IANA zones, e.g. ["America/New_York", "Europe/London"]' },
      },
      required: ["time", "to_zones"],
    },
  },
];

type Args = Record<string, any>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function dayRange(tz: string, from: string, to?: string): [number, number] {
  const a = DateTime.fromISO(from, { zone: tz }).startOf("day");
  const b = DateTime.fromISO(to || from, { zone: tz }).endOf("day");
  if (!a.isValid || !b.isValid) throw new Error("Dates must be YYYY-MM-DD.");
  return [a.toMillis(), b.toMillis()];
}

/** The tools for one review: `found` collects the files find_files offered (only those may be attached). */
export function toolRunner(settings: Settings, found: Set<string>, now = Date.now()) {
  const c = settings.calendar;
  const tz = c.timeZone;

  async function events(calendar: string | undefined, from: number, to: number, q?: string) {
    const cals = await resolveCalendars(calendar);
    const lists = await Promise.all(cals.map(async (cal) => (await listEvents(cal.id, from, to, q)).map((e) => ({ e, cal: cal.id }))));
    return lists.flat().sort((a, b) => eventTimes(a.e, tz).start - eventTimes(b.e, tz).start);
  }

  const run: Record<string, (a: Args) => Promise<unknown>> = {
    async find_free_time(a) {
      const [from, to] = dayRange(tz, str(a.from), str(a.to));
      const busy = (await events(str(a.calendar) || undefined, from, to)).filter((x) => blocksTime(x.e)).map((x) => eventTimes(x.e, tz));
      const their = str(a.their_time_zone) || undefined;
      const slots = freeSlots({
        from: str(a.from),
        to: str(a.to) || str(a.from),
        minutes: num(a.minutes, c.meetingMinutes),
        gap: c.gapMinutes,
        tz,
        workDays: c.workDays,
        workStart: c.workStart,
        workEnd: c.workEnd,
        partOfDay: str(a.part_of_day) || undefined,
        earliest: str(a.earliest) || undefined,
        latest: str(a.latest) || undefined,
        theirZone: their,
        theirHours: str(a.their_hours) || undefined,
        max: Math.min(10, num(a.max, 4)),
        now,
        busy,
      });
      return {
        time_zone: tz,
        slots: slots.map((s) => ({ when: describe(s, tz), ...(their ? { their_time: `${describe(s, their)} (${their})` } : {}) })),
        ...(slots.length ? {} : { note: "No free time in that period." }),
      };
    },
    async whats_on(a) {
      const [from, to] = dayRange(tz, str(a.from), str(a.to));
      const list = await events(str(a.calendar) || undefined, from, to, str(a.query) || undefined);
      return { time_zone: tz, events: list.map((x) => brief(x.e, x.cal, tz)) };
    },
    async find_meeting(a) {
      const which = str(a.which) || "next";
      const day = 86_400_000;
      let list;
      if (which === "all") {
        const [from, to] = dayRange(tz, str(a.from) || DateTime.fromMillis(now, { zone: tz }).toISODate()!, str(a.to) || undefined);
        list = await events(str(a.calendar) || "all", from, to, str(a.query));
      } else if (which === "last") {
        list = (await events(str(a.calendar) || "all", now - 400 * day, now, str(a.query))).slice(-5).reverse();
      } else {
        list = (await events(str(a.calendar) || "all", now, now + 400 * day, str(a.query))).slice(0, 5);
      }
      return { time_zone: tz, meetings: list.map((x) => brief(x.e, x.cal, tz)), ...(list.length ? {} : { note: "No such meeting." }) };
    },
    async meeting_details(a) {
      const cal = str(a.calendar) || "primary";
      return full(await getEvent(cal, str(a.id)), cal, tz);
    },
    async find_contact(a) {
      const people = await searchContacts(str(a.query));
      return people.length ? { contacts: people } : { contacts: [], note: "Nobody matches in Google Contacts." };
    },
    async find_files(a) {
      const files: FoundFile[] = await findFiles(settings.files.folders, str(a.query), str(a.kind) || "any");
      files.forEach((f) => found.add(f.path));
      return files.length ? { files } : { files: [], note: `No file matches in ${settings.files.folders.join(", ")}.` };
    },
    async convert_time(a) {
      const fromZone = str(a.from_zone) || tz;
      const t = DateTime.fromFormat(str(a.time), "yyyy-MM-dd HH:mm", { zone: fromZone });
      if (!t.isValid) throw new Error("time must be YYYY-MM-DD HH:MM, and zones IANA names like Europe/London.");
      const zones: string[] = Array.isArray(a.to_zones) ? a.to_zones.map(String) : [];
      return {
        from: `${t.toFormat("cccc d LLLL yyyy HH:mm")} ${fromZone}`,
        to: zones.map((z) => {
          const x = t.setZone(z);
          return x.isValid ? `${x.toFormat("cccc d LLLL yyyy HH:mm")} ${z}` : `${z}: unknown time zone`;
        }),
      };
    },
  };

  return async (call: ToolCall): Promise<unknown> => {
    const f = run[call.name];
    if (!f) return { error: `There is no tool called ${call.name}.` };
    try {
      return await f(call.args ?? {});
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** "today" etc. for the prompt, in the user's zone. */
export function clock(tz: string, now = Date.now()) {
  const t = DateTime.fromMillis(now, { zone: tz });
  return { today: t.toFormat("cccc d LLLL yyyy"), todayDate: t.toISODate()!, timeNow: t.toFormat("HH:mm"), timeZone: tz };
}
