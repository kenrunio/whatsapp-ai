// Is WhatsApp Web connected? Its page keeps a websocket open to WhatsApp's servers; when that
// stays closed (the PC slept, the network dropped) WhatsApp shows "Computer not connected" and may
// stop retrying. The main process sees the socket open and close (Chrome's debugger protocol, so
// no page structure or language involved) and reloads the page when it has been down a while.
// Pure, so it is unit-tested with a fake clock; index.ts wires it to Electron.

/** WhatsApp's own retries get a chance first */
export const GRACE = 45_000;
const FIRST_WAIT = 30_000;
const MAX_WAIT = 10 * 60_000;

const isWhatsAppSocket = (url: string) => /^wss:\/\/[^/]*\.whatsapp\.(com|net)(:\d+)?\//i.test(url);

export class ConnectionWatch {
  private sockets = new Set<string>();
  private open = new Set<string>();
  private downSince: number;
  private reloads = 0;
  private notBefore = 0;

  constructor(now: number) {
    this.downSince = now;
  }

  get connected(): boolean {
    return this.open.size > 0;
  }

  /** The page (re)loads: its old sockets are gone. */
  loading(now: number) {
    this.sockets.clear();
    this.open.clear();
    this.downSince = now;
  }

  created(id: string, url: string) {
    if (isWhatsAppSocket(url)) this.sockets.add(id);
  }

  /** Handshake answered (a refused one closes straight after). */
  opened(id: string) {
    if (!this.sockets.has(id)) return;
    this.open.add(id);
    this.reloads = 0;
    this.notBefore = 0;
  }

  closed(id: string, now: number) {
    this.sockets.delete(id);
    if (this.open.delete(id) && !this.open.size) this.downSince = now;
  }

  /** The PC woke or the network came back: no waiting out an earlier back-off. */
  wake() {
    this.reloads = 0;
    this.notBefore = 0;
  }

  /** Called every few seconds: reload the page now? Waits longer after each reload that didn't help. */
  shouldReload(now: number, online: boolean): boolean {
    if (this.connected || !online || now - this.downSince < GRACE || now < this.notBefore) return false;
    this.notBefore = now + Math.min(FIRST_WAIT * 2 ** this.reloads, MAX_WAIT);
    this.reloads++;
    return true;
  }
}
