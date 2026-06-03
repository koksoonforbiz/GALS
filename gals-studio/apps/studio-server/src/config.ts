import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * STUDIO_DATA_DIR holds studio.db and the media/ tree. Defaults to
 * ~/.gals-studio. Everything runs on localhost — no cloud, no auth.
 */
export const STUDIO_DATA_DIR = resolve(
  process.env.STUDIO_DATA_DIR ?? join(homedir(), '.gals-studio'),
);

export const MEDIA_DIR = join(STUDIO_DATA_DIR, 'media');
export const DB_PATH = join(STUDIO_DATA_DIR, 'studio.db');

export const PORT = Number(process.env.STUDIO_PORT ?? 5174);
export const HOST = process.env.STUDIO_HOST ?? '127.0.0.1';

/** Ensure the data dir + media tree exist and the DB url env is set for Prisma. */
export function ensureDataDir(): void {
  mkdirSync(MEDIA_DIR, { recursive: true });
  if (!process.env.STUDIO_DATABASE_URL) {
    process.env.STUDIO_DATABASE_URL = `file:${DB_PATH}`;
  }
}

export function mediaDirFor(sessionId: string): string {
  return join(MEDIA_DIR, sessionId);
}
