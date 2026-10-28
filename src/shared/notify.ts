// Which WhatsApp notifications to show on this PC, on top of WhatsApp's own notification settings.
// WhatsApp Web builds a message notification as new Notification(chat name, { tag: the chat's id,
// body }) — a group's id ends in @g.us, a person's in @c.us or @lid — and starts the body of a
// group message that mentions or replies to you with "Mentioned you" / "Replied to you".
// Calls ring through their own path and are never held back. When in doubt, show it: a wrong guess
// must never cost a message.

export interface NotifySettings {
  blockGroups: boolean;
  allowPinnedGroups: boolean;
  /** in blocked groups, still notify when someone mentions or replies to you */
  allowMentions: boolean;
  blockPersonal: boolean;
  allowPinnedPersonal: boolean;
  /** chat names that always notify */
  always: string[];
}

export interface Note {
  title: string;
  body: string;
  tag: string;
}

export type ChatKind = "group" | "personal" | "other";

export function kindOf(tag: string): ChatKind {
  if (/@g\.us$/.test(tag)) return "group";
  if (/@(c\.us|lid|s\.whatsapp\.net)$/.test(tag)) return "personal";
  return "other";
}

/** WhatsApp puts a space and direction marks before bodies that start with a non-Latin character. */
const lead = (s: string) => s.replace(/^[\s‎‏‪-‮⁦-⁩]+/, "");

export const isMention = (body: string) => /^(Mentioned you|Replied to you)\b/.test(lead(body));

/** "Incoming voice call", "Missed video call from Dan", "Group call"… (a call's own tag is its call id, so it is never a chat's anyway) */
export const isCall = (n: Note) => /\b(incoming|missed) (voice |video )?call\b|\bgroup call\b/i.test(lead(n.body).slice(0, 80));

export const sameChat = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Show this notification? `pinned` answers whether its chat is pinned (null: can't tell). */
export function shouldShow(n: Note, s: NotifySettings, pinned: () => boolean | null): boolean {
  if (!s.blockGroups && !s.blockPersonal) return true;
  if (isCall(n) || s.always.some((c) => sameChat(c, n.title))) return true;
  const kind = kindOf(n.tag);
  if (kind === "group" && s.blockGroups) {
    if (s.allowMentions && isMention(n.body)) return true;
    return s.allowPinnedGroups && pinned() !== false;
  }
  if (kind === "personal" && s.blockPersonal) return s.allowPinnedPersonal && pinned() !== false;
  return true;
}
