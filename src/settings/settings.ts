// The Settings window: every change saves at once (no OK button), like WhatsApp's own settings.

import { LANGUAGES } from "../shared/languages";

type Provider = "gemini" | "claude";
interface View {
  settings: {
    ai: { provider: Provider; model: string; recommended: Record<Provider, string>; myLanguage: string; theirLanguage: string; myName: string; myGender: string };
    calendar: { timeZone: string; workDays: number[]; workStart: number; workEnd: number; meetingMinutes: number; gapMinutes: number };
    files: { folders: string[] };
    app: { closeToTray: boolean; startAtLogin: boolean };
    notifications: { blockGroups: boolean; allowPinnedGroups: boolean; allowMentions: boolean; blockPersonal: boolean; allowPinnedPersonal: boolean; always: string[] };
    google: { email: string };
  };
  keys: Record<Provider, boolean>;
  googleClient: boolean;
  googleSignedIn: boolean;
  providers: Record<Provider, { label: string; defaultModel: string }>;
  version: string;
  dataFolder: string;
}
type R<T> = { ok: true; value: T } | { ok: false; error: string };
interface Api {
  get(): Promise<R<View>>;
  set(patch: unknown): Promise<R<View>>;
  setKey(p: Provider, key: string): Promise<R<View>>;
  testAi(p: Provider, model: string, key: string): Promise<R<string>>;
  listModels(p: Provider, key: string): Promise<R<{ models: { id: string; label: string }[]; recommended: string | null }>>;
  importGoogleClient(): Promise<R<View>>;
  googleSignIn(): Promise<R<View>>;
  googleSignOut(): Promise<R<View>>;
  addFolder(): Promise<R<View>>;
}
const api = (window as unknown as { settingsApi: Api }).settingsApi;

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
let view: View;

