// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { chatContext, chatName, chatRowAt, composer, composerText, dateOf, dayFirst, headerSlot, isGroupChat, isMessageField, isPinnedChat, messageFields, messages, messageTimes, olderMessagesNotice, parsePrePlain, rowName, sendButton, sendButtonAt } from "../src/preload/dom";

const PAGE = `
<div id="main">
  <header><div><span dir="auto" title="Dan Amir">Dan Amir</span></div>
    <div id="icons"><div id="video-wrap"><button aria-label="Video call"><span data-icon="video-call"></span></button></div><div><button aria-label="Voice call"></button></div><div><button aria-label="Search"></button></div></div></header>
  <div role="application">
    <div data-id="false_972501234567@c.us_A1"><div class="message-in">
      <div class="copyable-text" data-pre-plain-text="[09:58, 23/10/2026] Dan Amir: ">
        <div><span class="selectable-text copyable-text"><span>שלום אלכס <img alt="👋" data-plain-text="👋">, מה שלומך?</span></span></div>
      </div>
    </div></div>
    <div data-id="true_972501234567@c.us_A2"><div class="message-out">
      <div class="copyable-text" data-pre-plain-text="[10:01, 23/10/2026] Alex Stone: ">
        <div><span class="selectable-text copyable-text"><span>All good, thanks</span></span></div>
      </div>
    </div></div>
    <div data-id="false_972501234567@c.us_A3"><div class="message-in"><img src="photo.jpg"></div></div>
  </div>
  <footer><div contenteditable="true" data-lexical-editor="true"><p><span>Hi {his first name}</span></p><p><br></p><p><span>line 3</span></p></div></footer>
</div>`;

