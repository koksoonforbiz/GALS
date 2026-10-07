/**
 * Import the prompting course (course_slides.html) as native GALS content.
 *
 * One Course → one CourseModule per session → one INTERACTIVE_LESSON
 * ModuleItem per module, whose `lessonJson` is the session's slide deck
 * (see packages/shared/src/interactive-lesson.ts and
 * docs/process-mining/PHASE0_DISCOVERY.md).
 *
 * Idempotent: re-running updates the same course/modules/items in place.
 * Slide keys are FROZEN — a re-import that would change the type of an
 * existing key, or remove one, is refused (existing logs would silently
 * re-point) unless --force-key-drift is passed. Content edits at a stable
 * key are reported and applied.
 *
 *   pnpm run import:prompting-course -- --teacher-email t@example.edu \
 *     [--file ../../docs/process-mining/course_slides.html] \
 *     [--course-id <uuid>] [--publish] [--enroll <email|loginId> ...] \
 *     [--force-key-drift] [--dry-run]
 *
 * Creates no accounts. The teacher (and any --enroll students) must exist.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import type { LessonDocument } from '@ats/shared';
import {
  diffLessonKeys,
  isBreakingDrift,
  parseCourseHtml,
} from '../../src/interactive-lesson/course-html-parser';

interface Options {
  file: string;
  teacherEmail: string;
  courseId?: string;
  publish: boolean;
  enroll: string[];
  forceKeyDrift: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    file: path.resolve(__dirname, '../../../../docs/process-mining/course_slides.html'),
    teacherEmail: '',
    publish: false,
    enroll: [],
    forceKeyDrift: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--file') opts.file = path.resolve(next());
    else if (a === '--teacher-email') opts.teacherEmail = next();
    else if (a === '--course-id') opts.courseId = next();
    else if (a === '--publish') opts.publish = true;
    else if (a === '--enroll') opts.enroll.push(next());
    else if (a === '--force-key-drift') opts.forceKeyDrift = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--') continue;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!opts.teacherEmail) throw new Error('--teacher-email is required');
  return opts;
}

function moduleTitle(doc: LessonDocument): string {
  return doc.session.appendix
    ? `Appendix: ${doc.session.title}`
    : `Session ${doc.session.id}: ${doc.session.title}`;
}

function learningOutcomes(doc: LessonDocument): string[] {
  const obj = doc.slides.find((s) => s.t === 'objectives');
  return Array.isArray(obj?.items) ? (obj!.items as unknown[]).map(String) : [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const html = fs.readFileSync(opts.file, 'utf8');
    const parsed = parseCourseHtml(html, path.basename(opts.file));
    console.log(
      `Parsed "${parsed.title}": ${parsed.sessions.length} sessions, sha256 ${parsed.sourceSha256.slice(0, 12)}…`,
    );

    const teacher = await prisma.user.findUnique({ where: { email: opts.teacherEmail } });
    if (!teacher || (teacher.role !== 'teacher' && teacher.role !== 'admin')) {
      throw new Error(`No teacher/admin with email ${opts.teacherEmail}`);
    }

    let course = opts.courseId
      ? await prisma.course.findUnique({ where: { id: opts.courseId } })
      : await prisma.course.findFirst({
          where: { teacherId: teacher.id, title: parsed.title, archivedAt: null },
        });
    if (course && course.teacherId !== teacher.id) {
      throw new Error(`Course ${course.id} is not owned by ${opts.teacherEmail}`);
    }

    const existingModules = course
      ? await prisma.courseModule.findMany({
          where: { courseId: course.id },
          include: { items: { where: { type: 'INTERACTIVE_LESSON' } } },
        })
      : [];

    // ── Frozen-key check before writing anything ─────────────────────
    let breaking = false;
    for (const doc of parsed.sessions) {
      const mod = existingModules.find((m) => m.orderIndex === doc.session.id - 1);
      const prev = mod?.items[0]?.lessonJson as unknown as LessonDocument | undefined;
      if (!prev) continue;
      const drift = diffLessonKeys(prev, doc);
      if (drift.length) {
        console.log(
          `  Session ${doc.session.id}: ${drift.map((d) => `${d.key} ${d.kind}${d.detail ? ` (${d.detail})` : ''}`).join(', ')}`,
        );
      }
      if (isBreakingDrift(drift)) breaking = true;
    }
    if (breaking && !opts.forceKeyDrift) {
      throw new Error(
        'Re-import would change or remove existing slide keys (see above). Logged events would re-point to different slides. Pass --force-key-drift only if no learner data exists for this course.',
      );
    }

    if (opts.dryRun) {
      console.log(
        `[dry-run] Would ${course ? `update course ${course.id}` : 'create a new course'} with ${parsed.sessions.length} modules.`,
      );
      return;
    }

    if (!course) {
      course = await prisma.course.create({
        data: {
          title: parsed.title,
          description:
            'Eight-session course on prompting large language models, imported from the study edition (course_slides.html). Interactive slides are read-only in the builder; re-import to change them.',
          teacherId: teacher.id,
        },
      });
      console.log(`Created course ${course.id}`);
    } else {
      console.log(`Updating course ${course.id}`);
    }
    if (opts.publish && course.status !== 'PUBLISHED') {
      course = await prisma.course.update({
        where: { id: course.id },
        data: { status: 'PUBLISHED', visibility: 'PUBLIC' },
      });
    }

    for (const doc of parsed.sessions) {
      const orderIndex = doc.session.id - 1;
      const title = moduleTitle(doc);
      let mod = existingModules.find((m) => m.orderIndex === orderIndex);
      if (!mod) {
        const created = await prisma.courseModule.create({
          data: { courseId: course.id, title, orderIndex },
        });
        mod = { ...created, items: [] };
      } else if (mod.title !== title) {
        await prisma.courseModule.update({ where: { id: mod.id }, data: { title } });
      }

      const data = {
        title: doc.session.title,
        lessonJson: doc as unknown as Prisma.InputJsonValue,
        learningOutcomes: learningOutcomes(doc),
        estimatedMinutes: doc.session.appendix ? null : 60,
      };
      const item = mod.items[0];
      if (item) {
        await prisma.moduleItem.update({ where: { id: item.id }, data });
      } else {
        await prisma.moduleItem.create({
          data: { ...data, moduleId: mod.id, type: 'INTERACTIVE_LESSON', orderIndex: 0 },
        });
      }
      console.log(`  ${title}: ${doc.slides.length} slides`);
    }

    for (const who of opts.enroll) {
      const student = await prisma.user.findFirst({
        where: { OR: [{ email: who }, { loginId: who }], role: 'student' },
      });
      if (!student) {
        console.warn(`  ! no student "${who}" — skipped enrolment`);
        continue;
      }
      await prisma.enrollment.upsert({
        where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
        update: { status: 'ACTIVE' },
        create: { studentId: student.id, courseId: course.id },
      });
      console.log(`  enrolled ${who}`);
    }
    console.log(`Done. Course id: ${course.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
