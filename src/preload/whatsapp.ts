// The AI features inside WhatsApp Web (runs in the page's isolated preload world):
// * a "Translate" link under every message not in the user's language (click → the translation; again → hide);
// * icon buttons in the chat's top bar: Translate (Alt+T) — the messages on screen when the
//   message box is empty, else what's in the box, into the other language — Back (Alt+E), and
//   {AI} (Alt+A — also Enter or the send button while the box holds an {instruction}: nothing
//   with { } in it is ever sent);
// * notification clicks bring the window forward.
// The AI itself runs in the main process (ipc). Nothing here sends a message: the user presses Enter.

import { ipcRenderer, webFrame } from "electron";

import { CH, ChatContext, PageStatus, Result, ReviewReply } from "../shared/ipc";
import { isIn } from "../shared/lang";
import { language } from "../shared/languages";
import { hasInstructions } from "../shared/text";
import { Note, sameChat, shouldShow } from "../shared/notify";
import { attachFiles, chatContext, chatName, chatRowAt, composer, composerText, dateOf, dayFirst, headerSlot, isHeaderMenuButton, isMessageField, isPinnedChat, mainPanel, messageFields, messages, messageScroller, messageTimes, olderMessagesNotice, openMenuItems, rowName, rows, sendButton, sendButtonAt, setComposerText, type MessageEl } from "./dom";
import { CSS, ICONS, swap } from "./style";

const call = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>;

let status: PageStatus = {
  configured: false,
  myLanguage: "English",
  theirLanguage: "Hebrew",
  google: false,
  notifications: { blockGroups: false, allowPinnedGroups: true, allowMentions: true, blockPersonal: false, allowPinnedPersonal: true, always: [] },
};

const mine = () => language(status.myLanguage);
const theirs = () => language(status.theirLanguage);
/** Written in a language other than mine (so worth translating). */
const foreign = (text: string) => isIn(text, mine(), theirs()) === false;

async function refreshStatus() {
  const r = await call<PageStatus>(CH.status);
  if (r.ok) status = r.value;
  updateBarLabels();
}

// ---- translations of received messages ---------------------------------------------------------------

interface Shown {
  src: string;
  text: string | null;
  open: boolean;
}
/** by message id: survives WhatsApp re-drawing the bubble */
const shown = new Map<string, Shown>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function renderTranslation(m: MessageEl, box: HTMLElement) {
  const st = shown.get(m.id);
  const out = box.querySelector<HTMLElement>(".waai-tr-text")!;
  const btn = box.querySelector<HTMLButtonElement>(".waai-tr-btn")!;
  // write only what changed: every write is a DOM mutation, which runs decorate() again
  const set = (e: HTMLElement, t: string) => e.textContent !== t && (e.textContent = t);
  if (st?.open && st.text !== null) {
    set(out, st.text);
    out.hidden = false;
    if (!btn.disabled) set(btn, "Hide translation");
  } else {
    out.hidden = true;
    if (!btn.disabled) set(btn, st?.text ? "Show translation" : "Translate");
  }
}

