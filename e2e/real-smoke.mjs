// Smoke test against the real web.whatsapp.com with an empty profile: the page must load (QR
// login screen, not "browser not supported"). Nothing is signed in. Screenshot: e2e/out/real-qr.png
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "e2e", "out"), { recursive: true });
const app = await electron.launch({ executablePath: electronPath, args: ["."], cwd: root, env: { ...process.env, WA_AI_USER_DATA: mkdtempSync(path.join(tmpdir(), "waai-real-")) } });
const page = await app.firstWindow();
let ok = false;
for (let i = 0; i < 45 && !ok; i++) {
  await page.waitForTimeout(1000);
  ok = await page.evaluate(() => !!document.querySelector("canvas[aria-label], [data-ref] canvas, canvas") && /log ?in|scan|link/i.test(document.body.innerText));
}
const text = (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, " ");
await page.screenshot({ path: path.join(root, "e2e", "out", "real-qr.png") });
console.log(ok ? "✓ WhatsApp Web loaded its login (QR) screen" : "✗ no QR screen", "—", text);
await app.close();
process.exit(ok ? 0 : 1);
