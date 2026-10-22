/**
 * Seed + allocation against the real test DB (Postgres row locks can't be
 * mocked). Touches only efa_stimulus_sets and efa_allocation_slots, and only
 * on a database whose name ends in `_test`.
 */
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { loadBatteryFiles } from './battery/battery-files';
import { seedBattery } from './battery/seed-battery';
import { EfaAllocationService, formFor } from './allocation.service';

const DIR = path.resolve(__dirname, '../../../../docs/EF_battery_v2');
const prisma = new PrismaClient();
const allocation = new EfaAllocationService(prisma as never);
const files = loadBatteryFiles(DIR);

async function wipe() {
  if (process.env.NODE_ENV !== 'test' || !/_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('refusing to wipe: not a *_test database');
  }
  await prisma.efaAllocationSlot.deleteMany();
  await prisma.efaStimulusSet.deleteMany();
}

beforeAll(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('seedBattery', () => {
  it('creates the stimulus set and 60 slots, then is a no-op on rerun', async () => {
    expect(await seedBattery(prisma, files)).toEqual({
      stimulusSet: 'created',
      slotsCreated: 60,
      slotsUnchanged: 0,
      slotsUpdated: 0,
    });
    expect(await seedBattery(prisma, files)).toEqual({
      stimulusSet: 'unchanged',
      slotsCreated: 0,
      slotsUnchanged: 60,
      slotsUpdated: 0,
    });
    const set = await prisma.efaStimulusSet.findFirstOrThrow();
    expect(set.sha256).toBe(files.stimuliSha256);
    expect((set.data as { meta: { version: string } }).meta.version).toBe('2.0');
  });

  it('refuses a different stimuli.json for the same version unless forced', async () => {
    const tampered = { ...files, stimuliSha256: 'f'.repeat(64) };
    await expect(seedBattery(prisma, tampered)).rejects.toThrow(/different stimuli\.json/);
    expect(await prisma.efaStimulusSet.count()).toBe(1);
  });

  it('refuses a changed allocation row unless forced', async () => {
    const changed = {
      ...files,
      allocation: files.allocation.map((r) =>
        r.slot === 60 ? { ...r, orderCode: 'ABC', t0: 'A', t1: 'B', t2: 'C' } : r,
      ),
    };
    if (files.allocation[59]!.orderCode === 'ABC') return; // nothing to change
    await expect(seedBattery(prisma, changed)).rejects.toThrow(/slot 60 differs/);
  });

  it('appends new allocation rows (staff extension)', async () => {
    const extended = {
      ...files,
      allocation: [
        ...files.allocation,
        { slot: 61, block: 11, orderCode: 'ABC', t0: 'A', t1: 'B', t2: 'C' },
      ],
    };
    expect((await seedBattery(prisma, extended)).slotsCreated).toBe(1);
    await prisma.efaAllocationSlot.delete({ where: { slot: 61 } });
  });
});

describe('EfaAllocationService', () => {
  const course = randomUUID();

  it('20 concurrent first starts get 20 distinct slots, in slot order', async () => {
    const students = Array.from({ length: 20 }, () => randomUUID());
    const claims = await Promise.all(students.map((s) => allocation.claim(s, course)));
    const slots = claims.map((c) => c!.slot);
    expect(new Set(slots).size).toBe(20);
    expect([...slots].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const claimed = await prisma.efaAllocationSlot.count({ where: { claimedCourseId: course } });
    expect(claimed).toBe(20);
  });

  it('a student who already has a slot gets the same one back', async () => {
    const s = randomUUID();
    const first = await allocation.claim(s, course);
    const again = await allocation.claim(s, course);
    expect(again).toEqual(first);
  });

  it('maps the order to forms per occasion', async () => {
    const slot = { slot: 1, orderCode: 'BCA', t0: 'B', t1: 'C', t2: 'A' };
    expect(['T0', 'T1', 'T2'].map((o) => formFor(slot, o as 'T0'))).toEqual(['B', 'C', 'A']);
  });

  it('returns null when the table is exhausted', async () => {
    const free = await prisma.efaAllocationSlot.count({ where: { claimedAt: null } });
    await Promise.all(Array.from({ length: free }, () => allocation.claim(randomUUID(), course)));
    expect(await allocation.claim(randomUUID(), course)).toBeNull();
  });
});
