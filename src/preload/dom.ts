// Everything that knows WhatsApp Web's page structure. WhatsApp's class names are minified and
// change, so this leans on what has stayed put for years: #main for the open chat, the message
// rows' data-id, .message-in / .message-out, the .copyable-text block with data-pre-plain-text
// ("[14:05, 23/10/2026] Dan Amir: "), span.selectable-text for the text, and the contenteditable
// message box in the chat's footer with the send button after it; in the chat list (#pane-side), each [role=row]'s name in its
// first span[title] and, on pinned chats, an svg titled "ic-push-pin". When WhatsApp changes, this
// is the file to fix.
//
// Each lookup lists WhatsApp's usual selector first, then plainer ones that still match after a
// small change (an id, class or attribute renamed), so the features keep working until this file
// is updated. The plainer ones read less (no sender or time without data-pre-plain-text).

import type { ChatContext, ChatMessage } from "../shared/ipc";
import { sameChat } from "../shared/notify";

export const SEL = {
  composer: ['footer div[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', '[contenteditable="true"]'],
  row: ["div[data-id]", "[data-id]"],
  block: [".copyable-text[data-pre-plain-text]", "[data-pre-plain-text]", ".copyable-text", ".message-in, .message-out"],
  text: ["span.selectable-text", ".selectable-text", 'span[dir="ltr"], span[dir="rtl"], span[dir="auto"]'],
};

/** The first of `sels` that matches inside `root`. */
function pick(root: ParentNode, sels: string[]): HTMLElement | null {
  for (const s of sels) {
    const e = root.querySelector<HTMLElement>(s);
    if (e) return e;
  }
  return null;
}

/**
 * The first of `sels` that matches inside any of `roots`. Chosen once for the whole chat, so a
 * plainer selector never stands in for one message the usual one simply doesn't fit (a photo).
 */
const working = (roots: Element[], sels: string[]) => sels.find((s) => roots.some((r) => r.querySelector(s)));

function pickAll(root: ParentNode, sels: string[]): HTMLElement[] {
  for (const s of sels) {
    const all = root.querySelectorAll<HTMLElement>(s);
    if (all.length) return [...all];
  }
  return [];
}

/** Visible text of a node, with emoji images as their characters. */
export function textOf(node: Node): string {
  let s = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? "";
    else if (n instanceof HTMLImageElement) s += n.alt || n.dataset.plainText || "";
    else if (n instanceof HTMLBRElement) s += "\n";
    else if (n instanceof HTMLElement && !n.classList.contains("waai")) s += textOf(n);
  });
  return s;
}

/** The open chat: #main, or else the pane that holds both a message box's footer and a top bar. */
export function mainPanel(): HTMLElement | null {
  const main = document.getElementById("main");
  if (main) return main;
  for (const f of document.querySelectorAll("footer")) {
    if (!f.querySelector('[contenteditable="true"]')) continue;
    for (let p = f.parentElement; p && p !== document.body; p = p.parentElement) if (p.querySelector("header")) return p;
  }
  return null;
}

/** The chat's top bar. */
export const chatHeader = () => mainPanel()?.querySelector<HTMLElement>("header") ?? null;

/** The message box. */
export function composer(): HTMLElement | null {
  const main = mainPanel();
  return main ? pick(main, SEL.composer) : null;
}

/** The open chat's name. */
export function chatName(): string {
  const h = chatHeader();
  if (!h) return "";
  for (const s of h.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
    const t = (s.title || s.textContent || "").trim();
    if (t) return t;
  }
  return "";
}

export interface MessageEl {
  row: HTMLElement;
  id: string;
  me: boolean;
  /** the element holding the text */
  textEl: HTMLElement;
  /** the .copyable-text block (translations go after it) */
  block: HTMLElement;
  text: string;
  from: string;
  time: string;
}

/** "[14:05, 23/10/2026] Dan Amir: " → time and sender. */
export function parsePrePlain(s: string): { time: string; from: string } {
  const m = /^\[([^\]]*)\]\s*(.*?):?\s*$/.exec(s);
  return m ? { time: m[1].trim(), from: m[2].trim() } : { time: "", from: "" };
}

