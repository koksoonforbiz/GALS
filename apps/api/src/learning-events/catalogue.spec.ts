/**
 * The action catalogue is the source of truth (Prompt B, B1). These checks
 * fail when code, the database enum or the library drift from it:
 *   (a) every action the code can emit is in the catalogue. The web app's
 *       `track()` only accepts its ActivityAction union and the API writes
 *       the ActivityAction enum, so (a) is "both lists equal the catalogue";
 *       the Prisma enums (API and export tool) must match too;
 *   (b) every catalogue action has an emitter, or is marked deprecated;
 *   (c) every action named in library.v2.json is a catalogue action or a
 *       listed library term (LIBRARY_VOCABULARY);
 *   (d) stored payloads are checked against the catalogue schemas in the
 *       scripted-learner e2e tests (checkMetadata); here the schemas compile.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { ACTION_CATALOGUE, LIBRARY_VOCABULARY, checkMetadata, type ActionSpec } from '@ats/shared';
import { ActivityAction } from '../activity-log/activity-action.enum';

const ROOT = resolve(__dirname, '../../../..');
const catalogue = ACTION_CATALOGUE as Record<string, ActionSpec>;
const names = Object.keys(catalogue).sort();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function prismaEnum(rel: string): string[] {
  const m = /enum ActivityAction \{([\s\S]*?)\n\}/.exec(read(rel));
  return (m?.[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z][A-Z0-9_]*$/.test(l))
    .sort();
}

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${f}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (!['node_modules', 'dist', '__tests__'].includes(f)) files(rel, out);
    } else if (/\.(ts|tsx)$/.test(f) && !/\.(spec|test)\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

describe('action catalogue', () => {
  it('(a) equals the API enum, both Prisma enums and the web ActivityAction union', () => {
    expect(Object.values(ActivityAction).sort()).toEqual(names);
    expect(prismaEnum('apps/api/prisma/schema.prisma')).toEqual(names);
    expect(prismaEnum('tools/gals-export/prisma/schema.prisma')).toEqual(names);
    const union = /export type ActivityAction =([\s\S]*?)\r?\n\r?\nexport /.exec(
      read('apps/web/src/lib/activity-log/types.ts'),
    )?.[1];
    const web = [...(union ?? '').matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]!).sort();
    // The web union lists what the browser may send; server-only actions are not in it.
    const missing = web.filter((a) => !catalogue[a]);
    expect(missing).toEqual([]);
    const clientSide = names.filter(
      (a) => catalogue[a]!.side !== 'server' && !catalogue[a]!.deprecated,
    );
    expect(clientSide.filter((a) => !web.includes(a))).toEqual([]);
  });

  it('(b) every action has an emitter or is deprecated', () => {
    // Emitting code: the web app, and the API outside the enum, the parser
    // (which reads actions) and the export/reporting code.
    const skip = [
      'apps/web/src/lib/activity-log/types.ts',
      'apps/web/src/pages/teacher/',
      'apps/api/src/activity-log/activity-action.enum.ts',
      'apps/api/src/learning-events/engine/',
      'apps/api/src/activity-log/log-export.service.ts',
    ];
    const src = [...files('apps/web/src'), ...files('apps/api/src')]
      .filter((f) => !skip.some((s) => f.startsWith(s)))
      .map(read)
      .join('\n');
    const noEmitter = names.filter((a) => {
      if (catalogue[a]!.deprecated) return false;
      return !new RegExp(`(['"\`])${a}\\1|ActivityAction\\.${a}\\b`).test(src);
    });
    expect(noEmitter).toEqual([]);
    // A deprecated action must really have no emitter (else un-deprecate it).
    const revived = names.filter(
      (a) =>
        catalogue[a]!.deprecated &&
        new RegExp(`track\\(\\s*'${a}'|ActivityAction\\.${a}\\b`).test(src),
    );
    expect(revived).toEqual([]);
  });

  it('(c) every library.v2.json action is in the catalogue or the library vocabulary', () => {
    const lib = JSON.parse(read('apps/api/src/learning-events/config/library.v2.json')) as {
      actions: Array<{ action: string }>;
    };
    const unknown = lib.actions
      .map((a) => a.action)
      .filter((a) => !catalogue[a] && !LIBRARY_VOCABULARY[a]);
    expect(unknown).toEqual([]);
    // and the vocabulary lists only library terms that are not platform actions
    const libNames = new Set(lib.actions.map((a) => a.action));
    expect(Object.keys(LIBRARY_VOCABULARY).filter((a) => !libNames.has(a) || catalogue[a])).toEqual(
      [],
    );
  });

  it('(d) schemas accept a valid payload and name what is missing', () => {
    expect(checkMetadata('PAGE_LEFT', { path: '/x' })).toEqual([]);
    expect(checkMetadata('PAGE_LEFT', {})).toEqual(['path:invalid_type']);
    expect(checkMetadata('NOT_AN_ACTION', {})).toBeNull();
    for (const a of names) expect(checkMetadata(a, null)).not.toBeNull();
  });

  it('the generated ACTION_CATALOGUE.md is up to date', () => {
    // Outside the API rootDir, so required rather than imported.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { render } = require('../../../../packages/shared/scripts/gen-action-catalogue') as {
      render: () => string;
    };
    expect(read('docs/process-mining/ACTION_CATALOGUE.md').replace(/\r\n/g, '\n')).toBe(render());
  });
});
