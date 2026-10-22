import type { PrismaService } from '../prisma';

/**
 * Session N of a course = the module titled "Session N…" (the prompting
 * course import names them so). Its lesson is the module's first
 * INTERACTIVE_LESSON item; the lesson counts as finished once the student
 * has saved its reflect slide (or, without one, its last slide).
 */
export interface CourseSession {
  sessionNo: number;
  moduleId: string;
  lessonItemId: string | null;
  finalSlideKey: string | null;
}

const SESSION_TITLE = /^\s*Session\s+(\d+)\b/i;

export async function courseSessions(
  prisma: PrismaService,
  courseId: string,
): Promise<CourseSession[]> {
  const modules = await prisma.courseModule.findMany({
    where: { courseId },
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      title: true,
      items: {
        where: { type: 'INTERACTIVE_LESSON' },
        orderBy: { orderIndex: 'asc' },
        take: 1,
        select: { id: true, lessonJson: true },
      },
    },
  });
  const out: CourseSession[] = [];
  for (const m of modules) {
    const n = Number(SESSION_TITLE.exec(m.title)?.[1]);
    if (!n || n > 8 || out.some((s) => s.sessionNo === n)) continue;
    const lesson = m.items[0];
    const slides =
      (lesson?.lessonJson as { slides?: Array<{ key: string; t: string }> } | null)?.slides ?? [];
    const reflect = [...slides].reverse().find((s) => s.t === 'reflect');
    out.push({
      sessionNo: n,
      moduleId: m.id,
      lessonItemId: lesson?.id ?? null,
      finalSlideKey: (reflect ?? slides[slides.length - 1])?.key ?? null,
    });
  }
  return out.sort((a, b) => a.sessionNo - b.sessionNo);
}
