// Finding files on this computer for {send the picture of…}: a bounded walk of the folders set in
// Settings, matching every word of the query in the file name (or its folder). Only what was
// found here may then be read and attached (see index.ts).

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const KINDS: Record<string, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"],
  video: ["mp4", "mov", "avi", "mkv", "webm", "3gp"],
  audio: ["mp3", "m4a", "wav", "ogg", "opus", "aac"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "zip"],
};

export const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  bmp: "image/bmp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  webm: "video/webm",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  aac: "audio/aac",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
  zip: "application/zip",
};

const SKIP_DIRS = new Set(["node_modules", "appdata", "$recycle.bin", "system volume information", ".git", "__pycache__"]);
/** Google Drive shortcuts to online-only documents — not real files */
const SKIP_EXT = new Set(["gdoc", "gsheet", "gslides", "gform", "gdraw", "gmap", "gsite", "lnk", "ini", "tmp"]);

export const ext = (p: string) => path.extname(p).slice(1).toLowerCase();

export interface FoundFile {
  path: string;
  name: string;
  folder: string;
  size_kb: number;
  modified: string;
}

export function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s_\-.,]+/)
    .filter((w) => w.length > 1 && !["the", "a", "an", "of", "my", "file", "picture", "photo", "image", "pic"].includes(w));
}

/** 2 = every word in the name, 1 = every word in name + folder, 0 = no match. */
export function score(file: string, ws: string[]): number {
  const name = path.basename(file).toLowerCase();
  if (ws.every((w) => name.includes(w))) return 2;
  const tail = file.toLowerCase().split(/[\\/]/).slice(-3).join("/");
  return ws.every((w) => tail.includes(w)) ? 1 : 0;
}

export async function findFiles(folders: string[], query: string, kind = "any", opts = { maxDirs: 6000, maxMs: 6000, maxDepth: 8, limit: 10 }): Promise<FoundFile[]> {
  const ws = words(query);
  const exts = KINDS[kind] ? new Set(KINDS[kind]) : null;
  const hits: { p: string; s: number }[] = [];
  const t0 = Date.now();
  const queue: { dir: string; depth: number }[] = folders.map((d) => ({ dir: d, depth: 0 }));
  let dirs = 0;
  while (queue.length && dirs < opts.maxDirs && Date.now() - t0 < opts.maxMs) {
    const { dir, depth } = queue.shift()!;
    dirs++;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < opts.maxDepth && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name.toLowerCase())) queue.push({ dir: p, depth: depth + 1 });
        continue;
      }
      const x = ext(e.name);
      if (SKIP_EXT.has(x) || (exts && !exts.has(x)) || e.name.startsWith("~$")) continue;
      const s = ws.length ? score(p, ws) : exts ? 1 : 0;
      if (s) hits.push({ p, s });
    }
  }
  const withStat = await Promise.all(
    hits.map(async (h) => {
      try {
        const st = await stat(h.p);
        return { ...h, size: st.size, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return withStat
    .filter((h): h is NonNullable<typeof h> => !!h)
    .sort((a, b) => b.s - a.s || b.mtime - a.mtime)
    .slice(0, opts.limit)
    .map((h) => ({
      path: h.p,
      name: path.basename(h.p),
      folder: path.dirname(h.p),
      size_kb: Math.round(h.size / 1024),
      modified: new Date(h.mtime).toISOString().slice(0, 10),
    }));
}
