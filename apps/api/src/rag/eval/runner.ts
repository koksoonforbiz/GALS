/**
 * RAG eval harness — runner.
 *
 * Usage (from repo root):
 *   pnpm --filter @ats/api rag:eval -- --corpus=teacher|student|all
 *   pnpm --filter @ats/api rag:eval -- --corpus=all --compare apps/api/src/rag/eval/results/BASELINE-teacher.json --tolerance 0.02
 *
 * What it does:
 *   1. Boots the NestJS app context (so PrismaService, LlmService,
 *      RagService, EmbeddingService etc. are all wired the same way
 *      they are in prod).
 *   2. Reads `apps/api/src/rag/eval/gold/<corpus>_corpus.jsonl`.
 *   3. For each row, runs retrieval through the production paths
 *      (RagService.queryChunks for teacher, dialogue-style keyword
 *      scoring for student — matching what the chat surfaces actually
 *      use today; the harness intentionally measures the ACTUAL prod
 *      paths so later stages' fixes show up as deltas).
 *   4. Generates an answer via LlmService.callLlmStructured with the
 *      same grounded contract dialogue.service.ts uses.
 *   5. Computes RAGAS-style metrics via the judge LLM at temperature 0.
 *   6. Writes `results/<git-sha>-<corpus>.json` and prints a summary.
 *
 * Read-only: never writes to `document_chunks`, `student_rag_chunks`,
 * `source_documents`, `student_source_documents`, `chatbot_messages`,
 * `dialogue_messages`, or any other production table. Eval LLM calls
 * DO write to `llm_usage_log` because the funnel logs every call — this
 * is the cost-tracking table and writing to it is the expected,
 * non-destructive side effect of calling the funnel.
 */

// AppModule, NestFactory, PrismaService, LlmService, and RagService are
// loaded LAZILY inside `runReal()` so the `--stub` and `--help` paths
// don't trip the API's env validation (the AppModule transitively
// instantiates `ThrottlerRedisStorage` at module-eval time, which calls
// `validateEnv()` and `process.exit(1)` when the API .env isn't loaded
// — which is exactly the case when the harness is invoked in CI / a
// fresh checkout). The lazy imports keep the harness usable for a
// shape-only stub run without DB / Redis / blob creds.
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type {
  GoldItem,
  ItemResult,
  RetrievedChunkLite,
  GeneratedAnswer,
  RunSummary,
  MetricScore,
} from './types';
import { ALL_METRICS } from './metrics';
// Forward-declared type aliases (no value imports) so the rest of the
// module can reference them without triggering the env-validation chain
// described in the lazy-import note above.
type LlmServiceT = import('../llm.service').LlmService;
type RagServiceT = import('../rag.service').RagService;
type PrismaServiceT = import('../../prisma/prisma.service').PrismaService;

const GOLD_DIR = path.join(__dirname, 'gold');
const RESULTS_DIR = path.join(__dirname, 'results');

// ─── Arg parsing ──────────────────────────────────────────

interface ParsedArgs {
  corpus: 'teacher' | 'student' | 'all';
  compare: string | null;
  tolerance: number;
  stub: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    corpus: 'all',
    compare: null,
    tolerance: 0.02,
    stub: false,
    help: false,
  };
  for (const a of argv) {
    if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--corpus=')) {
      const v = a.split('=')[1];
      if (v === 'teacher' || v === 'student' || v === 'all') args.corpus = v;
    } else if (a.startsWith('--compare=')) {
      args.compare = a.split('=')[1] ?? null;
    } else if (a === '--compare') {
      // handled by the loop below — not supported in single-arg form
    } else if (a.startsWith('--tolerance=')) {
      args.tolerance = Number(a.split('=')[1]);
    } else if (a === '--stub') {
      args.stub = true;
    }
  }
  // Two-arg form: --compare <path>
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--compare') args.compare = argv[i + 1] ?? null;
    if (argv[i] === '--tolerance') args.tolerance = Number(argv[i + 1]);
  }
  return args;
}

function helpText(): string {
  return [
    'rag:eval — RAG harness runner',
    '',
    'Flags:',
    '  --corpus=teacher|student|all   Which gold set to run (default: all)',
    '  --compare <baseline.json>      Diff against a previous run, non-zero exit on regression',
    '  --tolerance=0.02               Allowed regression on any metric',
    '  --stub                         Skip DB+LLM, write null-score placeholder result files',
    '  -h, --help                     This help',
    '',
    'Env:',
    '  RAG_EVAL_JUDGE_USER_ID        Teacher User.id whose LLM key the judge uses',
    '  RAG_EVAL_TEACHER_COURSE_ID    Overrides the courseId in teacher_corpus.jsonl',
    '  RAG_EVAL_STUDENT_COURSE_ID    Overrides the courseId in student_corpus.jsonl',
    '  RAG_EVAL_STUDENT_ID           Overrides the studentId in student_corpus.jsonl',
  ].join('\n');
}