function decorate() {
  for (const m of messages()) {
    if (!foreign(m.text)) continue;
    let box = m.block.nextElementSibling as HTMLElement | null;
    if (!box?.classList.contains("waai-tr")) {
      box = el("div", "waai waai-tr");
      const out = el("div", "waai-tr-text");
      out.dir = "auto";
      out.hidden = true;
      const btn = el("button", "waai-tr-btn", "Translate");
      btn.type = "button";
      btn.title = `Translate this message into ${status.myLanguage}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = messages().find((x) => x.id === m.id) ?? m;
        void toggleOne(cur, box!);
      });
      box.append(out, btn);
      m.block.after(box);
    }
    const st = shown.get(m.id);
    if (st && st.src !== m.text) shown.delete(m.id); // edited message
    renderTranslation(m, box);
  }
}

async function translate(ms: MessageEl[]): Promise<boolean> {
  const todo = ms.filter((m) => shown.get(m.id)?.text == null);
  if (todo.length) {
    const r = await call<{ translations: string[]; failed: number }>(CH.translateIn, todo.map((m) => m.text));
    if (!r.ok) {
      showStatus(r.error, "error", r.code);
      return false;
    }
    todo.forEach((m, i) => shown.set(m.id, { src: m.text, text: r.value.translations[i], open: false }));
    if (r.value.failed) showStatus(`${r.value.failed} message(s) couldn't be translated.`, "error");
  }
  return true;
}

async function toggleOne(m: MessageEl, box: HTMLElement) {
  const st = shown.get(m.id);
  if (st?.text != null) {
    st.open = !st.open;
    renderTranslation(m, box);
    return;
  }
  const btn = box.querySelector<HTMLButtonElement>(".waai-tr-btn")!;
  btn.textContent = "Translating…";
  btn.disabled = true;
  try {
    if (await translate([m])) shown.get(m.id)!.open = true;
  } finally {
    btn.disabled = false;
    decorate();
  }
}

/** Translate (or hide again) every message on screen that isn't in my language. */
async function translateScreen() {
  const all = messages();
  if (!all.length) return showStatus("No messages with text found on screen. If there are some, WhatsApp may have changed its page and WhatsApp AI needs an update.", "info");
  const he = all.filter((m) => foreign(m.text));
  if (!he.length) return showStatus(`Every message on screen is already in ${status.myLanguage}.`, "info");
  const allOpen = he.every((m) => shown.get(m.id)?.open);
  if (allOpen) {
    he.forEach((m) => (shown.get(m.id)!.open = false));
    decorate();
    return;
  }
  await busy(`Translating the messages on screen into ${status.myLanguage}…`, async () => {
    if (!(await translate(he))) return;
    he.forEach((m) => {
      const st = shown.get(m.id);
      if (st) st.open = true;
    });
    decorate();
    showStatus(`Translated ${he.length} message${he.length === 1 ? "" : "s"}.`, "ok");
  });
}

// ---- the bar above the message box ---------------------------------------------------------------------

let bar: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let working = false;
/**
 * per chat: what the user wrote, and the box's text right after the translation replaced it — as
 * WhatsApp shows it (it may turn ":)" into an emoji) — so Back restores exactly what he wrote
 * unless he has changed the translation since
 */
const before = new Map<string, { original: string; translated: string }>();

const HISTORY = "History: load all of this chat's older messages that WhatsApp has on this computer";

const BUTTONS: [string, string][] = [
  ["history", HISTORY],
  ["translate", "Translate (Alt+T)"],
  ["back", "Back to your own text (Alt+E)"],
  ["ai", "Carry out the {instructions} in your message (Alt+A, or Enter)"],
];

/** Icon buttons in the chat's top bar, left of WhatsApp's own video / call icons and styled like them. */
function buildBar() {
  bar = el("div", "waai waai-bar");
  bar.id = "waai-bar";
  for (const [act, title] of BUTTONS) {
    const b = el("button", `waai-btn waai-${act}`);
    b.type = "button";
    b.dataset.act = act;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = ICONS[act] ?? "";
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the message box
    b.addEventListener("click", (e) => {
      e.stopPropagation(); // a click in the header otherwise opens the contact info
      void act_(act);
    });
    bar.append(b);
  }
  // messages float under the top bar's right end
  statusEl = el("div", "waai waai-status");
  statusEl.addEventListener("click", () => {
    if (statusEl?.dataset.code === "ai_not_configured") ipcRenderer.send(CH.openSettings);
    showStatus("", "info");
  });
  document.body.append(statusEl);
  updateBarLabels();
}

function updateBarLabels() {
  if (!bar) return;
  const title = (act: string, text: string) => {
    const b = bar!.querySelector<HTMLElement>(`[data-act="${act}"]`);
    if (b && b.title !== text) {
      b.title = text;
      b.setAttribute("aria-label", text);
    }
  };
  // what Translate will do depends on the message box
  const box = composer();
  title(
    "translate",
    box && composerText(box).trim()
      ? `Translate your message into the other language — ${status.myLanguage} ⇄ ${status.theirLanguage} (Alt+T)`
      : `Translate the messages on screen into ${status.myLanguage} (Alt+T)`,
  );
  title("back", `Back to your own text (Alt+E)`);
  const b = bar.querySelector<HTMLElement>('[data-act="translate"]')!;
  const html = swap(mine(), theirs());
  if (b.dataset.icon !== html) {
    b.innerHTML = html;
    b.dataset.icon = html;
  }
}

// ---- our items in WhatsApp's menus --------------------------------------------------------------------------
// "Personal Settings" ends the chat's ⋮ menu; "Always notify" follows "Mute notifications" in a chat
// list row's menu (right-click, or the row's arrow). Each is a copy of one of WhatsApp's own items.

let headerMenuAt = 0;
/** the chat-list row clicked or right-clicked last: its menu may be opening */
let rowMenu: { chat: string; at: number } | null = null;
const SETTINGS_ITEM = "Personal Settings";

/** A menu item like `template` (same look), with our icon and label. */
function menuItem(template: HTMLElement, kind: string, icon: string, label: string, pick: () => void): HTMLElement | null {
  const item = template.cloneNode(true) as HTMLElement;
  item.dataset.waai = kind;
  item.removeAttribute("id");
  item.querySelectorAll("[id]").forEach((e) => e.removeAttribute("id"));
  // the icon first: WhatsApp's icons carry hidden text (<title>), which must not get the label
  const svg = item.querySelector("svg");
  if (svg) svg.outerHTML = icon.replace("<svg ", `<svg width="${svg.getAttribute("width") ?? 24}" height="${svg.getAttribute("height") ?? 24}" `);
  // no other icons: a submenu arrow (copied from an item like Mute) would promise a submenu we don't have
  item.querySelectorAll("svg").forEach((s, i) => i > 0 && s.remove());
  const texts: Text[] = [];
  const walk = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const t = walk.currentNode as Text;
    if (t.textContent?.trim() && !t.parentElement?.closest("svg")) texts.push(t);
  }
  if (!texts.length) return null;
  texts[0].textContent = label;
  texts.slice(1).forEach((t) => (t.textContent = ""));
  item.querySelectorAll("[aria-label], [title]").forEach((e) => {
    if (e.closest("svg")) return;
    if (e.hasAttribute("aria-label")) e.setAttribute("aria-label", label);
    if (e.hasAttribute("title")) e.setAttribute("title", label);
  });
  const go = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    pick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  };
  item.addEventListener("click", go, true);
  item.addEventListener("keydown", (e) => e.key === "Enter" && go(e), true);
  return item;
}

