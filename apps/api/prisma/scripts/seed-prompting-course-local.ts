/**
 * Seed: LOCAL fixture accounts for trying the imported prompting course.
 *
 * OPT-IN ONLY — never runs at boot, in migrations or in tests. Creates
 *   - a teacher  prompting-teacher@gals.test
 *   - a student  prompting-student@gals.test  (loginId: prompting-student)
 * with freshly generated passwords, written to apps/api/.env.prompting-course.local
 * (git-ignored by the root `.env.*.local` rule) instead of the console.
 *
 * Then import and enrol:
 *   pnpm run seed:prompting-course-local
 *   pnpm run import:prompting-course -- --teacher-email prompting-teacher@gals.test \
 *     --publish --enroll prompting-student
 *
 * Refuses to run when NODE_ENV=production.
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-prompting-course-local refuses to run with NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient();
const OUT = path.resolve(__dirname, '../../.env.prompting-course.local');

function generatePassword(): string {
  // Meets the platform password policy: upper, lower, digit, symbol, ≥12.
  return `Pc${randomBytes(9).toString('base64url')}7!`;
}

async function upsertUser(
  email: string,
  name: string,
  role: 'teacher' | 'student',
  password: string,
  loginId?: string,
) {
  const now = new Date();
  const data = {
    passwordHash: await bcrypt.hash(password, 10),
    name,
    role,
    loginId: loginId ?? null,
    isTemporaryPassword: false,
    passwordChangedAt: now,
    termsAcceptedAt: now,
  };
  return prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data });
}

async function main() {
  const teacherPassword = generatePassword();
  const studentPassword = generatePassword();
  await upsertUser(
    'prompting-teacher@gals.test',
    'Prompting Course Teacher',
    'teacher',
    teacherPassword,
  );
  await upsertUser(
    'prompting-student@gals.test',
    'Prompting Course Student',
    'student',
    studentPassword,
    'prompting-student',
  );
  fs.writeFileSync(
    OUT,
    [
      '# Local-only fixture credentials (seed-prompting-course-local.ts). Do not commit.',
      'PROMPTING_TEACHER_EMAIL=prompting-teacher@gals.test',
      `PROMPTING_TEACHER_PASSWORD=${teacherPassword}`,
      'PROMPTING_STUDENT_LOGIN=prompting-student',
      `PROMPTING_STUDENT_PASSWORD=${studentPassword}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log(`Fixture accounts ready; credentials written to ${OUT}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
