// Google Calendar, read-only: events in a period (optionally matching words) and one event in full.

import { DateTime } from "luxon";

import { googleGet } from "./auth";

const API = "https://www.googleapis.com/calendar/v3";

export interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  transparency?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string; label?: string; pin?: string; passcode?: string }[] };
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
}

export async function calendars(): Promise<CalendarInfo[]> {
  const r = await googleGet<{ items?: CalendarInfo[] }>(`${API}/users/me/calendarList?minAccessRole=reader`);
  return r.items ?? [];
}

/** "primary" unless the user named one ("Sam" matches a calendar called "Sam Lee"); "all" = every calendar. */
export async function resolveCalendars(name?: string): Promise<CalendarInfo[]> {
  const n = (name ?? "").trim().toLowerCase();
  if (!n || n === "primary" || n === "mine") return [{ id: "primary", summary: "primary", primary: true }];
  const all = await calendars();
  if (n === "all") return all;
  const hit = all.filter((c) => c.summary.toLowerCase().includes(n) || c.id.toLowerCase().includes(n));
  if (!hit.length) throw new Error(`No calendar called "${name}". Calendars: ${all.map((c) => c.summary).join(", ")}`);
  return hit;
}

export async function listEvents(calendarId: string, timeMin: number, timeMax: number, q?: string, max = 250): Promise<GEvent[]> {
  const p = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(max),
  });
  if (q) p.set("q", q);
  const r = await googleGet<{ items?: GEvent[] }>(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${p}`);
  return (r.items ?? []).filter((e) => e.status !== "cancelled");
}

export async function getEvent(calendarId: string, id: string): Promise<GEvent> {
  return googleGet<GEvent>(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
}

export function eventTimes(e: GEvent, zone: string): { start: number; end: number; allDay: boolean } {
  if (e.start.dateTime) {
    return { start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime ?? e.start.dateTime), allDay: false };
  }
  const s = DateTime.fromISO(e.start.date ?? "", { zone });
  const en = DateTime.fromISO(e.end.date ?? e.start.date ?? "", { zone });
  return { start: s.toMillis(), end: en.toMillis(), allDay: true };
}

/** Busy for free-time purposes: timed, not "free", and not declined by me. */
export function blocksTime(e: GEvent): boolean {
  if (!e.start.dateTime || e.transparency === "transparent") return false;
  const me = e.attendees?.find((a) => a.self);
  return me?.responseStatus !== "declined";
}

const videoLink = (e: GEvent) => e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? e.hangoutLink;

/** What the model sees in a list. */
export function brief(e: GEvent, calendarId: string, zone: string) {
  const t = eventTimes(e, zone);
  const s = DateTime.fromMillis(t.start, { zone });
  const en = DateTime.fromMillis(t.end, { zone });
  const me = e.attendees?.find((a) => a.self);
  return {
    id: e.id,
    calendar: calendarId,
    title: e.summary ?? "(no title)",
    when: t.allDay ? `${s.toFormat("ccc d LLL yyyy")} (all day)` : `${s.toFormat("ccc d LLL yyyy HH:mm")}–${en.toFormat("HH:mm")}`,
    location: e.location || undefined,
    video_link: videoLink(e),
    attendees: e.attendees
      ?.filter((a) => !a.self)
      .slice(0, 12)
      .map((a) => a.displayName || a.email),
    my_response: me?.responseStatus,
  };
}

const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

/** One event in full. */
export function full(e: GEvent, calendarId: string, zone: string) {
  return {
    ...brief(e, calendarId, zone),
    notes: e.description ? stripHtml(e.description).slice(0, 4000) : undefined,
    organizer: e.organizer?.displayName || e.organizer?.email,
    attendees: e.attendees?.map((a) => ({ name: a.displayName, email: a.email, response: a.responseStatus })),
    dial_in: e.conferenceData?.entryPoints?.map((p) => ({ type: p.entryPointType, uri: p.uri, pin: p.pin ?? p.passcode })),
    link: e.htmlLink,
  };
}
