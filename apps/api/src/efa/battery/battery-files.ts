/**
 * Read and verify the frozen EF battery files (docs/EF_battery_v2):
 *   source/stimuli.json          — the source of truth (sha256 pinned per seed)
 *   source/allocation.csv        — counterbalancing rows
 *   derived/battery-extras.json  — ef.py constants not in stimuli.json
 * Pure apart from file reads, so the seed script and tests share it.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { EfaStimuli } from './stimuli.types';

export interface AllocationRow {
  slot: number;
  block: number;
  orderCode: string;
  t0: string;
  t1: string;
  t2: string;
}

export interface BatteryFiles {
  stimuli: EfaStimuli;
  stimuliSha256: string;
  extras: Record<string, unknown> & {
    stimuli_sha256: string;
    ef_sha256: string;
    batteryVersion: string;
  };
  extrasSha256: string;
  allocation: AllocationRow[];
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export function parseAllocationCsv(text: string): AllocationRow[] {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const header = lines.shift();
  if (header !== 'slot,block,order,T0,T1,T2')
    throw new Error(`unexpected allocation.csv header: ${header}`);
  return lines.map((line, i) => {
    const [slot, block, order, t0, t1, t2] = line.split(',');
    const row = {
      slot: Number(slot),
      block: Number(block),
      orderCode: order!,
      t0: t0!,
      t1: t1!,
      t2: t2!,
    };
    const forms = `${row.t0}${row.t1}${row.t2}`;
    if (
      !Number.isInteger(row.slot) ||
      forms !== row.orderCode ||
      new Set(forms).size !== 3 ||
      /[^ABC]/.test(forms)
    ) {
      throw new Error(`allocation.csv line ${i + 2} is invalid: ${line}`);
    }
    return row;
  });
}

/** Load and cross-check the three files. Throws on any inconsistency. */
export function loadBatteryFiles(dir: string): BatteryFiles {
  const stimuliRaw = fs.readFileSync(path.join(dir, 'source', 'stimuli.json'));
  const extrasRaw = fs.readFileSync(path.join(dir, 'derived', 'battery-extras.json'));
  const stimuli = JSON.parse(stimuliRaw.toString('utf8')) as EfaStimuli;
  const extras = JSON.parse(extrasRaw.toString('utf8')) as BatteryFiles['extras'];
  const stimuliSha256 = sha256(stimuliRaw);

  if (extras.stimuli_sha256 !== stimuliSha256) {
    throw new Error(
      'battery-extras.json was built from a different stimuli.json — rerun build_extras.py',
    );
  }
  if (extras.ef_sha256 !== stimuli.meta.code_sha256) {
    throw new Error('battery-extras.json ef.py hash does not match stimuli.json meta.code_sha256');
  }
  if (extras.batteryVersion !== stimuli.meta.version) {
    throw new Error(
      `version mismatch: extras ${extras.batteryVersion} vs stimuli ${stimuli.meta.version}`,
    );
  }

  const allocation = parseAllocationCsv(
    fs.readFileSync(path.join(dir, 'source', 'allocation.csv'), 'utf8'),
  );
  return { stimuli, stimuliSha256, extras, extrasSha256: sha256(extrasRaw), allocation };
}
