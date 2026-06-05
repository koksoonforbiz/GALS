export type PracticeCoverageMode = 'pages' | 'subtopic' | 'all';

export interface PracticeCoverage {
  mode: PracticeCoverageMode;
  pageStart?: number;
  pageEnd?: number;
  subtopic?: string;
}

export interface GeneratePracticeTestDto {
  /** Either `selectedText` (≥20 chars) OR no selection — when empty,
   *  the server falls back to RAG over the course's uploaded materials. */
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  /** Optional topic hint to bias the RAG fallback when no text is
   *  selected. If absent, the service derives one from `contentId`. */
  topic?: string;
  /** Default 3, min 0. Combined with `shortAnswerCount` must be ≥1 and ≤10. */
  mcqCount?: number;
  /** Default 2, min 0. Combined with `mcqCount` must be ≥1 and ≤10. */
  shortAnswerCount?: number;
  /** Narrowing for which slice of the lesson material the questions cover. */
  coverage?: PracticeCoverage;
  /** @deprecated Use mcqCount + shortAnswerCount.
   *  When provided alone (legacy clients), the server splits 60/40 MCQ/short. */
  questionCount?: number;
  /** sourceDocumentId — used to look up pre-generated exercises for instant delivery. */
  documentId?: string;
  /** Current PDF page number — used with documentId for cache lookup. */
  pageNumber?: number;
}

export interface SubmitPracticeTestAnswersDto {
  answers: Array<{
    questionIndex: number;
    answer: string;
  }>;
}
