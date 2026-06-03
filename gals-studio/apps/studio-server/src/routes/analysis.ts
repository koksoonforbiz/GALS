import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { computeReliability, computeDynamics, computeAttention, computeReading, computeGroundTruth } from '../analysis/compute.js';
import { EXPORTERS } from '../analysis/export.js';

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { scope?: string; dimension?: string } }>('/api/analysis/reliability', async (req) => {
    const scope = req.query.scope ?? 'all';
    const dimension = req.query.dimension ?? 'affect';
    return computeReliability(scope, dimension);
  });

  app.post<{ Body: { scope?: string; dimension?: string; save?: boolean } }>('/api/analysis/reliability', async (req) => {
    const scope = req.body.scope ?? 'all';
    const dimension = req.body.dimension ?? 'affect';
    const result = await computeReliability(scope, dimension);
    const run = await prisma.reliabilityRun.create({
      data: {
        scope,
        dimension,
        metrics: JSON.stringify({ kappa: result.kappa, pabak: result.pabak, krippendorffAlpha: result.krippendorffAlpha, percentAgreement: result.percentAgreement, nWindows: result.nWindows, nDisagreements: result.nDisagreements, cautionHighKappa: result.cautionHighKappa }),
        params: JSON.stringify({ pairing: 'primary_rater_1 vs primary_rater_2', missing: 'excluded (kappa) / treated as missing (alpha)' }),
      },
    });
    return { ...result, runId: run.id };
  });

  app.get<{ Querystring: { session?: string; resolutionWindows?: string } }>('/api/analysis/dynamics', async (req, reply) => {
    if (!req.query.session) return reply.code(400).send({ error: 'session required' });
    return computeDynamics(req.query.session, { resolutionWindows: req.query.resolutionWindows ? Number(req.query.resolutionWindows) : undefined });
  });

  app.get<{ Querystring: { session?: string } }>('/api/analysis/attention', async (req, reply) => {
    if (!req.query.session) return reply.code(400).send({ error: 'session required' });
    return computeAttention(req.query.session);
  });

  app.get<{ Querystring: { session?: string } }>('/api/analysis/reading', async (req, reply) => {
    if (!req.query.session) return reply.code(400).send({ error: 'session required' });
    return computeReading(req.query.session);
  });

  app.get<{ Params: { kind: string }; Querystring: { scope?: string } }>('/api/analysis/export/:kind', async (req, reply) => {
    const exporter = EXPORTERS[req.params.kind];
    if (!exporter) return reply.code(404).send({ error: 'unknown export kind' });
    const scope = req.query.scope ?? 'all';
    const data = await exporter(scope);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${req.params.kind}_${scope}.csv"`);
    return data;
  });

  app.get<{ Querystring: { session?: string } }>('/api/analysis/ground-truth', async (req, reply) => {
    if (!req.query.session) return reply.code(400).send({ error: 'session required' });
    return computeGroundTruth(req.query.session);
  });

  app.get('/api/analysis/runs', async () => ({ runs: await prisma.reliabilityRun.findMany({ orderBy: { computedAt: 'desc' } }) }));
}
