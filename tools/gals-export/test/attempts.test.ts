/**
 * CAP-83: kc/attempts.jsonl was always empty (queried `userId`, the column is
 * `studentId`, and the error was swallowed). These pin the fixed query and
 * the consent rule for answer text.
 */
import { describe, it, expect, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import { PrismaDataSource } from '../src/datasource.js';

const START = new Date('2026-11-20T02:00:00Z');
const END = new Date('2026-11-20T03:00:00Z');

function fakePrisma(researchUse: boolean | null) {
  const attempt = {
    id: 'a1',
    studentId: 'stu-1',
    questionId: 'q1',
    assessmentId: null,
    status: 'graded',
    textResponse: 'my answer',
    selectedOptionIds: null,
    currentScore: 2,
    autoFeedback: 'good',
    submittedAt: new Date('2026-11-20T02:30:00Z'),
    createdAt: new Date('2026-11-20T02:20:00Z'),
    updatedAt: new Date('2026-11-20T02:31:00Z'),
    question: { courseId: 'course-1', type: 'short_answer', maxScore: 3 },
    gradingResults: [
      {
        id: 'g1',
        attemptId: 'a1',
        score: 2,
        feedback: 'nice',
        gradedBy: 'ai',
        graderId: null,
        aiFeedbackJson: null,
        createdAt: new Date('2026-11-20T02:31:00Z'),
      },
    ],
  };
  return {
    studentSession: {
      findUnique: vi.fn().mockResolvedValue({ userId: 'stu-1', startedAt: START, endedAt: END }),
    },
    attempt: { findMany: vi.fn().mockResolvedValue([attempt]) },
    $queryRawUnsafe: vi
      .fn()
      .mockResolvedValue(researchUse == null ? [] : [{ research_use: researchUse }]),
  };
}

async function collect(prisma: ReturnType<typeof fakePrisma>) {
  const ds = new PrismaDataSource(prisma as never, {} as S3Client, 'bucket');
  const out: Record<string, unknown>[] = [];
  for await (const r of ds.getStream('sess-1', 'attempts')) out.push(r as Record<string, unknown>);
  return out;
}

describe('attempts stream', () => {
  it('queries by studentId within the session window', async () => {
    const prisma = fakePrisma(true);
    const rows = await collect(prisma);
    expect(rows).toHaveLength(1);
    const where = prisma.attempt.findMany.mock.calls[0]![0].where;
    expect(where.studentId).toBe('stu-1');
    expect(where).not.toHaveProperty('userId');
    expect(where.OR).toEqual([
      { createdAt: { gte: START, lte: END } },
      { submittedAt: { gte: START, lte: END } },
    ]);
    expect(rows[0]).toMatchObject({
      id: 'a1',
      courseId: 'course-1',
      textResponse: 'my answer',
      textResponseChars: 9,
      autoFeedback: 'good',
      wallMs: new Date('2026-11-20T02:30:00Z').getTime(),
      gradingResults: [{ id: 'g1', score: 2, feedback: 'nice', gradedBy: 'ai' }],
    });
  });

  it('drops answer and feedback text without research-use consent', async () => {
    for (const consent of [false, null]) {
      const [row] = await collect(fakePrisma(consent));
      expect(row).toMatchObject({
        textResponse: null,
        textResponseChars: 9,
        autoFeedback: null,
        gradingResults: [{ score: 2, feedback: null }],
      });
    }
  });

  it('fails loudly instead of yielding an empty stream', async () => {
    const prisma = fakePrisma(true);
    prisma.attempt.findMany.mockRejectedValue(new Error('Unknown argument `userId`'));
    await expect(collect(prisma)).rejects.toThrow('userId');
  });
});
