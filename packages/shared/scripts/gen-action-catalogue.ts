/**
 * Writes docs/process-mining/ACTION_CATALOGUE.md from src/action-catalogue.ts
 * (Prompt B, B1). Never edit the Markdown by hand.
 *
 *   pnpm --filter @ats/shared run gen:catalogue
 *
 * `--check` exits 1 when the committed file is out of date (used in CI).
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  ACTION_CATALOGUE,
  LIBRARY_VOCABULARY,
  type ActionSpec,
  type MetaType,
} from '../src/action-catalogue';

const OUT = resolve(__dirname, '../../../docs/process-mining/ACTION_CATALOGUE.md');

function fields(f?: Record<string, MetaType>): string {
  if (!f || Object.keys(f).length === 0) return '';
  return Object.entries(f)
    .map(([k, t]) => `\`${k}\`${t === 'any' ? '' : `: ${t}`}`)
    .join(', ');
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function render(): string {
  const entries = Object.entries(ACTION_CATALOGUE as Record<string, ActionSpec>);
  const bySurface = new Map<string, Array<[string, ActionSpec]>>();
  for (const e of entries) {
    const k = e[1].surface;
    bySurface.set(k, [...(bySurface.get(k) ?? []), e]);
  }
  const out: string[] = [];
  out.push('# Action catalogue');
  out.push('');
  out.push(
    '_Generated from `packages/shared/src/action-catalogue.ts` by `pnpm --filter @ats/shared run gen:catalogue`. Do not edit by hand._',
  );
  out.push('');
  const live = entries.filter(([, s]) => !s.deprecated).length;
  out.push(
    `${entries.length} platform actions (${live} with an emitter, ${entries.length - live} deprecated), plus ${Object.keys(LIBRARY_VOCABULARY).length} library v2 terms that are realised by other actions or not emitted.`,
  );
  out.push('');
  out.push(
    'Level: **ACT** learner action · **SYS** system · **QUALITY** capture health · **REF** reference outcome. Side: who writes it. Text fields hold free text (recorded; consent is on the study consent form). Required and optional metadata keys with their JSON type; other keys are allowed.',
  );
  for (const [surface, list] of [...bySurface].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push('');
    out.push(`## ${surface}`);
    out.push('');
    out.push(
      '| Action | Level | Side | Kind | Text fields | Required metadata | Optional metadata |',
    );
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const [a, s] of list.sort((x, y) => x[0].localeCompare(y[0]))) {
      const name = s.deprecated ? `~~${a}~~ (deprecated)` : `\`${a}\``;
      out.push(
        `| ${name} | ${s.level} | ${s.side} | ${s.kind} | ${cell((s.textFields ?? []).map((t) => `\`${t}\``).join(', '))} | ${cell(fields(s.required))} | ${cell(fields(s.optional))} |`,
      );
    }
  }
  out.push('');
  out.push('## Library v2 terms not emitted under their own name');
  out.push('');
  out.push('| Library term | Status | Realised as / note |');
  out.push('| --- | --- | --- |');
  for (const [a, v] of Object.entries(LIBRARY_VOCABULARY)) {
    out.push(
      `| \`${a}\` | ${v.status === 'renamed' ? 'renamed' : 'not emitted'} | ${cell(v.realisedAs)} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

if (require.main === module) {
  const md = render();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      // missing
    }
    if (current.replace(/\r\n/g, '\n') !== md) {
      console.error(`${OUT} is out of date: run pnpm --filter @ats/shared run gen:catalogue`);
      process.exit(1);
    }
    console.log('ACTION_CATALOGUE.md is up to date');
  } else {
    writeFileSync(OUT, md);
    console.log(`wrote ${OUT}`);
  }
}
