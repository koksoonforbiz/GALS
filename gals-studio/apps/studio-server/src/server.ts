import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { libraryRoutes } from './routes/library.js';
import { importRoutes } from './routes/import.js';
import { mediaRoutes } from './routes/media.js';
import { replayRoutes } from './routes/replay.js';
import { codingRoutes } from './routes/coding.js';
import { analysisRoutes } from './routes/analysis.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

  app.get('/api/health', async () => ({ ok: true, service: 'gals-studio', time: new Date().toISOString() }));

  await app.register(libraryRoutes);
  await app.register(importRoutes);
  await app.register(mediaRoutes);
  await app.register(replayRoutes);
  await app.register(codingRoutes);
  await app.register(analysisRoutes);

  return app;
}
