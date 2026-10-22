import { z } from 'zod';

/**
 * Knowledge tests (docs/assessments/README.md): pre/post-study and
 * pre/post-session tests from docs/assessment/knowledge_tests_v2.json.
 * The scoring functions here are the single source of the rules.
 */

export const KNOWLEDGE_TEST_KINDS = [
  'PRE_STUDY',
  'POST_STUDY',
  'PRE_SESSION',
  'POST_SESSION',
] as const;
export type KnowledgeTestKind = (typeof KNOWLEDGE_TEST_KINDS)[number];
export type KnowledgeTestForm = 'A' | 'B' | 'C';

/** URL slug ↔ kind (student route /student/courses/:id/knowledge-check/:kind[/:sessionNo]). */
export const KNOWLEDGE_TEST_SLUG: Record<KnowledgeTestKind, string> = {
  PRE_STUDY: 'pre-study',
  POST_STUDY: 'post-study',
  PRE_SESSION: 'pre-session',
  POST_SESSION: 'post-session',
};

/** Gate occasion label for a test: PRE_STUDY, POST_STUDY, S3_PRE, S3_POST. */
export function knowledgeTestOccasion(kind: KnowledgeTestKind, sessionNo?: number | null): string {
  if (kind === 'PRE_STUDY' || kind === 'POST_STUDY') return kind;
  return `S${sessionNo}_${kind === 'PRE_SESSION' ? 'PRE' : 'POST'}`;
}

export function parseKnowledgeTestOccasion(
  occasion: string,
): { kind: KnowledgeTestKind; sessionNo: number | null } | null {
  if (occasion === 'PRE_STUDY' || occasion === 'POST_STUDY')
    return { kind: occasion, sessionNo: null };
  const m = /^S([1-8])_(PRE|POST)$/.exec(occasion);
  return m
    ? { kind: m[2] === 'PRE' ? 'PRE_SESSION' : 'POST_SESSION', sessionNo: Number(m[1]) }
    : null;
}

/** Student-facing name of a test (also the course checklist label). */
export function knowledgeTestLabel(kind: KnowledgeTestKind, sessionNo?: number | null): string {
  switch (kind) {
    case 'PRE_STUDY':
      return 'Knowledge check: before the course';
    case 'POST_STUDY':
      return 'Knowledge check: end of the course';
    case 'PRE_SESSION':
      return `Session ${sessionNo}: knowledge check before the lesson`;
    case 'POST_SESSION':
      return `Session ${sessionNo}: knowledge check after the lesson`;
  }
}

// ── items ─────────────────────────────────────────────────────────────────

/** An item as stored (bank verbatim): keys, rubric and objective are server-only. */
export interface KnowledgeTestItem {
  slot: number;
  type: 'mcq' | 'sata' | 'open';
  stem: string;
  objective?: string;
  options?: Array<{ id: string; text: string; correct: boolean }>;
  maxMarks?: number;
  rubric?: string;
}

/** What the student receives: no `correct`, `rubric` or `objective`. */
export interface KnowledgeTestStudentItem {
  slot: number;
  type: 'mcq' | 'sata' | 'open';
  stem: string;
  options?: Array<{ id: string; text: string }>;
  maxChars?: number;
}

export const KNOWLEDGE_TEST_OPEN_MAX_CHARS = 2000;
export const KNOWLEDGE_TEST_RESPONSES_MAX_BYTES = 32 * 1024;

export function studentItems(items: KnowledgeTestItem[]): KnowledgeTestStudentItem[] {
  return items.map((i) => ({
    slot: i.slot,
    type: i.type,
    stem: i.stem,
    ...(i.options ? { options: i.options.map((o) => ({ id: o.id, text: o.text })) } : {}),
    ...(i.type === 'open' ? { maxChars: KNOWLEDGE_TEST_OPEN_MAX_CHARS } : {}),
  }));
}

// ── requests ──────────────────────────────────────────────────────────────

export const KnowledgeTestResponseSchema = z
  .object({
    option: z.string().max(4).optional(),
    options: z.array(z.string().max(4)).max(10).optional(),
    text: z.string().max(KNOWLEDGE_TEST_OPEN_MAX_CHARS).optional(),
  })
  .strict();
export type KnowledgeTestResponse = z.infer<typeof KnowledgeTestResponseSchema>;
export type KnowledgeTestResponses = Record<string, KnowledgeTestResponse>;

export const KnowledgeTestStartSchema = z.object({
  kind: z.enum(KNOWLEDGE_TEST_KINDS),
  sessionNo: z.number().int().min(1).max(8).nullish(),
});
export type KnowledgeTestStartRequest = z.infer<typeof KnowledgeTestStartSchema>;

export const KnowledgeTestSaveSchema = z.object({
  responses: z.record(z.string().regex(/^\d{1,2}$/), KnowledgeTestResponseSchema),
});

/** Submit: optionally the client's final responses (else the last autosave). */
export const KnowledgeTestSubmitSchema = z.object({
  responses: z.record(z.string().regex(/^\d{1,2}$/), KnowledgeTestResponseSchema).optional(),
});
export type KnowledgeTestSubmitRequest = z.infer<typeof KnowledgeTestSubmitSchema>;
export type KnowledgeTestSaveRequest = z.infer<typeof KnowledgeTestSaveSchema>;

export const KnowledgeTestWrittenScoreSchema = z.object({
  dimensionScores: z
    .array(z.union([z.literal(0), z.literal(1)]))
    .min(1)
    .max(10),
  role: z.enum(['RATER', 'ADJUDICATOR']).default('RATER'),
  /** when the blinded answer was shown (from the GET payload) */
  shownAt: z.string().datetime().optional(),
});
export type KnowledgeTestWrittenScoreRequest = z.infer<typeof KnowledgeTestWrittenScoreSchema>;

