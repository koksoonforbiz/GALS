import type { FastifyInstance } from 'fastify';
import { serveMedia, serveSnapshotHtml } from '../media/serve.js';

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sessionId: string; snapshotId: string } }>(
    '/api/media/snapshot/:sessionId/:snapshotId.html',
    (req, reply) => serveSnapshotHtml(reply, req.params.sessionId, req.params.snapshotId),
  );
  app.get<{ Params: { sessionId: string; snapshotId: string } }>(
    '/api/media/snapshot/:sessionId/:snapshotId.jpg',
    (req, reply) =>
      serveMedia(req, reply, [req.params.sessionId, 'snapshots', `${req.params.snapshotId}.jpg`]),
  );
  // Webcam: accept any extension (.mp4/.webm/.mov) after the segment id.
  app.get<{ Params: { sessionId: string; file: string } }>(
    '/api/media/webcam/:sessionId/:file',
    (req, reply) => serveMedia(req, reply, [req.params.sessionId, 'webcam', req.params.file]),
  );
}
