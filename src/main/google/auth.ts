// Google sign-in for installed apps: PKCE + loopback redirect (the system browser opens Google's
// page; Google redirects back to a one-shot server on 127.0.0.1). The refresh token is kept as an
// encrypted secret; access tokens are cached in memory. Read-only calendar and contacts scopes.
//
// The OAuth client is the "Desktop app" client JSON built into the app (scripts/build.mjs); one
// imported in Settings ("Use another client file…") takes precedence.

import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { getSecret, setSecret, setSettings } from "../settings";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

/** Accepts the JSON exactly as Google downloads it ({"installed": {...}}) or a flat object. */
export function parseClientJson(text: string): ClientConfig {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const inner = (v.installed ?? v.web ?? v) as Record<string, unknown>;
  const id = inner.client_id ?? inner.clientId;
  const secret = inner.client_secret ?? inner.clientSecret;
  if (typeof id !== "string" || typeof secret !== "string") {
    throw new Error('The file has no client_id / client_secret — use the JSON of a "Desktop app" OAuth client.');
  }
  return { clientId: id, clientSecret: secret };
}

declare const __GOOGLE_CLIENT_JSON__: string | undefined;
/** Built in at build time ("" when there was no google-client.json; undefined in tests). */
const EMBEDDED = typeof __GOOGLE_CLIENT_JSON__ === "string" ? __GOOGLE_CLIENT_JSON__ : "";

export function client(): ClientConfig | null {
  const s = getSecret("googleClient") || EMBEDDED;
  if (!s) return null;
  try {
    return parseClientJson(s);
  } catch {
    return null;
  }
}

export function importClient(text: string) {
  const c = parseClientJson(text);
  setSecret("googleClient", JSON.stringify(c));
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** What Google sends back to the loopback server: the code, or why there is none. */
export function readRedirect(url: string, state: string): string {
  const q = new URL(url, "http://127.0.0.1").searchParams;
  if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google sign-in failed (${q.get("error")}).`);
  if (q.get("state") !== state) throw new Error("Google sign-in answered for a different request — try again.");
  const code = q.get("code");
  if (!code) throw new Error("Google sign-in came back without a code — try again.");
  return code;
}

const PAGE = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>WhatsApp AI</title><body style="font:16px Segoe UI,sans-serif;padding:40px;color:#111b21">` +
  `<h2 style="color:#008069">WhatsApp AI</h2><p>${msg}</p><p>You can close this tab.</p></body>`;

/** Opens Google's sign-in in the browser and waits (up to 5 minutes) for the answer. */
export async function signIn(): Promise<string> {
  const c = client();
  if (!c) throw new Error("Import the Google client file first.");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url || req.url.startsWith("/favicon")) {
        res.writeHead(404).end();
        return;
      }
      try {
        const code = readRedirect(req.url, state);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Signed in. WhatsApp AI can now read your calendar and contacts."));
        resolve({ code, redirectUri });
      } catch (e) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(PAGE((e as Error).message));
        reject(e);
      } finally {
        clearTimeout(timer);
        server.close();
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Google sign-in timed out."));
    }, 5 * 60_000);
    let redirectUri = "";
    server.listen(0, "127.0.0.1", () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const u = new URL(AUTH_URL);
      u.search = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
      }).toString();
      void shell.openExternal(u.toString());
    });
  });

  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, client_id: c.clientId, client_secret: c.clientSecret });
  if (!tok.refresh_token) throw new Error("Google didn't return a refresh token — try signing in again.");
  setSecret("googleRefreshToken", tok.refresh_token);
  cached = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
  const email = await fetchEmail(tok.access_token);
  setSettings({ google: { email } });
  return email;
}

/** Signing out also forgets an imported client file when one is built in, so the next sign-in uses the built-in one. */
export function signOut() {
  setSecret("googleRefreshToken", null);
  if (EMBEDDED) setSecret("googleClient", null);
  setSettings({ google: { email: "" } });
  cached = null;
}

interface TokenReply {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenReply> {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    if (body.error === "invalid_grant") {
      signOut();
      throw new Error("Google sign-in has expired — sign in again in Settings.");
    }
    throw new Error(`Google sign-in failed (${String(body.error_description ?? body.error ?? r.status)}).`);
  }
  return body as unknown as TokenReply;
}

async function fetchEmail(token: string): Promise<string> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` } });
  const b = (await r.json().catch(() => ({}))) as { email?: string };
  return b.email ?? "(signed in)";
}

let cached: { token: string; until: number } | null = null;

export const isSignedIn = () => !!getSecret("googleRefreshToken");

/** A valid access token, refreshed when needed. */
export async function accessToken(force = false): Promise<string> {
  if (!force && cached && cached.until > Date.now()) return cached.token;
  const c = client();
  const refresh = getSecret("googleRefreshToken");
  if (!c || !refresh) throw new Error("Google isn't connected — sign in to Google in WhatsApp AI's Settings.");
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, client_id: c.clientId, client_secret: c.clientSecret });
  cached = { token: tok.access_token, until: Date.now() + (tok.expires_in - 60) * 1000 };
  return tok.access_token;
}

/** GET a Google API as the signed-in user (one retry with a fresh token after a 401). */
export async function googleGet<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(attempt > 0)}` }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 && attempt === 0) continue;
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
    if (!r.ok) {
      const msg = body.error?.message ?? `HTTP ${r.status}`;
      if (r.status === 403) throw new Error(`Google refused (${msg}) — sign in to Google again in Settings and allow calendar and contacts.`);
      throw new Error(`Google: ${msg}`);
    }
    return body as T;
  }
}
