/**
 * Seed: LOCAL fixture for the study-notes browser test
 * (e2e/study-notes.e2e.spec.ts).
 *
 * OPT-IN ONLY. Run `pnpm run seed:efa-e2e-local` first (it creates the
 * fixture teacher and student). This (re)creates a published course
 * "Notes e2e course" with two sessions, each a three-slide lesson with
 * theory slides of known text, no course gates, and enrols the student.
 * Appends E2E_NOTES_COURSE_ID to apps/api/.env.efa-e2e.local.
 *
 *   pnpm run seed:notes-e2e-local
 *
 * Refuses to run when NODE_ENV=production.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-notes-e2e-local refuses to run with NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient();
const ENV = path.resolve(__dirname, '../../.env.efa-e2e.local');
const TITLE = 'Notes e2e course';

function lesson(n: number): Prisma.InputJsonValue {
  return {
    schemaVersion: 1,
    source: { file: 'notes-e2e-fixture', sha256: 'fixture', importedAt: '2026-11-24T00:00:00Z' },
    session: {
      id: n,
      title: `Notes fixture ${n}`,
      covers: '',
      bigq: '',
      core: [],
      appendix: false,
    },
    slides: [
      { key: `n${n}-0`, t: 'title', contentHash: `n${n}-0`, heading: `Session ${n}` },
      {
        key: `n${n}-1`,
        t: 'theory',
        contentHash: `n${n}-1`,
        heading: 'Why prompts fail',
        html:
          '<p>A prompt fails when the model has to guess the goal, the audience or the format.</p>' +
          '<p>Short prompts are not the problem. Missing context is the problem.</p>',
      },
      {
        key: `n${n}-2`,
        t: 'theory',
        contentHash: `n${n}-2`,
        heading: 'Context first',
        html: '<p>Give the model the context a new colleague would need on their first day.</p>',
      },
    ],
  };
}

async function main() {
  const teacher = await prisma.user.findUnique({ where: { email: 'efa-teacher@gals.test' } });
  const student = await prisma.user.findUnique({ where: { email: 'efa-student@gals.test' } });
  if (!teacher || !student) throw new Error('Run pnpm run seed:efa-e2e-local first');

  await prisma.course.deleteMany({ where: { teacherId: teacher.id, title: TITLE } });
  const course = await prisma.course.create({
    data: {
      title: TITLE,
      description: 'Local browser-test fixture',
      teacherId: teacher.id,
      status: 'PUBLISHED',
    },
  });
  for (let n = 1; n <= 2; n++) {
    const m = await prisma.courseModule.create({
      data: { courseId: course.id, title: `Session ${n}: notes fixture`, orderIndex: n - 1 },
    });
    await prisma.moduleItem.create({
      data: {
        moduleId: m.id,
        title: `Session ${n} lesson`,
        type: 'INTERACTIVE_LESSON',
        orderIndex: 0,
        lessonJson: lesson(n),
      },
    });
  }
  await prisma.enrollment.create({
    data: { studentId: student.id, courseId: course.id, status: 'ACTIVE' },
  });

  const env = fs.existsSync(ENV)
    ? fs.readFileSync(ENV, 'utf8').replace(/^E2E_NOTES_COURSE_ID=.*\n?/m, '')
    : '';
  fs.writeFileSync(ENV, `${env.trimEnd()}\nE2E_NOTES_COURSE_ID=${course.id}\n`);
  console.log(`Notes e2e course: ${course.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
