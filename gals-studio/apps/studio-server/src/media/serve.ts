import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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
  if (candidate !== MEDIA_DIR && !candidate.startsWith(MEDIA_DIR + '/') && !candidate.startsWith(MEDIA_DIR + '\\')) {
    return null;
  }
  return candidate;
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
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', type);

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        reply.code(416).header('Content-Range', `bytes */${size}`).send();
        return;
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1);
      reply.send(createReadStream(path, { start, end }));
      return;
    }
  }
  reply.header('Content-Length', size);
  reply.send(createReadStream(path));
}
