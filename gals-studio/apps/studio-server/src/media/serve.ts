import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MEDIA_DIR } from '../config.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return MIME[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/** Guard against path traversal: resolved path must stay under MEDIA_DIR. */
export function safeMediaPath(relParts: string[]): string | null {
  const candidate = resolve(join(MEDIA_DIR, ...relParts.map((p) => normalize(p))));
  if (
    candidate !== MEDIA_DIR &&
    !candidate.startsWith(MEDIA_DIR + '/') &&
    !candidate.startsWith(MEDIA_DIR + '\\')
  ) {
    return null;
  }
  return candidate;
}

/**
 * Serve a recorded DOM snapshot as HTML. The recorder injects
 * `<base href="http://localhost:5173">` (the live app origin); offline in the
 * studio that origin is dead, so relative resources would hang or error. Rewrite
 * the base to the snapshot's own same-origin media folder so resolution fails
 * fast (404) instead of reaching out. Small files — read+transform, no stream.
 */
export async function serveSnapshotHtml(
  reply: FastifyReply,
  sessionId: string,
  snapshotId: string,
): Promise<void> {
  const path = safeMediaPath([sessionId, 'snapshots', `${snapshotId}.html`]);
  if (!path) {
    reply.code(403).send({ error: 'path traversal blocked' });
    return;
  }
  let html: string;
  try {
    html = await readFile(path, 'utf8');
  } catch {
    reply.code(404).send({ error: 'not found' });
    return;
  }
  const base = `/api/media/snapshot/${sessionId}/`;
  html = html.replace(/<base\b[^>]*>/i, `<base href="${base}">`);
  reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
}

/**
 * Serve a media file with HTTP Range support (required for <video> scrubbing).
 */
export async function serveMedia(
  req: FastifyRequest,
  reply: FastifyReply,
  relParts: string[],
): Promise<void> {
  const path = safeMediaPath(relParts);
  if (!path) {
    reply.code(403).send({ error: 'path traversal blocked' });
    return;
  }
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    reply.code(404).send({ error: 'not found' });
    return;
  }
  const type = mimeFor(path);

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      start = match[1] ? parseInt(match[1], 10) : 0;
      end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        reply.code(416).header('Content-Range', `bytes */${size}`).send();
        return;
      }
      status = 206;
    }
  }

  // Stream straight to the raw socket. Fastify v5's reply.send() drops the body
  // to 0 bytes when a Content-Length is set manually on a stream payload (which
  // range requests require), so <video> scrubbing got an empty response. hijack()
  // hands us the socket and bypasses Fastify's payload serialization entirely.
  reply.hijack();
  const headers: Record<string, string | number> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': type,
    'Content-Length': end - start + 1,
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  reply.raw.writeHead(status, headers);
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => reply.raw.destroy());
  reply.raw.on('close', () => stream.destroy());
  stream.pipe(reply.raw);
}
