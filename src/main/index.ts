// WhatsApp AI: WhatsApp Web in a desktop window (calls, notifications, files, tray — like
// WhatsApp Desktop), with the AI features injected by preload/whatsapp.ts and served here.

import { BrowserWindow, Menu, Tray, app, desktopCapturer, dialog, ipcMain, nativeImage, net, powerMonitor, session, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { CH, ChatContext, PageStatus, Result, ReviewReply } from "../shared/ipc";
import { sameChat } from "../shared/notify";
import { AiConfig, complete } from "./ai/client";
import { review, translateOut } from "./ai/compose";
import { FAKE_KEY, startFake } from "./ai/fake";
import { ModelList, fetchModels } from "./ai/models";
import { AiError, PROVIDERS, Provider } from "./ai/provider";
import { TranslationCache, translateTexts } from "./ai/translate";
import { MIME, ext } from "./files";
import * as google from "./google/auth";
import { ConnectionWatch } from "./connection";
import { aiConfig, defaultModel, getSecret, getSettings, keyName, setSecret, setSettings } from "./settings";
import { SPECS, clock, toolRunner } from "./tools";

if (process.env.WA_AI_USER_DATA) app.setPath("userData", process.env.WA_AI_USER_DATA);

const WA_URL = process.env.WA_AI_URL ?? "https://web.whatsapp.com/";
const PARTITION = "persist:whatsapp";
// WhatsApp Web only serves browsers it knows: present as the Chrome this Electron is built on
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;
app.setAppUserModelId("com.ekgir.whatsappai");

const asset = (f: string) => path.join(__dirname, "assets", f);
let win: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain());

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- window state --------------------------------------------------------------------------------

const stateFile = () => path.join(app.getPath("userData"), "window.json");

function loadBounds(): { width: number; height: number; x?: number; y?: number; maximized?: boolean } {
  try {
    return { width: 1280, height: 860, ...JSON.parse(readFileSync(stateFile(), "utf8")) };
  } catch {
    return { width: 1280, height: 860 };
  }
}

function saveBounds() {
  if (!win) return;
  const b = win.getNormalBounds();
  writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
}

// ---- translation cache (on disk, per target language + text) -------------------------------------

const MAX_CACHE = 20_000;

function diskCache(): TranslationCache {
  const file = path.join(app.getPath("userData"), "translations.json");
  let map: Map<string, string> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const load = () => {
    if (map) return map;
    try {
      map = new Map(Object.entries(JSON.parse(readFileSync(file, "utf8"))));
    } catch {
      map = new Map();
    }
    return map;
  };
  const save = () => {
    timer = null;
    const m = load();
    while (m.size > MAX_CACHE) m.delete(m.keys().next().value!);
    writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(m)));
    renameSync(`${file}.tmp`, file);
  };
  return {
    get: (k) => load().get(k),
    set: (k, v) => {
      load().set(k, v);
      timer ??= setTimeout(save, 2000);
    },
  };
}

// ---- IPC -----------------------------------------------------------------------------------------

const waOrigin = new URL(WA_URL).origin;

/** Only our own pages may call: WhatsApp Web (top frame) and the Settings window. */
function fromWhatsApp(e: IpcMainInvokeEvent) {
  const u = e.senderFrame?.url ?? "";
  return e.sender === win?.webContents && e.senderFrame === e.sender.mainFrame && (waOrigin === "null" ? u.startsWith("file:") : u.startsWith(waOrigin));
}
const fromSettings = (e: IpcMainInvokeEvent) => !!settingsWin && e.sender === settingsWin.webContents;

function failure(e: unknown): Result<never> {
  if (e instanceof AiError) return { ok: false, error: e.message, code: e.code };
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function handle<A extends unknown[], T>(channel: string, guard: (e: IpcMainInvokeEvent) => boolean, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!guard(e)) return { ok: false, error: "Not allowed." };
    try {
      return { ok: true, value: await fn(...(args as A)) };
    } catch (err) {
      return failure(err);
    }
  });
}

const me = () => ({ name: getSettings().ai.myName, gender: getSettings().ai.myGender });
/** Some WhatsApp notifications are held back (Personal Settings › Windows notifications). */
const filtering = () => getSettings().notifications.blockGroups || getSettings().notifications.blockPersonal;
const MAX_ATTACH = 100 * 1024 * 1024;

function pageStatus(): PageStatus {
  const s = getSettings();
  return {
    configured: !!process.env.WA_AI_FAKE_BASE || !!getSecret(keyName(s.ai.provider)),
    myLanguage: s.ai.myLanguage,
    theirLanguage: s.ai.theirLanguage,
    google: google.isSignedIn(),
    notifications: s.notifications,
  };
}

// ---- models: Google retires model names, so the default comes from the provider -----------------

const DAY = 24 * 3600 * 1000;