/** A WhatsApp menu is opening: add our item to it. */
function addMenuItems() {
  const items = openMenuItems();
  if (!items.length || items.some((i) => i.dataset.waai)) return;
  const now = Date.now();
  if (rowMenu && now - rowMenu.at < 2000 && rowMenu.at > headerMenuAt) {
    const chat = rowMenu.chat;
    const on = status.notifications.always.some((c) => sameChat(c, chat));
    const after = items.find((i) => /mute/i.test(i.textContent ?? "")) ?? items[items.length - 1];
    const item = menuItem(after, "always-notify", ICONS.bell, on ? "Stop always notifying" : "Always notify", () => void alwaysNotify(chat, !on));
    if (item) after.after(item);
  } else if (now - headerMenuAt < 2000) {
    const last = items[items.length - 1];
    const item = menuItem(last, "settings", ICONS.settings, SETTINGS_ITEM, () => ipcRenderer.send(CH.openSettings));
    if (item) last.after(item);
  }
}

async function alwaysNotify(chat: string, on: boolean) {
  const r = await call<string[]>(CH.alwaysNotify, chat, on);
  if (!r.ok) return showStatus(r.error, "error");
  status.notifications.always = r.value;
  showStatus(on ? `${chat} will always notify (Personal Settings › Windows notifications).` : `${chat} no longer always notifies.`, "ok");
}