// ─── Helpers ──────────────────────────────────────────────

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'nogit';
  }
}

function readGold(corpus: 'teacher' | 'student'): GoldItem[] {
  const file = path.join(GOLD_DIR, `${corpus}_corpus.jsonl`);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
  const overrideCourse =
    corpus === 'teacher' ? process.env.RAG_EVAL_TEACHER_COURSE_ID : process.env.RAG_EVAL_STUDENT_COURSE_ID;
  const overrideStudent = process.env.RAG_EVAL_STUDENT_ID;
  return lines.map((l) => {
    const item = JSON.parse(l) as GoldItem;
    if (overrideCourse && (!item.courseId || item.courseId.startsWith('__'))) {
      item.courseId = overrideCourse;
    }
    if (corpus === 'student' && overrideStudent && (!item.studentId || item.studentId.startsWith('__'))) {
      item.studentId = overrideStudent;
    }
    return item;
  });
}

function isPlaceholderId(id: string | undefined | null): boolean {
  if (!id) return true;
  return id.startsWith('__') || id.length < 8;
}

// ─── Retrieval ─────────────────────────────────────────────

/** Teacher-side retrieval — mirrors RagController's `ragQuery` shape but
 *  read-only. */
async function retrieveTeacher(
  rag: RagServiceT,
  item: GoldItem,
  topK = 8,
): Promise<RetrievedChunkLite[]> {
  const chunks = await rag.queryChunks(item.courseId, item.question, topK);
  return chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentName: c.documentTitle,
    pageNumber: c.pageNumber,
    content: c.content,
    score: c.rerankerScore,
  }));
}

/** Student-side retrieval — mirrors what dialogue.service.ts actually
 *  does today (keyword scoring over `student_rag_chunks`). This is the
 *  surface the chat path uses; Stage 02 will replace it with the shared
 *  hybrid retriever and the harness will pick up that replacement
 *  automatically since this function will be updated as part of that
 *  refactor.
 *
 *  We reimplement the same scoring inline here rather than calling
 *  DialogueService.sendMessage (which would write `dialogue_messages`
 *  rows, violating the read-only constraint). */
async function retrieveStudent(
  prisma: PrismaServiceT,
  item: GoldItem,
  topK = 8,
): Promise<RetrievedChunkLite[]> {
  if (!item.studentId) return [];
  const activeSources = await prisma.studentSourceDocument.findMany({
    where: { studentId: item.studentId, courseId: item.courseId, isActive: true },
    select: { id: true },
  });
  if (activeSources.length === 0) return [];
  const sourceIds = activeSources.map((s) => s.id);

  const chunks = await prisma.studentRagChunk.findMany({
    where: {
      studentId: item.studentId,
      courseId: item.courseId,
      documentId: { in: sourceIds },
    },
    include: { document: { select: { originalName: true } } },
  });
  if (chunks.length === 0) return [];

  const queryTerms = item.question
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = chunks.map((chunk) => {
    const contentLower = chunk.content.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = contentLower.match(new RegExp(escaped, 'g'));
      score += matches ? matches.length : 0;
    }
    score = score / Math.sqrt(chunk.content.length / 100);
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.document.originalName,
      pageNumber: chunk.pageNumber,
      content: chunk.content,
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ─── Generation ────────────────────────────────────────────

/** Runs through `LlmService.callLlmStructured` using the same dialogue-
 *  style grounded prompt the production surfaces use. The prompt mirrors
 *  dialogue.service.ts:347-378 closely but without dependence on the
 *  course's `dblSettings` (which would require DB writes for new
 *  sessions). */
async function generateAnswer(
  llm: LlmServiceT,
  judgeUserId: string,
  item: GoldItem,
  retrieved: RetrievedChunkLite[],
): Promise<GeneratedAnswer> {
  const ragContext = retrieved.length === 0
    ? ''
    : retrieved
        .map(
          (c, i) =>
            `[Source ${i + 1}: ${c.documentName}${c.pageNumber ? `, p.${c.pageNumber}` : ''}]\n${c.content}`,
        )
        .join('\n\n');

  const systemPrompt =
    'You are an intelligent learning assistant. Answer the student\'s question using ONLY the supplied source material. ' +
    'If the sources do not contain enough information, say so clearly — do not invent or rely on general knowledge. ' +
    'When citing, use inline tags like [Source N] referencing the numbered sources below.' +
    (ragContext
      ? `\n\n--- SOURCES ---\n${ragContext}\n--- END SOURCES ---`
      : '\n\n(No sources retrieved.)');

  const userPrompt = `Question: ${item.question}`;

  const result = await llm.callLlmStructured(
    judgeUserId,
    {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0,
      maxTokens: 1024,
    },
    { feature: 'rag_eval_generation' },
  );

  // Parse `[Source N]` citations out of the reply and map back to
  // retrieved chunks by index.
  const citations: Array<{ documentName: string; pageNumber: number | null }> = [];
  const citationRe = /\[Source\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = citationRe.exec(result.content)) !== null) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < retrieved.length && !seen.has(idx)) {
      seen.add(idx);
      citations.push({
        documentName: retrieved[idx]!.documentName,
        pageNumber: retrieved[idx]!.pageNumber,
      });
    }
  }

  return {
    text: result.content,
    citations,
    model: result.model,
    provider: result.provider,
  };
}

