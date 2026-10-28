import { contextBridge, ipcRenderer } from "electron";

import { CH } from "../shared/ipc";

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld("settingsApi", {
  get: call(CH.sGet),
  set: call(CH.sSet),
  setKey: call(CH.sSetKey),
  testAi: call(CH.sTestAi),
  listModels: call(CH.sListModels),
  importGoogleClient: call(CH.sImportGoogle),
  googleSignIn: call(CH.sGoogleSignIn),
  googleSignOut: call(CH.sGoogleSignOut),
  addFolder: call(CH.sAddFolder),
});
