# WhatsApp AI — design (2026-10-23)

## Intent

The user writes WhatsApp messages in English to Hebrew speakers and reads their Hebrew replies.
They want WhatsApp Desktop as it is, plus AI help (as in the author's mail app, ClassicMail):
translate their English into natural Israeli WhatsApp Hebrew before sending, translate Hebrew
messages into English on request, and carry out `{instructions}` in curly braces.

## Decided with the user

- **Approach:** wrap the official WhatsApp Web (web.whatsapp.com) in a desktop window and add
  the AI on top. That is what WhatsApp Desktop 2.26 itself is (a WebView2 wrapper), so chats,
  groups, media, voice/video calls and attachments behave the same, and the ban risk is low.
  Not an unofficial protocol client (Baileys).
- **Incoming:** click to translate. A small "Translate" link on each Hebrew message; nothing is
  sent to the AI until it is clicked.
- **Outgoing:** preview, then send. A Translate key swaps the English in the message box for the
  Hebrew, which the user can check and edit; Enter sends. "Back to English" restores the original.
- **`{}` instructions** can look things up in: this chat's history, Google Calendar (free time,
  meetings and their details), Google Contacts, and files on this computer (pictures etc. are
  attached to the message, WhatsApp shows its usual preview before sending).
- Voice and video calls must work (camera / microphone permissions granted to WhatsApp Web).
- Location: only for a future phone version — out of scope here.

## Calls made for the user (theirs to overrule)

- **Electron**, not Tauri: injecting buttons into a remote page, camera/mic permissions and
  file dialogs are first-class there. The AI code is a TypeScript port of ClassicMail's
  (`src-tauri/src/ai/*`): same two providers (Gemini, Claude), same prompts adapted to chat,
  same JSON-reply handling and tool-use loop.
- The API key and Google sign-in are kept encrypted with Electron `safeStorage` (Windows DPAPI)
  in the app's data folder; the key goes only into request headers.
- Google sign-in uses a "Desktop app" OAuth client file that the user imports once in Settings
  (or builds in as `google-client.json`). Read-only scopes: calendar, contacts.
- Enter with an unfinished `{instruction}` in the box runs the AI instead of sending, so raw
  instructions are never sent by accident.
- Translations are cached on disk (per target language + text), so re-opening costs nothing.
- Closing the window hides it to the tray so notifications keep coming (like WhatsApp Desktop);
  Quit from the tray menu.

## Non-goals

- No automatic translation of every message (the user chose click-to-translate).
- No sending without the user pressing Enter/Send themselves — the AI only fills the box / attaches.
- No reading of chats other than the open one.

## Risk

WhatsApp Web's page structure is not a public API. All selectors live in `src/preload/dom.ts`
so a WhatsApp update means fixing one file; the AI features fail soft (WhatsApp itself keeps
working) when a selector stops matching.
