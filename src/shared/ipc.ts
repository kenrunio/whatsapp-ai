// The messages between the WhatsApp page / Settings window and the main process.

import type { NotifySettings } from "./notify";

export interface ChatMessage {
  from: string;
  me: boolean;
  time: string;
  text: string;
}

/** The open chat, as the WhatsApp page shows it (oldest message first). */
export interface ChatContext {
  chat: string;
  isGroup: boolean;
  messages: ChatMessage[];
}

/** Every call answers this way, so the page can show the error text as it is. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

export interface PageStatus {
  configured: boolean;
  myLanguage: string;
  theirLanguage: string;
  google: boolean;
  notifications: NotifySettings;
}

export interface Attachment {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface ReviewReply {
  text: string;
  attachments: Attachment[];
  applied: number;
  /** files found but too big to attach */
  skipped: string[];
}

export const CH = {
  status: "wa:status",
  translateIn: "wa:translateIn",
  translateOut: "wa:translateOut",
  review: "wa:review",
  openSettings: "wa:openSettings",
  notificationClicked: "wa:notificationClicked",
  /** a notification was shown (not held back): flash the taskbar */
  notified: "wa:notified",
  alwaysNotify: "wa:alwaysNotify",
  settingsChanged: "wa:settingsChanged",
  sGet: "settings:get",
  sSet: "settings:set",
  sSetKey: "settings:setKey",
  sTestAi: "settings:testAi",
  sListModels: "settings:listModels",
  sImportGoogle: "settings:importGoogleClient",
  sGoogleSignIn: "settings:googleSignIn",
  sGoogleSignOut: "settings:googleSignOut",
  sAddFolder: "settings:addFolder",
} as const;