function placeBar() {
  if (!bar || !statusEl) return;
  // in every open chat — also groups where only admins can write (no message box): Translate
  // then translates the screen, and the writing buttons stay hidden
  const box = composer();
  if (!covering) coverSend(); // once it covers, it keeps itself in place every frame
  const slot = headerSlot();
  const dark = document.body.classList.contains("dark") || document.documentElement.classList.contains("dark");
  statusEl.classList.toggle("waai-dark", dark);
  if (!slot) {
    if (bar.isConnected) bar.remove();
    // no chat open, so no top bar to sit under: a message (e.g. from the chat list's menu) goes top right
    statusEl.style.display = statusEl.textContent ? "block" : "none";
    statusEl.style.top = "72px";
    statusEl.style.right = "24px";
    return;
  }
  // WhatsApp redraws the header when the chat changes: put the buttons back each time
  if (bar.parentElement !== slot.parent || bar.nextSibling !== slot.before) slot.parent.insertBefore(bar, slot.before);
  bar.classList.toggle("waai-dark", dark);
  // the same colour as WhatsApp's own icons (it differs between light and dark mode)
  if (slot.before instanceof Element) {
    const c = getComputedStyle(slot.before.querySelector("button, [role=button]") ?? slot.before).color;
    if (bar.style.color !== c) bar.style.color = c;
  }
  const h = slot.header.getBoundingClientRect();
  statusEl.style.display = statusEl.textContent ? "block" : "none";
  statusEl.style.top = `${Math.round(h.bottom + 8)}px`;
  statusEl.style.right = `${Math.round(window.innerWidth - h.right + 16)}px`;
  const chat = chatName();
  const text = box ? composerText(box) : "";
  if (!text.trim()) before.delete(chat); // sent (or cleared)
  bar.querySelector<HTMLElement>('[data-act="back"]')!.hidden = !box || !before.has(chat);
  const ai = bar.querySelector<HTMLElement>('[data-act="ai"]')!;
  ai.hidden = !box;
  ai.classList.toggle("waai-hot", hasInstructions(text));
  updateBarLabels();
}

// While the message box holds { }, our own {AI} button lies over WhatsApp's send button, in its
// place, shape and colours, moved with it every frame. (WhatsApp redraws its button as you type, so
// anything put on the button itself would keep disappearing.)
let aiSend: HTMLButtonElement | null = null;
let covering = false;
const AI_SEND = "Carry out the {instructions} — a message with { } in it is never sent";

function coverSend() {
  const box = composer();
  const send = box && /[{}]/.test(composerText(box)) ? sendButton() : null;
  const r = send?.getBoundingClientRect();
  // gone while the AI works (so it is clear it was pressed), and only where the button can be seen
  // (not under a picture's preview or a menu)
  const shown = !working && !!send && !!r?.width && send.contains(document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).find((e) => e !== aiSend) ?? null);
  covering = shown;
  if (!shown) {
    if (aiSend) aiSend.style.display = "none";
    return;
  }
  requestAnimationFrame(coverSend);
  if (!aiSend) {
    aiSend = el("button", "waai waai-send-ai", "{AI}");
    aiSend.type = "button";
    aiSend.title = AI_SEND;
    aiSend.setAttribute("aria-label", AI_SEND);
    aiSend.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the message box
    aiSend.addEventListener("click", () => {
      if (working) return;
      instead(messageFields());
      if (working) aiSend!.style.display = "none";
    });
    document.body.append(aiSend);
  }
  const cs = getComputedStyle(send!);
  Object.assign(aiSend.style, {
    display: "flex",
    left: `${r!.left}px`,
    top: `${r!.top}px`,
    width: `${r!.width}px`,
    height: `${r!.height}px`,
    borderRadius: cs.borderRadius,
    color: cs.color,
    background: backgroundOf(send!),
  });
}

/** The colour behind an element: its own, or the nearest one around it that has one. */
function backgroundOf(e: Element | null): string {
  for (; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return "#fff";
}

let statusTimer: number | undefined;
function showStatus(msg: string, kind: "info" | "ok" | "error" | "busy", code?: string) {
  if (!statusEl) return;
  window.clearTimeout(statusTimer);
  statusEl.textContent = msg;
  statusEl.className = `waai waai-status waai-${kind}${statusEl.classList.contains("waai-dark") ? " waai-dark" : ""}`;
  statusEl.style.display = msg ? "block" : "none";
  statusEl.dataset.code = code ?? "";
  statusEl.title = code === "ai_not_configured" ? "Click to open Personal Settings" : msg ? "Click to dismiss" : "";
  if (msg && kind !== "busy" && kind !== "error") statusTimer = window.setTimeout(() => showStatus("", "info"), 6000);
}

async function busy(msg: string, fn: () => Promise<void>) {
  if (working) return;
  working = true;
  bar?.classList.add("waai-working");
  showStatus(msg, "busy");
  try {
    await fn();
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), "error");
  } finally {
    working = false;
    bar?.classList.remove("waai-working");
    if (statusEl?.classList.contains("waai-busy")) showStatus("", "info");
  }
}

