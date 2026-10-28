// Settings (settings.json) and secrets (secrets.json, each value encrypted with Windows DPAPI via
// safeStorage) in the app's data folder, %APPDATA%\WhatsApp AI.

import { app, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AiConfig } from "./ai/client";
import type { NotifySettings } from "../shared/notify";
import { AiError, PROVIDERS, Provider } from "./ai/provider";

export interface Settings {
  ai: {
    provider: Provider;
    /** "" = the recommended model (below) */
    model: string;
    /** per provider: the best model the key can use, asked from the provider (models/fetchModels) */
    recommended: Record<Provider, string>;
    /** when that list was last asked (epoch ms) */
    modelsCheckedAt: number;
    /** the language the user writes and reads in */
    myLanguage: string;
    /** the language his messages are translated into */
    theirLanguage: string;
    /** how the AI refers to the user ("me") */
    myName: string;
    /** grammatical gender of "me" in Hebrew; "" = not set */
    myGender: "" | "male" | "female";
  };
  calendar: {
    timeZone: string;
    /** 0 = Sunday */
    workDays: number[];
    /** minutes after midnight */
    workStart: number;
    workEnd: number;
    meetingMinutes: number;
    gapMinutes: number;
  };
  files: {
    /** where {find a picture of…} looks */
    folders: string[];
  };
  app: {
    closeToTray: boolean;
    startAtLogin: boolean;
  };
  /** Windows notifications on this PC, on top of WhatsApp's own settings (shared/notify.ts) */
  notifications: NotifySettings;
  google: {
    /** the signed-in account, "" = none */
    email: string;
  };
}

export function defaultSettings(home = app.getPath("home")): Settings {
  return {
    ai: { provider: "gemini", model: "", recommended: { gemini: "", claude: "" }, modelsCheckedAt: 0, myLanguage: "English", theirLanguage: "Hebrew", myName: "", myGender: "" },
    calendar: { timeZone: "Asia/Jerusalem", workDays: [0, 1, 2, 3, 4], workStart: 8 * 60, workEnd: 18 * 60, meetingMinutes: 45, gapMinutes: 15 },
    files: {
      folders: ["Pictures", "Desktop", "Documents", "Downloads", "My Drive"].map((f) => path.join(home, f)).filter((f) => existsSync(f)),
    },
    app: { closeToTray: true, startAtLogin: false },
    notifications: { blockGroups: false, allowPinnedGroups: true, allowMentions: true, blockPersonal: false, allowPinnedPersonal: true, always: [] },
    google: { email: "" },
  };
}

type Patch = { [K in keyof Settings]?: Partial<Settings[K]> };

/** Saved values over the defaults, section by section (a new setting gets its default). */
export function mergeSettings(base: Settings, patch: Patch): Settings {
  const out = structuredClone(base) as unknown as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(patch ?? {})) {
    if (!(section in out) || !values || typeof values !== "object") continue;
    for (const [k, v] of Object.entries(values)) {
      if (k in out[section] && v !== undefined) out[section][k] = v;
    }
  }
  return out as unknown as Settings;
}

const file = (name: string) => path.join(app.getPath("userData"), name);

function readJson(name: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file(name), "utf8"));
  } catch {
    return {};
  }
}

/** Write via a temp file, so a crash mid-write never leaves half a file. */
function writeJson(name: string, value: unknown) {
  const p = file(name);
  writeFileSync(`${p}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${p}.tmp`, p);
}

let cache: Settings | null = null;

export function getSettings(): Settings {
  cache ??= mergeSettings(defaultSettings(), readJson("settings.json") as Patch);
  return cache;
}

export function setSettings(patch: Patch): Settings {
  cache = mergeSettings(getSettings(), patch);
  writeJson("settings.json", cache);
  return cache;
}

// ---- secrets ------------------------------------------------------------------------------------

export type SecretName = "geminiKey" | "claudeKey" | "googleClient" | "googleRefreshToken";

export function getSecret(name: SecretName): string | null {
  const v = readJson("secrets.json")[name];
  if (typeof v !== "string" || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(v, "base64"));
  } catch {
    return null;
  }
}

export function setSecret(name: SecretName, value: string | null) {
  const all = readJson("secrets.json");
  if (value === null || value === "") delete all[name];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows can't encrypt secrets for this app right now.");
    all[name] = safeStorage.encryptString(value).toString("base64");
  }
  writeJson("secrets.json", all);
}

export const keyName = (p: Provider): SecretName => (p === "gemini" ? "geminiKey" : "claudeKey");

// ---- the AI config every call uses --------------------------------------------------------------

/** Tests / demo: WA_AI_FAKE_BASE points at the built-in fake model (ai/fake.ts). */
/** The model used when none is chosen: the provider's recommendation for this key, else the built-in default. */
export const defaultModel = (p: Provider) => getSettings().ai.recommended[p] || PROVIDERS[p].defaultModel;

export function aiConfig(): AiConfig {
  const s = getSettings().ai;
  const model = s.model.trim() || defaultModel(s.provider);
  const fake = process.env.WA_AI_FAKE_BASE;
  if (fake) return { provider: s.provider, model, base: fake, key: "demo-ai-key", demo: true };
  const key = getSecret(keyName(s.provider));
  if (!key) throw new AiError("ai_not_configured", `Set up the AI first: add your ${PROVIDERS[s.provider].label} API key in Personal Settings.`);
  return { provider: s.provider, model, base: PROVIDERS[s.provider].base, key, demo: false };
}
