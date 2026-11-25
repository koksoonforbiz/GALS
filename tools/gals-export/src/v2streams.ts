/**
 * Bundle v2 streams (Prompt B, P7), read with plain SQL so the export tool
 * does not need a copy of every new table and column in its Prisma schema.
 * Rows come back as stored (snake_case for mapped tables, camelCase for the
 * interaction streams), with BigInt as number and Date as ISO string.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { StreamKey, StreamRecord } from './types.js';

type Raw = (sql: string, ...params: unknown[]) => Promise<Array<Record<string, unknown>>>;

const BATCH = 2_000;

function json(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

async function* paged(
  raw: Raw,
  sql: string,
  params: unknown[],
): AsyncIterable<Record<string, unknown>> {
  for (let offset = 0; ; offset += BATCH) {
    const rows = await raw(`${sql} LIMIT ${BATCH} OFFSET ${offset}`, ...params);
    for (const r of rows) yield json(r);
    if (rows.length < BATCH) return;
  }
}

/** wallMs from a timestamp column, for readers that expect one. */
function withWall(r: Record<string, unknown>, col: string): StreamRecord {
  const v = r[col];
  const ms = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return { wallMs: Number.isFinite(ms) ? ms : 0, ...r };
}

/** Where the library JSON files are: the API image's dist, or the repo. */
const LIBRARY_DIRS = [
  process.env.GALS_LIBRARY_DIR,
  '/app/dist/learning-events/config',
  join(process.cwd(), 'apps/api/src/learning-events/config'),
  join(process.cwd(), '../../apps/api/src/learning-events/config'),
].filter((d): d is string => !!d);

