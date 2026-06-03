import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import { prisma } from '../prisma.js';

/**
 * Coding durability is the top constraint: a one-click backup of all coding
 * tables (independent of media), and restore. The backup is a zip containing
 * coding.json (full fidelity) + reliability.csv (human-readable).
 */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/coding/export', async (_req, reply) => {
    const [coders, codebookVersions, annotations, reliabilityRuns] = await Promise.all([
      prisma.coder.findMany(),
      prisma.codebookVersion.findMany(),
      prisma.annotation.findMany(),
      prisma.reliabilityRun.findMany(),
    ]);
    const payload = { exportedAt: new Date().toISOString(), coders, codebookVersions, annotations, reliabilityRuns };
    const zip = new AdmZip();
    zip.addFile('coding.json', Buffer.from(JSON.stringify(payload, null, 2)));
    const relCsv = ['id,scope,dimension,computedAt,metrics']
      .concat(reliabilityRuns.map((r) => `${r.id},${r.scope},${r.dimension},${r.computedAt.toISOString()},"${(r.metrics as string).replace(/"/g, '""')}"`))
      .join('\n');
    zip.addFile('reliability.csv', Buffer.from(relCsv));
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="gals-coding-backup.zip"');
    return reply.send(zip.toBuffer());
  });

  // Restore coding from a backup zip (multipart) or a JSON body { coding.json }.
  app.post('/api/coding/import', async (req, reply) => {
    let payload: any;
    if (req.isMultipart?.()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no file' });
      const zip = new AdmZip(await file.toBuffer());
      const entry = zip.getEntry('coding.json');
      if (!entry) return reply.code(400).send({ error: 'coding.json missing in backup' });
      payload = JSON.parse(entry.getData().toString('utf8'));
    } else {
      payload = (req.body as any)?.payload ?? req.body;
    }
    if (!payload) return reply.code(400).send({ error: 'no payload' });

    let restored = { coders: 0, codebookVersions: 0, annotations: 0, reliabilityRuns: 0 };
    // upsert coders + codebook versions, then annotations + runs (idempotent by id)
    for (const c of payload.coders ?? []) {
      await prisma.coder.upsert({ where: { id: c.id }, update: { name: c.name, role: c.role }, create: { id: c.id, name: c.name, role: c.role, createdAt: new Date(c.createdAt) } });
      restored.coders++;
    }
    for (const v of payload.codebookVersions ?? []) {
      await prisma.codebookVersion.upsert({ where: { id: v.id }, update: { locked: v.locked, definition: v.definition }, create: { id: v.id, name: v.name, version: v.version, definition: v.definition, locked: v.locked, createdAt: new Date(v.createdAt) } });
      restored.codebookVersions++;
    }
    for (const a of payload.annotations ?? []) {
      await prisma.annotation.upsert({
        where: { id: a.id },
        update: { code: a.code, intensity: a.intensity, confidence: a.confidence, notes: a.notes },
        create: { ...a, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt) },
      });
      restored.annotations++;
    }
    for (const r of payload.reliabilityRuns ?? []) {
      await prisma.reliabilityRun.upsert({ where: { id: r.id }, update: {}, create: { ...r, computedAt: new Date(r.computedAt) } });
      restored.reliabilityRuns++;
    }
    return { ok: true, restored };
  });
}
