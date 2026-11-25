/**
 * A send queue that survives reloads, crashes and offline periods
 * (Prompt B, B3: no silent loss).
 *
 * Items stay in localStorage until the server has acknowledged them
 * (peek, send, then ack). The server dedupes on the item's id, so an item
 * that was sent but whose acknowledgement was lost (tab closed mid-request)
 * is simply re-sent next time: at-least-once delivery plus dedupe gives
 * exactly one stored row.
 *
 * localStorage, not IndexedDB: its writes are synchronous, so they complete
 * inside `pagehide`, where IndexedDB transactions are often cut off.
 *
 * Each page load keeps its own queue (key `<prefix>:<tab id>`), so two open
 * tabs never overwrite each other. A tab writes a small heartbeat every 15 s;
 * the next page load adopts the queues of tabs whose heartbeat stopped more
 * than a minute ago (closed or crashed) and sends them. Their events keep
 * their own session and ids, so a double send is deduped by the server.
 *
 * The queue is capped. When it is full the oldest items are dropped and
 * counted; the count is sent with the next batch so the server records the
 * loss (`ingest_issues`, kind `client_overflow`) instead of it vanishing.
 */

export interface Overflow {
  dropped: number;
  sinceMs: number | null;
}

interface Stored<T> {
  v: 1;
  items: T[];
  dropped: number;
  droppedSince: number | null;
}

const PERSIST_DELAY_MS = 500;
const HEARTBEAT_MS = 15_000;
const ABANDONED_AFTER_MS = 60_000;

export class DurableQueue<T> {
  private items: T[] = [];
  private inFlight = new Set<string>();
  private dropped = 0;
  private droppedSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly key: string;

  constructor(
    private readonly prefix: string,
    private readonly idOf: (item: T) => string,
    private readonly maxItems: number,
    tabId: string,
  ) {
    this.key = `${prefix}:${tabId}`;
    this.beat();
    setInterval(() => {
      if (!this.closing) this.beat();
    }, HEARTBEAT_MS);
    // The page is going away: let the next page load adopt this queue at
    // once instead of waiting for the heartbeat to go stale. If the page
    // comes back from the back/forward cache, it is ours again.
    window.addEventListener('pagehide', () => {
      this.persistNow();
      this.closing = true;
      try {
        localStorage.setItem(`${this.key}#hb`, '0');
      } catch {
        // Storage unavailable.
      }
    });
    window.addEventListener('pageshow', () => {
      this.closing = false;
      this.beat();
    });
    this.adoptAbandoned();
  }

  private closing = false;

  get length(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    const over = this.items.length - this.maxItems;
    if (over > 0) this.dropOldest(over);
    this.schedulePersist();
  }

  /** Items not already being sent, oldest first, marked as in flight. */
  take(max = Infinity, filter?: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (const it of this.items) {
      if (out.length >= max) break;
      const id = this.idOf(it);
      if (this.inFlight.has(id) || (filter && !filter(it))) continue;
      this.inFlight.add(id);
      out.push(it);
    }
    return out;
  }

  /** The server stored (or already had) these: remove them for good. */
  ack(items: T[]): void {
    if (items.length === 0) return;
    const ids = new Set(items.map(this.idOf));
    this.items = this.items.filter((it) => !ids.has(this.idOf(it)));
    for (const id of ids) this.inFlight.delete(id);
    this.persistNow();
  }

  /** Sending failed: keep them for the next attempt. */
  release(items: T[]): void {
    for (const it of items) this.inFlight.delete(this.idOf(it));
  }

  /** Remove items for good (not sent), e.g. another user's leftover events. */
  drop(pred: (item: T) => boolean): void {
    const before = this.items.length;
    this.items = this.items.filter((it) => !pred(it));
    if (this.items.length !== before) this.schedulePersist();
  }

  /** Change queued items in place (e.g. give session-less events a session). */
  update(fn: (item: T) => T): void {
    this.items = this.items.map(fn);
    this.schedulePersist();
  }

  /** How many were dropped since the last report; resets the count. */
  takeOverflow(): Overflow | null {
    if (this.dropped === 0) return null;
    const o = { dropped: this.dropped, sinceMs: this.droppedSince };
    this.dropped = 0;
    this.droppedSince = null;
    this.schedulePersist();
    return o;
  }

  /** Put an overflow report back (its batch failed). */
  restoreOverflow(o: Overflow | null): void {
    if (!o) return;
    this.dropped += o.dropped;
    this.droppedSince = this.droppedSince ?? o.sinceMs;
  }

  persistNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const data: Stored<T> = {
      v: 1,
      items: this.items,
      dropped: this.dropped,
      droppedSince: this.droppedSince,
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (data.items.length === 0 && data.dropped === 0) localStorage.removeItem(this.key);
        else localStorage.setItem(this.key, JSON.stringify(data));
        return;
      } catch {
        // Quota: drop the oldest half and count it, then try again.
        if (this.items.length === 0) return;
        this.dropOldest(Math.ceil(this.items.length / 2));
        data.items = this.items;
        data.dropped = this.dropped;
        data.droppedSince = this.droppedSince;
      }
    }
  }

  private schedulePersist(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persistNow();
    }, PERSIST_DELAY_MS);
  }

  private dropOldest(n: number): void {
    const removed = this.items.splice(0, n);
    for (const it of removed) this.inFlight.delete(this.idOf(it));
    this.dropped += removed.length;
    this.droppedSince = this.droppedSince ?? Date.now();
  }

  private beat(): void {
    try {
      localStorage.setItem(`${this.key}#hb`, String(Date.now()));
    } catch {
      // Storage unavailable: the queue still works in memory.
    }
  }

  /** Take over the queues of page loads that are gone (closed, crashed). */
  adoptAbandoned(): void {
    let keys: string[] = [];
    try {
      const all = Object.keys(localStorage).filter((k) => k.startsWith(`${this.prefix}:`));
      keys = all.filter((k) => !k.endsWith('#hb') && k !== this.key);
      // Heartbeats of page loads that ended with an empty queue.
      for (const k of all) {
        if (!k.endsWith('#hb') || k === `${this.key}#hb`) continue;
        const stale = Date.now() - Number(localStorage.getItem(k) ?? 0) >= ABANDONED_AFTER_MS;
        if (stale && localStorage.getItem(k.slice(0, -3)) === null) localStorage.removeItem(k);
      }
    } catch {
      return;
    }
    const seen = new Set(this.items.map(this.idOf));
    let adopted = 0;
    for (const k of keys) {
      try {
        const hb = Number(localStorage.getItem(`${k}#hb`) ?? 0);
        if (Date.now() - hb < ABANDONED_AFTER_MS) continue; // still open
        const raw = localStorage.getItem(k);
        const s = raw ? (JSON.parse(raw) as Stored<T>) : null;
        if (s?.v === 1 && Array.isArray(s.items)) {
          for (const it of s.items) {
            if (seen.has(this.idOf(it))) continue;
            seen.add(this.idOf(it));
            this.items.push(it);
            adopted++;
          }
          this.dropped += s.dropped ?? 0;
          this.droppedSince = this.droppedSince ?? s.droppedSince ?? null;
        }
        localStorage.removeItem(k);
        localStorage.removeItem(`${k}#hb`);
      } catch {
        // Unreadable: leave it.
      }
    }
    if (adopted > 0) {
      const over = this.items.length - this.maxItems;
      if (over > 0) this.dropOldest(over);
      this.persistNow();
    }
  }
}

/** Exponential back-off: 30 s, 60 s, 2 min, 4 min, then every 5 min. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(300_000, 30_000 * 2 ** (failures - 1));
}