// ─── Run loop ──────────────────────────────────────────────

async function evalOne(
  llm: LlmServiceT,
  judgeUserId: string,
  item: GoldItem,
  retrieved: RetrievedChunkLite[],
  answer: GeneratedAnswer,
): Promise<ItemResult['metrics']> {
  const metrics: ItemResult['metrics'] = {
    context_recall: { score: null, error: 'not run' },
    context_precision: { score: null, error: 'not run' },
    faithfulness: { score: null, error: 'not run' },
    answer_relevancy: { score: null, error: 'not run' },
    refusal_correctness: { score: null, error: 'not run' },
    citation_validity: { score: null, error: 'not run' },
  };

  for (const [key, fn] of Object.entries(ALL_METRICS)) {
    try {
      metrics[key as keyof typeof metrics] = await fn(llm, judgeUserId, item, retrieved, answer);
    } catch (err) {
      // Triple-defensive: even though each metric already catches, do
      // not let a thrown error from inside the catch handler kill the
      // row.
      metrics[key as keyof typeof metrics] = {
        score: null,
        error: `unexpected throw: ${(err as Error).message}`,
      };
    }
  }
  return metrics;
}

function aggregate(items: ItemResult[]): RunSummary['aggregates'] {
  const keys: (keyof ItemResult['metrics'])[] = [
    'context_recall',
    'context_precision',
    'faithfulness',
    'answer_relevancy',
    'refusal_correctness',
    'citation_validity',
  ];
  const out: RunSummary['aggregates'] = {};
  for (const k of keys) {
    const scores: number[] = [];
    let nNull = 0;
    for (const it of items) {
      const m: MetricScore = it.metrics[k];
      if (m.score === null) nNull += 1;
      else scores.push(m.score);
    }
    out[k] = {
      mean: scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
      n: scores.length,
      nNull,
    };
  }
  return out;
}