let toastTimer = 0;
function toast(msg: string, error = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = `show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = ""), error ? 6000 : 1800);
}

async function run(p: Promise<R<View>>, done?: string) {
  const r = await p;
  if (!r.ok) return toast(r.error, true);
  view = r.value;
  render();
  if (done) toast(done);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
};

function render() {
  const s = view.settings;
  $("version").textContent = `Version ${view.version}`;
  $<HTMLSelectElement>("provider").value = s.ai.provider;
  const prov = view.providers[s.ai.provider];
  $("keyState").textContent = view.keys[s.ai.provider] ? `A ${prov.label} key is saved.` : `No ${prov.label} key saved yet.`;
  $("key").placeholder = view.keys[s.ai.provider] ? "•••••••• (saved — type a new one to replace it)" : "Paste your API key";
  renderModels();
  fillLanguages("myLanguage", s.ai.myLanguage);
  fillLanguages("theirLanguage", s.ai.theirLanguage);
  $("myName").value = s.ai.myName;
  $<HTMLSelectElement>("myGender").value = s.ai.myGender;

  $("googleState").textContent = view.googleSignedIn ? `Signed in as ${s.google.email}.` : "Not signed in.";
  $<HTMLButtonElement>("googleSignOut").hidden = !view.googleSignedIn;
  $("googleNote").textContent = view.googleClient
    ? "Google opens in your browser; WhatsApp AI gets read-only access to your calendar and contacts."
    : "This copy has no Google client built in: the first time, you're asked for the Google client file (the OAuth client JSON from Google Cloud — see the README). Then Google opens in your browser.";
  $<HTMLButtonElement>("googleSignIn").textContent = view.googleSignedIn ? "Sign in again" : "Sign in with Google";

  $("timeZone").value = s.calendar.timeZone;
  $("meetingMinutes").value = String(s.calendar.meetingMinutes);
  $("gapMinutes").value = String(s.calendar.gapMinutes);
  $("workStart").value = hhmm(s.calendar.workStart);
  $("workEnd").value = hhmm(s.calendar.workEnd);
  const days = $("workDays");
  days.querySelectorAll("label").forEach((l) => l.remove());
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d, i) => {
    const l = document.createElement("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = s.calendar.workDays.includes(i);
    c.addEventListener("change", () => {
      const set = new Set(view.settings.calendar.workDays);
      if (c.checked) set.add(i);
      else set.delete(i);
      void run(api.set({ calendar: { workDays: [...set].sort() } }));
    });
    l.append(c, ` ${d}`);
    days.append(l);
  });

  const ul = $("folders");
  ul.replaceChildren(
    ...s.files.folders.map((f) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = f;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Remove";
      b.addEventListener("click", () => void run(api.set({ files: { folders: view.settings.files.folders.filter((x) => x !== f) } })));
      li.append(code, b);
      return li;
    }),
  );
  if (!s.files.folders.length) ul.innerHTML = '<li class="muted">No folders — {send the … picture} won\'t find anything.</li>';

  const n = s.notifications;
  const check = (id: string, on: boolean, enabled = true) => {
    const c = $<HTMLInputElement>(id);
    c.checked = on;
    c.disabled = !enabled;
    c.closest("label")?.classList.toggle("off", !enabled);
  };
  check("blockGroups", n.blockGroups);
  check("allowPinnedGroups", n.allowPinnedGroups, n.blockGroups);
  check("allowMentions", n.allowMentions, n.blockGroups);
  check("blockPersonal", n.blockPersonal);
  check("allowPinnedPersonal", n.allowPinnedPersonal, n.blockPersonal);
  const always = $("always");
  always.replaceChildren(
    ...n.always.map((c) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Remove";
      b.addEventListener("click", () => void run(api.set({ notifications: { always: view.settings.notifications.always.filter((x) => x !== c) } })));
      li.append(c, b);
      return li;
    }),
  );
  if (!n.always.length) always.innerHTML = '<li class="muted">None yet.</li>';

  $<HTMLInputElement>("closeToTray").checked = s.app.closeToTray;
  $<HTMLInputElement>("startAtLogin").checked = s.app.startAtLogin;
  $("dataFolder").textContent = view.dataFolder;
}

/** A language pick-list, with the saved value kept even if it isn't in the list. */
function fillLanguages(id: string, value: string) {
  const sel = $<HTMLSelectElement>(id);
  const names = LANGUAGES.map((l) => l.name);
  if (value && !names.includes(value)) names.push(value);
  if (sel.options.length !== names.length) {
    sel.replaceChildren(
      ...names.map((n) => {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        return o;
      }),
    );
  }
  sel.value = value;
}

let models: { id: string; label: string }[] = [];

function renderModels() {
  const s = view.settings.ai;
  const rec = s.recommended[s.provider] || view.providers[s.provider].defaultModel;
  const sel = $<HTMLSelectElement>("model");
  const opts: [string, string][] = [["", `Recommended — ${rec}`], ...models.map((m): [string, string] => [m.id, m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id])];
  if (s.model && !models.some((m) => m.id === s.model)) opts.push([s.model, s.model]);
  sel.replaceChildren(
    ...opts.map(([v, t]) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      return o;
    }),
  );
  sel.value = s.model;
}

/** The models this key can use, from the provider (when a key is saved). */
async function loadModels() {
  models = [];
  if (!view.keys[view.settings.ai.provider]) return renderModels();
  const r = await api.listModels(view.settings.ai.provider, "");
  if (r.ok) models = r.value.models;
  const v = await api.get();
  if (v.ok) view = v.value;
  render();
}

function onChange(id: string, patch: (v: string, el: HTMLInputElement) => unknown) {
  $(id).addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    void run(api.set(patch(el.value, el)), "Saved");
  });
}

async function init() {
  const r = await api.get();
  if (!r.ok) return toast(r.error, true);
  view = r.value;
  render();
  void loadModels();

  onChange("provider", (v) => ({ ai: { provider: v, model: "" } }));
  $("provider").addEventListener("change", () => setTimeout(() => void loadModels(), 300));
  onChange("model", (v) => ({ ai: { model: v.trim() } }));
  onChange("myLanguage", (v) => ({ ai: { myLanguage: v } }));
  onChange("theirLanguage", (v) => ({ ai: { theirLanguage: v } }));
  onChange("myName", (v) => ({ ai: { myName: v.trim() } }));
  onChange("myGender", (v) => ({ ai: { myGender: v } }));
  onChange("timeZone", (v) => ({ calendar: { timeZone: v.trim() || "Asia/Jerusalem" } }));
  onChange("meetingMinutes", (v) => ({ calendar: { meetingMinutes: Math.max(5, Number(v) || 45) } }));
  onChange("gapMinutes", (v) => ({ calendar: { gapMinutes: Math.max(0, Number(v) || 0) } }));
  onChange("workStart", (v) => ({ calendar: { workStart: mins(v) } }));
  onChange("workEnd", (v) => ({ calendar: { workEnd: mins(v) } }));
  onChange("closeToTray", (_v, el) => ({ app: { closeToTray: el.checked } }));
  onChange("startAtLogin", (_v, el) => ({ app: { startAtLogin: el.checked } }));
  for (const id of ["blockGroups", "allowPinnedGroups", "allowMentions", "blockPersonal", "allowPinnedPersonal"]) {
    onChange(id, (_v, el) => ({ notifications: { [id]: el.checked } }));
  }
  const addAlways = () => {
    const name = $("alwaysName").value.trim();
    if (!name) return;
    const always = view.settings.notifications.always.filter((c) => c.toLowerCase() !== name.toLowerCase());
    $("alwaysName").value = "";
    void run(api.set({ notifications: { always: [...always, name] } }), "Saved");
  };
  $("addAlways").addEventListener("click", addAlways);
  $("alwaysName").addEventListener("keydown", (e) => e.key === "Enter" && addAlways());
  // "Always notify" can also be set from WhatsApp's chat list while this window is open
  window.addEventListener("focus", () => void run(api.get()));

  $("saveKey").addEventListener("click", async () => {
    const key = $("key").value.trim();
    if (!key) return toast("Paste the key first.", true);
    await run(api.setKey(view.settings.ai.provider, key), "Key saved");
    $("key").value = "";
    await loadModels();
  });
  $("test").addEventListener("click", async () => {
    const out = $("testResult");
    out.className = "result";
    out.textContent = "Testing…";
    const r = await api.testAi(view.settings.ai.provider, $("model").value, $("key").value);
    out.className = `result ${r.ok ? "ok" : "error"}`;
    out.textContent = r.ok ? `✓ ${r.value}` : r.error;
    if (r.ok) await loadModels();
  });
  $("importGoogle").addEventListener("click", () => void run(api.importGoogleClient()));
  $("googleSignIn").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("googleSignIn");
    btn.disabled = true;
    $("googleState").textContent = view.googleClient ? "Finish signing in in your browser…" : "Pick the Google client file…";
    await run(api.googleSignIn(), "Signed in to Google");
    btn.disabled = false;
    render();
  });
  $("googleSignOut").addEventListener("click", () => void run(api.googleSignOut(), "Signed out"));
  $("addFolder").addEventListener("click", () => void run(api.addFolder()));
}

void init();
