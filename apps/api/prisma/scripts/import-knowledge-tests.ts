/**
 * Import the knowledge-test item bank (docs/assessment/knowledge_tests_v2.json)
 * as KnowledgeTestDefinitions: 16 session forms (Sessions 1–8 × A/B) and
 * 3 study forms (A/B/C). Items are stored verbatim.
 *
 * Idempotent, keyed by (course, scope, session, form, version). A definition
 * whose items differ from the bank is refused unless --force; one that has
 * attempts is never changed.
 *
 *   pnpm run import:knowledge-tests -- --course-id <uuid> \
 *     [--file ../../docs/assessment/knowledge_tests_v2.json] [--force] [--dry-run]
 *
 * On a production image (no pnpm download, see DEPLOYMENT_LITHIUM.md):
 *   npx --no-install ts-node --transpile-only -P tsconfig.json \
 *     prisma/scripts/import-knowledge-tests.ts --course-id <uuid> --file /kt/knowledge_tests_v2.json
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { bankDefinitions, itemsHash, type BankFile } from '../../src/knowledge-tests/bank';

interface Options {
  file: string;
  courseId: string;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    file: path.resolve(__dirname, '../../../../docs/assessment/knowledge_tests_v2.json'),
    courseId: '',
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--file') opts.file = path.resolve(next());
    else if (a === '--course-id') opts.courseId = next();
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--') continue;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!opts.courseId) throw new Error('--course-id is required');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bank = JSON.parse(fs.readFileSync(opts.file, 'utf8')) as BankFile;
  const defs = bankDefinitions(bank); // throws if the bank breaks its design
  console.log(
    `Knowledge-test bank v${bank.version} (${bank.built ?? 'no date'}): ${defs.length} definitions`,
  );
  for (const d of defs) {
    console.log(
      `  ${d.scope} ${d.scope === 'session' ? `S${d.sessionNo}` : '  '} form ${d.form}: ${d.items.length} items, maxMarks ${d.maxMarks}`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const course = await prisma.course.findUnique({
      where: { id: opts.courseId },
      select: { title: true },
    });
    if (!course) throw new Error(`Course ${opts.courseId} not found`);
    console.log(`Course: ${course.title}`);
    const report = { created: 0, unchanged: 0, updated: 0, refused: [] as string[] };
    for (const d of defs) {
      const key = {
        courseId: opts.courseId,
        scope: d.scope,
        sessionNo: d.sessionNo,
        form: d.form,
        version: d.version,
      };
      const name = `${d.scope}${d.sessionNo ? ` S${d.sessionNo}` : ''} ${d.form}`;
      const existing = await prisma.knowledgeTestDefinition.findUnique({
        where: { courseId_scope_sessionNo_form_version: key },
        include: { _count: { select: { attempts: true } } },
      });
      if (!existing) {
        report.created++;
        if (!opts.dryRun)
          await prisma.knowledgeTestDefinition.create({
            data: {
              ...key,
              title: d.title,
              items: d.items as unknown as Prisma.InputJsonValue,
              maxMarks: d.maxMarks,
            },
          });
        continue;
      }
      if (itemsHash(existing.items) === itemsHash(d.items) && existing.maxMarks === d.maxMarks) {
        report.unchanged++;
        continue;
      }
      if (existing._count.attempts) {
        report.refused.push(`${name}: has ${existing._count.attempts} attempt(s), never changed`);
        continue;
      }
      if (!opts.force) {
        report.refused.push(`${name}: differs from the bank (pass --force to overwrite)`);
        continue;
      }
      report.updated++;
      if (!opts.dryRun)
        await prisma.knowledgeTestDefinition.update({
          where: { id: existing.id },
          data: {
            title: d.title,
            items: d.items as unknown as Prisma.InputJsonValue,
            maxMarks: d.maxMarks,
          },
        });
    }
    console.log(`${opts.dryRun ? '[dry-run] ' : ''}${JSON.stringify(report)}`);
    if (report.refused.length) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
