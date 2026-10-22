/**
 * Seed the frozen EF battery v2.0 (stimuli + allocation table) into the DB.
 * Idempotent; refuses a changed stimuli.json for an already-seeded version
 * unless --force (see src/efa/battery/seed-battery.ts).
 *
 *   pnpm run seed:ef-battery -- [--dir ../../docs/EF_battery_v2] [--force] [--dry-run]
 *
 * Production (lithium): run in a one-off api container with the battery
 * folder bind-mounted, e.g. `-v ~/gals/repo/docs/EF_battery_v2:/efa:ro … --dir /efa`.
 * Allocation can be extended by adding rows to allocation.csv and rerunning.
 */
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { loadBatteryFiles } from '../../src/efa/battery/battery-files';
import { seedBattery } from '../../src/efa/battery/seed-battery';

function parseArgs(argv: string[]) {
  const opts = {
    dir: path.resolve(__dirname, '../../../../docs/EF_battery_v2'),
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    else if (a === '--dir') opts.dir = path.resolve(argv[++i] ?? '');
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = loadBatteryFiles(opts.dir);
  console.log(
    `EF battery ${files.stimuli.meta.version}: stimuli sha256 ${files.stimuliSha256}, ` +
      `extras ${files.extrasSha256.slice(0, 12)}…, ${files.allocation.length} allocation rows`,
  );
  const prisma = new PrismaClient();
  try {
    const report = await seedBattery(prisma, files, { force: opts.force, dryRun: opts.dryRun });
    console.log(`${opts.dryRun ? '[dry-run] ' : ''}${JSON.stringify(report)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
