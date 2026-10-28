# WhatsApp AI

WhatsApp on the desktop — the real WhatsApp Web in its own window, like WhatsApp for Windows —
with AI added (Google Gemini or Anthropic Claude, with your own API key):

- **Any two languages**: in Settings pick your language and the other one (about 30 to choose
  from — English and Hebrew to start with).
- **Translate received messages**: every message that isn't in your language gets a small
  **Translate** link; click it for the translation underneath (click again to hide).
- **One Translate button** (Alt+T) in the chat's top bar:
  - with the message box **empty**, it translates the messages on screen into your language
    (press again to hide them);
  - with **text in the box**, it translates that text into the other language — your English
    becomes natural WhatsApp Hebrew (right gender for the person you're writing to), and Hebrew
    you typed becomes English. Check it, then press Enter. The **undo arrow** (Alt+E) restores
    exactly what you typed.
- **{Instructions}**: write `{…}` anywhere in a message and press **{AI}**
  (Alt+A) — or just Enter or the send button, which shows **{AI}** instead of its arrow while the
  message has `{ }` in it: the instructions are carried out and the result waits in the box for you
  to send. Nothing with `{` or `}` in it is ever sent. Examples:
  - `Hi {his first name}, {say I'll send the deck tonight}` — uses the chat itself;
  - `How about {two free slots next week, afternoons}?` — your Google Calendar (work hours,
    usual meeting length and the gap between meetings are in Settings);
  - `The Zoom link is {the zoom link of my Acme meeting tomorrow}` — meeting details;
  - `Dan's mobile is {Dan Amir's mobile number}` — Google Contacts;
  - `{send the Acme logo picture}` — finds the file on this computer and attaches it
    (WhatsApp shows its usual preview; you press send);
  - with **Translate**, the instructions are carried out first, then the result is translated.
- **History** (the clock in the chat's top bar): loads all of the chat's older messages that
  WhatsApp has on this computer, while the chat stays where it was — up to where WhatsApp says
  "Use WhatsApp on your phone to see older messages" (the rest is only on the phone). Press it again
  while it loads to stop.
- Calls use WhatsApp's own video and call icons in the chat's top bar.
- Notifications, unread count on the taskbar, tray icon, spell check (English + Hebrew),
  voice notes, attachments and downloads work as in WhatsApp Web.
- **Windows notifications, filtered** (Personal Settings, on this PC only, on top of WhatsApp's own
  notification settings): block all groups (except pinned ones, and mentions or replies to you)
  and/or all personal chats (except pinned ones); an **Always notify** list (also from a chat's
  right-click menu in the chat list) always gets through. Calls always ring; messages held back
  still arrive and show as unread, without a sound or a taskbar flash.
- Stays connected: if WhatsApp's connection stays down (after the PC sleeps or the network drops —
  "Computer not connected"), the page reloads by itself, also while hidden in the tray.

The AI never sends anything: it only fills the message box (and attaches files). You press Enter.
Even if a WhatsApp update hides the message box from WhatsApp AI, Enter with `{instructions}` is
held back (with a message saying why) rather than sent; so is a picture's caption with `{ }` in it.

## The buttons

They sit in the chat's top bar (in every chat, groups too), left of WhatsApp's video and call
icons: the **clock** loads the chat's history, **A ⇄ א** (your language ⇄ theirs) translates,
the **undo arrow** (shown after a translation) puts back what you typed, and **{AI}** carries out
your instructions (it turns green while the message holds one). **Personal Settings** is the last item in the chat's ⋮ menu (also
Ctrl+, and the tray icon). Messages ("Translated —
check it…", errors) appear just under the top bar; click one to dismiss it.

## Install

1. Download `WhatsApp-AI-Setup-<version>.exe` from this repository's **Releases** page and run
   it (Windows 10/11; installs for your Windows user, no admin rights). It isn't code-signed, so
   SmartScreen may warn: **More info → Run anyway**. Or build it yourself (see Development).
2. Scan the QR code with your phone (WhatsApp › Settings › Linked devices › Link a device).
3. Open **Personal Settings** (a chat's ⋮ menu › Personal Settings, or Ctrl+,):
   - **AI**: choose Google Gemini or Anthropic Claude, paste your API key, **Save key**, **Test**.
     The model list comes from your key; leave it on **Recommended** and it follows the newest
     fast model your key can use (Google retires old model names for new keys).
   - **Languages**: yours and the other one.
   - **Google Calendar and Contacts** (optional, for `{free slots}`, `{phone numbers}` …): see
     the next section.
   - **Files**: the folders `{send the … picture}` searches (Pictures, Desktop, Documents,
     Downloads and My Drive to start with).

Your API key and Google sign-in are encrypted with Windows (DPAPI) in
`%APPDATA%\WhatsApp AI`; the WhatsApp session is kept there too, so you stay logged in.

## Connecting Google Calendar and Contacts

The `{…}` instructions can look things up in your Google Calendar and Contacts (read-only). For
that the app needs a Google **OAuth client file** — a small JSON file from Google Cloud that
identifies your copy of the app to Google. It's free and takes about ten minutes, once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with the Google
   account whose calendar you want to use, and create a project (any name, e.g. "WhatsApp AI").
2. **APIs & Services › Library**: enable **Google Calendar API** and **People API**.
3. **Google Auth Platform** (formerly *OAuth consent screen*) › **Get started**: an app name
   (e.g. "WhatsApp AI"), your e-mail as support and contact e-mail, and **Audience: External**
   (with Google Workspace you can pick **Internal** instead and skip step 4).
4. **Audience**: under **Test users**, add your own Gmail address. Then, to avoid having to sign
   in again every 7 days (Google's limit while an app is "Testing"), press **Publish app** — it's
   still only you using it; Google doesn't review an app for that.
5. **Clients › Create client**: Application type **Desktop app**, any name › **Create** ›
   **Download JSON**.
6. In WhatsApp AI: **Personal Settings › Google › Sign in with Google**, pick the downloaded file.
   Google opens in your browser; choose your account. Google warns *"Google hasn't verified this
   app"* — it's your own app: **Continue** (or **Advanced › Go to WhatsApp AI**), tick calendar
   and contacts, **Continue**.

The app asks only for read-only calendar and contacts access, and the AI sees only what its
lookups return for the instruction at hand (free slots, a meeting's details, a contact), never the
whole calendar or address book. **Sign out** in Settings removes the access from this PC; to
remove it entirely, go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Building it yourself: put the file in the project folder as `google-client.json` (git-ignored)
and `npm run release` builds it in, so Sign in doesn't ask for it. Don't give that installer to
other people — use `npm run release:public` for theirs.

## Privacy

- Your API key, Google sign-in and WhatsApp session stay on your PC (see above).
- When you use Translate or `{…}`, the text involved — your message, and for context up to the
  last ~12,000 characters of the chat — is sent to the AI provider you chose (Google or Anthropic)
  under your own API key, together with what the calendar, contacts and file lookups returned.
  Nothing else leaves your PC, and nothing goes to the authors of this app.
- The AI never sends anything: it fills the message box and you press Enter, so you always see
  what would go out. It is told to ignore instructions written by the other people in the chat.

## Keys

| Keys | Action |
|---|---|
| Alt+T | Translate: box empty → the messages on screen into your language; text in the box → that text into the other language |
| Alt+E | Back to what you typed |
| Alt+A, Enter or the send button | Carry out the `{instructions}` in your message |
| Alt+Shift+T | Translate (or hide) the messages on screen, even while typing |
| Ctrl+, | Personal Settings |
| F5 | Reload WhatsApp |

## Development

```bash
npm ci
npm start            # build and run
npm test             # unit tests
npm run e2e          # the real app against a stand-in WhatsApp page and a fake model
npm run release      # installer → release/ (with google-client.json built in, if present)
npm run release:public  # installer without it, for publishing → release/public/
```

- `src/main` — the Electron main process: window, tray, permissions, and the AI: `ai/provider.ts` + `ai/tooluse.ts` (Gemini and Claude wire
  formats), `ai/translate.ts`, `ai/compose.ts` (translate and `{}` prompts), `tools.ts` (what
  `{}` can look up), `google/*`, `files.ts`, `slots.ts` (free-time finder), `connection.ts`
  (reloads WhatsApp when its websocket stays closed).
- `src/preload/whatsapp.ts` — what's added to the WhatsApp page; **`src/preload/dom.ts` is the
  only file that knows WhatsApp Web's page structure**. Each lookup tries WhatsApp's usual selector
  first, then plainer fallbacks, so small WhatsApp changes keep working; when an update still breaks
  the Translate links or the bar, fix the selectors there (and `e2e/fixture/whatsapp.html` to match).
- `src/settings` — the Settings window.
- `npm run e2e` drives the real app with Playwright; `node e2e/real-smoke.mjs` checks that the
  real web.whatsapp.com still loads (QR screen) in the app.
- `LIVE_GEMINI_KEY=… npx vitest run test/live.test.ts` runs the translation and `{}` prompts
  against the real Gemini.
- Installer output is built in `C:\dev\whatsapp-ai-build` (`build.directories.output` in
  `package.json`, outside any synced folder); only the setup `.exe` is copied to `release/`.

## Publishing a release

`npm run release:public`, then on GitHub: **Releases › Draft a new release**, tag `v<version>`,
attach `release/public/WhatsApp-AI-Setup-<version>.exe`, **Publish release**.

## Disclaimer and licence

Not affiliated with, endorsed by or connected to WhatsApp or Meta; "WhatsApp" is a trademark of
WhatsApp LLC. This app loads the official WhatsApp Web and adds to it. WhatsApp's terms don't
allow unofficial clients, so use it at your own risk. MIT licence — see [LICENSE](LICENSE).
