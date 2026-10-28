import { describe, expect, it } from "vitest";

import { ConnectionWatch, GRACE } from "../src/main/connection";

const WS = "wss://web.whatsapp.com/ws/chat";
const S = 1000;

/** A page that loaded at 0 and connected. */
function connected() {
  const w = new ConnectionWatch(0);
  w.created("1", WS);
  w.opened("1");
  return w;
}

describe("connection watch", () => {
  it("leaves a connected page alone", () => {
    const w = connected();
    expect(w.connected).toBe(true);
    expect(w.shouldReload(10 * 60 * S, true)).toBe(false);
  });

  it("gives WhatsApp's own retries a while, then reloads", () => {
    const w = connected();
    w.closed("1", 100 * S);
    expect(w.shouldReload(100 * S + GRACE - S, true)).toBe(false);
    expect(w.shouldReload(100 * S + GRACE, true)).toBe(true);
  });

  it("doesn't reload while the PC is offline", () => {
    const w = connected();
    w.closed("1", 0);
    expect(w.shouldReload(10 * 60 * S, false)).toBe(false);
    expect(w.shouldReload(10 * 60 * S, true)).toBe(true);
  });

  it("stays down only when every WhatsApp socket has closed", () => {
    const w = connected();
    w.created("2", "wss://web.whatsapp.com:5222/ws/chat");
    w.opened("2");
    w.closed("1", 0);
    expect(w.shouldReload(GRACE * 2, true)).toBe(false);
    w.closed("2", GRACE * 2);
    expect(w.shouldReload(GRACE * 4, true)).toBe(true);
  });

  it("ignores other sockets", () => {
    const w = new ConnectionWatch(0);
    w.created("x", "wss://example.com/ws");
    w.opened("x");
    expect(w.connected).toBe(false);
    expect(w.shouldReload(GRACE, true)).toBe(true);
  });

  it("waits longer after each reload that didn't help, until the PC wakes", () => {
    const w = connected();
    w.closed("1", 0);
    let t = GRACE;
    expect(w.shouldReload(t, true)).toBe(true);
    w.loading(t);
    // next try: a grace period after the reload
    expect(w.shouldReload(t + GRACE - S, true)).toBe(false);
    t += GRACE;
    expect(w.shouldReload(t, true)).toBe(true);
    w.loading(t);
    // then 60 s (back-off past the grace period)
    expect(w.shouldReload(t + GRACE, true)).toBe(false);
    expect(w.shouldReload(t + 60 * S, true)).toBe(true);
    w.loading(t + 60 * S);
    t += 60 * S;
    // the PC wakes: a grace period again, not 120 s
    w.wake();
    expect(w.shouldReload(t + GRACE, true)).toBe(true);
  });

  it("a page load forgets the old sockets and starts the clock again", () => {
    const w = connected();
    w.loading(5 * S);
    expect(w.connected).toBe(false);
    expect(w.shouldReload(5 * S + GRACE - S, true)).toBe(false);
    w.created("9", WS);
    w.opened("9");
    w.closed("1", 50 * S); // the old page's socket, closing late
    expect(w.connected).toBe(true);
  });
});