async function put(box: HTMLElement, text: string) {
  if (await setComposerText(box, text)) return;
  const copied = await navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
  throw new Error(`Couldn't put the text into WhatsApp's message box${copied ? " — it is on the clipboard instead: paste it with Ctrl+V" : ""}.`);
}

async function applyReview(box: HTMLElement, r: ReviewReply) {
  await put(box, r.text);
  const files = r.attachments.map((a) => new File([a.data as BlobPart], a.name, { type: a.mime }));
  if (files.length) attachFiles(files);
  const notes: string[] = [];
  if (files.length) notes.push(`Attached ${files.map((f) => f.name).join(", ")} — check WhatsApp's preview, then send.`);
  if (r.skipped.length) notes.push(`Too big to attach: ${r.skipped.join(", ")}.`);
  showStatus(notes.join(" ") || (r.applied ? "Done — check it, then press Enter to send." : "The AI left the message as it was."), "ok");
}

function ensureConfigured(): boolean {
  if (status.configured) return true;
  showStatus("Set up the AI first — click here to open Personal Settings.", "error", "ai_not_configured");
  return false;
}

async function act_(act: string) {
  if (act === "history") return loadHistory();
  if (act === "screen") return ensureConfigured() && translateScreen();
  const box = composer();
  if (working || !ensureConfigured()) return;
  // no message box (a group only admins can write in): Translate means the screen
  if (!box) return act === "translate" ? translateScreen() : undefined;
  const chat = chatName();
  const text = composerText(box).trim();
  const ctx: ChatContext = chatContext();

  if (act === "translate") {
    // nothing typed: translate the conversation on screen
    if (!text) return translateScreen();
    // typed in their language (and nothing to carry out): into mine; otherwise into theirs
    const toMine = !hasInstructions(text) && foreign(text);
    await busy(toMine ? `Translating into ${status.myLanguage}…` : `Translating into ${status.theirLanguage}…`, async () => {
      if (hasInstructions(text)) {
        const r = await call<ReviewReply>(CH.review, text, ctx, true);
        if (!r.ok) return showStatus(r.error, "error", r.code);
        await applyReview(box, r.value);
        before.set(chat, { original: text, translated: composerText(box) });
        return;
      }
      const r = await call<{ text: string }>(CH.translateOut, text, toMine ? "mine" : "their", ctx);
      if (!r.ok) return showStatus(r.error, "error", r.code);
      await put(box, r.value.text);
      if (!toMine) before.set(chat, { original: text, translated: composerText(box) });
      showStatus(toMine ? "" : "Translated — check it, then press Enter to send.", "ok");
    });
  } else if (act === "back") {
    const b = before.get(chat);
    if (b && norm(composerText(box)) === norm(b.translated)) {
      await busy("", async () => {
        await put(box, b.original);
        before.delete(chat);
      });
      return;
    }
    if (!text) return;
    await busy(`Translating into ${status.myLanguage}…`, async () => {
      const r = await call<{ text: string }>(CH.translateOut, text, "mine", ctx);
      if (!r.ok) return showStatus(r.error, "error", r.code);
      await put(box, r.value.text);
      before.delete(chat);
    });
  } else if (act === "ai") {
    if (!hasInstructions(text)) return showStatus("Write an instruction in {curly braces} first, e.g. {suggest two free slots next week}.", "info");
    await busy("Working on your {instructions}…", async () => {
      const r = await call<ReviewReply>(CH.review, text, ctx, false);
      if (!r.ok) return showStatus(r.error, "error", r.code);
      await applyReview(box, r.value);
    });
  }
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- history ----------------------------------------------------------------------------------------------
// History loads all of the open chat's older messages that WhatsApp has on this computer: it scrolls
// WhatsApp's message list to the top again and again — behind a cover, so the chat stays where it
// was — until WhatsApp says older messages are only on the phone (it asks WhatsApp to get them, in
// versions that offer to) or the chat begins. Pressed again while loading, it stops.

let history: { chat: string; stop: boolean } | null = null;

const day = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function oldestMessage(): Date | null {
  const times = messageTimes();
  const first = dayFirst(times);
  for (const t of times) {
    const d = dateOf(t, first);
    if (d) return d;
  }
  return null;
}

/** Wait until older messages have been added at the top, or WhatsApp's notice has appeared; false after `ms`. */
async function grew(firstId: string | undefined, notice: boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, 150));
    if (rows()[0]?.dataset.id !== firstId || (!notice && olderMessagesNotice())) return true;
  }
  return false;
}

