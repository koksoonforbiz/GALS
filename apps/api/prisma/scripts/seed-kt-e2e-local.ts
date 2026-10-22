/**
 * Seed: LOCAL fixture for the knowledge-tests browser test
 * (e2e/knowledge-tests.e2e.spec.ts).
 *
 * OPT-IN ONLY. Run `pnpm run seed:efa-e2e-local` first (it creates the
 * fixture teacher and student and writes their passwords). This adds a
 * published course "Knowledge tests e2e course" with Sessions 1–8 + an
 * appendix (one two-slide lesson each), the EF warm-up gates (T0 before
 * Session 1, T2 after the appendix), the item bank, the 18 knowledge-test
 * gates, and enrols the student. Appends E2E_KT_COURSE_ID to
 * apps/api/.env.efa-e2e.local.
 *
 *   pnpm run seed:kt-e2e-local [-- --reset] [-- --warmup-done]
 *
 * --reset        deletes the student's knowledge-test data and gate passes
 * --warmup-done  marks the T0 warm-up gates passed (skips the 10-minute puzzles)
 *
 * Refuses to run when NODE_ENV=production.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { bankDefinitions, type BankFile } from '../../src/knowledge-tests/bank';
import { KT_GATE_SEQUENCE } from '../../src/knowledge-tests/knowledge-test-admin.service';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-kt-e2e-local refuses to run with NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient();
const ENV = path.resolve(__dirname, '../../.env.efa-e2e.local');
const BANK = path.resolve(__dirname, '../../../../docs/assessment/knowledge_tests_v2.json');
const COURSE_TITLE = 'Knowledge tests e2e course';

async function main() {
  const reset = process.argv.includes('--reset');
  const warmupDone = process.argv.includes('--warmup-done');
  const teacher = await prisma.user.findUnique({ where: { email: 'efa-teacher@gals.test' } });
  const student = await prisma.user.findUnique({ where: { email: 'efa-student@gals.test' } });
  if (!teacher || !student) throw new Error('Run pnpm run seed:efa-e2e-local first');

  let course = await prisma.course.findFirst({
    where: { teacherId: teacher.id, title: COURSE_TITLE },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        title: COURSE_TITLE,
        description: 'Local browser-test fixture',
        teacherId: teacher.id,
        status: 'PUBLISHED',
      },
    });
    const modules: string[] = [];
    for (let n = 1; n <= 9; n++) {
      const m = await prisma.courseModule.create({
        data: {
          courseId: course.id,
          title: n <= 8 ? `Session ${n}: fixture` : 'Appendix: references',
          orderIndex: n - 1,
        },
      });
      modules.push(m.id);
      await prisma.moduleItem.create({
        data: {
          moduleId: m.id,
          title: n <= 8 ? `Session ${n} lesson` : 'Appendix',
          type: 'INTERACTIVE_LESSON',
          orderIndex: 0,
          lessonJson: {
            version: 1,
            session: n,
            slides: [
              { key: `s${n}-1`, t: 'title', title: `Session ${n}` },
              {
                key: `s${n}-2`,
                t: 'reflect',
                prompts: ['What worked?', 'What to change?', 'Next task?'],
              },
            ],
          } as Prisma.InputJsonValue,
        },
      });
    }
    for (const [kind, occasion, position, moduleId, sequence] of [
      ['EF_QUESTIONNAIRE', 'T0', 'BEFORE_MODULE', modules[0], 10],
      ['EF_TESTS', 'T0', 'BEFORE_MODULE', modules[0], 20],
      ['EF_QUESTIONNAIRE', 'T2', 'AFTER_MODULE', modules[8], 910],
      ['EF_TESTS', 'T2', 'AFTER_MODULE', modules[8], 920],
    ] as const) {
      await prisma.courseGate.create({
        data: { courseId: course.id, kind, occasion, position, moduleId: moduleId!, sequence },
      });
    }
    const bank = JSON.parse(fs.readFileSync(BANK, 'utf8')) as BankFile;
    for (const d of bankDefinitions(bank)) {
      await prisma.knowledgeTestDefinition.create({
        data: {
          courseId: course.id,
          scope: d.scope,
          sessionNo: d.sessionNo,
          form: d.form,
          version: d.version,
          items: d.items as never,
          maxMarks: d.maxMarks,
        },
      });
    }
    const gate = (
      occasion: string,
      position: 'BEFORE_MODULE' | 'AFTER_MODULE',
      n: number,
      sequence: number,
    ) =>
      prisma.courseGate.create({
        data: {
          courseId: course!.id,
          kind: 'KNOWLEDGE_TEST',
          occasion,
          position,
          moduleId: modules[n - 1]!,
          sequence,
        },
      });
    await gate('PRE_STUDY', 'BEFORE_MODULE', 1, KT_GATE_SEQUENCE.PRE_STUDY);
    await gate('POST_STUDY', 'AFTER_MODULE', 8, KT_GATE_SEQUENCE.POST_STUDY);
    for (let n = 1; n <= 8; n++) {
      await gate(`S${n}_PRE`, 'BEFORE_MODULE', n, KT_GATE_SEQUENCE.PRE_SESSION);
      await gate(`S${n}_POST`, 'AFTER_MODULE', n, KT_GATE_SEQUENCE.POST_SESSION);
    }
  }
  await prisma.enrollment.upsert({
    where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
    create: { studentId: student.id, courseId: course.id, status: 'ACTIVE' },
    update: { status: 'ACTIVE' },
  });

  if (reset) {
    await prisma.knowledgeTestAssignment.deleteMany({
      where: { studentId: student.id, courseId: course.id },
    });
    await prisma.studentGateCompletion.deleteMany({
      where: { studentId: student.id, gate: { courseId: course.id } },
    });
    await prisma.lessonSlideState.deleteMany({
      where: { studentId: student.id, moduleItem: { module: { courseId: course.id } } },
    });
  }
  if (warmupDone) {
    for (const g of await prisma.courseGate.findMany({
      where: { courseId: course.id, occasion: 'T0' },
    })) {
      await prisma.studentGateCompletion.upsert({
        where: { gateId_studentId: { gateId: g.id, studentId: student.id } },
        create: { gateId: g.id, studentId: student.id, source: 'override', reason: 'e2e fixture' },
        update: {},
      });
    }
  }

  const env = fs.existsSync(ENV)
    ? fs.readFileSync(ENV, 'utf8').replace(/^E2E_KT_COURSE_ID=.*\n?/m, '')
    : '';
  fs.writeFileSync(ENV, `${env.trimEnd()}\nE2E_KT_COURSE_ID=${course.id}\n`);
  console.log(
    `Fixture ready: course ${course.id}${reset ? ' (student reset)' : ''}${warmupDone ? ' (warm-up passed)' : ''}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
