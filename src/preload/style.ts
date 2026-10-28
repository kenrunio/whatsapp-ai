// Styles and icons for what we add to WhatsApp Web, in WhatsApp's own look (light and dark).
// Icons: Material Design icons (Apache 2.0), 24×24.

import type { Language } from "../shared/languages";

export const CSS = `
.waai-tr { display: block; margin-top: 4px; padding-right: 72px; font-size: 13px; line-height: 18px; }
.waai-tr-text {
  margin: 2px 0 4px; padding: 4px 8px; border-left: 3px solid #00a884; border-radius: 4px;
  background: rgba(0, 168, 132, 0.08); white-space: pre-wrap; direction: ltr; text-align: left;
  font-size: 14px; line-height: 19px; color: inherit; user-select: text;
}
.waai-tr-btn {
  all: unset; cursor: pointer; color: #008069; font-size: 12.5px; font-weight: 500;
}
.waai-tr-btn:hover { text-decoration: underline; }
.waai-tr-btn:disabled { cursor: default; opacity: 0.6; text-decoration: none; }
body.dark .waai-tr-btn, .dark .waai-tr-btn { color: #21c063; }

.waai-bar { display: flex; align-items: center; gap: 10px; margin-right: 10px; flex: none; color: #54656f; }
.waai-btn {
  all: unset; box-sizing: border-box; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: inherit;
}
.waai-btn svg { width: 24px; height: 24px; fill: currentColor; display: block; }
.waai-pair { display: inline-flex; align-items: center; gap: 1px; font: 600 15px/1 "Segoe UI", Arial, sans-serif; }
.waai-pair svg { width: 13px; height: 13px; margin: 0 1px; }
.waai-pair .waai-g2 { font-size: 10px; letter-spacing: -0.3px; }
.waai-btn .waai-braces { font: 600 14px/1 "Segoe UI", Arial, sans-serif; letter-spacing: -0.2px; }
.waai-btn:hover { background: rgba(11, 20, 26, 0.08); }
.waai-dark .waai-btn:hover { background: rgba(255, 255, 255, 0.1); }
.waai-btn:focus-visible { outline: 2px solid #00a884; }
.waai-btn[hidden] { display: none; }
.waai-btn.waai-history.waai-hot, .waai-btn.waai-ai.waai-hot { color: #00a884; background: rgba(0, 168, 132, 0.12); }
.waai-working .waai-btn { opacity: 0.4; pointer-events: none; }
/* over WhatsApp's send button while the message holds { }: place, shape and colours set from it */
.waai-send-ai {
  all: unset; position: fixed; z-index: 1000; box-sizing: border-box; display: none; align-items: center; justify-content: center;
  cursor: pointer; font: 600 14px/1 "Segoe UI", Arial, sans-serif; letter-spacing: -0.2px;
}
.waai-send-ai:hover { filter: brightness(0.94); }
.waai-send-ai:focus-visible { outline: 2px solid #00a884; }
/* over the messages while History loads older ones (WhatsApp scrolls the list to the top for them) */
.waai-history-cover { position: fixed; z-index: 900; display: flex; align-items: center; justify-content: center; color: #667781; font: 14px "Segoe UI", Arial, sans-serif; cursor: default; }
.waai-status {
  position: fixed; z-index: 2147483000; display: none; max-width: min(460px, 50vw); padding: 8px 14px; border-radius: 8px;
  background: #ffffff; box-shadow: 0 2px 5px rgba(11, 20, 26, 0.26); font: 13.5px/19px "Segoe UI", Helvetica, Arial, sans-serif; cursor: pointer;
}
.waai-status.waai-dark { background: #233138; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.6); }
.waai-status:empty { display: none !important; }
.waai-status.waai-error { color: #ea0038; }
.waai-status.waai-ok { color: #008069; }
.waai-dark .waai-status.waai-ok { color: #21c063; }
.waai-status.waai-info { color: #667781; }
.waai-status.waai-busy { color: #667781; }
.waai-status.waai-busy::before {
  content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px;
  border: 2px solid #00a884; border-right-color: transparent; border-radius: 50%; animation: waai-spin 0.8s linear infinite;
}
@keyframes waai-spin { to { transform: rotate(360deg); } }
`;

const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// Material "swap_horiz"
const SWAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/></svg>';

const letter = (l: Language) => `<span class="waai-g${l.glyph.length > 1 ? " waai-g2" : ""}">${l.glyph}</span>`;

/** "A ⇄ א": translate between my language and theirs. */
export const swap = (mine: Language, theirs: Language) => `<span class="waai-pair" aria-hidden="true">${letter(mine)}${SWAP}${letter(theirs)}</span>`;

export const ICONS: Record<string, string> = {
  // back (Material "undo")
  back: svg("M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"),
  ai: '<span class="waai-braces" aria-hidden="true">{AI}</span>',
  // history (Material "history")
  history: svg("M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"),
  // settings (Material "tune")
  bell: svg("M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"),
  settings: svg("M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"),
};
