/**
 * The single source of truth for replay time (mirrors the live ReplayTab).
 *
 *   currentAbsoluteMs = baseWallClockMs + currentOffsetMs
 *   relative(wallMs)  = wallMs - baseWallClockMs
 *
 * A subscribe-able store drives a requestAnimationFrame loop; all panels read
 * the same playhead via useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';

export interface ClockConfig {
  baseWallClockMs: number;
  durationMs: number;
}

export class PlayheadStore {
  private offsetMs = 0;
  private playing = false;
  private speed = 1;
  private raf = 0;
  private lastTick = 0;
  private listeners = new Set<() => void>();
  private snapshot = { offsetMs: 0, playing: false, speed: 1 };

  constructor(private config: ClockConfig) {}

  setConfig(config: ClockConfig) {
    this.config = config;
    this.seek(Math.min(this.offsetMs, config.durationMs));
  }

  getSnapshot = () => this.snapshot;

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private emit() {
    this.snapshot = { offsetMs: this.offsetMs, playing: this.playing, speed: this.speed };
    for (const l of this.listeners) l();
  }

  get currentOffsetMs() {
    return this.offsetMs;
  }
  get currentAbsoluteMs() {
    return this.config.baseWallClockMs + this.offsetMs;
  }

  seek(offsetMs: number) {
    this.offsetMs = Math.max(0, Math.min(offsetMs, this.config.durationMs));
    this.emit();
  }

  seekAbsolute(absoluteMs: number) {
    this.seek(absoluteMs - this.config.baseWallClockMs);
  }

  setSpeed(speed: number) {
    this.speed = speed;
    this.emit();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.lastTick = performance.now();
    const loop = (now: number) => {
      if (!this.playing) return;
      const dt = now - this.lastTick;
      this.lastTick = now;
      this.offsetMs += dt * this.speed;
      if (this.offsetMs >= this.config.durationMs) {
        this.offsetMs = this.config.durationMs;
        this.playing = false;
        this.emit();
        return;
      }
      this.emit();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.emit();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  restart() {
    this.seek(0);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }
}

export function usePlayhead(store: PlayheadStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** mm:ss or h:mm:ss for long sessions. */
export function fmtRel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtWall(absoluteMs: number, timezone?: string): string {
  try {
    return new Date(absoluteMs).toLocaleTimeString(undefined, { timeZone: timezone, hour12: false });
  } catch {
    return new Date(absoluteMs).toLocaleTimeString(undefined, { hour12: false });
  }
}