/** Ask the provider which models this key can use; its recommendation becomes the default. */
async function refreshModels(provider: Provider, typedKey = ""): Promise<ModelList> {
  const fake = process.env.WA_AI_FAKE_BASE;
  const key = typedKey.trim() || getSecret(keyName(provider)) || (fake ? FAKE_KEY : "");
  if (!key) throw new Error(`Enter your ${PROVIDERS[provider].label} API key first.`);
  const list = await fetchModels({ provider, base: fake ?? PROVIDERS[provider].base, key, demo: !!fake }, PROVIDERS[provider].defaultModel);
  if (list.recommended && !fake) {
    const ai = getSettings().ai;
    setSettings({ ai: { recommended: { ...ai.recommended, [provider]: list.recommended }, modelsCheckedAt: Date.now() } });
  }
  return list;
}

/** Run an AI call; if the provider has retired the default model, refresh the recommendation and try once more. */
async function withModel<T>(fn: (cfg: AiConfig) => Promise<T>): Promise<T> {
  try {
    return await fn(aiConfig());
  } catch (e) {
    const s = getSettings().ai;
    if (!(e instanceof AiError && e.code === "ai_model") || s.model.trim()) throw e;
    const before = defaultModel(s.provider);
    await refreshModels(s.provider);
    if (defaultModel(s.provider) === before) throw e;
    return fn(aiConfig());
  }
}

