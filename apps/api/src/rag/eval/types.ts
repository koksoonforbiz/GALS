/**
 * RAG eval harness — shared types.
 *
 * The harness is offline and read-only; it exists to give later RAG
 * stages a stable before/after measurement surface. See
 * `apps/api/src/rag/eval/README.md` for usage.
 */

export interface GoldItem {
  id: string;
  corpus: 'teacher' | 'student';
  question: string;
  expected_answer: string;
  must_cite: string[];
  courseId: string;
  /** Required only for the student corpus. The student whose
   *  `student_rag_chunks` rows we score against. */
  studentId?: string;
  tags?: string[];
  /** When true, the only acceptable answer is a refusal. The
   *  `refusal_correctness` metric scores 1.0 if the system declined and
   *  0.0 if it confabulated. */
  is_refusal?: boolean;
}

export interface RetrievedChunkLite {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  content: string;
  score: number;
}

export interface GeneratedAnswer {
  /** Free-text answer string as produced by the surface under test. */
  text: string;
  /** Citations the surface emitted, normalized to a comparable shape. */
  citations: Array<{ documentName: string; pageNumber: number | null }>;
  /** Provider/model the funnel resolved for this call (or null if the
   *  template-fallback path ran). */
  model: string | null;
  provider: string | null;
}

export type MetricScore =
  | { score: number; reasoning?: string }
  | { score: null; error: string };

export interface ItemResult {
  itemId: string;
  question: string;
  retrieved: RetrievedChunkLite[];
  answer: GeneratedAnswer;
  metrics: {
    context_recall: MetricScore;
    context_precision: MetricScore;
    faithfulness: MetricScore;
    answer_relevancy: MetricScore;
    refusal_correctness: MetricScore;
    citation_validity: MetricScore;
  };
  /** Optional row-level error if retrieval or generation itself failed.
   *  When set, all per-metric scores are `null` with this error string. */
  rowError?: string;
}

export interface RunSummary {
  /** ISO timestamp. */
  startedAt: string;
  finishedAt: string;
  gitSha: string;
  corpus: 'teacher' | 'student' | 'all';
  /** Operator who triggered the run (env $USER or "unknown"). */
  operator: string;
  /** Models used during the run. Logged so a later --compare can
   *  attribute regressions to a model change. */
  judgeModel: string | null;
  judgeProvider: string | null;
  generatorModel: string | null;
  generatorProvider: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  /** Per-item results. */
  items: ItemResult[];
  /** Aggregated metric means (null-safe: items whose metric is `null` are
   *  excluded from the mean). */
  aggregates: Record<string, { mean: number | null; n: number; nNull: number }>;
  /** Notes recorded by the runner (e.g. "no API key — judge fell back",
   *  "DB unreachable — stub run"). */
  notes: string[];
}
