#!/usr/bin/env node
/**
 * studio-analyze — recompute + export all analysis for a scope, headless.
 *
 *   studio-analyze --scope <sessionId|all> --out ./analysis-out
 *
 * Writes long-format, gold, reliability, summary, probes, questionnaires CSVs
 * so any number in the dashboards is reproducible without the UI.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXPORTERS } from './export.js';
import { computeReliability } from './compute.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let scope = 'all';
  let out = './analysis-out';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope') scope = args[++i];
    else if (args[i] === '--out') out = args[++i];
  }
  await mkdir(out, { recursive: true });

  for (const [kind, fn] of Object.entries(EXPORTERS)) {
    const data = await fn(scope);
    const path = join(out, `${kind}_${scope}.csv`);
    await writeFile(path, data);
    console.log(`✓ ${path} (${data.split('\n').length - 1} rows)`);
  }

  for (const dim of ['affect', 'behavior']) {
    const rel = await computeReliability(scope, dim);
    console.log(`\n${dim}: κ=${rel.kappa.toFixed(3)}  PABAK=${rel.pabak.toFixed(3)}  α=${rel.krippendorffAlpha.toFixed(3)}  agreement=${(rel.percentAgreement * 100).toFixed(1)}%  N=${rel.nWindows}${rel.cautionHighKappa ? '  ⚠ κ>0.85 caution' : ''}`);
  }

  const { prisma } = await import('../prisma.js');
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