function registerIpc() {
  const cache = diskCache();

  handle(CH.status, fromWhatsApp, pageStatus);
  handle(CH.translateIn, fromWhatsApp, async (texts: string[]) => {
    const r = await withModel((cfg) => translateTexts(() => cfg, cache, getSettings().ai.myLanguage, texts.map(String)));
    return { translations: r.translations, failed: r.failed };
  });
  handle(CH.translateOut, fromWhatsApp, async (text: string, to: "their" | "mine", context: ChatContext) => {
    const s = getSettings().ai;
    return { text: await withModel((cfg) => translateOut(cfg, String(text), to === "mine" ? s.myLanguage : s.theirLanguage, context, me())) };
  });
  handle(CH.review, fromWhatsApp, async (text: string, context: ChatContext, translate: boolean): Promise<ReviewReply> => {
    const s = getSettings();
    const found = new Set<string>();
    const { r, out } = await withModel(async (cfg) => {
      const r = await review(cfg, String(text), context, me(), s.ai.myLanguage, clock(s.calendar.timeZone), SPECS, toolRunner(s, found), () => found);
      const out = translate && r.text.trim() ? await translateOut(cfg, r.text, s.ai.theirLanguage, context, me()) : r.text;
      return { r, out };
    });
    const attachments: ReviewReply["attachments"] = [];
    const skipped: string[] = [];
    for (const p of r.attachments) {
      const st = await stat(p).catch(() => null);
      if (!st || st.size > MAX_ATTACH) {
        skipped.push(path.basename(p));
        continue;
      }
      attachments.push({ name: path.basename(p), mime: MIME[ext(p)] ?? "application/octet-stream", data: new Uint8Array(await readFile(p)) });
    }
    return { text: out, attachments, applied: r.applied, skipped };
  });
  ipcMain.on(CH.openSettings, (e) => {
    if (e.sender === win?.webContents) openSettings();
  });
  ipcMain.on(CH.notificationClicked, (e) => {
    if (e.sender === win?.webContents) showMain();
  });
  // with notifications filtered, only a notification that was shown flashes the taskbar
  ipcMain.on(CH.notified, (e) => {
    if (e.sender === win?.webContents && filtering() && !win.isFocused()) win.flashFrame(true);
  });

  // Settings window
  const view = () => ({
    settings: getSettings(),
    keys: { gemini: !!getSecret("geminiKey"), claude: !!getSecret("claudeKey") },
    googleClient: !!google.client(),
    googleSignedIn: google.isSignedIn(),
    providers: PROVIDERS,
    version: app.getVersion(),
    dataFolder: app.getPath("userData"),
  });
  const changed = () => {
    win?.webContents.send(CH.settingsChanged);
    applyLoginItem();
    return view();
  };
  handle(CH.sGet, fromSettings, view);
  // a chat's right-click menu › Always notify
  handle(CH.alwaysNotify, fromWhatsApp, (chat: string, on: boolean) => {
    const name = String(chat).trim();
    const always = getSettings().notifications.always.filter((c) => !sameChat(c, name));
    if (on && name) always.push(name);
    setSettings({ notifications: { always } });
    changed();
    return always;
  });
  handle(CH.sSet, fromSettings, (patch: Parameters<typeof setSettings>[0]) => {
    setSettings(patch);
    return changed();
  });
  handle(CH.sSetKey, fromSettings, async (provider: Provider, key: string) => {
    setSecret(keyName(provider), key.trim() || null);
    if (key.trim()) await refreshModels(provider);
    return changed();
  });
  handle(CH.sListModels, fromSettings, (provider: Provider, key: string) => refreshModels(provider, key));
  handle(CH.sTestAi, fromSettings, async (provider: Provider, model: string, key: string) => {
    const k = key.trim() || getSecret(keyName(provider)) || (process.env.WA_AI_FAKE_BASE ? FAKE_KEY : "");
    if (!k) throw new Error(`Enter your ${PROVIDERS[provider].label} API key first.`);
    const cfg = {
      provider,
      model: model.trim() || (await refreshModels(provider, k)).recommended || defaultModel(provider),
      base: process.env.WA_AI_FAKE_BASE ?? PROVIDERS[provider].base,
      key: k,
      demo: !!process.env.WA_AI_FAKE_BASE,
    };
    const t0 = Date.now();
    await complete(cfg, "", "Reply with the single word OK.", { maxTokens: 50, timeoutMs: 30_000 });
    return `${PROVIDERS[provider].label} (${cfg.model}) answered in ${((Date.now() - t0) / 1000).toFixed(1)} s.`;
  });
  /** The user picks the client file (README: "Connecting Google Calendar and Contacts"). */
  const pickGoogleClient = async (): Promise<boolean> => {
    const r = await dialog.showOpenDialog(settingsWin!, {
      title: "Pick the Google client file (the OAuth client JSON downloaded from Google Cloud)",
      defaultPath: app.getPath("downloads"),
      filters: [{ name: "Google client file", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return false;
    google.importClient(readFileSync(r.filePaths[0], "utf8"));
    return true;
  };
  handle(CH.sImportGoogle, fromSettings, async () => {
    await pickGoogleClient();
    return view();
  });
  // no client file yet: ask for it first, then straight on to Google
  handle(CH.sGoogleSignIn, fromSettings, async () => {
    if (!google.client() && !(await pickGoogleClient())) return view();
    await google.signIn();
    return changed();
  });
  handle(CH.sGoogleSignOut, fromSettings, () => {
    google.signOut();
    return changed();
  });
  handle(CH.sAddFolder, fromSettings, async () => {
    const r = await dialog.showOpenDialog(settingsWin!, { title: "Folder to search for files", properties: ["openDirectory"] });
    if (!r.canceled && r.filePaths[0]) {
      const folders = [...new Set([...getSettings().files.folders, r.filePaths[0]])];
      setSettings({ files: { folders } });
    }
    return view();
  });
}

// ---- windows -------------------------------------------------------------------------------------

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 820,
    parent: win ?? undefined,
    title: "WhatsApp AI — Personal Settings",
    icon: asset("icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#f0f2f5",
    webPreferences: { preload: path.join(__dirname, "preload-settings.js"), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  void settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => (settingsWin = null));
}

function setupSession() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);
  ses.setSpellCheckerLanguages(["en-US", "he"].filter((l) => ses.availableSpellCheckerLanguages.includes(l)));
  const allowed = new Set(["media", "notifications", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "display-capture", "mediaKeySystem", "speaker-selection"]);
  const trusted = (url: string) => url.startsWith(waOrigin) || (waOrigin === "null" && url.startsWith("file:"));
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed.has(permission) && trusted(details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && trusted(origin || ""));
  // screen sharing in a call: the system picker where there is one, else the whole first screen
  ses.setDisplayMediaRequestHandler(
    async (_req, cb) => {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      cb(sources[0] ? { video: sources[0], audio: "loopback" } : {});
    },
    { useSystemPicker: true },
  );
}

function createMain() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 760,
    minHeight: 500,
    title: "WhatsApp AI",
    icon: asset("icon.png"),
    autoHideMenuBar: true,
    backgroundColor: "#f0f2f5",
    show: !process.argv.includes("--hidden"),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "preload-whatsapp.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      // hidden in the tray, WhatsApp must still notice a dropped connection and retry
      backgroundThrottling: false,
    },
  });
  if (b.maximized) win.maximize();
  const wc = win.webContents;
  watchConnection(wc);
  void win.loadURL(WA_URL);

  // links open in the browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (!url.startsWith(waOrigin) && /^https?:/i.test(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  // unread count from the title ("(3) WhatsApp")
  let unread = 0;
  win.on("page-title-updated", (e, title) => {
    e.preventDefault();
    const n = Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0);
    win?.setTitle(n ? `(${n}) WhatsApp AI` : "WhatsApp AI");
    if (n > unread && win && !win.isFocused() && !filtering()) win.flashFrame(true);
    unread = n;
    tray?.setToolTip(n ? `WhatsApp AI — ${n} unread` : "WhatsApp AI");
    win?.setOverlayIcon(n ? nativeImage.createFromPath(asset("badge.png")) : null, n ? `${n} unread` : "");
  });
  win.on("focus", () => win?.flashFrame(false));

  // right-click: spelling suggestions and clipboard
  wc.on("context-menu", (_e, p) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    for (const s of p.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (p.misspelledWord) {
      items.push({ label: "Add to dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: "separator" });
    }
    if (p.isEditable) items.push({ role: "cut", enabled: p.editFlags.canCut }, { role: "copy", enabled: p.editFlags.canCopy }, { role: "paste" }, { role: "selectAll" });
    else if (p.selectionText) items.push({ role: "copy" });
    if (p.linkURL && /^https?:/i.test(p.linkURL)) items.push({ type: "separator" }, { label: "Open link in browser", click: () => void shell.openExternal(p.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
  });

  wc.on("render-process-gone", (_e, d) => {
    if (d.reason !== "clean-exit") setTimeout(() => win?.reload(), 1000);
  });

  win.on("close", (e) => {
    saveBounds();
    if (!quitting && getSettings().app.closeToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => (win = null));
}

// ---- staying connected: reload WhatsApp when its connection stays down (see connection.ts) ---------

function watchConnection(wc: WebContents) {
  // the e2e stand-in page has no connection to watch
  if (!waOrigin.startsWith("https:")) return;
  const watch = new ConnectionWatch(Date.now());
  const dbg = wc.debugger;
  const attach = () => {
    if (dbg.isAttached()) return true;
    try {
      dbg.attach("1.3");
    } catch {
      return false;
    }
    // sockets seen before (re)attaching are unknown: count from now, so at most one needless reload
    watch.loading(Date.now());
    // only socket events are wanted: keep no response bodies
    dbg.sendCommand("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }).catch(() => dbg.detach());
    return true;
  };
  dbg.on("message", (_e, method, p) => {
    if (method === "Network.webSocketCreated") watch.created(p.requestId, p.url);
    else if (method === "Network.webSocketHandshakeResponseReceived") watch.opened(p.requestId);
    else if (method === "Network.webSocketClosed") watch.closed(p.requestId, Date.now());
  });
  wc.on("did-start-navigation", (e) => {
    if (e.isMainFrame && !e.isSameDocument) watch.loading(Date.now());
  });
  powerMonitor.on("resume", () => watch.wake());
  let wasOnline = net.isOnline();
  const timer = setInterval(() => {
    const online = net.isOnline();
    if (online && !wasOnline) watch.wake();
    wasOnline = online;
    if (attach() && watch.shouldReload(Date.now(), online)) {
      console.log("WhatsApp has been disconnected for a while: reloading it");
      void wc.loadURL(WA_URL);
    }
  }, 5000);
  wc.once("destroyed", () => clearInterval(timer));
  attach();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(asset("tray.png")));
  tray.setToolTip("WhatsApp AI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open WhatsApp AI", click: showMain },
      { label: "Personal Settings…", click: openSettings },
      { type: "separator" },
      { label: "Quit", click: quit },
    ]),
  );
  tray.on("click", showMain);
}

function quit() {
  quitting = true;
  app.quit();
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "&WhatsApp AI",
        submenu: [
          { label: "Personal Settings…", accelerator: "CmdOrCtrl+,", click: openSettings },
          { type: "separator" },
          { label: "Reload", accelerator: "F5", click: () => win?.reload() },
          { label: "Open data folder", click: () => void shell.openPath(app.getPath("userData")) },
          { type: "separator" },
          { label: "Quit", accelerator: "CmdOrCtrl+Q", click: quit },
        ],
      },
      // no "&" mnemonic: Alt+E is Back
      {
        label: "Edit",
        submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      {
        label: "&View",
        submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools" }],
      },
      {
        label: "&Help",
        submenu: [
          {
            label: "About WhatsApp AI",
            click: () =>
              void dialog.showMessageBox(win!, {
                type: "info",
                title: "WhatsApp AI",
                message: `WhatsApp AI ${app.getVersion()}`,
                detail:
                  "WhatsApp Web with translation and {} AI instructions.\n\n" +
                  "Alt+T  translate (the chat when the box is empty, else your message)\nAlt+E  back to what you typed\nAlt+A  carry out {instructions}\nAlt+Shift+T  translate the chat",
              }),
          },
        ],
      },
    ]),
  );
}

function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: getSettings().app.startAtLogin, args: ["--hidden"] });
}

app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  if (process.env.WA_AI_FAKE === "1") process.env.WA_AI_FAKE_BASE = await startFake();
  registerIpc();
  const ai = getSettings().ai;
  if (getSecret(keyName(ai.provider)) && Date.now() - ai.modelsCheckedAt > DAY) refreshModels(ai.provider).catch(() => undefined);
  setupSession();
  createMenu();
  createMain();
  createTray();
  applyLoginItem();
});
