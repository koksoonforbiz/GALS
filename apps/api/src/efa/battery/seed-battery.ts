/**
 * Idempotent seed of the frozen EF battery (mirrors import-prompting-course.ts):
 *  - stimulus set keyed by battery version + stimuli.json sha256. Same hash → no-op.
 *    A different hash for an already-seeded version is refused unless `force`.
 *  - allocation slots upserted by slot. A changed, already-seeded slot is refused
 *    unless `force` (and never if it is claimed); new slots are appended (`extend`).
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { BatteryFiles } from './battery-files';

export interface SeedOptions {
  force?: boolean;
  dryRun?: boolean;
}

export interface SeedReport {
  stimulusSet: 'created' | 'unchanged' | 'replaced';
  slotsCreated: number;
  slotsUnchanged: number;
  slotsUpdated: number;
}

export async function seedBattery(
  prisma: PrismaClient,
  files: BatteryFiles,
  opts: SeedOptions = {},
): Promise<SeedReport> {
  const version = files.stimuli.meta.version;
  const report: SeedReport = {
    stimulusSet: 'unchanged',
    slotsCreated: 0,
    slotsUnchanged: 0,
    slotsUpdated: 0,
  };

  const sameVersion = await prisma.efaStimulusSet.findMany({ where: { batteryVersion: version } });
  const exact = sameVersion.find((s) => s.sha256 === files.stimuliSha256);
  const other = sameVersion.filter((s) => s.sha256 !== files.stimuliSha256);
  if (other.length && !opts.force) {
    throw new Error(
      `battery ${version} is already seeded with a different stimuli.json (sha256 ${other[0]!.sha256.slice(0, 12)}…, ` +
        `file ${files.stimuliSha256.slice(0, 12)}…). Refusing; pass --force only if the change is intended.`,
    );
  }
  if (exact && exact.extrasSha256 !== files.extrasSha256 && !opts.force) {
    throw new Error(
      `battery-extras.json changed since battery ${version} was seeded. Refusing; pass --force only if intended.`,
    );
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (!exact) {
    report.stimulusSet = other.length ? 'replaced' : 'created';
    ops.push(
      prisma.efaStimulusSet.create({
        data: {
          batteryVersion: version,
          sha256: files.stimuliSha256,
          data: files.stimuli as unknown as Prisma.InputJsonValue,
          extras: files.extras as unknown as Prisma.InputJsonValue,
          extrasSha256: files.extrasSha256,
        },
      }),
    );
  } else if (exact.extrasSha256 !== files.extrasSha256) {
    report.stimulusSet = 'replaced';
    ops.push(
      prisma.efaStimulusSet.update({
        where: { id: exact.id },
        data: {
          extras: files.extras as unknown as Prisma.InputJsonValue,
          extrasSha256: files.extrasSha256,
        },
      }),
    );
  }

  const existing = new Map((await prisma.efaAllocationSlot.findMany()).map((s) => [s.slot, s]));
  for (const row of files.allocation) {
    const cur = existing.get(row.slot);
    if (!cur) {
      report.slotsCreated++;
      ops.push(prisma.efaAllocationSlot.create({ data: row }));
      continue;
    }
    const same =
      cur.block === row.block &&
      cur.orderCode === row.orderCode &&
      cur.t0 === row.t0 &&
      cur.t1 === row.t1 &&
      cur.t2 === row.t2;
    if (same) {
      report.slotsUnchanged++;
      continue;
    }
    if (cur.claimedAt) {
      throw new Error(
        `allocation slot ${row.slot} is already claimed and differs from allocation.csv; refusing.`,
      );
    }
    if (!opts.force) {
      throw new Error(
        `allocation slot ${row.slot} differs from allocation.csv; refusing without --force.`,
      );
    }
    report.slotsUpdated++;
    ops.push(prisma.efaAllocationSlot.update({ where: { slot: row.slot }, data: row }));
  }

  if (!opts.dryRun && ops.length) await prisma.$transaction(ops);
  return report;
}
