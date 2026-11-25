import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { CaptureQualityService } from './capture-quality.service';

/**
 * Prompt B, P1 against a real database: the event envelope, idempotent
 * ingest, sequence gaps, keystroke/clipboard text and stream ownership.
 */
const PASSWORD = 'Test-Passw0rd!';

describe('Capture envelope (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;
  let userId: string;
  let sessionId: string;

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, t = token) =>
    r.set('Authorization', `Bearer ${t}`).set('x-session-id', sessionId);
  const at = new Date().toISOString();
  const tab = 'tab-1';
  const ev = (seq: number, id = randomUUID()) => ({
    action: 'MODULE_ITEM_VIEWED',
    occurredAt: at,
    clientEventId: id,
    clientSeq: seq,
    tabId: tab,
    durationMs: 1200,
    sourceChannel: 'lesson',
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    const reg = async (email: string) =>
      (
        await http()
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, termsAccepted: true, name: email, role: 'student' })
      ).body;
    const me = await reg('envelope@test.com');
    const other = await reg('envelope-other@test.com');
    token = me.accessToken;
    otherToken = other.accessToken;
    userId = me.user.id;
    sessionId = (
      await http().post('/api/activity-log/session/open').set('Authorization', `Bearer ${token}`)
    ).body.sessionId;
  }, 60_000);

  afterAll(async () => {
    await prisma.captureQuality.deleteMany({ where: { sessionId } });
    await prisma.ingestIssue.deleteMany({ where: { sessionId } });
    for (const t of ['keystroke_logs', 'clipboard_logs', 'click_logs'] as const) {
      await (prisma[t] as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({
        where: { sessionId },
      });
    }
    await cleanDatabase(prisma);
    await app.close();
  });

  it('stores the envelope and stores a re-sent batch once', async () => {
    const batch = { sessionId, events: [ev(1), ev(2)], appBuild: 'test-build' };
    const first = await as(http().post('/api/activity-log/batch')).send(batch).expect(201);
    expect(first.body).toMatchObject({ accepted: 2, duplicates: 0 });
    const again = await as(http().post('/api/activity-log/batch')).send(batch).expect(201);
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 2, failed: 0 });

    const rows = await prisma.activityLog.findMany({
      where: { sessionId, tabId: tab },
      orderBy: { clientSeq: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      clientSeq: 1,
      durationMs: 1200,
      sourceChannel: 'lesson',
      appBuild: 'test-build',
      consentScope: 'study-consent-form',
    });
    expect(rows[0]!.serverReceivedAt).toBeInstanceOf(Date);
    expect(
      await prisma.ingestIssue.findFirst({ where: { sessionId, kind: 'duplicate' } }),
    ).toMatchObject({ eventCount: 2 });
  });

  it('records a browser queue overflow', async () => {
    await as(http().post('/api/activity-log/batch'))
      .send({ sessionId, events: [ev(3)], overflow: { dropped: 7, sinceMs: 123 } })
      .expect(201);
    expect(
      await prisma.ingestIssue.findFirst({ where: { sessionId, kind: 'client_overflow' } }),
    ).toMatchObject({ eventCount: 7, stream: 'activity_log' });
  });

  it('finds sequence gaps in activity events and in streams', async () => {
    // activity: 1, 2, 3 stored; 4 and 5 lost; 6 arrives
    await as(http().post('/api/activity-log/batch'))
      .send({ sessionId, events: [ev(6)] })
      .expect(201);
    // clicks: 1 and 4 (2..3 lost)
    await as(http().post('/api/logs/clicks'))
      .send({
        sessionId,
        userId,
        events: [1, 4].map((clientSeq) => ({
          x: 1,
          y: 1,
          pageUrl: '/p',
          elementSelector: 'button',
          elementText: 'Next',
          timestamp: Date.now(),
          tabId: tab,
          clientSeq,
        })),
      })
      .expect(201);
    const recs = await app.get(CaptureQualityService).analyseSession(sessionId);
    expect(recs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stream: 'activity_log',
          kind: 'gap',
          fromSeq: 4,
          toSeq: 5,
          count: 2,
        }),
        expect.objectContaining({
          stream: 'click_logs',
          kind: 'gap',
          fromSeq: 2,
          toSeq: 3,
          count: 2,
        }),
      ]),
    );
    expect(await prisma.captureQuality.count({ where: { sessionId, kind: 'gap' } })).toBe(2);
  });

  it('stores keystroke bursts and clipboard text, once per sequence number', async () => {
    const burst = {
      sessionId,
      userId,
      events: [
        {
          fieldId: 'answer',
          keystrokeCount: 3,
          pauseDurationMs: 150,
          typingSpeedWPM: 40,
          timestamp: Date.now(),
          burstStart: Date.now() - 900,
          fieldKind: 'textarea',
          keys: [
            { k: 'h', t: 0 },
            { k: 'i', t: 120 },
            { k: '!', t: 300 },
          ],
          text: 'hi!',
          tabId: tab,
          clientSeq: 1,
        },
      ],
    };
    await as(http().post('/api/logs/keystrokes')).send(burst).expect(201);
    await as(http().post('/api/logs/keystrokes')).send(burst).expect(201); // retry
    const ks = await prisma.keystroke_logs.findMany({ where: { sessionId } });
    expect(ks).toHaveLength(1);
    expect(ks[0]).toMatchObject({ text: 'hi!', fieldKind: 'textarea', keystrokeCount: 3 });
    expect(ks[0]!.keys).toEqual(burst.events[0]!.keys);

    await as(http().post('/api/logs/clipboard'))
      .send({
        sessionId,
        userId,
        events: [
          {
            action: 'paste',
            textLength: 20_000,
            pageUrl: '/p',
            timestamp: Date.now(),
            text: 'x'.repeat(20_000),
            tabId: tab,
            clientSeq: 1,
          },
        ],
      })
      .expect(201);
    const clip = await prisma.clipboard_logs.findFirstOrThrow({ where: { sessionId } });
    expect(clip.textLength).toBe(20_000);
    expect(clip.text).toHaveLength(10_000);
  });

  it("refuses stream rows filed under another user's id", async () => {
    await as(http().post('/api/logs/clicks'), otherToken)
      .send({ sessionId, userId, events: [] })
      .expect(403);
  });
});
