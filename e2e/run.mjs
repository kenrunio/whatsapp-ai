// End-to-end: the real app (Electron, preload, main process, Settings window) against the
// stand-in WhatsApp page and the fake model. Screenshots go to e2e/out/.
//   npm run e2e
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "e2e", "out");
mkdirSync(out, { recursive: true });

const userData = mkdtempSync(path.join(tmpdir(), "waai-e2e-"));
const pics = path.join(userData, "Pictures");
mkdirSync(pics);
writeFileSync(path.join(pics, "acme logo.png"), Buffer.from("89504e470d0a1a0a", "hex"));
writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ files: { folders: [pics] }, app: { closeToTray: false } }));

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

// WA_AI_EXE=C:\dev\whatsapp-ai-build\win-unpacked\WhatsApp AI.exe tests the packaged app instead
const exe = process.env.WA_AI_EXE;
const app = await electron.launch({
  executablePath: exe ?? electronPath,
  args: exe ? [] : ["."],
  cwd: root,
  env: { ...process.env, WA_AI_FAKE: "1", WA_AI_USER_DATA: userData, WA_AI_URL: pathToFileURL(path.join(root, "e2e", "fixture", "whatsapp.html")).href },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector("#main header #waai-bar", { state: "visible", timeout: 15000 });
  check(
    await page.evaluate(() => document.getElementById("waai-bar").nextElementSibling?.querySelector('[aria-label="Video call"]') !== null),
    "the AI buttons sit in the chat's top bar, left of the video-call icon",
  );
  const icon = (act) => page.locator(`#waai-bar [data-act="${act}"]`).textContent();
  check((await icon("translate")) === "Aא" && (await page.locator('#waai-bar [data-act="chat"]').count()) === 0, "one Translate button, showing A ⇄ א");

  // received messages: a Translate link on the Hebrew ones only
  await page.waitForSelector(".waai-tr-btn");
  check((await page.locator(".waai-tr").count()) === 2, "Translate links on the 2 Hebrew messages (not on English or 👍)");
  const first = page.locator(".waai-tr").first();
  await first.locator(".waai-tr-btn").click();
  await first.locator(".waai-tr-text").waitFor({ state: "visible" });
  check((await first.locator(".waai-tr-text").textContent()).startsWith("[EN] היי אלכס"), "click Translate → the English shows under the message");
  check((await first.locator(".waai-tr-btn").textContent()) === "Hide translation", "…and the link becomes Hide translation");
  await page.screenshot({ path: path.join(out, "1-translated-message.png") });
  await first.locator(".waai-tr-btn").click();
  check(await first.locator(".waai-tr-text").isHidden(), "Hide translation hides it");

  // Translate with an empty message box: the messages on screen; again: hides them
  const shownCount = () => page.evaluate(() => [...document.querySelectorAll(".waai-tr-text")].filter((e) => !e.hidden).length);
  await page.locator('#waai-bar [data-act="translate"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".waai-tr-text")].filter((e) => !e.hidden).length === 2);
  check(true, "Translate with an empty box translates the Hebrew messages on screen");
  await page.screenshot({ path: path.join(out, "4-translate-screen.png") });
  await page.locator('#waai-bar [data-act="translate"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".waai-tr-text")].filter((e) => !e.hidden).length === 0);
  check((await shownCount()) === 0, "…and pressing it again hides them");

  // writing: To Hebrew, then Back to English
  const box = page.locator('#main footer [contenteditable="true"]');
  const boxText = () => page.evaluate(() => [...document.querySelectorAll("#main footer p")].map((p) => p.textContent).join("\n"));
  await box.click();
  await page.keyboard.type("Tuesday works for me, see you then");
  await page.keyboard.press("Alt+KeyT");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent?.startsWith("[HE]"));
  check((await boxText()) === "[HE] Tuesday works for me, see you then", "Alt+T replaces the English with the Hebrew");
  await page.locator('#waai-bar [data-act="back"]').waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check(await page.locator('#waai-bar [data-act="back"]').isVisible(), "Back to English appears");
  await page.screenshot({ path: path.join(out, "2-translated-reply.png") });
  await page.keyboard.press("Alt+KeyE");
  await page.waitForFunction(() => !document.querySelector("#main footer p")?.textContent?.startsWith("[HE]"));
  await page.locator('#waai-bar [data-act="back"]').waitFor({ state: "hidden", timeout: 5000 });
  check((await boxText()) === "Tuesday works for me, see you then", "Alt+E (Back to English) restores exactly what was typed");
  check((await page.evaluate(() => window.__stalePastes)) === 0, "each paste replaced the whole message (the editor had seen the selection)");

  // changed after translating: Back translates what is there now, instead of restoring
  await page.keyboard.press("Alt+KeyT");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent?.startsWith("[HE]"));
  await box.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" 🙂");
  await page.keyboard.press("Alt+KeyE");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent?.startsWith("[EN]"));
  check((await boxText()) === "[EN] [HE] Tuesday works for me, see you then 🙂", "after editing the translation, Back translates the edited text");

  // typed in their language: Translate goes into mine
  const clear = async () => {
    await box.click();
    await page.keyboard.press("Control+KeyA");
    await page.keyboard.press("Backspace");
  };
  await clear();
  await page.keyboard.type("מחר בעשר בבוקר");
  await page.keyboard.press("Alt+KeyT");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent?.startsWith("[EN]"));
  check((await boxText()) === "[EN] מחר בעשר בבוקר", "Hebrew typed in the box translates into English");

  // {instructions}: Enter runs the AI instead of sending; a picture gets attached
  const sentBefore = await page.locator(".message-out").count();
  await clear();
  check((await page.evaluate(() => document.querySelector("#main footer [contenteditable]").innerText.trim())) === "", "the box is empty again");
  await page.keyboard.type("Sure {thank him} {send the acme logo picture}");
  await page.locator('#waai-bar [data-act="ai"].waai-hot').waitFor({ timeout: 2000 }).catch(() => {});
  check(await page.locator('#waai-bar [data-act="ai"].waai-hot').isVisible(), "the {AI} button lights up while there are instructions");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent === "Sure THANK HIM", null, { timeout: 15000 });
  check((await page.locator(".message-out").count()) === sentBefore, "Enter with {instructions} didn't send the message");
  check((await boxText()) === "Sure THANK HIM", "the instructions were carried out in place");
  await page.locator("#media-preview").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  const preview = await page.locator("#media-preview").textContent();
  check(preview.includes("acme logo.png (image/png"), `the picture found on disk was attached (${preview})`);
  await page.screenshot({ path: path.join(out, "3-instructions.png") });
  await page.evaluate(() => (document.getElementById("media-preview").style.display = "none"));
  await box.click();
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".message-out").length === n + 1, sentBefore);
  check((await page.locator(".message-out").last().textContent()).includes("Sure THANK HIM"), "the second Enter sends it");

  // WhatsApp's send button: while the box holds { }, our {AI} button lies over it — steady while
  // WhatsApp redraws its button on every key — and {instructions} are carried out instead of sent
  const send = page.locator('#main footer [aria-label="Send"]');
  const aiSend = page.locator(".waai-send-ai");
  const onSend = () =>
    page.evaluate(() => {
      const r = document.querySelector('#main footer [aria-label="Send"]').getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(".waai-send-ai")?.textContent ?? "the arrow";
    });
  const sentBySend = await page.locator(".message-out").count();
  await box.click();
  await page.keyboard.type("Ok {thank him}");
  await aiSend.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check((await onSend()) === "{AI}", `with { } in the box, {AI} shows in place of the send button (${await onSend()})`);
  await page.evaluate(() => {
    window.__covered = [];
    const t = setInterval(() => {
      const r = document.querySelector('#main footer [aria-label="Send"]').getBoundingClientRect();
      window.__covered.push(!!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(".waai-send-ai"));
    }, 10);
    setTimeout(() => clearInterval(t), 800);
  });
  await page.keyboard.type(" :)", { delay: 80 });
  await page.waitForTimeout(700);
  const covered = await page.evaluate(() => window.__covered);
  check(covered.length > 40 && covered.every(Boolean), `…and stays, without flickering, while typing (${covered.filter(Boolean).length}/${covered.length})`);
  await page.screenshot({ path: path.join(out, "5-send-button-ai.png") });
  // while the AI works, {AI} is gone (so it's clear it was pressed, and it can't be pressed again)
  await page.evaluate(() => {
    window.__whileWorking = [];
    const look = () => {
      if (document.getElementById("waai-bar").classList.contains("waai-working"))
        window.__whileWorking.push(getComputedStyle(document.querySelector(".waai-send-ai")).display !== "none");
      if (document.querySelector("#main footer p")?.textContent !== "Ok THANK HIM :)") requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await aiSend.click();
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent === "Ok THANK HIM :)", null, { timeout: 15000 });
  const whileWorking = await page.evaluate(() => window.__whileWorking);
  check(whileWorking.length > 0 && !whileWorking.includes(true), `{AI} disappears as soon as it is pressed, while the AI works (${whileWorking.length} frames)`);
  check((await page.locator(".message-out").count()) === sentBySend, "pressing it carries out the {instructions} instead of sending");
  await aiSend.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
  check((await onSend()) === "the arrow", "…after which it is WhatsApp's send arrow again");
  await send.click();
  await page.waitForFunction((n) => document.querySelectorAll(".message-out").length === n + 1, sentBySend);
  check((await page.locator(".message-out").last().textContent()).includes("Ok THANK HIM :)"), "…and the next press of the send button sends the result");
  // the send button pressed from the keyboard
  await box.click();
  await page.keyboard.type("Hi {thank him}");
  await send.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#main footer p")?.textContent === "Hi THANK HIM", null, { timeout: 15000 });
  check((await page.locator(".message-out").count()) === sentBySend + 1, "Enter on the focused send button carries out the {instructions} too");
  await clear();
  // braces that aren't an instruction are never sent either
  for (const [text, how] of [["see {} here", "Enter"], ["a { b", "the {AI} button"], ["c } d", "WhatsApp's own send button, reached anyway"]]) {
    await box.click();
    await page.keyboard.type(text);
    if (how === "Enter") await page.keyboard.press("Enter");
    else if (how === "the {AI} button") await aiSend.click();
    else await send.dispatchEvent("click");
    await page.waitForTimeout(300);
    check(
      (await page.locator(".message-out").count()) === sentBySend + 1 && (await boxText()) === text && (await page.locator(".waai-status").textContent()).startsWith("Not sent"),
      `"${text}" isn't sent by ${how} (and it says why)`,
    );
    await clear();
  }

  // Alt+Shift+T: the messages on screen, even with text in the box
  await box.click();
  await page.keyboard.type("draft");
  await page.keyboard.press("Alt+Shift+KeyT");
  await page.waitForFunction(() => [...document.querySelectorAll(".waai-tr-text")].filter((e) => !e.hidden).length === 2);
  check((await boxText()) === "draft", "Alt+Shift+T translates the messages on screen and leaves the draft alone");

  // a chat without a video-call icon (like some groups): the buttons go before the first icon
  await page.evaluate(() => document.querySelector('[aria-label="Video call"]').parentElement.remove());
  await page.waitForFunction(() => document.getElementById("waai-bar")?.nextElementSibling?.querySelector('[aria-label="Voice call"]'));
  check(true, "without a video icon the buttons sit before the next icon");

  // a group only admins can write in: no message box, Translate still translates the screen
  await page.keyboard.press("Alt+Shift+KeyT"); // hide the translations shown above
  await page.waitForFunction(() => [...document.querySelectorAll(".waai-tr-text")].every((e) => e.hidden));
  await page.evaluate(() => {
    window.__footer = document.querySelector("#main footer");
    window.__footer.remove();
  });
  await page.waitForTimeout(600);
  check(
    (await page.locator("#main header #waai-bar").isVisible()) && (await page.locator('#waai-bar [data-act="ai"]').isHidden()),
    "without a message box the Translate button stays (and {AI} hides)",
  );
  await page.locator('#waai-bar [data-act="translate"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll(".waai-tr-text")].some((e) => !e.hidden));
  check(true, "…and Translate translates the messages on screen");
  await page.evaluate(() => document.querySelector("#main").append(window.__footer));

  // WhatsApp changed its page and the message box isn't found: Enter still never sends raw {instructions}
  const anyBox = page.locator('footer [contenteditable="true"]');
  const sentNow = await page.locator(".message-out").count();
  await page.evaluate(() => document.getElementById("app").append(window.__footer));
  await anyBox.click();
  await page.keyboard.press("Control+KeyA");
  await page.keyboard.type("Hi {his first name}");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check(
    (await page.locator(".message-out").count()) === sentNow && (await page.locator(".waai-status").textContent()).startsWith("Not sent"),
    "with the message box not found, Enter with {instructions} still doesn't send (and says why)",
  );
  await page.keyboard.press("Control+KeyA");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => document.querySelector("#main").append(window.__footer));

  // Settings: in WhatsApp's ⋮ menu
  await page.locator('[aria-label="Menu"]').click();
  const item = page.locator('#menus li[data-waai="settings"]');
  await item.waitFor({ timeout: 3000 });
  check((await item.textContent()) === "Personal Settings" && (await page.locator("#menus li").count()) === 4, `the ⋮ menu ends with "Personal Settings" (${await item.textContent()})`);
  await page.screenshot({ path: path.join(out, "5-menu.png") });
  const [settings] = await Promise.all([app.waitForEvent("window"), item.click()]);
  check((await page.locator("#menus li").count()) === 0, "choosing it closes the menu");
  await settings.waitForSelector("#provider");
  check((await settings.locator("#theirLanguage").inputValue()) === "Hebrew", "Settings opens with the languages");
  await settings.locator("#test").click();
  await settings.waitForSelector("#testResult.ok", { timeout: 15000 });
  check((await settings.locator("#testResult").textContent()).startsWith("✓ Google Gemini"), "Settings › Test reaches the model");
  check((await settings.locator("#theirLanguage option").count()) > 25, "Settings offers a list of languages");
  await settings.locator("#theirLanguage").selectOption("French");
  await page.waitForFunction(() => document.querySelector('#waai-bar [data-act="translate"]')?.textContent === "AFR");
  check(true, "choosing French updates the Translate button at once (A ⇄ FR)");

  // Windows notifications: WhatsApp's notification (tag = the chat's id), then its sound
  const notify = (title, body, tag) => page.evaluate(([t, b, g]) => window.__notify(t, b, g), [title, body, tag]);
  const GROUP = "120363025246125244@g.us";
  const seen = (r) => r.shown && r.sound;
  const held = (r) => !r.shown && !r.sound;
  check(seen(await notify("Acme IR", "Dan‎: results out", GROUP)), "nothing blocked: a group notifies, with its sound");
  await settings.locator("#blockGroups").check();
  await page.waitForTimeout(600);
  check(await settings.locator("#allowPinnedGroups").isChecked(), "Block all groups: 'except pinned groups' starts ticked");
  check(held(await notify("Acme IR", "Dan‎: results out", GROUP)), "a group that isn't pinned is held back, sound and all");
  check(seen(await notify("Board", "Dan‎: see you", GROUP)), "a pinned group still notifies");
  check(seen(await notify("Acme IR", "Mentioned you: Dan‎: @Alex see this", GROUP)), "a mention in a blocked group still notifies");
  check(seen(await notify("Yael", "ok", "972541234567@c.us")), "personal chats still notify");
  check(seen(await notify("Acme IR", "📞 Incoming voice call", "3EB0C1D2")), "calls always ring");

  // right-click a chat in the list › Always notify
  await page.locator('#pane-side [role="row"]', { hasText: "Acme IR" }).click({ button: "right" });
  const always = page.locator('#menus li[data-waai="always-notify"]');
  await always.waitFor({ timeout: 3000 });
  const labels = await page.locator("#menus li").evaluateAll((lis) => lis.map((li) => li.querySelector("[aria-label]")?.getAttribute("aria-label") ?? li.textContent));
  check(labels.indexOf("Always notify") === labels.indexOf("Mute notifications") + 1, `a chat's right-click menu has "Always notify" under "Mute notifications" (${labels.join(", ")})`);
  check((await always.locator("svg").count()) === 1, "…with its bell icon and no submenu arrow (it has no submenu, unlike Mute)");
  await always.click();
  await page.waitForFunction(() => document.querySelector(".waai-status")?.textContent?.includes("will always notify"));
  check(seen(await notify("Acme IR", "Dan‎: results out", GROUP)), "…after which that group notifies again");
  await settings.bringToFront();
  await settings.evaluate(() => window.dispatchEvent(new Event("focus")));
  await settings.locator("#always li", { hasText: "Acme IR" }).waitFor({ timeout: 3000 });
  check(true, "…and it is listed in Personal Settings › Always notify");
  await page.locator('#pane-side [role="row"]', { hasText: "Acme IR" }).click({ button: "right" });
  await always.waitFor({ timeout: 3000 });
  check((await always.textContent()) === "Stop always notifying", "on a chat already in the list, the item reads 'Stop always notifying'");
  await page.keyboard.press("Escape");

  // with no chat open (no top bar to sit under), the confirmation still stays up to be read
  await page.evaluate(() => {
    window.__header = document.querySelector("#main header");
    window.__header.remove();
  });
  await page.waitForTimeout(400);
  await page.locator('#pane-side [role="row"]', { hasText: "Acme IR" }).click({ button: "right" });
  await always.waitFor({ timeout: 3000 });
  await always.click();
  await page.waitForTimeout(1500);
  check(
    (await page.locator(".waai-status").isVisible()) && (await page.locator(".waai-status").textContent()).includes("no longer always notifies"),
    "with no chat open, the confirmation stays on screen",
  );
  await page.evaluate(() => document.querySelector("#main").prepend(window.__header));

  await settings.locator("#blockPersonal").check();
  await page.waitForTimeout(600);
  check(held(await notify("Yael", "ok", "972541234567@c.us")), "Block all personal chats: a person who isn't pinned is held back");
  check(seen(await notify("Dan Amir", "מעולה", "972501234567@c.us")), "…a pinned person still notifies");

  // History: one press loads all the older messages WhatsApp has on this computer, behind a cover so
  // the chat stays at the bottom, up to where WhatsApp says older ones are only on the phone; pressed
  // again while it loads, it stops
  const history = page.locator('#waai-bar [data-act="history"]');
  const status = () => page.locator(".waai-status").textContent();
  const statusIs = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".waai-status")?.textContent ?? ""), re.source, { timeout: 40000 });
  const oldest = () =>
    page.evaluate(() => {
      const [d, m, y] = /(\d+)\/(\d+)\/(\d+)/.exec(document.querySelector("#main [data-pre-plain-text]").dataset.prePlainText).slice(1).map(Number);
      return new Date(y, m - 1, d).getTime();
    });
  const monthsAgo = (m) => {
    const d = new Date();
    d.setMonth(d.getMonth() - m);
    return d.getTime();
  };
  const DAY = 864e5;
  const atBottom = () => page.evaluate(() => (({ scrollTop, clientHeight, scrollHeight }) => scrollTop + clientHeight >= scrollHeight - 2)(document.getElementById("list")));
  // while it loads: is the list hidden whenever it isn't at the bottom?
  const watch = () =>
    page.evaluate(() => {
      window.__hidden = [];
      const look = () => {
        const l = document.getElementById("list");
        if (l.scrollTop + l.clientHeight < l.scrollHeight - 2) window.__hidden.push(!!document.querySelector(".waai-history-cover"));
        if (/^Loading/.test(document.querySelector(".waai-status")?.textContent ?? "") || !window.__hidden.length) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
  await history.click();
  await history.click();
  await statusIs(/^Stopped/).catch(() => {});
  check((await status()).startsWith("Stopped"), `pressing History again while it loads stops it (${await status()})`);
  await watch();
  const t0 = Date.now();
  await history.click();
  await statusIs(/only on your phone/);
  check(
    (await oldest()) <= monthsAgo(9) + 5 * DAY && (await oldest()) > monthsAgo(9) - 5 * DAY && (await page.evaluate(() => window.__noticeClicks)) === 0 && Date.now() - t0 < 20000,
    `one press loads all the history this computer has, up to WhatsApp's "only on your phone" notice, without clicking it (${await status()})`,
  );
  const hidden = await page.evaluate(() => window.__hidden);
  check(hidden.length > 0 && hidden.every(Boolean) && (await atBottom()) && !(await page.locator(".waai-history-cover").count()), `…behind a cover, so the chat stays at the bottom (${hidden.filter(Boolean).length}/${hidden.length} frames)`);
  await history.click();
  await statusIs(/only on your phone/);
  check(true, "…and says so again on the next press");
  await page.screenshot({ path: path.join(out, "7-history.png") });
  await settings.setViewportSize({ width: 720, height: 1400 });
  await settings.screenshot({ path: path.join(out, "6-settings.png"), fullPage: true });
} catch (e) {
  failures++;
  console.error("✗", e);
  const w = app.windows()[0];
  if (w) await w.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
} finally {
  await app.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
