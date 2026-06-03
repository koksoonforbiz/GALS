import type { FastifyInstance } from 'fastify';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importBundle } from '../import/importer.js';

export async function importRoutes(app: FastifyInstance): Promise<void> {
  // Import by absolute local path to a bundle folder or zip.
  app.post<{ Body: { path?: string } }>('/api/import', async (req, reply) => {
    // multipart zip upload?
    if (req.isMultipart?.()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no file' });
      const dir = await mkdtemp(join(tmpdir(), 'gals-upload-'));
      const zipPath = join(dir, file.filename || 'bundle.zip');
      await writeFile(zipPath, await file.toBuffer());
      const report = await importBundle(zipPath);
      return reply.code(report.ok ? 200 : 422).send(report);
    }
    const path = req.body?.path;
    if (!path) return reply.code(400).send({ error: 'provide a local bundle path or upload a zip' });
    const report = await importBundle(path);
    return reply.code(report.ok ? 200 : 422).send(report);
  });
}