// ── student status (the client renders only from this) ────────────────────

export interface KnowledgeTestStatusEntry {
  kind: KnowledgeTestKind;
  sessionNo: number | null;
  slug: string;
  label: string;
  state: 'submitted' | 'in_progress' | 'available' | 'locked';
  /** machine-readable reason when locked */
  reasonCode?: string;
  reason?: string;
}

export interface KnowledgeTestStatus {
  enabled: boolean;
  tests: KnowledgeTestStatusEntry[];
}

// ── scoring (docs/assessments/README.md §Scoring) ─────────────────────────

/** mcq: 1 if the selected option is keyed, else 0; blank = 0 (omitted). */
export function scoreMcq(item: KnowledgeTestItem, r: KnowledgeTestResponse | undefined): number {
  if (!r?.option) return 0;
  return item.options?.some((o) => o.id === r.option && o.correct) ? 1 : 0;
}

/**
 * sata: three keyed options of five; score = max(0, (correct − incorrect) / 3).
 * Selecting all five = 1/3. This is the only rule (no exact-match option).
 */
export function scoreSata(item: KnowledgeTestItem, r: KnowledgeTestResponse | undefined): number {
  const picked = new Set(r?.options ?? []);
  if (!picked.size) return 0;
  const keyed = new Set((item.options ?? []).filter((o) => o.correct).map((o) => o.id));
  let correct = 0;
  let incorrect = 0;
  for (const id of picked) {
    if (!(item.options ?? []).some((o) => o.id === id)) continue;
    if (keyed.has(id)) correct++;
    else incorrect++;
  }
  return Math.max(0, (correct - incorrect) / keyed.size);
}

export function isOmitted(item: KnowledgeTestItem, r: KnowledgeTestResponse | undefined): boolean {
  if (item.type === 'mcq') return !r?.option;
  if (item.type === 'sata') return !(r?.options ?? []).length;
  return !(r?.text ?? '').trim();
}

export interface KnowledgeTestAutoScore {
  perSlot: Record<string, number | null>;
  autoTotal: number;
  autoMax: number;
  omitted: number;
  omittedSlots: number[];
}

/** mcq + sata scores (open items: null, scored by raters). */
export function autoScore(
  items: KnowledgeTestItem[],
  responses: KnowledgeTestResponses,
): KnowledgeTestAutoScore {
  const perSlot: Record<string, number | null> = {};
  let autoTotal = 0;
  let autoMax = 0;
  const omittedSlots: number[] = [];
  for (const item of items) {
    const r = responses[String(item.slot)];
    if (isOmitted(item, r)) omittedSlots.push(item.slot);
    if (item.type === 'open') {
      perSlot[item.slot] = null;
      continue;
    }
    const s = item.type === 'mcq' ? scoreMcq(item, r) : scoreSata(item, r);
    perSlot[item.slot] = Math.round(s * 1e4) / 1e4;
    autoTotal += s;
    autoMax += 1;
  }
  return {
    perSlot,
    autoTotal: Math.round(autoTotal * 1e4) / 1e4,
    autoMax,
    omitted: omittedSlots.length,
    omittedSlots,
  };
}

/** Max marks of a form, from its items (session 9, study 29). */
export function maxMarksOf(items: KnowledgeTestItem[]): number {
  return items.reduce((s, i) => s + (i.type === 'open' ? (i.maxMarks ?? 0) : 1), 0);
}

/**
 * Written total of one open response from its score rows: needs ≥ 2 rater
 * rows that agree on the total, or an adjudication row (which wins).
 */
export function writtenTotal(
  rows: Array<{ role: 'RATER' | 'ADJUDICATOR'; total: number }>,
): number | null {
  const adj = rows.find((r) => r.role === 'ADJUDICATOR');
  if (adj) return adj.total;
  const raters = rows.filter((r) => r.role === 'RATER');
  if (raters.length < 2) return null;
  return raters[0]!.total === raters[1]!.total ? raters[0]!.total : null;
}

/** Cohen's κ for two raters, nominal; `weights: 'quadratic'` for ordered scores 0..k. */
export function cohensKappa(
  pairs: Array<[number, number]>,
  weights: 'none' | 'quadratic' = 'none',
  categories?: number[],
): number | null {
  if (!pairs.length) return null;
  const cats = categories ?? [...new Set(pairs.flat())].sort((a, b) => a - b);
  const k = cats.length;
  if (k < 2) return 1;
  const idx = new Map(cats.map((c, i) => [c, i]));
  const n = pairs.length;
  const obs = Array.from({ length: k }, () => Array<number>(k).fill(0));
  for (const [a, b] of pairs) obs[idx.get(a)!]![idx.get(b)!]! += 1 / n;
  const rowM = obs.map((r) => r.reduce((s, v) => s + v, 0));
  const colM = cats.map((_, j) => obs.reduce((s, r) => s + r[j]!, 0));
  const w = (i: number, j: number) =>
    weights === 'quadratic' ? ((i - j) * (i - j)) / ((k - 1) * (k - 1)) : i === j ? 0 : 1;
  let po = 0;
  let pe = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      po += w(i, j) * obs[i]![j]!;
      pe += w(i, j) * rowM[i]! * colM[j]!;
    }
  if (pe === 0) return 1;
  return Math.round((1 - po / pe) * 1000) / 1000;
}
