#!/usr/bin/env node
/**
 * studio-import <path-or-glob> [...more]
 * Bulk-import session bundles (folders or zips). One bad bundle never poisons
 * the rest of the batch.
 */
import { glob } from 'node:fs/promises';
import { importBundle } from './importer.js';

async function expand(patterns: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const p of patterns) {
    if (p.includes('*')) {
      try {
        for await (const match of glob(p)) out.add(match);
      } catch {
        out.add(p);
      }
    } else {
      out.add(p);
    }
  }
  return [...out];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: studio-import <bundle-path-or-glob> [...]');
    process.exit(1);
  }
  const paths = await expand(args);
  let ok = 0;
  let failed = 0;
  for (const path of paths) {
    const report = await importBundle(path);
    if (report.ok) {
      ok += 1;
      console.log(`✓ ${report.sessionId}  windows=${report.windows}  ${JSON.stringify(report.inserted)}`);
      if (report.warnings.length) console.log(`  warnings: ${report.warnings.join('; ')}`);
    } else {
      failed += 1;
      console.error(`✗ ${path}: ${report.errors.join('; ')}`);
    }
  }
  console.log(`\nimported ${ok} ok, ${failed} failed`);
  const { prisma } = await import('../prisma.js');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
