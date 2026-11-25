/**
 * Seed: LOCAL fixture for the camera guard browser test
 * (e2e/camera-guard.e2e.spec.ts).
 *
 * OPT-IN ONLY. Run `pnpm run seed:efa-e2e-local` first (it writes
 * E2E_COURSE_ID to apps/api/.env.efa-e2e.local). This turns webcam
 * recording on for that course, so the puzzles page records the webcam and
 * the camera guard runs.
 *
 *   pnpm run seed:camera-e2e-local
 *
 * Refuses to run when NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-camera-e2e-local refuses to run with NODE_ENV=production');
  process.exit(1);
}

const prisma = new PrismaClient();
const ENV = path.resolve(__dirname, '../../.env.efa-e2e.local');

async function main() {
  const m = /^E2E_COURSE_ID=(.+)$/m.exec(fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '');
  if (!m) throw new Error(`E2E_COURSE_ID not found in ${ENV}: run seed:efa-e2e-local first`);
  const courseId = m[1]!.trim();
  // --off: switch it off again (other e2e suites run without a camera).
  const on = !process.argv.includes('--off');
  await prisma.recordingConfig.upsert({
    where: { courseId },
    create: { courseId, isEnabled: on },
    update: { isEnabled: on },
  });
  console.log(`webcam recording ${on ? 'enabled' : 'disabled'} for course ${courseId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
