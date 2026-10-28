// Checks the selectors in src/preload/dom.ts against the REAL, signed-in WhatsApp Web, using the
// installed app's profile (%APPDATA%\WhatsApp AI — quit WhatsApp AI first). It opens the first
// chats in the list one by one and prints only yes/no answers and counts — never message text,
// chat names or contacts.
//   npm run build && node e2e/probe.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHATS = 8;
const app = await electron.launch({
  executablePath: electronPath,
  args: ["."],
  cwd: root,
  env: { ...process.env, WA_AI_USER_DATA: path.join(process.env.APPDATA, "WhatsApp AI") },
});
const page = await app.firstWindow();
const rows = [];
try {
  await page.waitForSelector('#pane-side, [aria-label="Chat list"]', { timeout: 60_000 });
  const list = page.locator('#pane-side [role="listitem"], #pane-side [role="row"], [aria-label="Chat list"] [role="listitem"]');
  for (let i = 0; i < CHATS && i < (await list.count()); i++) {
    await list.nth(i).click();
    await page.waitForSelector("#main header", { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const header = document.querySelector("#main header");
      const hr = header.getBoundingClientRect();
      const icons = [...header.querySelectorAll('button, [role="button"]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return !b.closest("#waai-bar") && b.querySelector("svg, [data-icon]") && r.width > 0 && r.width <= 72 && r.left > hr.left + hr.width / 2;
      });
      const bar = document.getElementById("waai-bar");
      const rowIds = [...document.querySelectorAll("#main div[data-id]")].map((r) => r.dataset.id ?? "");
      return {
        group: rowIds.some((id) => id.includes("@g.us")) || [...header.querySelectorAll("button, [role=button]")].some((b) => /group/i.test(b.getAttribute("aria-label") ?? "")),
        "message box": !!document.querySelector('#main footer div[contenteditable="true"]'),
        // generic button labels only ("Video call", "Search"…), cut short
        "header icons": icons.map((b) => (b.getAttribute("aria-label") || b.querySelector("[data-icon]")?.getAttribute("data-icon") || "?").slice(0, 18)).join(" | "),
        "AI buttons shown": !!bar && bar.isConnected && header.contains(bar),
        "Translate links": document.querySelectorAll(".waai-tr").length,
      };
    });
    // the ⋮ menu: does it get our item?
    const menuBtn = page.locator("#main header").locator('button, [role="button"]').filter({ has: page.locator("svg, [data-icon]") }).last();
    await menuBtn.click();
    await page.waitForTimeout(800);
    r["⋮ menu item"] = (await page.locator('[data-waai="settings"]').count()) > 0;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    rows.push(r);
  }
  console.table(rows);
} finally {
  await app.close();
}
