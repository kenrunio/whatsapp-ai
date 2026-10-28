# WhatsApp AI — notes for Claude

Electron wrapper of web.whatsapp.com with AI translation and `{}` instructions. README.md has the
layout; the design record is `docs/superpowers/specs/2026-10-23-whatsapp-ai-design.md`.

- **WhatsApp Web's page structure lives only in `src/preload/dom.ts`.** Keep it that way, and keep
  `e2e/fixture/whatsapp.html` mirroring whatever structure dom.ts relies on.
- The AI code is a port of the author's mail app ClassicMail (`../ClassicMail/src-tauri/src/ai` when
  checked out next to this repo). Prompts, the JSON reply handling and the tool-use loop should stay
  in step with it.
- Nothing may send a WhatsApp message on the user's behalf: the AI fills the box / attaches, the
  user presses Enter. Enter or the send button with `{instructions}` in the box runs the AI instead of
  sending; nothing with `{` or `}` in it is ever sent.
- Only files returned by `find_files` during that same review may be read and attached.
- Checks before calling a change done: `npx tsc --noEmit`, `npm test`, `npm run e2e`.
- Windows + Google Drive: `npm install` needs `legacy-peer-deps` (in `.npmrc`); the installer is
  built in `C:\dev\whatsapp-ai-build`.