export function messageOf(row: HTMLElement, blockSel = SEL.block[0], textSel = SEL.text[0]): MessageEl | null {
  const block = row.querySelector<HTMLElement>(blockSel);
  if (!block) return null;
  const textEl = block.querySelector<HTMLElement>(textSel);
  if (!textEl) return null;
  const id = row.dataset.id ?? "";
  const me = id.startsWith("true_") || !!row.querySelector(".message-out");
  const { time, from } = parsePrePlain(block.dataset.prePlainText ?? "");
  return { row, id, me, textEl, block, text: textOf(textEl).trim(), from, time };
}

export function messages(): MessageEl[] {
  const rs = rows();
  const blockSel = working(rs, SEL.block);
  if (!blockSel) return [];
  const textSel = working(rs.map((r) => r.querySelector(blockSel)).filter((b): b is Element => !!b), SEL.text);
  if (!textSel) return [];
  return rs.map((r) => messageOf(r, blockSel, textSel)).filter((m): m is MessageEl => !!m && !!m.text);
}

/** The message rows of the open chat (text or not). */
export function rows(): HTMLElement[] {
  const main = mainPanel();
  return main ? pickAll(main, SEL.row) : [];
}

// ---- older messages ------------------------------------------------------------------------------
// WhatsApp loads older messages when its message list is scrolled to the top, as far back as this
// computer has them: then it says "Use WhatsApp on your phone to see older messages." (Some versions
// offer "Click here to get older messages from your phone" instead, which fetches more.)

/** The open chat's scrolling message list. */
export function messageScroller(): HTMLElement | null {
  for (let e = rows()[0]?.parentElement ?? null; e && e !== document.body; e = e.parentElement) {
    if (e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY)) return e;
  }
  return mainPanel()?.querySelector<HTMLElement>('[role="application"]') ?? null;
}

/**
 * WhatsApp's notice at the top of the messages, when it shows: `fetch` when clicking it gets older
 * messages from the phone ("Click here to get…"), else it marks the end of what this computer has
 * ("Use WhatsApp on your phone to see older messages").
 */
export function olderMessagesNotice(): { el: HTMLElement; fetch: boolean } | null {
  const el = olderMessagesEl();
  return el ? { el, fetch: /\b(click|tap|get)\b/i.test(el.textContent ?? "") } : null;
}

function olderMessagesEl(): HTMLElement | null {
  const main = mainPanel();
  if (!main) return null;
  // never a message (or a row of messages) that happens to say it
  const MSG = ".message-in, .message-out, [data-pre-plain-text]";
  const said = (e: Element) => /older messages/i.test(e.textContent ?? "") && !e.closest(MSG) && !e.querySelector(MSG);
  const button = [...main.querySelectorAll<HTMLElement>('button, [role="button"]')].find(said);
  if (button) return button;
  if (!/older messages/i.test(main.textContent ?? "")) return null;
  // the innermost element that says it
  return [...main.querySelectorAll<HTMLElement>("div, span")].reverse().find((e) => said(e) && ![...e.children].some(said)) ?? null;
}

/** The time stamps ("14:05, 23/10/2026") of the open chat's messages, oldest first. */
export const messageTimes = () =>
  rows()
    .map((r) => parsePrePlain(r.querySelector<HTMLElement>("[data-pre-plain-text]")?.dataset.prePlainText ?? "").time)
    .filter(Boolean);

/**
 * Does WhatsApp write dates day first (23/10/2026) or month first (10/23/2026)? A number over 12
 * settles it; otherwise the computer's own date format does, which WhatsApp follows.
 */
export function dayFirst(times: string[], locale?: string): boolean {
  for (const t of times) {
    const m = DATE.exec(t);
    if (m && m[1].length < 4 && +m[1] > 12) return true;
    if (m && m[1].length < 4 && +m[2] > 12) return false;
  }
  const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2000, 10, 22)).map((p) => p.type);
  return parts.indexOf("day") < parts.indexOf("month");
}