async function loadHistory() {
  if (history) {
    history.stop = true;
    return;
  }
  const chat = chatName();
  const scroller = messageScroller();
  if (!scroller) return;
  const run: { chat: string; stop: boolean } = { chat, stop: false };
  history = run;
  const button = bar?.querySelector<HTMLElement>('[data-act="history"]');
  button?.classList.add("waai-hot");
  if (button) button.title = "Loading older messages — press again to stop";
  // where the chat was (at the bottom, usually), to go back there afterwards
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const cover = el("div", "waai waai-history-cover", "Loading older messages…");
  cover.title = "Click to stop";
  cover.addEventListener("click", () => (run.stop = true));
  document.body.append(cover);
  let stalls = 0;
  try {
    for (let round = 0; round < 2000; round++) {
      const oldest = oldestMessage();
      const at = oldest ? ` (${day(oldest)})` : "";
      if (run.stop || chatName() !== chat) return showStatus(`Stopped${oldest ? ` — messages are loaded back to ${day(oldest)}` : ""}.`, "info");
      const notice = olderMessagesNotice();
      if (notice && !notice.fetch)
        return showStatus(`Loaded all the history WhatsApp has for this chat on this computer${at}. Older messages are only on your phone.`, "ok");
      showStatus(`Loading this chat's history…${oldest ? ` now at ${day(oldest)}.` : ""} Press History again to stop.`, "busy");
      const s = messageScroller() ?? scroller;
      const r = s.getBoundingClientRect();
      Object.assign(cover.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, background: backgroundOf(s) });
      const first = rows()[0]?.dataset.id;
      notice?.el.click(); // "Click here to get older messages from your phone"
      s.scrollTop = 0;
      s.dispatchEvent(new Event("scroll"));
      if (await grew(first, !!notice, notice ? 15_000 : 4_000)) stalls = 0;
      else if (++stalls >= 3)
        return showStatus(
          notice
            ? `WhatsApp couldn't get older messages from your phone${at} — is the phone online? Press History to try again.`
            : `Loaded the whole chat: it starts here${at}.`,
          "ok",
        );
    }
  } finally {
    history = null;
    button?.classList.remove("waai-hot");
    if (button) button.title = HISTORY;
    // back where the chat was, before the cover comes off
    if (chatName() === chat) {
      const s = messageScroller() ?? scroller;
      s.scrollTop = s.scrollHeight - fromBottom;
      await new Promise((r) => requestAnimationFrame(r));
      s.scrollTop = s.scrollHeight - fromBottom;
    }
    cover.remove();
  }
}

// ---- keys ---------------------------------------------------------------------------------------------

/**
 * Nothing with { } in it is ever sent, by Enter or by WhatsApp's send button: {instructions} in the
 * message box are carried out instead (the user checks the result, then sends it), other braces are
 * refused with a message. Nor is anything sent while the AI is still rewriting the message. True
 * when this send was stopped; `act` is false for the pointer events before the click itself.
 */
function stopSend(e: Event, fields: HTMLElement[], act = true): boolean {
  if (!working && !fields.some((f) => /[{}]/.test(composerText(f)))) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (act && !working) instead(fields);
  return true;
}

/** What Enter or the send button does instead of sending { } in `fields`. */
function instead(fields: HTMLElement[]) {
  const box = composer();
  if (box && fields.includes(box) && hasInstructions(composerText(box))) void act_("ai");
  // the message box wasn't found (WhatsApp changed its page)
  else if (!box && fields.some((f) => hasInstructions(composerText(f))))
    showStatus("Not sent: WhatsApp AI can't find WhatsApp's message box (WhatsApp may have changed its page), so it can't carry out the {instructions}. Take out the { } to send the message as it is.", "error");
  else showStatus("Not sent: a message with { } in it is never sent. Write your instruction inside the { } in the message box, or take them out to send the message as it is.", "error");
}

function onSendClick(e: Event) {
  if (sendButtonAt(e.target)) stopSend(e, messageFields(), e.type === "click");
}

