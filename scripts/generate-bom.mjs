#!/usr/bin/env node
// Regenerates docs/bom.csv from the currently installed production
// dependency tree (checklist item 45 — bill of materials).
// Usage: pnpm bom

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');

// `shell: true` is required so Windows can resolve the `pnpm.cmd` shim;
// safe here since every argument is a fixed literal, never user input.
const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
  cwd: repoRoot,
  encoding: 'utf-8',
  shell: true,
});
const data = JSON.parse(raw);

const rows = [];
for (const [license, pkgs] of Object.entries(data)) {
  for (const p of pkgs) {
    rows.push({
      name: p.name,
      version: p.versions.join(' / '),
      license,
      homepage: p.homepage ?? '',
    });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [
  'name,version,license,homepage',
  ...rows.map((r) => [r.name, r.version, r.license, r.homepage].map(esc).join(',')),
].join('\n');

writeFileSync(path.join(repoRoot, 'docs', 'bom.csv'), csv);
console.log(`Wrote docs/bom.csv (${rows.length} production packages).`);