function printSummary(summary: RunSummary): void {
  const lines: string[] = [];
  lines.push('');
  lines.push(`─── rag:eval summary — ${summary.corpus} @ ${summary.gitSha} ───`);
  lines.push(`  judge       : ${summary.judgeProvider ?? '-'} / ${summary.judgeModel ?? '-'}`);
  lines.push(`  generator   : ${summary.generatorProvider ?? '-'} / ${summary.generatorModel ?? '-'}`);
  lines.push(`  embedding   : ${summary.embeddingModel ?? '-'} dim=${summary.embeddingDimensions ?? '-'}`);
  lines.push(`  items       : ${summary.items.length}`);
  for (const note of summary.notes) lines.push(`  note: ${note}`);
  lines.push('');
  lines.push('  metric                  mean        n   null');
  for (const [k, v] of Object.entries(summary.aggregates)) {
    const mean = v.mean === null ? '   null' : v.mean.toFixed(4);
    lines.push(`    ${k.padEnd(22)} ${String(mean).padStart(6)}   ${String(v.n).padStart(2)}    ${String(v.nNull).padStart(2)}`);
  }
  lines.push('');
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function compareRuns(baseline: RunSummary, current: RunSummary, tolerance: number): {
  ok: boolean;
  regressions: Array<{ metric: string; delta: number; baseline: number; current: number }>;
} {
  const regressions: Array<{ metric: string; delta: number; baseline: number; current: number }> = [];
  for (const [k, b] of Object.entries(baseline.aggregates)) {
    const c = current.aggregates[k];
    if (!c || b.mean === null || c.mean === null) continue;
    const delta = c.mean - b.mean;
    if (delta < -tolerance) {
      regressions.push({ metric: k, delta, baseline: b.mean, current: c.mean });
    }
  }
  return { ok: regressions.length === 0, regressions };
}

// ─── Main ─────────────────────────────────────────────────

async function runStub(corpus: 'teacher' | 'student' | 'all'): Promise<void> {
  // Generate placeholder result files so the file shape is committed
  // even when no dev DB / LLM is reachable. Operator must rerun with
  // real creds to populate real scores.
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const corpora: Array<'teacher' | 'student'> =
    corpus === 'all' ? ['teacher', 'student'] : [corpus];

  for (const c of corpora) {
    const items = readGold(c);
    const result: RunSummary = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      gitSha: gitSha(),
      corpus: c,
      operator: process.env.USER ?? process.env.USERNAME ?? 'unknown',
      judgeModel: null,
      judgeProvider: null,
      generatorModel: null,
      generatorProvider: null,
      embeddingModel: null,
      embeddingDimensions: null,
      items: items.map((it) => ({
        itemId: it.id,
        question: it.question,
        retrieved: [],
        answer: { text: '', citations: [], model: null, provider: null },
        metrics: {
          context_recall: { score: null, error: 'stub run' },
          context_precision: { score: null, error: 'stub run' },
          faithfulness: { score: null, error: 'stub run' },
          answer_relevancy: { score: null, error: 'stub run' },
          refusal_correctness: { score: null, error: 'stub run' },
          citation_validity: { score: null, error: 'stub run' },
        },
        rowError: 'STUB: harness not executed against a real DB/LLM; rerun without --stub when dev creds are available',
      })),
      aggregates: {
        context_recall: { mean: null, n: 0, nNull: items.length },
        context_precision: { mean: null, n: 0, nNull: items.length },
        faithfulness: { mean: null, n: 0, nNull: items.length },
        answer_relevancy: { mean: null, n: 0, nNull: items.length },
        refusal_correctness: { mean: null, n: 0, nNull: items.length },
        citation_validity: { mean: null, n: 0, nNull: items.length },
      },
      notes: [
        'STUB RUN — no dev DB or LLM key reachable from this environment.',
        'Re-run `pnpm --filter @ats/api rag:eval -- --corpus=' + c + '` with',
        'RAG_EVAL_JUDGE_USER_ID, RAG_EVAL_TEACHER_COURSE_ID / RAG_EVAL_STUDENT_COURSE_ID,',
        'and RAG_EVAL_STUDENT_ID set to populate real baseline numbers.',
      ],
    };

    const outPath = path.join(RESULTS_DIR, `${gitSha()}-${c}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`wrote ${outPath}`);
    printSummary(result);
  }
}

async function runReal(corpus: 'teacher' | 'student' | 'all'): Promise<RunSummary[]> {
  const judgeUserId = process.env.RAG_EVAL_JUDGE_USER_ID;
  if (!judgeUserId) {
    throw new Error(
      'RAG_EVAL_JUDGE_USER_ID env var is required for a real run (teacher User.id with an LLM key configured). Pass --stub to emit placeholder result files instead.',
    );
  }

  // Lazy imports — see top-of-file note. Boots the env validation and
  // Redis/blob clients only when we actually need to hit the DB.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../app.module');
  const { PrismaService } = await import('../../prisma/prisma.service');
  const { LlmService } = await import('../llm.service');
  const { RagService } = await import('../rag.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const llm = app.get(LlmService);
    const rag = app.get(RagService);

    // Resolve the judge's chat model for logging.
    let judgeModelInfo: { model: string | null; provider: string | null } = {
      model: null,
      provider: null,
    };
    try {
      const settings = await llm.getUserLlmSettings(judgeUserId);
      judgeModelInfo = { model: settings.model, provider: settings.provider };
    } catch {
      // Non-fatal: judge metadata is just metadata for the JSON output.
    }

    const corpora: Array<'teacher' | 'student'> =
      corpus === 'all' ? ['teacher', 'student'] : [corpus];

    const summaries: RunSummary[] = [];
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

    for (const c of corpora) {
      const items = readGold(c);
      const startedAt = new Date().toISOString();
      const notes: string[] = [];
      const itemResults: ItemResult[] = [];

      for (const item of items) {
        const placeholder =
          isPlaceholderId(item.courseId) ||
          (c === 'student' && isPlaceholderId(item.studentId));
        if (placeholder) {
          itemResults.push({
            itemId: item.id,
            question: item.question,
            retrieved: [],
            answer: { text: '', citations: [], model: null, provider: null },
            metrics: {
              context_recall: { score: null, error: 'placeholder courseId/studentId' },
              context_precision: { score: null, error: 'placeholder courseId/studentId' },
              faithfulness: { score: null, error: 'placeholder courseId/studentId' },
              answer_relevancy: { score: null, error: 'placeholder courseId/studentId' },
              refusal_correctness: { score: null, error: 'placeholder courseId/studentId' },
              citation_validity: { score: null, error: 'placeholder courseId/studentId' },
            },
            rowError: 'placeholder ids — set RAG_EVAL_*_COURSE_ID / RAG_EVAL_STUDENT_ID to populate',
          });
          continue;
        }

        try {
          const retrieved =
            c === 'teacher' ? await retrieveTeacher(rag, item) : await retrieveStudent(prisma, item);
          const answer = await generateAnswer(llm, judgeUserId, item, retrieved);
          const metrics = await evalOne(llm, judgeUserId, item, retrieved, answer);
          itemResults.push({
            itemId: item.id,
            question: item.question,
            retrieved,
            answer,
            metrics,
          });
        } catch (err) {
          const msg = (err as Error).message;
          itemResults.push({
            itemId: item.id,
            question: item.question,
            retrieved: [],
            answer: { text: '', citations: [], model: null, provider: null },
            metrics: {
              context_recall: { score: null, error: 'row failed' },
              context_precision: { score: null, error: 'row failed' },
              faithfulness: { score: null, error: 'row failed' },
              answer_relevancy: { score: null, error: 'row failed' },
              refusal_correctness: { score: null, error: 'row failed' },
              citation_validity: { score: null, error: 'row failed' },
            },
            rowError: msg,
          });
          notes.push(`row ${item.id} failed: ${msg}`);
        }
      }

      // Sniff the generator + embedding metadata from the first
      // successful row.
      const sample = itemResults.find((r) => r.answer.model);
      const generator = sample
        ? { model: sample.answer.model, provider: sample.answer.provider }
        : { model: null, provider: null };

      const summary: RunSummary = {
        startedAt,
        finishedAt: new Date().toISOString(),
        gitSha: gitSha(),
        corpus: c,
        operator: process.env.USER ?? process.env.USERNAME ?? 'unknown',
        judgeModel: judgeModelInfo.model,
        judgeProvider: judgeModelInfo.provider,
        generatorModel: generator.model,
        generatorProvider: generator.provider,
        embeddingModel: null,
        embeddingDimensions: null,
        items: itemResults,
        aggregates: aggregate(itemResults),
        notes,
      };

      const outPath = path.join(RESULTS_DIR, `${gitSha()}-${c}.json`);
      fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`wrote ${outPath}`);
      printSummary(summary);
      summaries.push(summary);
    }
    return summaries;
  } finally {
    await app.close();
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(helpText());
    return 0;
  }

  if (args.stub) {
    await runStub(args.corpus);
    return 0;
  }

  let summaries: RunSummary[];
  try {
    summaries = await runReal(args.corpus);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`rag:eval failed: ${(err as Error).message}`);
    return 1;
  }

  // Optional baseline compare. Runs against the FIRST summary the
  // current run produced (one corpus per file).
  if (args.compare) {
    try {
      const baseline = JSON.parse(fs.readFileSync(args.compare, 'utf-8')) as RunSummary;
      const current = summaries.find((s) => s.corpus === baseline.corpus) ?? summaries[0]!;
      const cmp = compareRuns(baseline, current, args.tolerance);
      if (!cmp.ok) {
        // eslint-disable-next-line no-console
        console.error('');
        // eslint-disable-next-line no-console
        console.error(`REGRESSION DETECTED against ${args.compare} (tolerance=${args.tolerance}):`);
        for (const r of cmp.regressions) {
          // eslint-disable-next-line no-console
          console.error(`  ${r.metric}: ${r.baseline.toFixed(4)} → ${r.current.toFixed(4)} (Δ ${r.delta.toFixed(4)})`);
        }
        return 1;
      }
      // eslint-disable-next-line no-console
      console.log(`No regressions vs ${args.compare} (tolerance=${args.tolerance}).`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`--compare failed: ${(err as Error).message}`);
      return 1;
    }
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('rag:eval unhandled:', err);
    process.exitCode = 1;
  });