function onKey(e: KeyboardEvent) {
  const target = e.target instanceof Element ? e.target : null;
  const enter = e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;
  const field = target?.closest<HTMLElement>('[contenteditable="true"]');
  if (enter && field && isMessageField(field) && stopSend(e, [field])) return;
  // Enter or Space on a focused send button presses it
  if ((enter || e.key === " ") && sendButtonAt(target) && stopSend(e, messageFields())) return;
  if (!e.altKey || e.ctrlKey || e.metaKey || !mainPanel()) return;
  const map: Record<string, string> = e.shiftKey ? { KeyT: "screen" } : { KeyT: "translate", KeyE: "back", KeyA: "ai" };
  const act = map[e.code];
  if (act) {
    e.preventDefault();
    e.stopImmediatePropagation();
    void act_(act);
  }
}

// ---- notifications ------------------------------------------------------------------------------------------
// WhatsApp creates its notifications in the page's own world, so the hook lives there. For each one it
// asks this (isolated) world through a synchronous DOM event, with the details on <html>, whether to
// show it (Personal Settings › Windows notifications). A held-back one gets a stand-in that WhatsApp
// handles like a closed notification, and its sound — which WhatsApp plays itself right after — is
// skipped. A click on a shown one brings the window forward.

const NOTIFICATION_HOOK = `(() => {
  const N = window.Notification;
  if (!N || N.__waai) return;
  const html = document.documentElement;
  let heldAt = 0;
  const show = (title, o) => {
    html.dataset.waaiNote = JSON.stringify({ title: String(title ?? ""), body: String(o?.body ?? ""), tag: String(o?.tag ?? "") });
    document.dispatchEvent(new Event("waai-notification"));
    const yes = html.dataset.waaiVerdict !== "hold";
    delete html.dataset.waaiNote;
    delete html.dataset.waaiVerdict;
    return yes;
  };
  class Held extends EventTarget {
    constructor(title, o) {
      super();
      Object.assign(this, { title, body: o?.body ?? "", tag: o?.tag ?? "", data: o?.data ?? null, onclick: null, onclose: null, onerror: null, onshow: null });
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }
  class W extends N {
    constructor(title, options) {
      if (!show(title, options)) {
        heldAt = Date.now();
        const held = new Held(title, options);
        setTimeout(() => held.close(), 0);
        return held;
      }
      super(title, options);
      heldAt = 0;
      this.addEventListener("click", () => window.postMessage({ __waai: "notification-click" }, "*"));
      window.postMessage({ __waai: "notification-shown" }, "*");
    }
  }
  W.__waai = true;
  window.Notification = W;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (Date.now() - heldAt < 3000 && !this.isConnected) return Promise.resolve();
    return play.call(this);
  };
})();`;

/** The hook asks: show this notification? */
function judgeNotification() {
  const html = document.documentElement;
  try {
    const n = JSON.parse(html.dataset.waaiNote ?? "") as Note;
    html.dataset.waaiVerdict = shouldShow(n, status.notifications, () => isPinnedChat(n.title)) ? "show" : "hold";
  } catch {
    // unreadable: shown
  }
}

// ---- start ------------------------------------------------------------------------------------------------

function start() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  buildBar();
  void refreshStatus();
  void webFrame.executeJavaScript(NOTIFICATION_HOOK);
  document.addEventListener("waai-notification", judgeNotification);
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.data?.__waai === "notification-click") ipcRenderer.send(CH.notificationClicked);
    if (e.data?.__waai === "notification-shown") ipcRenderer.send(CH.notified);
  });
  window.addEventListener("keydown", onKey, true);
  // WhatsApp may act on any of these: all are stopped, the click carries out the instructions
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) window.addEventListener(type, onSendClick, true);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      decorate();
      addMenuItems();
    });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener(
    "click",
    (e) => {
      if (isHeaderMenuButton(e.target)) headerMenuAt = Date.now();
      const row = chatRowAt(e.target);
      if (row) rowMenu = { chat: rowName(row), at: Date.now() };
    },
    true,
  );
  document.addEventListener(
    "contextmenu",
    (e) => {
      const row = chatRowAt(e.target);
      rowMenu = row ? { chat: rowName(row), at: Date.now() } : null;
    },
    true,
  );
  window.setInterval(placeBar, 250);
  window.addEventListener("resize", placeBar);
  ipcRenderer.on(CH.settingsChanged, () => void refreshStatus());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
