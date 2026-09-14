/**
 * Seed: two-door LOCAL click-through fixture (docs/two-door/, Phase 3).
 *
 * OPT-IN ONLY — never runs as part of boot, migrations, or tests. Creates
 * the minimum needed to walk both doors end to end:
 *
 *   1. a teacher      twodoor-teacher@gals.test
 *   2. a student      twodoor-student@gals.test   (loginId: twodoor-student)
 *   3. a PUBLISHED course owned by the teacher, with one module holding a
 *      real (tiny, generated) PDF uploaded to MinIO — so the student door's
 *      /api/items/:id/download-url → /s3/... path is exercised for real
 *   4. an ACTIVE enrollment of the student in that course
 *
 * Passwords are generated fresh on every run and printed once; nothing is
 * hardcoded. Re-running is idempotent for everything except the password
 * (which is rotated and printed again).
 *
 * Run INSIDE the api container of the two-door stack (MinIO/Postgres are
 * not published to the host there):
 *
 *   ./deploy/scripts/twodoor.sh local exec api pnpm run seed:twodoor
 *
 * Options:
 *   --student-temp-password   mark the student's password temporary, so the
 *                             first login forces /change-password (the real
 *                             provisioning flow)
 *   --dry-run                 print what would happen, touch nothing
 *
 * Refuses to run when NODE_ENV=production.
 */

import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STUDENT_TEMP_PASSWORD = args.includes('--student-temp-password');

const TEACHER_EMAIL = 'twodoor-teacher@gals.test';
const STUDENT_EMAIL = 'twodoor-student@gals.test';
const STUDENT_LOGIN_ID = 'twodoor-student';
const COURSE_TITLE = 'Two-Door Smoke Course';
const MODULE_TITLE = 'Module 1 — Reading';
const PDF_FILENAME = 'two-door-smoke.pdf';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-twodoor-local refuses to run with NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (set in the api container environment)`);
  return v;
}

/** URL-safe random password that satisfies the app's complexity rule (upper, lower, digit, symbol). */
function generatePassword(): string {
  const body = randomBytes(12).toString('base64url');
  return `Gals-${body}-7a`;
}

/**
 * A minimal, valid single-page PDF with one line of text. Offsets in the
 * xref table are computed, not hand-typed, so the file opens in pdf.js.
 */
function buildTinyPdf(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function upsertUser(opts: {
  email: string;
  loginId?: string;
  name: string;
  role: 'teacher' | 'student';
  password: string;
  temporary: boolean;
}) {
  const passwordHash = await bcrypt.hash(opts.password, 10);
  const now = new Date();
  const data = {
    passwordHash,
    name: opts.name,
    role: opts.role,
    loginId: opts.loginId ?? null,
    isTemporaryPassword: opts.temporary,
    passwordChangedAt: now,
    termsAcceptedAt: now,
  };
  return prisma.user.upsert({
    where: { email: opts.email },
    create: { email: opts.email, ...data },
    update: data,
  });
}

async function main() {
  const teacherPassword = generatePassword();
  const studentPassword = generatePassword();

  console.log(
    `[seed-twodoor] ${DRY_RUN ? 'DRY RUN — ' : ''}NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`,
  );
  console.log(`[seed-twodoor] teacher ${TEACHER_EMAIL}`);
  console.log(
    `[seed-twodoor] student ${STUDENT_EMAIL} (loginId ${STUDENT_LOGIN_ID})${STUDENT_TEMP_PASSWORD ? ' — temporary password' : ''}`,
  );
  console.log(`[seed-twodoor] course  "${COURSE_TITLE}" → "${MODULE_TITLE}" → PDF ${PDF_FILENAME}`);
  if (DRY_RUN) return;

  // ---- users --------------------------------------------------------------
  const teacher = await upsertUser({
    email: TEACHER_EMAIL,
    name: 'Two-Door Teacher',
    role: 'teacher',
    password: teacherPassword,
    temporary: false,
  });
  const student = await upsertUser({
    email: STUDENT_EMAIL,
    loginId: STUDENT_LOGIN_ID,
    name: 'Two-Door Student',
    role: 'student',
    password: studentPassword,
    temporary: STUDENT_TEMP_PASSWORD,
  });

  // ---- course + module ----------------------------------------------------
  let course = await prisma.course.findFirst({
    where: { title: COURSE_TITLE, teacherId: teacher.id },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        title: COURSE_TITLE,
        description: 'Local two-door click-through fixture. Safe to delete.',
        teacherId: teacher.id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
      },
    });
  } else if (course.status !== 'PUBLISHED') {
    course = await prisma.course.update({
      where: { id: course.id },
      data: { status: 'PUBLISHED' },
    });
  }

  let courseModule = await prisma.courseModule.findFirst({
    where: { courseId: course.id, title: MODULE_TITLE },
  });
  if (!courseModule) {
    courseModule = await prisma.courseModule.create({
      data: { courseId: course.id, title: MODULE_TITLE, orderIndex: 0 },
    });
  }

  // ---- PDF item: upload to MinIO, then record the key (same key layout
  // as ItemsService.getUploadUrl so download-url works unchanged) --------
  let pdfItem = await prisma.moduleItem.findFirst({
    where: { moduleId: courseModule.id, type: 'PDF', title: 'Course reading (PDF)' },
  });
  if (!pdfItem) {
    pdfItem = await prisma.moduleItem.create({
      data: {
        id: randomUUID(),
        moduleId: courseModule.id,
        type: 'PDF',
        title: 'Course reading (PDF)',
        orderIndex: 0,
      },
    });
  }

  const bucket = requireEnv('BLOB_STORAGE_BUCKET');
  const s3 = new S3Client({
    endpoint: requireEnv('BLOB_STORAGE_ENDPOINT'),
    region: process.env.BLOB_STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: requireEnv('BLOB_STORAGE_ACCESS_KEY'),
      secretAccessKey: requireEnv('BLOB_STORAGE_SECRET_KEY'),
    },
    forcePathStyle: true,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }

  const pdf = buildTinyPdf(
    'GALS two-door smoke test: this PDF came through nginx /s3/ from MinIO.',
  );
  const key = `course-materials/${course.id}/${pdfItem.id}/${PDF_FILENAME}`;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: pdf, ContentType: 'application/pdf' }),
  );
  pdfItem = await prisma.moduleItem.update({
    where: { id: pdfItem.id },
    data: { pdfBlobKey: key, pdfFilename: PDF_FILENAME, pdfSize: pdf.byteLength },
  });

  // ---- enrollment ---------------------------------------------------------
  await prisma.enrollment.upsert({
    where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
    create: { studentId: student.id, courseId: course.id, status: 'ACTIVE' },
    update: { status: 'ACTIVE' },
  });

  console.log('');
  console.log('[seed-twodoor] done. Credentials (printed once — passwords rotate on every run):');
  console.log(`  teacher  ${TEACHER_EMAIL}   ${teacherPassword}`);
  console.log(`  student  ${STUDENT_LOGIN_ID} (or ${STUDENT_EMAIL})   ${studentPassword}`);
  console.log('');
  console.log('  ids:');
  console.log(`    course   ${course.id}`);
  console.log(`    module   ${courseModule.id}`);
  console.log(`    pdfItem  ${pdfItem.id}   s3 key ${key}`);
}

main()
  .catch((err) => {
    console.error('[seed-twodoor] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
