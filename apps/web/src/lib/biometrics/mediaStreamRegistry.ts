/**
 * Global registry for active MediaStreams.
 * Allows centralized cleanup (e.g. on logout) and sharing streams
 * across components (e.g. webcam preview).
 */

const streams = new Map<string, MediaStream>();
const listeners = new Set<() => void>();

export const mediaStreamRegistry = {
  /** Register a stream under a unique key. */
  register(key: string, stream: MediaStream) {
    streams.set(key, stream);
    listeners.forEach((fn) => fn());
  },

  /** Remove a stream from the registry. */
  unregister(key: string) {
    streams.delete(key);
    listeners.forEach((fn) => fn());
  },

  /** Get a registered stream by key. */
  get(key: string): MediaStream | undefined {
    return streams.get(key);
  },

  /** Stop all tracks on all registered streams and clear the registry. */
  stopAll() {
    for (const [key, stream] of streams) {
      stream.getTracks().forEach((t) => t.stop());
      streams.delete(key);
    }
    listeners.forEach((fn) => fn());
  },

  /** Subscribe to changes in the registry. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Get all registered stream keys. */
  keys(): string[] {
    return Array.from(streams.keys());
  },
};