describe("reading WhatsApp's page", () => {
  it("parses the sender line", () => {
    expect(parsePrePlain("[09:58, 23/10/2026] Dan Amir: ")).toEqual({ time: "09:58, 23/10/2026", from: "Dan Amir" });
    expect(parsePrePlain("nothing")).toEqual({ time: "", from: "" });
  });

  it("reads the chat, messages (emoji included) and the message box", () => {
    document.body.innerHTML = PAGE;
    expect(chatName()).toBe("Dan Amir");
    const slot = headerSlot()!;
    expect((slot.before as HTMLElement).id).toBe("video-wrap");
    const ms = messages();
    expect(ms.map((m) => [m.me, m.from, m.text])).toEqual([
      [false, "Dan Amir", "שלום אלכס 👋, מה שלומך?"],
      [true, "Alex Stone", "All good, thanks"],
    ]);
    expect(chatContext()).toMatchObject({ chat: "Dan Amir", isGroup: false, messages: [{ time: "09:58, 23/10/2026" }, { me: true }] });
    expect(isGroupChat()).toBe(false);
    document.querySelector('[aria-label="Video call"]')!.setAttribute("aria-label", "Group video call");
    expect(isGroupChat()).toBe(true);
    expect(composerText(document.querySelector<HTMLElement>("[contenteditable]")!)).toBe("Hi {his first name}\n\nline 3");
  });

  it("still reads the chat after WhatsApp renames things (no #main, no data-pre-plain-text, no selectable-text)", () => {
    document.body.innerHTML = `
<div id="side"><div contenteditable="true" role="textbox"><p>search</p></div></div>
<div class="pane">
  <header><div><span dir="auto" title="Dan Amir">Dan Amir</span></div><div><button aria-label="Video call"><span data-icon="video-call"></span></button></div></header>
  <div role="application">
    <div data-id="false_972501234567@c.us_B1"><div class="message-in"><div><span dir="rtl">שלום אלכס</span></div></div></div>
    <div data-id="true_972501234567@c.us_B2"><div class="message-out"><div><span dir="ltr">Hi Dan</span></div></div></div>
  </div>
  <footer><div contenteditable="true" class="renamed"><p><span>Hi {his first name}</span></p></div></footer>
</div>`;
    expect(chatName()).toBe("Dan Amir");
    expect(headerSlot()).not.toBeNull();
    expect(messages().map((m) => [m.me, m.text])).toEqual([
      [false, "שלום אלכס"],
      [true, "Hi Dan"],
    ]);
    expect(composer()?.className).toBe("renamed");
  });

  it("doesn't fall back for one message: a photo in a normal chat stays without text", () => {
    document.body.innerHTML = PAGE;
    document.querySelector('[data-id$="_A3"] .message-in')!.insertAdjacentHTML("afterbegin", `<span dir="auto">Dan Amir</span>`);
    expect(messages().map((m) => m.text)).toEqual(["שלום אלכס 👋, מה שלומך?", "All good, thanks"]);
  });

  it("finds a message box that has lost its footer, but not the search box", () => {
    document.body.innerHTML = PAGE;
    const box = document.querySelector("#main footer [contenteditable]")!;
    document.querySelector("#main footer")!.replaceWith(box);
    box.setAttribute("role", "textbox");
    expect(composer()).toBe(box);
    box.remove();
    document.body.insertAdjacentHTML("afterbegin", `<div id="side"><div contenteditable="true" role="textbox"></div></div>`);
    expect(composer()).toBeNull();
  });

  it("reads the chat list: names, and which chats are pinned (as the real WhatsApp marks them)", () => {
    document.body.innerHTML = `
<div id="side"><div id="pane-side" aria-label="Chat list">
  <div role="row"><div><span dir="auto" title="Board">Board</span></div><div><span title="Dan: hi">Dan: hi</span><svg><title>ic-push-pin</title></svg></div></div>
  <div role="row"><div><span dir="auto" title="Acme IR">Acme IR</span></div><div><span title="Board">Board</span><svg><title>ic-notifications-off</title></svg></div></div>
  <div role="row"><div><span dir="auto" title="Yael">Yael</span></div><div><span data-icon="pinned2"></span></div></div>
</div></div>`;
    expect(isPinnedChat("Board")).toBe(true);
    expect(isPinnedChat("acme ir")).toBe(false); // its last message is called "Board": names come from each row's first span
    expect(isPinnedChat("Yael")).toBe(true); // older WhatsApp: data-icon="pinned…"
    expect(isPinnedChat("Someone scrolled away")).toBeNull();
    const row = chatRowAt(document.querySelector('[title="Dan: hi"]'))!;
    expect(rowName(row)).toBe("Board");
    expect(chatRowAt(document.body)).toBeNull();
  });

  it("knows WhatsApp's send button by its label, its icon, or its place after the message box", () => {
    const footer = (send: string) => {
      document.body.innerHTML = `
<div id="side"><div contenteditable="true" role="textbox" id="search"></div></div>
<div id="main"><header></header><footer>
  <button id="emoji"><span data-icon="wds-ic-emoji"></span></button>
  <div contenteditable="true" role="textbox"><p>hi</p></div>${send}
</footer></div>`;
      return document.getElementById("send");
    };
    for (const html of [
      `<button id="send" aria-label="Send"><span></span></button>`,
      `<div id="send" role="button"><span data-icon="send"></span></div>`,
      `<button id="send"><svg><title>wds-ic-send-filled</title></svg></button>`,
      `<button id="send"><span></span></button>`, // nothing says "send": the button after the box
    ]) {
      const send = footer(html)!;
      expect(sendButtonAt(send.querySelector("span, svg") ?? send)).toBe(send);
      expect(sendButtonAt(document.getElementById("emoji"))).toBeNull();
      expect(sendButton()).toBe(send);
    }
    expect(sendButtonAt(document.querySelector("#main [contenteditable]"))).toBeNull();
    // the chat list's search box is no place a message is written
    expect(isMessageField(document.getElementById("search")!)).toBe(false);
    expect(messageFields()).toEqual([composer()]);
  });

  it("reads the messages' dates, day or month first as WhatsApp writes them", () => {
    expect(dayFirst(["09:58, 23/10/2026"], "en-US")).toBe(true); // 23 can only be a day
    expect(dayFirst(["9:58 AM, 10/23/2026"], "en-GB")).toBe(false);
    expect(dayFirst(["09:58, 03/04/2026"], "en-GB")).toBe(true); // can't tell: the computer's format
    expect(dayFirst(["09:58, 03/04/2026"], "en-US")).toBe(false);
    expect(dateOf("09:58, 23/10/2026", true)).toEqual(new Date(2026, 9, 23));
    expect(dateOf("9:58 AM, 10/23/2026", false)).toEqual(new Date(2026, 9, 23));
    expect(dateOf("09:58, 23.10.26", true)).toEqual(new Date(2026, 9, 23));
    expect(dateOf("09:58, 2026-10-23", true)).toEqual(new Date(2026, 9, 23));
    expect(dateOf("09:58", true)).toBeNull();
    expect(dateOf("09:58, 31/02/2026", true)).toBeNull();
  });

  it("finds WhatsApp's notice about older messages, but never a message that says it", () => {
    document.body.innerHTML = `
<div id="main"><header></header><div role="application">
  <div><div><span>Click here to get older messages from your phone.</span></div></div>
  <div data-id="false_1@c.us_A"><div class="message-in"><div class="copyable-text" data-pre-plain-text="[09:58, 23/10/2026] Dan: "><span class="selectable-text">see the older messages</span></div></div></div>
</div><footer><div contenteditable="true"></div></footer></div>`;
    expect(olderMessagesNotice()).toMatchObject({ el: { tagName: "SPAN" }, fetch: true }); // clicking it gets them
    expect(messageTimes()).toEqual(["09:58, 23/10/2026"]);
    document.querySelector("span")!.textContent = "Use WhatsApp on your phone to see older messages.";
    expect(olderMessagesNotice()?.fetch).toBe(false); // the end of what this computer has
    document.querySelector("span")!.remove();
    expect(olderMessagesNotice()).toBeNull();
  });
});
