import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { existsSync, createReadStream } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { libraryRoutes } from './routes/library.js';
import { importRoutes } from './routes/import.js';
import { mediaRoutes } from './routes/media.js';
import { replayRoutes } from './routes/replay.js';
import { codingRoutes } from './routes/coding.js';
import { analysisRoutes } from './routes/analysis.js';
import { analysisSummaryRoutes } from './routes/analysisSummary.js';
import { llmCodingRoutes } from './routes/llmCoding.js';
import { windowCodingRoutes } from './routes/windowCoding.js';
import { backupRoutes } from './routes/backup.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  app.get('/api/health', async () => ({
    ok: true,
    service: 'gals-studio',
    time: new Date().toISOString(),
  }));
  app.get('/api/config', async () => {
    const { STUDIO_DATA_DIR } = await import('./config.js');
    return { dataDir: STUDIO_DATA_DIR };
  });

  await app.register(libraryRoutes);
  await app.register(importRoutes);
  await app.register(mediaRoutes);
  await app.register(replayRoutes);
  await app.register(codingRoutes);
  await app.register(analysisRoutes);
  await app.register(analysisSummaryRoutes);
  await app.register(llmCodingRoutes);
  await app.register(windowCodingRoutes);
  await app.register(backupRoutes);

  // Serve the built web app for the packaged single-process / desktop launch.
  const webDist = process.env.STUDIO_WEB_DIST ?? resolve(process.cwd(), '../studio-web/dist');
  if (existsSync(webDist)) {
    const MIME: Record<string, string> = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };
    app.get('/*', async (req, reply) => {
      const urlPath = (req.params as Record<string, string>)['*'] ?? '';
      const candidate = resolve(join(webDist, urlPath));
      const file =
        candidate.startsWith(webDist) && urlPath && existsSync(candidate)
          ? candidate
          : join(webDist, 'index.html');
      reply.header('Content-Type', MIME[extname(file)] ?? 'text/html');
      return reply.send(createReadStream(file));
    });
  }

  return app;
}
