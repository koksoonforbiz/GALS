import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import * as zlib from 'zlib';
import { AppModule } from './app.module';
import { validateEnv } from './env';
import { GlobalExceptionFilter } from './common';

// Matches the existing express.json() limit below — applies to BOTH the
// compressed bytes received and the decompressed JSON, so a gzip request
// can't bypass the size cap in either direction (including zip-bomb style
// payloads that are small compressed but huge decompressed).
const GZIP_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

/**
 * Transparent request-decompression for `Content-Encoding: gzip`. Lets
 * bandwidth-heavy clients (session-replay snapshots — HTML/text compresses
 * ~10:1) send gzipped JSON instead of plain text, with zero server-side
 * opt-in per route.
 *
 * Only activates when the header is present, so it's a no-op for every
 * existing request. Must run BEFORE express.json()/urlencoded(): once this
 * middleware consumes the raw stream, those parsers can no longer read it a
 * second time (a stream can only be consumed once), so this sets `req.body`
 * itself and mutates `content-type` to a value neither parser matches —
 * that's what stops them from re-reading the (already-drained) stream and
 * silently clobbering `req.body` with `{}`.
 */
function gzipRequestDecompression() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers['content-encoding'] !== 'gzip') {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > GZIP_BODY_LIMIT_BYTES) {
        aborted = true;
        res.status(413).json({ message: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const decompressed = zlib.gunzipSync(Buffer.concat(chunks), {
          maxOutputLength: GZIP_BODY_LIMIT_BYTES,
        });
        req.body = decompressed.length > 0 ? JSON.parse(decompressed.toString('utf-8')) : {};
        // Prevent express.json()/urlencoded() further down the chain from
        // trying to parse the same (now-consumed) stream again.
        req.headers['content-type'] = 'application/x-already-parsed';
        next();
      } catch {
        res.status(400).json({ message: 'Invalid gzip payload' });
      }
    });

    req.on('error', () => {
      if (!aborted) res.status(400).json({ message: 'Error reading request body' });
    });
  };
}

async function bootstrap() {
  const env = validateEnv();

  const app = await NestFactory.create(AppModule, { rawBody: true });

  // CSP is meaningless here (this server returns JSON/files, never renders
  // HTML), but the rest of helmet's defaults are worth having. CORP is
  // relaxed from the default 'same-origin' because the frontend runs on a
  // different origin in every environment (dev: 5173 vs API port; prod:
  // separate web/API hosts) and legitimately loads files (PDFs, exports)
  // served directly by this API.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.setGlobalPrefix('api');
  app.use(gzipRequestDecompression());
  app.use(json({ limit: '12mb' }));
  app.use(urlencoded({ extended: true, limit: '12mb' }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.listen(env.PORT);
  console.log(`API running on port ${env.PORT} [${env.NODE_ENV}]`);
}

bootstrap();