function libraryFile(version: string): { content: unknown; sha256: string } | null {
  const file = version === 'v2' ? 'library.v2.json' : `library.${version.replace('.', '_')}.json`;
  for (const dir of LIBRARY_DIRS) {
    const p = join(dir, file);
    if (!existsSync(p)) continue;
    const content = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    // Same hash as the API (sha256 of JSON.stringify of the parsed file).
    return { content, sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
  }
  return null;
}

/**
 * The v2 streams of one session. `userId` scopes the learner-level tables
 * (EF battery, slide states, notes, Prompt Lab work), like cards/attempts.
 */
export async function* v2Stream(
  raw: Raw,
  key: StreamKey,
  sessionId: string,
  userId: string,
): AsyncIterable<StreamRecord> {
  const S = [sessionId];
  const U = [userId];
  switch (key) {
    case 'parse_runs':
      for await (const r of paged(
        raw,
        'SELECT * FROM session_parse_runs WHERE session_id = $1::uuid ORDER BY started_at, id',
        S,
      ))
        yield withWall(r, 'started_at');
      return;
    case 'coverage':
      for await (const r of paged(
        raw,
        'SELECT * FROM learning_event_coverage WHERE session_id = $1::uuid ORDER BY computed_at, id',
        S,
      ))
        yield withWall(r, 'computed_at');
      return;
    case 'parameter_snapshots':
      for await (const r of paged(
        raw,
        'SELECT * FROM parameter_set_snapshots WHERE hash IN (SELECT DISTINCT parameter_hash FROM learning_events WHERE session_id = $1::uuid) ORDER BY hash',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'library': {
      const used = await raw(
        'SELECT DISTINCT library_version, library_hash FROM learning_events WHERE session_id = $1::uuid AND library_hash IS NOT NULL',
        sessionId,
      );
      for (const u of used) {
        const version = String(u.library_version);
        const file = libraryFile(version);
        yield {
          wallMs: 0,
          libraryVersion: version,
          libraryHash: u.library_hash,
          // The content only when the file on disk is exactly the one used.
          content: file && file.sha256 === u.library_hash ? file.content : null,
          contentMatches: !!file && file.sha256 === u.library_hash,
        };
      }
      return;
    }
    case 'ingest_issues':
      for await (const r of paged(
        raw,
        'SELECT * FROM ingest_issues WHERE session_id = $1::uuid ORDER BY created_at, id',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'capture_quality':
      for await (const r of paged(
        raw,
        'SELECT * FROM capture_quality WHERE session_id = $1::uuid ORDER BY stream, tab_id, from_seq',
        S,
      ))
        yield withWall(r, 'detected_at');
      return;
    case 'intervention_ledger':
      for await (const r of paged(
        raw,
        'SELECT * FROM intervention_ledger WHERE session_id = $1::uuid ORDER BY created_at, id',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'llm_turns':
      for await (const r of paged(
        raw,
        'SELECT * FROM llm_turns WHERE session_id = $1::uuid ORDER BY created_at, id',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'knowledge_tests':
      for await (const r of paged(
        raw,
        'SELECT * FROM knowledge_test_attempts WHERE student_session_id = $1::uuid ORDER BY started_at, id',
        S,
      ))
        yield withWall(r, 'started_at');
      return;
    case 'knowledge_test_scores':
      for await (const r of paged(
        raw,
        'SELECT s.* FROM knowledge_test_written_scores s JOIN knowledge_test_attempts a ON a.id = s.attempt_id WHERE a.student_session_id = $1::uuid ORDER BY s.created_at, s.id',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'efa_occasions':
      for await (const r of paged(
        raw,
        'SELECT * FROM efa_occasions WHERE student_id = $1::uuid ORDER BY started_at, id',
        U,
      ))
        yield withWall(r, 'started_at');
      return;
    case 'efa_task_runs':
      for await (const r of paged(
        raw,
        'SELECT t.* FROM efa_task_runs t JOIN efa_occasions o ON o.id = t.occasion_id WHERE o.student_id = $1::uuid ORDER BY t.created_at, t.id',
        U,
      ))
        yield withWall(r, 'started_at');
      return;
    case 'efa_trials':
      for await (const r of paged(
        raw,
        'SELECT tr.* FROM efa_trials tr JOIN efa_task_runs t ON t.id = tr.task_run_id JOIN efa_occasions o ON o.id = t.occasion_id WHERE o.student_id = $1::uuid ORDER BY tr.task_run_id, tr.trial_index, tr.id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'efa_answers':
      for await (const r of paged(
        raw,
        'SELECT a.* FROM efa_answers a JOIN efa_occasions o ON o.id = a.occasion_id WHERE o.student_id = $1::uuid ORDER BY a.answered_at, a.id',
        U,
      ))
        yield withWall(r, 'answered_at');
      return;
    case 'efa_task_scores':
      for await (const r of paged(
        raw,
        'SELECT sc.* FROM efa_task_scores sc JOIN efa_task_runs t ON t.id = sc.task_run_id JOIN efa_occasions o ON o.id = t.occasion_id WHERE o.student_id = $1::uuid ORDER BY sc.computed_at, sc.id',
        U,
      ))
        yield withWall(r, 'computed_at');
      return;
    case 'promptlab_runs':
      for await (const r of paged(
        raw,
        'SELECT * FROM prompt_lab_runs WHERE student_session_id = $1::uuid ORDER BY created_at, id',
        S,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'promptlab_versions':
      for await (const r of paged(
        raw,
        'SELECT * FROM prompt_lab_versions WHERE student_id = $1::uuid ORDER BY created_at, id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'promptlab_test_cases':
      for await (const r of paged(
        raw,
        'SELECT * FROM prompt_lab_test_cases WHERE student_id = $1::uuid ORDER BY created_at, id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'promptlab_test_results':
      for await (const r of paged(
        raw,
        'SELECT * FROM prompt_lab_test_results WHERE student_id = $1::uuid ORDER BY created_at, id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'promptlab_ratings':
      for await (const r of paged(
        raw,
        'SELECT * FROM prompt_lab_output_ratings WHERE student_id = $1::uuid ORDER BY created_at, id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    case 'slide_states':
      for await (const r of paged(
        raw,
        'SELECT * FROM lesson_slide_states WHERE student_id = $1::uuid ORDER BY updated_at, id',
        U,
      ))
        yield withWall(r, 'updated_at');
      return;
    case 'study_notes':
      for await (const r of paged(
        raw,
        'SELECT * FROM study_notes WHERE student_id = $1::uuid ORDER BY created_at, id',
        U,
      ))
        yield withWall(r, 'created_at');
      return;
    default:
      return;
  }
}

/** Keys handled by v2Stream. */
export const V2_KEYS = new Set<StreamKey>([
  'parse_runs',
  'coverage',
  'parameter_snapshots',
  'library',
  'ingest_issues',
  'capture_quality',
  'intervention_ledger',
  'llm_turns',
  'knowledge_tests',
  'knowledge_test_scores',
  'efa_occasions',
  'efa_task_runs',
  'efa_trials',
  'efa_answers',
  'efa_task_scores',
  'promptlab_runs',
  'promptlab_versions',
  'promptlab_test_cases',
  'promptlab_test_results',
  'promptlab_ratings',
  'slide_states',
  'study_notes',
]);