const DATE = /(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/;

/** The date in a message's time stamp; null if it has none. */
export function dateOf(time: string, isDayFirst: boolean): Date | null {
  const m = DATE.exec(time);
  if (!m) return null;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  const [y, mo, d] = m[1].length === 4 ? [a, b, c] : isDayFirst ? [c, b, a] : [c, a, b];
  const date = new Date(y < 100 ? 2000 + y : y, mo - 1, d);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

const labelOf = (b: Element) =>
  `${b.getAttribute("aria-label") ?? ""} ${(b as HTMLElement).title ?? ""} ${b.querySelector("[data-icon]")?.getAttribute("data-icon") ?? ""}`;

/** The icon buttons on the right of the chat's top bar (video, call, search, menu…), left to right. */
export function headerIcons(header: HTMLElement): HTMLElement[] {
  const hr = header.getBoundingClientRect();
  return [...header.querySelectorAll<HTMLElement>('button, [role="button"]')]
    .filter((b) => !b.closest("#waai-bar") && b.querySelector("svg, [data-icon]"))
    .filter((b) => {
      const r = b.getBoundingClientRect();
      // laid out (not in tests): small, and in the right half — not the chat's title area
      return hr.width === 0 || (r.width > 0 && r.width <= 72 && r.left > hr.left + hr.width / 2);
    })
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
}

/**
 * Where our buttons go: just before WhatsApp's video-call button in the chat's top bar — or, in
 * chats without one (some groups), before the leftmost of its icons — as a sibling of that
 * button's own wrapper.
 */
export function headerSlot(): { header: HTMLElement; parent: HTMLElement; before: Node | null } | null {
  const header = chatHeader();
  if (!header) return null;
  const icons = headerIcons(header);
  const anchor = icons.find((b) => /video/i.test(labelOf(b))) ?? icons[0];
  if (!anchor) return { header, parent: header, before: null };
  // climb out of wrappers that hold only this button, so we sit in the row of icons
  let el: HTMLElement = anchor;
  while (el.parentElement && el.parentElement !== header && el.parentElement.childElementCount === 1) el = el.parentElement;
  return { header, parent: el.parentElement ?? header, before: el };
}

/** Is this click on the ⋮ menu button of the chat's top bar? */
export function isHeaderMenuButton(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const header = chatHeader();
  const b = target.closest<HTMLElement>('button, [role="button"]');
  if (!header || !b || !header.contains(b) || b.closest("#waai-bar")) return false;
  if (/menu|more/i.test(labelOf(b))) return true;
  const icons = headerIcons(header);
  return icons[icons.length - 1] === b;
}

/** The items of the drop-down menu that is open now (WhatsApp draws it outside the header). */
export function openMenuItems(): HTMLElement[] {
  const items = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"], [role="application"] li, li[data-animate-dropdown-item]')];
  const header = chatHeader();
  return items.filter((li) => !header?.contains(li) && !li.closest("#side, .waai") && li.getClientRects().length > 0);
}

// ---- the chat list -------------------------------------------------------------------------------

const CHAT_LIST = ["#pane-side", '[aria-label="Chat list"]'];
const CHAT_ROW = '[role="listitem"], [role="row"]';

/** A chat-list row's chat name: its first span with a title (the last message's comes after it). */
export const rowName = (row: Element) => row.querySelector<HTMLElement>("span[title]")?.title.trim() ?? "";

/** The chat-list row a click or right-click landed on. */
export function chatRowAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const list = pick(document, CHAT_LIST);
  const row = target.closest<HTMLElement>(CHAT_ROW);
  return list && row && list.contains(row) ? row : null;
}

/** A pinned row shows a pin icon: an svg titled "ic-push-pin" (older WhatsApp: data-icon="pinned…"). */
const hasPin = (row: Element) =>
  !!row.querySelector('[data-icon*="pin" i]') || [...row.querySelectorAll("svg title")].some((t) => /(^|[-_\s])pin(ned)?\d*($|[-_\s])/i.test(t.textContent ?? ""));

/** Is this chat pinned? null: its row isn't drawn (WhatsApp draws only the rows on screen). */
export function isPinnedChat(name: string): boolean | null {
  const list = pick(document, CHAT_LIST);
  const row = list && [...list.querySelectorAll<HTMLElement>(CHAT_ROW)].find((r) => sameChat(rowName(r), name));
  return row ? hasPin(row) : null;
}

/** A group: its top bar has "Group video call" (message ids no longer say @g.us), or an old-style group id. */
export function isGroupChat(): boolean {
  const header = chatHeader();
  if (header && [...header.querySelectorAll('button, [role="button"]')].some((b) => /group/i.test(labelOf(b)))) return true;
  return rows().some((r) => (r.dataset.id ?? "").includes("@g.us"));
}

/** The chat as the AI reads it: the last messages on screen, oldest first. */
export function chatContext(max = 40): ChatContext {
  const list: ChatMessage[] = messages()
    .slice(-max)
    .map((m) => ({ from: m.from, me: m.me, time: m.time, text: m.text }));
  return { chat: chatName(), isGroup: isGroupChat(), messages: list };
}

// ---- the message box ------------------------------------------------------------------------------

/** The message box's text, one line per paragraph. */
export function composerText(el: HTMLElement): string {
  const ps = el.querySelectorAll("p");
  // an empty line is <p><br></p>: that <br> is not a line break of its own
  if (ps.length) return [...ps].map((p) => textOf(p).replace(/\n$/, "")).join("\n");
  return el.innerText;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

/**
 * Select the whole message box, then wait: Lexical hears of the new selection only from the
 * "selectionchange" event that follows, and a paste before that lands at the old cursor, beside
 * the old text instead of over it.
 */
async function selectAll(el: HTMLElement) {
  el.focus();
  document.execCommand("selectAll", false);
  await settle();
}

/**
 * Replace the message box's text the way a user would: select all, then paste. WhatsApp's editor
 * (Lexical) handles the paste itself, so its own state stays right; insertText is the fallback.
 */
export async function setComposerText(el: HTMLElement, text: string): Promise<boolean> {
  await selectAll(el);
  if (!text) {
    document.execCommand("delete", false);
    await settle();
    return composerText(el).trim() === "";
  }
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await settle();
  if (norm(composerText(el)) === norm(text)) return true;
  await selectAll(el);
  document.execCommand("insertText", false, text);
  await settle();
  return norm(composerText(el)) === norm(text);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Where a message is written: the message box, or a picture's caption — not the chat list's search (in #side). */
export const isMessageField = (f: Element) => !f.closest("#side");

export const messageFields = () => [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')].filter(isMessageField);

/**
 * WhatsApp's send button (the message box's, or a picture preview's), when `target` is on it: its
 * label or icon says "send" — or else it is the button after the message box in the chat's footer.
 */
export function sendButtonAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const b = target.closest<HTMLElement>('button, [role="button"]');
  if (!b || b.closest(".waai")) return null;
  if (saysSend(b)) return b;
  const box = composer();
  return box && box.closest("footer")?.contains(b) && after(box, b) ? b : null;
}

/** The message box's send button (WhatsApp shows it while the box has text). */
export function sendButton(): HTMLElement | null {
  const box = composer();
  const buttons = [...(box?.closest("footer")?.querySelectorAll<HTMLElement>('button, [role="button"]') ?? [])];
  return buttons.find(saysSend) ?? buttons.find((b) => after(box!, b)) ?? null;
}

const saysSend = (b: HTMLElement) =>
  /^send$/i.test((b.getAttribute("aria-label") || b.title).trim()) ||
  !!b.querySelector('[data-icon*="send" i]') ||
  [...b.querySelectorAll("svg title")].some((t) => /(^|[-_\s])send($|[-_\s])/i.test(t.textContent ?? ""));

const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(b);

/** Hand files to WhatsApp as if pasted (it opens its usual preview with a caption box); a drop on the chat is the fallback. */
export function attachFiles(files: File[]): boolean {
  const el = composer();
  const main = mainPanel();
  if (!el || !main || !files.length) return false;
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  el.focus();
  const handled = !el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  if (handled) return true;
  const target = main.querySelector<HTMLElement>('[role="application"]') ?? main;
  for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  return true;
}
