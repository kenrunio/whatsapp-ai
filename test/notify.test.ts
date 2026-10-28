import { describe, expect, it } from "vitest";

import { NotifySettings, isCall, isMention, kindOf, shouldShow } from "../src/shared/notify";

const OFF: NotifySettings = { blockGroups: false, allowPinnedGroups: false, allowMentions: true, blockPersonal: false, allowPinnedPersonal: false, always: [] };
const group = (body = "Dan Amir‎: hi all", title = "Acme IR") => ({ title, body, tag: "120363025246125244@g.us" });
const person = (title = "Dan Amir", tag = "972501234567@c.us") => ({ title, body: "hi", tag });

describe("which notifications to show", () => {
  it("tells groups from people by the chat id in the tag", () => {
    expect(kindOf("120363025246125244@g.us")).toBe("group");
    expect(kindOf("972501234567@c.us")).toBe("personal");
    expect(kindOf("118234567890123@lid")).toBe("personal");
    expect(kindOf("3EB0C1D2E3F4")).toBe("other"); // a call's id
    expect(kindOf("wa-web-call-active")).toBe("other");
  });

  it("spots mentions, replies and calls", () => {
    expect(isMention("Mentioned you: Dan Amir‎: @Alex see this")).toBe(true);
    expect(isMention(" ‏Replied to you: דן‏: כן")).toBe(true);
    expect(isMention("Mentioned all: Dan: hi")).toBe(false);
    expect(isMention("Dan: I mentioned you to Yael")).toBe(false);
    expect(isCall({ title: "Dan", body: "📞 Incoming voice call", tag: "3EB0" })).toBe(true);
    expect(isCall({ title: "Board", body: "Dan‎: Missed video call", tag: "1@g.us" })).toBe(true);
    expect(isCall({ title: "Board", body: "Dan: call me later", tag: "1@g.us" })).toBe(false);
  });

  it("shows everything when nothing is blocked", () => {
    expect(shouldShow(group(), OFF, () => false)).toBe(true);
    expect(shouldShow(person(), OFF, () => false)).toBe(true);
  });

  it("blocks groups, except pinned ones, mentions and the always list", () => {
    const s = { ...OFF, blockGroups: true };
    expect(shouldShow(group(), s, () => true)).toBe(false);
    expect(shouldShow(person(), s, () => false)).toBe(true);
    expect(shouldShow(group(), { ...s, allowPinnedGroups: true }, () => true)).toBe(true);
    expect(shouldShow(group(), { ...s, allowPinnedGroups: true }, () => false)).toBe(false);
    expect(shouldShow(group("Mentioned you: Dan‎: @Alex?"), s, () => false)).toBe(true);
    expect(shouldShow(group("Mentioned you: Dan‎: @Alex?"), { ...s, allowMentions: false }, () => false)).toBe(false);
    expect(shouldShow(group(), { ...s, always: [" acme ir "] }, () => false)).toBe(true);
  });

  it("blocks people, except pinned ones and the always list", () => {
    const s = { ...OFF, blockPersonal: true };
    expect(shouldShow(person(), s, () => false)).toBe(false);
    expect(shouldShow(person("Yael", "118234567890123@lid"), s, () => false)).toBe(false);
    expect(shouldShow(group(), s, () => false)).toBe(true);
    expect(shouldShow(person(), { ...s, allowPinnedPersonal: true }, () => true)).toBe(true);
    expect(shouldShow(person(), { ...s, always: ["Dan Amir"] }, () => false)).toBe(true);
  });

  it("when in doubt, shows it", () => {
    const s = { ...OFF, blockGroups: true, blockPersonal: true, allowPinnedGroups: true, allowPinnedPersonal: true };
    expect(shouldShow(group(), s, () => null)).toBe(true); // pinned or not can't be told
    expect(shouldShow({ title: "WhatsApp Web", body: "You have an active call in this window", tag: "wa-web-call-active" }, s, () => false)).toBe(true);
    expect(shouldShow({ title: "Dan", body: "📹 Incoming video call", tag: "3EB0C1" }, s, () => false)).toBe(true);
  });
});
