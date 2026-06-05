import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import { ActivityLogService, ActivityAction } from '../activity-log';
import { TextMiningService } from '../text-mining';
import type { InterventionType, Prisma } from '@prisma/client';
import { Prisma as PrismaNs } from '@prisma/client';
import { StudentRagRetrievalService } from '../student-rag/student-rag-retrieval.service';
import type { RetrievedChunk } from '../student-rag/student-rag-retrieval.service';
import { EmbeddingService } from '../student-rag/embedding.service';
// Stage 06 — shared grounded-generation contract + multimodal helpers.
import { buildGroundedMessages, GROUNDING_CONTRACT } from '../rag/shared/grounded-prompt';
import {
  GroundedEvidenceService,
  type GroundedEvidence,
} from '../rag/shared/grounded-evidence.service';
import { loadImageChunkMetadata } from '../rag/shared/grounded-evidence.helpers';
import {
  FaithfulnessCheckService,
  buildFaithfulnessRetryAddendum,
} from '../rag/shared/faithfulness-check.service';
import { faithfulnessCheckEnabled } from '../rag/shared/multimodal-generation.flags';
import type { FunnelMessage, FunnelContentPart } from '../rag/llm.service';

// Stage 02 feature flag. Default ON.
function sharedRetrieverEnabled(): boolean {
  const v = (process.env.RAG_USE_SHARED_RETRIEVER ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}
import type {
  CreateSavedReviewDto,
  UpdateSavedReviewDto,
  GeneratePracticeTestDto,
  SubmitPracticeTestAnswersDto,
  GenerateSuggestionsDto,
  AskQuestionDto,
  GenerateStepwiseDto,
  SubmitStepCheckDto,
  GenerateCardsDto,
  ReviewCardDto,
  ChatRequestDto,
} from './dto';
import type { PracticeCoverage } from './dto/generate-practice-test.dto';
import { DEFAULT_PROMPTS } from './prompts/default-prompts';
import {
  buildPracticeTestingPrompt,
  buildPracticeAnswerCheckPrompt,
} from './prompts/practice-testing.prompt';
import {
  buildQuestionSuggestionPrompt,
  buildElaborationAnswerPrompt,
  buildConversationSummaryPrompt,
} from './prompts/interrogative-elaboration.prompt';
import {
  buildStepwiseLearningPrompt,
  buildStepCheckPrompt,
} from './prompts/stepwise-learning.prompt';
import { buildDistributedPracticePrompt } from './prompts/distributed-practice.prompt';
import {
  calculateNextReview,
  previewAllRatings,
  QUALITY_MAP,
  type QualityRating,
} from './utils/sm2-algorithm';

// ─── Practice Testing Interfaces ─────────────────────────

interface PracticeQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  keywords?: string[];
}

/** Reason the requested coverage scope was widened to the whole
 *  lesson. Propagated from `resolveInterventionContext` →
 *  `generatePracticeTest` → response → UI notice + CSV row. Null
 *  when coverage applied cleanly (or wasn't requested). */
export interface CoverageFallback {
  reason: 'no_chunks_in_range' | 'invalid_range_after_clamp' | 'no_pages_available';
  requestedPageStart?: number;
  requestedPageEnd?: number;
  clampedPageEnd?: number;
}

interface PracticeTestResult {
  interventionId: string;
  questions: Array<Omit<PracticeQuestion, 'correctAnswer' | 'explanation' | 'keywords'>>;
  /** Set when the student asked for a page range or subtopic but the
   *  request couldn't be honoured (e.g. zero chunks in the page range
   *  after clamping). Frontend shows a non-blocking notice. */
  coverageFallback?: CoverageFallback;
  /** True when the student didn't explicitly choose mcq/short counts.
   *  Distinguishes accepted-defaults from deliberate-choices in
   *  post-analysis. Mirrors what the activity-log meta carries. */
  usedDefaults: boolean;
  /** True iff `usedDefaults` AND the teacher's per-course
   *  `InterventionPromptConfig` carried non-null
   *  `defaultMcqCount`/`defaultShortAnswerCount` that were used in
   *  place of the hard-coded 3+2. */
  usedTeacherDefaults: boolean;
}

interface GradedAnswer {
  questionIndex: number;
  question: string;
  type: 'mcq' | 'short_answer';
  userAnswer: string;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
  feedback?: string;
  options?: string[];
}

interface GradedResult {
  interventionId: string;
  score: number;
  totalQuestions: number;
  results: GradedAnswer[];
}

// ─── Interrogative Elaboration Interfaces ───────────────

interface SuggestedQuestion {
  question: string;
  type: 'why' | 'how';
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  wasSuggested?: boolean;
}

// ─── Stage 3: JSON schemas for intervention generators ──────────────
//
// These describe the structured output we want from the LLM. Both the
// OpenAI funnel (response_format: json_schema) and the Gemini funnel
// (generationConfig.responseSchema) consume the same schema dialect —
// JSON Schema with string/number/array/object primitives — so the
// constants below work for both providers.
//
// Validators downstream (`validateXxxResponse`) defensively re-check the
// shape, so these schemas are best-effort hints to the model rather than
// strict gates. We deliberately keep them permissive (no `additionalProperties`
// or required-on-everything) to avoid bouncing well-formed responses.

/**
 * Build the JSON schema for a practice-testing response with strict
 * counts. The `questions` array is pinned to exactly `mcq + short`
 * items so the funnel can reject a malformed LLM response before our
 * own validator runs. (The funnel's `jsonSchema` is a hint, not a
 * gate, but per Stage 3 the OpenAI funnel enforces it via
 * `response_format: json_schema` strict mode when the funnel can.)
 *
 * Exported so the unit test can assert minItems/maxItems are pinned
 * to the requested totals.
 */
export function buildPracticeTestingSchema(mcq: number, short: number): Record<string, unknown> {
  const total = mcq + short;
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: total,
        maxItems: total,
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            type: { type: 'string', enum: ['mcq', 'short_answer'] },
            options: { type: 'array', items: { type: 'string' } },
            correctAnswer: { type: 'string' },
            explanation: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
          },
          required: ['question', 'type', 'correctAnswer', 'explanation'],
        },
      },
    },
    required: ['questions'],
  };
}

const PRACTICE_GRADE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    isCorrect: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: ['isCorrect', 'feedback'],
};

const INTERROGATIVE_SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    suggestedQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          type: { type: 'string', enum: ['why', 'how'] },
          topic: { type: 'string' },
          difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        },
        required: ['question', 'type', 'topic', 'difficulty'],
      },
    },
    keyConcepts: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestedQuestions'],
};

const INTERROGATIVE_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    conceptsCovered: { type: 'array', items: { type: 'string' } },
    questionsAsked: { type: 'integer' },
    depthRating: { type: 'string', enum: ['surface', 'moderate', 'deep'] },
  },
  required: ['summary'],
};

const STEPWISE_GENERATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          comprehensionCheck: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              sampleAnswer: { type: 'string' },
            },
            required: ['question', 'sampleAnswer'],
          },
        },
        required: ['title', 'content'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['steps'],
};

const STEPWISE_CHECK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    isCorrect: { type: 'boolean' },
    feedback: { type: 'string' },
    encouragement: { type: 'string' },
  },
  required: ['isCorrect', 'feedback'],
};

const DISTRIBUTED_PRACTICE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          hint: { type: 'string' },
        },
        required: ['front', 'back'],
      },
    },
  },
  required: ['cards'],
};

// ─── Helpers for extracting plain text from PAGE content ─────────────

/**
 * Strip HTML tags and decode a handful of common entities. Used when
 * walking the block-document JSON to convert each block's `html` field
 * into plain text the LLM can ingest cleanly.
 */
function stripHtmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\/?[A-Za-z][\w.-]*[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Walk a BlockDocument JSON value (what the AI generator stores in
 * `ModuleItem.contentMdx` — `{ version, blocks: [...] }`) and extract
 * human-readable text from every block. Falls back to scanning arbitrary
 * nested objects for known text-bearing fields so it tolerates schema
 * drift. Skips id/metadata bookkeeping fields entirely.
 */
function extractTextFromBlockDocument(doc: unknown): string {
  const parts: string[] = [];
  const textFields = new Set([
    'html',
    'text',
    'caption',
    'problem',
    'solution',
    'misconception',
    'correction',
    'question',
    'answer',
    'explanation',
  ]);
  const skip = new Set(['id', 'metadata', 'generationJobId', 'generatedBy', 'version']);
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if (t) parts.push(t);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      for (const f of textFields) {
        if (typeof o[f] === 'string') {
          parts.push(stripHtmlToPlainText(o[f] as string));
        }
      }
      for (const [k, v] of Object.entries(o)) {
        if (skip.has(k)) continue;
        if (textFields.has(k)) continue;
        if (typeof v === 'object' && v !== null) visit(v);
      }
    }
  };
  visit(doc);
  return parts
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Best-effort PAGE-content → plain-text. Tries JSON block-document
 * parsing first (the AI-generated format); falls back to MDX-style
 * stripping for legacy / hand-authored pages. Returns the cleanest
 * text we can produce. The JSON-first path avoids treating `{...}`
 * as JSX expressions and shredding the JSON values — which produced
 * garbage like `,"metadata":}` previously.
 */
function extractTextFromBlockDocumentOrMdx(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const text = extractTextFromBlockDocument(parsed);
      if (text) return text;
    } catch {
      // not JSON — fall through
    }
  }
  // Fallback: MDX-style stripping
  let s = value;
  s = s.replace(/^(?:import|export)\s+[^\n]+\n/gm, '');
  s = s.replace(/<\/?[A-Za-z][\w.-]*[^>]*>/g, '');
  s = s.replace(/\{[\s\S]*?\}/g, '');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^[*\-+]\s+/gm, '');
  s = s.replace(/^>\s+/gm, '');
  s = s.replace(/^```[\s\S]*?```$/gm, '');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

interface ElaborationSessionData {
  suggestedQuestions: SuggestedQuestion[];
  keyConcepts: string[];
  conversation: ConversationMessage[];
  selectedText: string;
  questionsAsked: number;
}

interface SuggestionResult {
  interventionId: string;
  suggestedQuestions: SuggestedQuestion[];
  keyConcepts: string[];
}

// ─── Stepwise Learning Interfaces ────────────────────────

interface StepwiseComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

interface StepwiseStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: StepwiseComprehensionCheck;
}

interface StepUserResponse {
  response: string;
  feedback: string;
  isCorrect: boolean;
  timestamp: string;
}

interface StepResult {
  attempts: number;
  passed: boolean;
  userResponses: StepUserResponse[];
}

interface StepwiseSessionData {
  steps: StepwiseStep[];
  summary: string;
  currentStep: number;
  selectedText: string;
  stepResults: Record<number, StepResult>;
}

interface StepCheckResponse {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
  attempts: number;
  showAnswer: boolean;
  sampleAnswer?: string;
}

// ─── Distributed Practice Interfaces ─────────────────────

interface FlashcardData {
  front: string;
  back: string;
}

interface ConversationSummary {
  summary: string;
  conceptsCovered: string[];
  questionsAsked: number;
  depthRating: 'surface' | 'moderate' | 'deep';
}

@Injectable()
export class LearningInterventionsService {
  private readonly logger = new Logger(LearningInterventionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly activityLogService: ActivityLogService,
    @Inject(forwardRef(() => TextMiningService))
    private readonly textMining: TextMiningService,
    private readonly studentRagRetrieval: StudentRagRetrievalService,
    private readonly embeddingService: EmbeddingService,
    // Stage 06 — shared grounded-evidence builder (fetches image
    // bytes from MinIO + applies the cap) and faithfulness check
    // service. Both come through RagModule exports.
    private readonly groundedEvidence: GroundedEvidenceService,
    private readonly faithfulnessCheck: FaithfulnessCheckService,
  ) {}

  // ─── Prompt Config ────────────────────────────────────────

  async getSystemPrompt(courseId: string, interventionType: InterventionType): Promise<string> {
    const customConfig = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
    });

    if (customConfig?.isCustom && customConfig.systemPrompt) {
      return customConfig.systemPrompt;
    }

    return DEFAULT_PROMPTS[interventionType].systemPrompt;
  }

  async getPromptConfig(courseId: string, interventionType: InterventionType) {
    const customConfig = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
    });

    const defaults = DEFAULT_PROMPTS[interventionType];

    return {
      interventionType,
      courseId,
      isCustom: !!customConfig?.isCustom,
      systemPrompt: customConfig?.isCustom ? customConfig.systemPrompt : defaults.systemPrompt,
      defaultSystemPrompt: defaults.systemPrompt,
      userPromptTemplate: defaults.userPromptTemplate,
      label: defaults.label,
      description: defaults.description,
      // P4 — surface teacher-tunable default counts for the
      // Practice Testing config UI. Null on every other intervention
      // type AND on any row where the teacher hasn't set them yet.
      defaultMcqCount: customConfig?.defaultMcqCount ?? null,
      defaultShortAnswerCount: customConfig?.defaultShortAnswerCount ?? null,
    };
  }

  async getAllPromptConfigs(courseId: string) {
    const types: InterventionType[] = [
      'PRACTICE_TESTING',
      'DISTRIBUTED_PRACTICE',
      'STEPWISE_LEARNING',
      'INTERROGATIVE_ELABORATION',
    ];

    return Promise.all(types.map((t) => this.getPromptConfig(courseId, t)));
  }

  async updatePromptConfig(
    courseId: string,
    interventionType: InterventionType,
    teacherId: string,
    systemPrompt: string,
  ) {
    if (!systemPrompt || systemPrompt.trim().length < 50) {
      throw new BadRequestException('System prompt must be at least 50 characters');
    }

    if (systemPrompt.length > 10000) {
      throw new BadRequestException('System prompt must be less than 10000 characters');
    }

    const hasJsonInstruction =
      systemPrompt.toLowerCase().includes('json') && systemPrompt.toLowerCase().includes('format');

    await this.prisma.interventionPromptConfig.upsert({
      where: {
        courseId_interventionType: { courseId, interventionType },
      },
      create: {
        courseId,
        interventionType,
        teacherId,
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
      update: {
        systemPrompt: systemPrompt.trim(),
        isCustom: true,
      },
    });

    const config = await this.getPromptConfig(courseId, interventionType);
    return {
      ...config,
      warning: hasJsonInstruction
        ? null
        : 'Your prompt may not include JSON formatting instructions. The intervention may not work correctly.',
    };
  }

  /** P4 — update the per-course Practice Testing default counts.
   *  Both values are nullable: pass `null` to clear an override
   *  (fall back to the hard-coded 3+2). Bounded to [0, 10] and the
   *  combined total to [1, 10] when at least one value is non-null
   *  (matches the gate in `generatePracticeTest`'s resolver). */
  async updatePracticeTestDefaults(
    courseId: string,
    teacherId: string,
    defaults: {
      defaultMcqCount: number | null;
      defaultShortAnswerCount: number | null;
    },
  ) {
    const { defaultMcqCount, defaultShortAnswerCount } = defaults;
    const validateOne = (label: string, v: number | null) => {
      if (v == null) return;
      if (!Number.isInteger(v) || v < 0 || v > 10) {
        throw new BadRequestException(`${label} must be an integer between 0 and 10`);
      }
    };
    validateOne('defaultMcqCount', defaultMcqCount);
    validateOne('defaultShortAnswerCount', defaultShortAnswerCount);
    if (defaultMcqCount != null || defaultShortAnswerCount != null) {
      const total = (defaultMcqCount ?? 3) + (defaultShortAnswerCount ?? 2);
      if (total < 1 || total > 10) {
        throw new BadRequestException(
          `Combined default total must be between 1 and 10 (got ${total})`,
        );
      }
    }

    // Practice Testing only — the columns are ignored on other rows.
    const existing = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: {
          courseId,
          interventionType: 'PRACTICE_TESTING',
        },
      },
    });

    if (existing) {
      await this.prisma.interventionPromptConfig.update({
        where: {
          courseId_interventionType: {
            courseId,
            interventionType: 'PRACTICE_TESTING',
          },
        },
        data: {
          defaultMcqCount,
          defaultShortAnswerCount,
        },
      });
    } else {
      // Seed a row that still uses the system-prompt default but
      // carries the teacher's count preferences. `isCustom=false`
      // keeps `getPromptConfig` returning the default systemPrompt.
      await this.prisma.interventionPromptConfig.create({
        data: {
          courseId,
          interventionType: 'PRACTICE_TESTING',
          teacherId,
          systemPrompt: DEFAULT_PROMPTS.PRACTICE_TESTING.systemPrompt,
          isCustom: false,
          defaultMcqCount,
          defaultShortAnswerCount,
        },
      });
    }

    return this.getPromptConfig(courseId, 'PRACTICE_TESTING');
  }

  async deletePromptConfig(courseId: string, interventionType: InterventionType) {
    await this.prisma.interventionPromptConfig
      .delete({
        where: {
          courseId_interventionType: { courseId, interventionType },
        },
      })
      .catch(() => {
        // If it doesn't exist, that's fine — already default
      });

    return this.getPromptConfig(courseId, interventionType);
  }

  async previewPrompt(
    userId: string,
    systemPrompt: string,
    sampleText: string,
    interventionType: InterventionType,
  ) {
    const defaults = DEFAULT_PROMPTS[interventionType];
    const userPrompt = defaults.userPromptTemplate
      .replace(/\{\{questionCount\}\}/g, '3')
      .replace(/\{\{cardCount\}\}/g, '3')
      .replace(/\{\{selectedText\}\}/g, sampleText);

    const resolvedSystem = systemPrompt
      .replace(/\{\{questionCount\}\}/g, '3')
      .replace(/\{\{cardCount\}\}/g, '3');

    const result = await this.llmService.callLlmForUser(userId, resolvedSystem, userPrompt, {
      feature: 'prompt_preview',
    });

    return {
      output: result.content,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  // ─── Shared input resolver ────────────────────────────────
  //
  // Replaces the four hard `selectedText must be at least 20 chars` 4xx
  // guards with a fallback that pulls top-K chunks of the course's
  // uploaded materials when the student hasn't selected any text. This
  // matches the behaviour of `chat()` and is what the user expects: an
  // intervention triggered without a text selection should still be
  // grounded in *something the teacher uploaded*, not free-styled by the
  // LLM.
  //
  // If the course has no indexed material yet (no DocumentChunk rows),
  // we fail loudly instead of silently feeding the LLM an empty context
  // — that's the failure mode that produces the "random content" bug.
  //
  // Caller passes the DTO. Returns a single string ready to drop into
  // {{selectedText}} in the existing prompt templates.

  private async resolveInterventionContext(
    studentId: string,
    dto: {
      selectedText?: string;
      courseId: string;
      contentId?: string;
      topic?: string;
      /** Practice-testing only narrowing. Other interventions still
       *  pass undefined. `pages` narrows the PDF/student-RAG slice,
       *  `subtopic` biases the retrieval query (or injects a focus
       *  note on the PDF path). `all` (or undefined) is today's
       *  behaviour. All narrowing is best-effort: any failure
       *  degrades to the unfiltered context with a console.warn. */
      coverage?: PracticeCoverage;
    },
  ): Promise<{
    text: string;
    source: 'selection' | 'student-rag' | 'pdf-source';
    /** Stage 06 — structured evidence shape ready for
     *  `buildGroundedMessages`. Null when source === 'selection'
     *  (the selected text is the single source of truth — there's
     *  no chunk/citation structure to attach). */
    evidence: GroundedEvidence | null;
    /** Set when a requested coverage narrowing was widened (e.g.
     *  page range had no chunks, or pageEnd had to be clamped past
     *  the document's last page and emptied the range). Undefined
     *  when coverage applied cleanly or wasn't requested. */
    coverageFallback?: CoverageFallback;
  }> {
    const sel = (dto.selectedText ?? '').trim();
    if (sel.length >= 20) {
      // Selection mode: no structured evidence, no images. The
      // caller's `ctx.text` is fed into the strategy-specific
      // prompt template as today. Coverage narrowing is ignored —
      // the student already chose what to focus on.
      return {
        text: dto.selectedText!,
        source: 'selection',
        evidence: null,
      };
    }

    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    const coverage = dto.coverage;

    // ─── STANDARD-MODE PDF path ──────────────────────────────────────
    if (dto.contentId) {
      // ── Subtopic mode on the PDF path uses the teacher hybrid
      // retriever (dense + sparse + RRF) against this course's
      // DocumentChunks, biased by the subtopic string. Teacher chunks
      // are fixed-size sliding windows with no section structure, so
      // we don't try to filter by heading — we just let retrieval
      // surface the most relevant slices. The PDF-text fallback below
      // still runs if retrieval throws or returns nothing.
      if (coverage?.mode === 'subtopic' && coverage.subtopic?.trim()) {
        try {
          const subtopicChunks = await this.queryTeacherChunksForSubtopic(
            dto.courseId,
            coverage.subtopic.trim(),
          );
          if (subtopicChunks && subtopicChunks.length > 0) {
            const filename = await this.lookupPdfFilenameForContent(dto.courseId, dto.contentId);
            const contextChunks = subtopicChunks.map((c, i) => {
              const pageLabel = c.pageNumber != null ? `, p.${c.pageNumber}` : '';
              return {
                id: `teacher-chunk:${c.chunkId}`,
                text: c.content,
                citationLabel: `Source ${i + 1}: ${filename ?? c.documentName ?? 'lesson PDF'}${pageLabel}`,
              };
            });
            const evidence: GroundedEvidence = {
              contextChunks,
              images: [],
              hasImages: false,
              totalImageBytes: 0,
            };
            const text = this.flattenEvidenceToLegacyText(evidence);
            return { text, source: 'pdf-source', evidence };
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[interventions] subtopic teacher-retrieval failed; falling back to full PDF text: ${(err as Error).message}`,
          );
        }
      }

      // ── Page-range narrowing: clamp pageEnd to the document's max
      // page first so a too-large value doesn't empty the slice. If
      // the clamped range becomes invalid (pageStart > clamped), or
      // the clamped slice returns zero chunks, record a fallback
      // reason and fall through to the unscoped PDF text. Tracks the
      // ORIGINAL requested range in coverageFallback so the UI can
      // tell the student exactly what they asked for vs got.
      let pdfText: string | null = null;
      let pdfFallback: CoverageFallback | undefined;
      let appliedPageStart: number | undefined;
      let appliedPageEnd: number | undefined;
      const wantsPages =
        coverage?.mode === 'pages' &&
        typeof coverage.pageStart === 'number' &&
        typeof coverage.pageEnd === 'number';
      try {
        if (wantsPages) {
          const reqStart = coverage!.pageStart as number;
          const reqEnd = coverage!.pageEnd as number;
          const maxPage = await this.lookupMaxPageForContent(dto.courseId, dto.contentId);
          // No page metadata at all (legacy ingest) — try the slice
          // anyway; the paged helper falls back to full text with a
          // warn when nothing matches. We still flag fallback only if
          // the helper actually returns null.
          if (maxPage == null) {
            const sliced = await this.tryResolveFromModuleItemPaged(
              dto.courseId,
              dto.contentId,
              reqStart,
              reqEnd,
            );
            if (sliced) {
              pdfText = sliced;
              appliedPageStart = reqStart;
              appliedPageEnd = reqEnd;
            } else {
              pdfFallback = {
                reason: 'no_pages_available',
                requestedPageStart: reqStart,
                requestedPageEnd: reqEnd,
              };
              pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
            }
          } else {
            const clampedEnd = Math.min(reqEnd, maxPage);
            if (reqStart > clampedEnd) {
              pdfFallback = {
                reason: 'invalid_range_after_clamp',
                requestedPageStart: reqStart,
                requestedPageEnd: reqEnd,
                clampedPageEnd: clampedEnd,
              };
              pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
            } else {
              const sliced = await this.tryResolveFromModuleItemPaged(
                dto.courseId,
                dto.contentId,
                reqStart,
                clampedEnd,
              );
              // sliced may have come back from the helper's own
              // full-text fallback when no chunks matched. Detect
              // that by comparing to the unscoped text — if equal,
              // the slice yielded nothing.
              if (!sliced) {
                pdfFallback = {
                  reason: 'no_chunks_in_range',
                  requestedPageStart: reqStart,
                  requestedPageEnd: reqEnd,
                  clampedPageEnd: clampedEnd,
                };
                pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
              } else {
                // The paged helper falls back to full text internally
                // when zero chunks match; distinguish by checking whether
                // ANY chunks exist in the clamped range.
                const hasAny = await this.hasChunksInPageRange(
                  dto.courseId,
                  dto.contentId,
                  reqStart,
                  clampedEnd,
                );
                if (!hasAny) {
                  pdfFallback = {
                    reason: 'no_chunks_in_range',
                    requestedPageStart: reqStart,
                    requestedPageEnd: reqEnd,
                    clampedPageEnd: clampedEnd,
                  };
                  // sliced here is the helper's full-text fallback —
                  // use it directly rather than re-fetching.
                  pdfText = sliced;
                } else {
                  pdfText = sliced;
                  appliedPageStart = reqStart;
                  appliedPageEnd = clampedEnd;
                }
              }
            }
          }
        } else {
          pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[interventions] coverage page-slice failed; falling back to full PDF: ${(err as Error).message}`,
        );
        pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
      }
      if (pdfText) {
        // For the PDF path, the subtopic mode (if it reached here)
        // couldn't narrow via teacher retrieval — fall back to a focus
        // note at the head of the context. The model still sees the
        // full PDF text below it.
        let finalText = pdfText;
        if (coverage?.mode === 'subtopic' && coverage.subtopic?.trim()) {
          finalText = `[Focus] The student wants to focus on: ${coverage.subtopic.trim()}\n\n${pdfText}`;
        }
        // PDF-as-context is single-document; no per-chunk citation
        // structure. Synthesise a single grounded chunk so the
        // shared contract still applies (the model is reminded to
        // cite [Source 1: <filename>] when quoting).
        const filename = await this.lookupPdfFilenameForContent(dto.courseId, dto.contentId);
        const pageSuffix =
          appliedPageStart != null && appliedPageEnd != null
            ? ` (pp. ${appliedPageStart}-${appliedPageEnd})`
            : '';
        return {
          text: finalText,
          source: 'pdf-source',
          evidence: {
            contextChunks: [
              {
                id: `pdf-source:${dto.contentId}`,
                text: finalText,
                citationLabel: `Source 1: ${filename ?? 'lesson PDF'}${pageSuffix}`,
              },
            ],
            images: [],
            hasImages: false,
            totalImageBytes: 0,
          },
          coverageFallback: pdfFallback,
        };
      }
    }

    // Build a RAG query.
    let query = (dto.topic ?? '').trim();
    if (!query && dto.contentId) {
      query = await this.deriveQueryFromContentId(dto.contentId);
    }
    if (!query) {
      const course = await this.prisma.course.findUnique({
        where: { id: dto.courseId },
        select: { title: true },
      });
      query = course?.title ?? 'key concepts';
    }
    // Subtopic narrowing: append a focus clause so dense/sparse
    // retrieval bias toward chunks mentioning the subtopic. Cheap and
    // degrades to today's behaviour if the subtopic isn't in the
    // corpus.
    if (coverage?.mode === 'subtopic' && coverage.subtopic?.trim()) {
      query = `${query} — focused on: ${coverage.subtopic.trim()}`;
    }

    // ─── STUDENT-RAG path ──────────────────────────────────────────
    // Pull raw chunks (multimodal-aware) and build the grounded
    // evidence shape via the shared service. Falls back to the
    // legacy snippet-block when no chunks come back.
    const rawChunks = await this.queryStudentRagRawChunks(studentId, dto.courseId, query);
    // Page-range narrowing on the student-RAG path: filter the
    // shared retriever's output by pageNumber. The current shared
    // retriever (`StudentRagRetrievalService.retrieveWithMeta`)
    // doesn't yet accept a page-range opt — rather than churn that
    // signature for one consumer, we filter in-memory here. Chunks
    // without a pageNumber (legacy ingest) survive the filter so we
    // don't accidentally narrow to zero results.
    let narrowed = rawChunks;
    let studentRagFallback: CoverageFallback | undefined;
    if (
      coverage?.mode === 'pages' &&
      typeof coverage.pageStart === 'number' &&
      typeof coverage.pageEnd === 'number'
    ) {
      const lo = coverage.pageStart;
      const hi = coverage.pageEnd;
      const filtered = rawChunks.filter(
        (c) => c.pageNumber == null || (c.pageNumber >= lo && c.pageNumber <= hi),
      );
      if (filtered.length > 0) {
        narrowed = filtered;
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[interventions] coverage page-range ${lo}-${hi} eliminated all student-RAG chunks; falling back to unfiltered set`,
        );
        studentRagFallback = {
          reason: 'no_chunks_in_range',
          requestedPageStart: lo,
          requestedPageEnd: hi,
        };
      }
    }
    if (narrowed.length > 0) {
      const imageMeta = await loadImageChunkMetadata(this.prisma, narrowed);
      const evidence = await this.groundedEvidence.buildEvidence(narrowed, imageMeta);
      const text = this.flattenEvidenceToLegacyText(evidence);
      return {
        text,
        source: 'student-rag',
        evidence,
        coverageFallback: studentRagFallback,
      };
    }

    // No student-uploaded chunks for this course → fail loudly.
    throw new BadRequestException(
      'No indexed materials yet for this course. ' +
        'Either highlight some text on the page first, or upload your ' +
        'study materials in the dialogue panel before triggering an ' +
        'intervention without a selection.',
    );
  }

  /** Stage 07 — page-range narrowing variant of
   *  `tryResolveFromModuleItem`. Slices a PDF's chunks by
   *  `pageNumber BETWEEN start AND end`. Falls back to the full PDF
   *  text with a console.warn when the underlying chunks lack
   *  pageNumber (legacy ingest) or when the slice would yield empty.
   *  PAGE-type items don't carry page numbers — for those we just
   *  return the full text (and the caller's focus note still
   *  applies). */
  private async tryResolveFromModuleItemPaged(
    courseId: string,
    contentId: string,
    pageStart: number,
    pageEnd: number,
  ): Promise<string | null> {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: contentId },
      select: {
        type: true,
        pdfFilename: true,
        contentMdx: true,
        module: { select: { courseId: true } },
      },
    });
    if (!item) return null;
    if (item.module.courseId !== courseId) return null;

    if (item.type === 'PDF' && item.pdfFilename) {
      const sourceDoc = await this.prisma.sourceDocument.findFirst({
        where: { courseId, filename: item.pdfFilename },
        select: { id: true },
      });
      if (!sourceDoc) return null;

      // Try the page-filtered query first.
      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          documentId: sourceDoc.id,
          pageNumber: { gte: pageStart, lte: pageEnd },
        },
        orderBy: { chunkIndex: 'asc' },
        select: { content: true },
      });
      if (chunks.length > 0) {
        const joined = chunks.map((c) => c.content).join('\n\n');
        return joined.length > 50_000 ? joined.slice(0, 50_000) : joined;
      }

      // No chunks in that page range OR the doc has no pageNumber
      // metadata (legacy ingest). Fall back to the full text + warn.
      // eslint-disable-next-line no-console
      console.warn(
        `[interventions] no page-numbered chunks for ${item.pdfFilename} pages ${pageStart}-${pageEnd}; falling back to full PDF text`,
      );
      return this.tryResolveFromModuleItem(courseId, contentId);
    }

    // PAGE-type items have no native pagination concept. The full
    // text is the safe default; the focus note added by the caller
    // still applies.
    return this.tryResolveFromModuleItem(courseId, contentId);
  }

  /** Look up the maximum `pageNumber` recorded for a PDF item's
   *  DocumentChunks. Used to clamp `coverage.pageEnd` before the
   *  page-filtered fetch. Returns null when:
   *    - the item isn't a PDF
   *    - the item's source document doesn't exist
   *    - no chunks carry pageNumber (legacy ingest)
   *  Triple-defensive: any throw degrades to null so the caller
   *  falls back to its existing best-effort path. */
  private async lookupMaxPageForContent(
    courseId: string,
    contentId: string,
  ): Promise<number | null> {
    try {
      const item = await this.prisma.moduleItem.findUnique({
        where: { id: contentId },
        select: {
          type: true,
          pdfFilename: true,
          module: { select: { courseId: true } },
        },
      });
      if (!item || item.module.courseId !== courseId) return null;
      if (item.type !== 'PDF' || !item.pdfFilename) return null;
      const sourceDoc = await this.prisma.sourceDocument.findFirst({
        where: { courseId, filename: item.pdfFilename },
        select: { id: true },
      });
      if (!sourceDoc) return null;
      const top = await this.prisma.documentChunk.findFirst({
        where: { documentId: sourceDoc.id, pageNumber: { not: null } },
        orderBy: { pageNumber: 'desc' },
        select: { pageNumber: true },
      });
      return top?.pageNumber ?? null;
    } catch {
      return null;
    }
  }

  /** True when at least one chunk exists in `[pageStart, pageEnd]`
   *  for the PDF behind `contentId`. Used to disambiguate the paged
   *  helper's "fell back to full text" path from a real hit so the
   *  caller can flag coverageFallback only when the slice was
   *  actually empty. Defensive: any throw degrades to `true` so we
   *  don't spuriously flag fallback when a count query fails. */
  private async hasChunksInPageRange(
    courseId: string,
    contentId: string,
    pageStart: number,
    pageEnd: number,
  ): Promise<boolean> {
    try {
      const item = await this.prisma.moduleItem.findUnique({
        where: { id: contentId },
        select: {
          type: true,
          pdfFilename: true,
          module: { select: { courseId: true } },
        },
      });
      if (!item || item.module.courseId !== courseId) return true;
      if (item.type !== 'PDF' || !item.pdfFilename) return true;
      const sourceDoc = await this.prisma.sourceDocument.findFirst({
        where: { courseId, filename: item.pdfFilename },
        select: { id: true },
      });
      if (!sourceDoc) return true;
      const hit = await this.prisma.documentChunk.findFirst({
        where: {
          documentId: sourceDoc.id,
          pageNumber: { gte: pageStart, lte: pageEnd },
        },
        select: { id: true },
      });
      return !!hit;
    } catch {
      return true;
    }
  }

  /** Subtopic-mode helper for the PDF path: run the teacher hybrid
   *  retriever (`StudentRagRetrievalService.retrieveTeacher`) over
   *  this course's DocumentChunks, biased by the subtopic string.
   *  Teacher chunks are fixed-size sliding windows with no section
   *  structure, so we can't filter by heading — retrieval scoring
   *  is the bias mechanism. Returns null when the corpus has no
   *  embeddings or retrieval throws; the caller falls back to the
   *  full-PDF text path. Triple-defensive. */
  private async queryTeacherChunksForSubtopic(
    courseId: string,
    subtopic: string,
  ): Promise<RetrievedChunk[] | null> {
    try {
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { teacherId: true },
      });
      if (!course?.teacherId) return null;
      const teacherId = course.teacherId;
      const creds = await this.embeddingService
        .resolveTeacherEmbeddingSpec(teacherId)
        .catch(() => null);
      const apiKey = creds?.apiKey ?? '';
      const provider = creds?.provider ?? 'fallback';
      const out = await this.studentRagRetrieval.retrieveTeacher(
        subtopic,
        courseId,
        null,
        5,
        teacherId,
        apiKey,
        provider,
      );
      if (out.meta.degradedRetrieval || out.meta.mixedIndexChunkCount > 0) {
        this.logger.warn(
          `interventions.queryTeacherChunksForSubtopic: degraded=${out.meta.degradedRetrieval} mixed=${out.meta.mixedIndexChunkCount}`,
        );
      }
      return out.chunks.length > 0 ? out.chunks : null;
    } catch (err) {
      this.logger.warn(`Teacher subtopic retrieval failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Stage 06 — look up the PDF filename for the standard-mode
   *  pdf-source path so the synthesised single-chunk citation
   *  label reflects what the student is actually looking at. */
  private async lookupPdfFilenameForContent(
    courseId: string,
    contentId: string,
  ): Promise<string | null> {
    try {
      const item = await this.prisma.moduleItem.findUnique({
        where: { id: contentId },
        select: { pdfFilename: true, module: { select: { courseId: true } } },
      });
      if (!item || item.module.courseId !== courseId) return null;
      return item.pdfFilename ?? null;
    } catch {
      return null;
    }
  }

  /** Stage 06 — render a legacy `[Source N — name, p.X]\nsnippet`
   *  block from grounded evidence so the existing
   *  `{{selectedText}}` substitution in the four intervention
   *  prompt templates still receives the right shape. Generators
   *  that want the full structured evidence read from `ctx.evidence`
   *  instead and pass it to `buildGroundedMessages`. */
  private flattenEvidenceToLegacyText(evidence: GroundedEvidence): string {
    const MAX_CHARS = 500;
    const lines: string[] = [];
    for (const c of evidence.contextChunks) {
      const snippet =
        c.text.length > MAX_CHARS ? c.text.slice(0, MAX_CHARS).trim() + '…' : c.text.trim();
      lines.push(`[${c.citationLabel}]\n${snippet}`);
    }
    for (const img of evidence.images) {
      lines.push(`[${img.citationLabel}] (image attached)`);
    }
    return lines.join('\n\n');
  }

  /**
   * Standard-mode helper: when the student is on a course module item
   * (PDF or PAGE-type AI-generated lesson) and triggers an intervention
   * without selecting text, ground on that specific item's content.
   *
   *  - PDF item: resolved via the matching teacher SourceDocument by
   *    filename within the course; we return the already-extracted
   *    DocumentChunks text (capped). If no matching source exists we
   *    return null (caller falls through to student-RAG).
   *  - PAGE item: parse the stored block-document JSON in
   *    `contentMdx` and extract plain text from every block. This is
   *    what the AI content generator writes — its field name is
   *    historical but the value is JSON, not real MDX. Returns null
   *    if the JSON is unparseable or has no text-bearing blocks.
   *
   * Returns null in any case where this resolver doesn't apply so the
   * caller can decide whether to fall through to other context sources.
   */
  private async tryResolveFromModuleItem(
    courseId: string,
    contentId: string,
  ): Promise<string | null> {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: contentId },
      select: {
        type: true,
        pdfFilename: true,
        contentMdx: true,
        module: { select: { courseId: true } },
      },
    });
    if (!item) return null;
    if (item.module.courseId !== courseId) return null;

    if (item.type === 'PDF' && item.pdfFilename) {
      const sourceDoc = await this.prisma.sourceDocument.findFirst({
        where: { courseId, filename: item.pdfFilename },
        select: { id: true },
      });
      if (!sourceDoc) return null;
      const chunks = await this.prisma.documentChunk.findMany({
        where: { documentId: sourceDoc.id },
        orderBy: { chunkIndex: 'asc' },
        select: { content: true },
      });
      if (chunks.length === 0) return null;
      const joined = chunks.map((c) => c.content).join('\n\n');
      return joined.length > 50_000 ? joined.slice(0, 50_000) : joined;
    }

    if (item.type === 'PAGE' && item.contentMdx) {
      const text = extractTextFromBlockDocumentOrMdx(item.contentMdx);
      if (!text) return null;
      return text.length > 50_000 ? text.slice(0, 50_000) : text;
    }

    return null;
  }

  /**
   * Stage 06 — return raw `RetrievedChunk[]` (carries `modality`)
   * for the grounded-evidence builder. Mirrors
   * `queryStudentRagChunks` but skips the snippet-block formatting.
   */
  private async queryStudentRagRawChunks(
    studentId: string,
    courseId: string,
    query: string,
  ): Promise<RetrievedChunk[]> {
    const activeSources = await this.prisma.studentSourceDocument.findMany({
      where: { studentId, courseId, isActive: true },
      select: { id: true },
    });
    if (activeSources.length === 0) return [];
    const sourceIds = activeSources.map((s) => s.id);

    if (sharedRetrieverEnabled()) {
      try {
        const haveEmbeddings = await this.prisma.studentRagChunk.findFirst({
          where: {
            studentId,
            courseId,
            documentId: { in: sourceIds },
            embedding: { not: PrismaNs.JsonNull },
          },
          select: { id: true },
        });
        if (haveEmbeddings) {
          const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { teacherId: true },
          });
          const teacherId = course?.teacherId;
          const creds = teacherId
            ? await this.embeddingService.resolveTeacherEmbeddingSpec(teacherId)
            : null;
          const apiKey = creds?.apiKey ?? '';
          const provider = creds?.provider ?? 'fallback';
          const out = await this.studentRagRetrieval.retrieveWithMeta(
            query,
            studentId,
            courseId,
            sourceIds,
            5,
            apiKey,
            provider,
            teacherId,
          );
          if (out.meta.degradedRetrieval || out.meta.mixedIndexChunkCount > 0) {
            this.logger.warn(
              `interventions.queryStudentRagRawChunks: degraded=${out.meta.degradedRetrieval} mixed=${out.meta.mixedIndexChunkCount}`,
            );
          }
          if (out.chunks.length > 0) return out.chunks;
        }
      } catch (err) {
        this.logger.warn(
          `Shared retriever failed in interventions raw; falling back to keyword: ${(err as Error).message}`,
        );
      }
    }

    // Legacy keyword fallback — synthesise RetrievedChunk-shaped
    // entries so downstream code doesn't branch. All keyword hits
    // are `text` modality (no image chunks survive the keyword
    // scorer).
    const chunks = await this.prisma.studentRagChunk.findMany({
      where: { studentId, courseId, documentId: { in: sourceIds } },
      include: { document: { select: { originalName: true } } },
    });
    if (chunks.length === 0) return [];

    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = chunks.map((chunk) => {
      const haystack = `${chunk.contextualText ?? ''} ${chunk.content}`;
      const haystackLower = haystack.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = haystackLower.match(new RegExp(escaped, 'g'));
        score += matches ? matches.length : 0;
      }
      score = score / Math.sqrt(haystack.length / 100);
      return { chunk, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(({ chunk, score }) => ({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.document.originalName,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      score,
      metadata: {},
      modality: 'text' as const,
    }));
  }

  /** Stage 02: prefer the shared hybrid retriever
   *  (`StudentRagRetrievalService`). Falls back to the legacy keyword
   *  scorer when:
   *    - `RAG_USE_SHARED_RETRIEVER=false`, OR
   *    - no chunks in the corpus have embeddings yet.
   *  Output shape (string snippet block) is preserved so callers
   *  (`resolveInterventionContext` + `chat()` grounding) don't need to
   *  change. */
  private async queryStudentRagChunks(
    studentId: string,
    courseId: string,
    query: string,
  ): Promise<string | null> {
    const activeSources = await this.prisma.studentSourceDocument.findMany({
      where: { studentId, courseId, isActive: true },
      select: { id: true },
    });
    if (activeSources.length === 0) return null;
    const sourceIds = activeSources.map((s) => s.id);

    const top: Array<{
      documentName: string;
      pageNumber: number | null;
      content: string;
    }> = [];

    if (sharedRetrieverEnabled()) {
      try {
        const haveEmbeddings = await this.prisma.studentRagChunk.findFirst({
          where: {
            studentId,
            courseId,
            documentId: { in: sourceIds },
            embedding: { not: PrismaNs.JsonNull },
          },
          select: { id: true },
        });
        if (haveEmbeddings) {
          const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { teacherId: true },
          });
          const teacherId = course?.teacherId;
          const creds = teacherId
            ? await this.embeddingService.resolveTeacherEmbeddingSpec(teacherId)
            : null;
          const apiKey = creds?.apiKey ?? '';
          const provider = creds?.provider ?? 'fallback';
          const out = await this.studentRagRetrieval.retrieveWithMeta(
            query,
            studentId,
            courseId,
            sourceIds,
            5,
            apiKey,
            provider,
            teacherId,
          );
          if (out.meta.degradedRetrieval || out.meta.mixedIndexChunkCount > 0) {
            this.logger.warn(
              `interventions.queryStudentRagChunks: degraded=${out.meta.degradedRetrieval} mixed=${out.meta.mixedIndexChunkCount}`,
            );
          }
          for (const c of out.chunks) {
            top.push({
              documentName: c.documentName,
              pageNumber: c.pageNumber,
              content: c.content,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          `Shared retriever failed in interventions; falling back to keyword: ${(err as Error).message}`,
        );
      }
    }

    if (top.length === 0) {
      // Keyword fallback (legacy behaviour) — Stage 03 scoring now
      // includes `contextualText` in the haystack so context-only
      // hits surface here too. Generator-facing payload remains the
      // original `content`.
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: {
          studentId,
          courseId,
          documentId: { in: sourceIds },
        },
        include: { document: { select: { originalName: true } } },
      });
      if (chunks.length === 0) return null;

      const queryTerms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 2);

      const scored = chunks.map((chunk) => {
        const haystack = `${chunk.contextualText ?? ''} ${chunk.content}`;
        const haystackLower = haystack.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const matches = haystackLower.match(new RegExp(escaped, 'g'));
          score += matches ? matches.length : 0;
        }
        score = score / Math.sqrt(haystack.length / 100);
        return {
          documentName: chunk.document.originalName,
          pageNumber: chunk.pageNumber,
          content: chunk.content,
          score,
        };
      });
      scored.sort((a, b) => b.score - a.score);

      // If the top score is 0 the query didn't match anything — return the
      // top 5 chunks anyway (common case when the topic is just a course
      // title with no overlap; we'd rather feed the LLM something the
      // student actually uploaded than fall through to teacher RAG which
      // is empty).
      for (const c of scored.slice(0, 5)) {
        top.push({
          documentName: c.documentName,
          pageNumber: c.pageNumber,
          content: c.content,
        });
      }
    }

    if (top.length === 0) return null;

    const MAX_CHARS = 500;
    return top
      .map((c, i) => {
        const snippet =
          c.content.length > MAX_CHARS
            ? c.content.slice(0, MAX_CHARS).trim() + '…'
            : c.content.trim();
        const pg = c.pageNumber !== null ? `, p.${c.pageNumber}` : '';
        return `[Source ${i + 1} — ${c.documentName}${pg}]\n${snippet}`;
      })
      .join('\n\n');
  }

  /** Best-effort: try to map `contentId` to a human-readable string the
   *  TF-IDF query can match against. Modules and module items have
   *  titles; bare page slugs don't, so we bail out gracefully. */
  private async deriveQueryFromContentId(contentId: string): Promise<string> {
    try {
      const moduleItem = await this.prisma.moduleItem.findUnique({
        where: { id: contentId },
        select: { title: true, module: { select: { title: true } } },
      });
      if (moduleItem) {
        return [moduleItem.module?.title, moduleItem.title].filter(Boolean).join(' — ');
      }
    } catch {
      /* ignore — contentId may not be a uuid */
    }
    return '';
  }

  /**
   * Stage 06 — shared invoker for the four intervention generators.
   *
   * Wraps `callLlmStructured` so:
   *   1. The strategy-specific `system` prompt produced by the
   *      `buildXxxPrompt()` builder is augmented with the verbatim
   *      grounding contract (cite, refuse if unsupported, treat
   *      captions as hints not facts).
   *   2. When `ctx.evidence?.images` is non-empty AND multimodal
   *      generation is on, the image bytes are attached as
   *      `FunnelImageUrlPart` content blocks on the user message
   *      so the VLM can actually see the figure.
   *   3. JSON-mode + jsonSchema flow through unchanged so the four
   *      generators' validators downstream still get structured
   *      output.
   *   4. Faithfulness check, when enabled, runs against the parsed
   *      JSON's flattened text and either passes or triggers ONE
   *      regenerate with a stricter addendum.
   *
   * The four generators all converge on `buildXxxPrompt(systemPrompt,
   * ctx.text, count)` → `{ system, user }` strings; we route those
   * through this method with `evidence` from `resolveInterventionContext`.
   */
  private async generateInterventionGrounded(args: {
    teacherId: string;
    courseId: string;
    triggeredByUserId: string;
    feature: string;
    /** Strategy-specific system prompt produced by buildXxxPrompt. */
    system: string;
    /** Strategy-specific user prompt; already includes `ctx.text`
     *  inlined via the prompt template (legacy `{{selectedText}}`
     *  substitution). */
    user: string;
    /** Grounded evidence shape from `resolveInterventionContext`.
     *  Null ⇒ selection mode; we still apply the grounding contract
     *  but attach no images and inject no extra context block
     *  (selection IS the source). */
    evidence: GroundedEvidence | null;
    jsonMode?: boolean;
    jsonSchema?: Record<string, unknown>;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    imageCount: number;
    imageInputBytes: number;
  }> {
    const images = args.evidence?.images ?? [];
    // Prepend the grounding contract to the system prompt. The
    // strategy-specific instructions (JSON shape, count) stay
    // exactly where they were; the contract is appended after a
    // divider so it composes cleanly.
    const systemWithContract = `${args.system.trim()}\n\n---\n\n${GROUNDING_CONTRACT}`;

    // Build the user message. When images are attached we use a
    // FunnelContentPart[] so the funnel sees image_url parts; when
    // not, we keep the plain string shape so older funnel paths /
    // mocks keep working.
    const messages: FunnelMessage[] = (() => {
      if (images.length === 0) {
        return [{ role: 'user' as const, content: args.user }];
      }
      const parts: FunnelContentPart[] = [{ type: 'text', text: args.user }];
      for (const img of images) {
        if (img.bytes && img.bytes.length > 0) {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.bytes.toString('base64')}`,
            },
          });
        } else if (img.presignedUrl && /^https?:\/\//i.test(img.presignedUrl)) {
          parts.push({ type: 'image_url', image_url: { url: img.presignedUrl } });
        }
      }
      return [{ role: 'user' as const, content: parts }];
    })();

    const first = await this.llmService.callLlmStructured(
      args.teacherId,
      {
        systemPrompt: systemWithContract,
        messages,
        jsonMode: args.jsonMode,
        jsonSchema: args.jsonSchema,
        maxTokens: args.maxTokens,
        temperature: args.temperature,
      },
      {
        feature: args.feature,
        courseId: args.courseId,
        triggeredByUserId: args.triggeredByUserId,
      },
    );

    let content = first.content;
    let promptTokens = first.promptTokens;
    let completionTokens = first.completionTokens;

    // Faithfulness check: default ON for intervention generation
    // (correctness > latency) per Stage 06 spec.
    if (faithfulnessCheckEnabled('intervention')) {
      const contextStr = this.flattenEvidenceForJudge(args.evidence);
      const outcome = await this.faithfulnessCheck.checkFaithfulness({
        answer: content,
        context: contextStr,
        teacherId: args.teacherId,
        courseId: args.courseId,
      });
      this.logger.log(
        `faithfulness_check.fired=true passed=${outcome.supported} judgeRan=${outcome.judgeRan}`,
      );
      if (!outcome.supported) {
        const stricter = await this.llmService.callLlmStructured(
          args.teacherId,
          {
            systemPrompt:
              systemWithContract + buildFaithfulnessRetryAddendum(outcome.unsupportedClaims ?? []),
            messages,
            jsonMode: args.jsonMode,
            jsonSchema: args.jsonSchema,
            maxTokens: args.maxTokens,
            temperature: args.temperature,
          },
          {
            feature: `${args.feature}_retry`,
            courseId: args.courseId,
            triggeredByUserId: args.triggeredByUserId,
          },
        );
        content = stricter.content;
        promptTokens += stricter.promptTokens;
        completionTokens += stricter.completionTokens;
        this.logger.log(`faithfulness_check.regenerated=true`);
      }
    }

    return {
      content,
      promptTokens,
      completionTokens,
      imageCount: images.length,
      imageInputBytes: args.evidence?.totalImageBytes ?? 0,
    };
  }

  /** Stage 06 — flatten grounded evidence into a string the
   *  faithfulness judge can score against. Mirrors the
   *  same-named helper in DialogueService. */
  private flattenEvidenceForJudge(evidence: GroundedEvidence | null): string {
    if (!evidence) return '';
    const lines: string[] = [];
    for (const c of evidence.contextChunks) {
      lines.push(`[${c.citationLabel}]`);
      if (c.text) lines.push(c.text);
      if (c.caption) lines.push(`(caption: ${c.caption})`);
      lines.push('');
    }
    for (const img of evidence.images) {
      lines.push(`[${img.citationLabel}]`);
      lines.push('(image attached)');
      if (img.caption) lines.push(`(caption: ${img.caption})`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // ─── Practice Testing ─────────────────────────────────────

  // ─── Pre-generation helpers ──────────────────────────────────────────────

  /** Called by the background pre-generation worker. Runs the LLM for a
   *  single (page, strategy) pair and returns the raw validated content.
   *  No Prisma writes, no activity logs — pure LLM call. */
  async preGeneratePage(
    courseId: string,
    pageText: string,
    strategy:
      | 'practice-testing'
      | 'distributed-practice'
      | 'stepwise-learning'
      | 'interrogative-elaboration',
  ): Promise<unknown> {
    const teacherId = await this.getCourseTeacherIdWithApiKey(courseId);

    const callOnce = async (
      feature: string,
      system: string,
      user: string,
      schema: Record<string, unknown>,
    ) =>
      this.generateInterventionGrounded({
        teacherId,
        courseId,
        triggeredByUserId: teacherId,
        feature,
        system,
        user,
        evidence: null,
        jsonMode: true,
        jsonSchema: schema,
      });

    if (strategy === 'practice-testing') {
      const sp = await this.getSystemPrompt(courseId, 'PRACTICE_TESTING');
      const { system, user } = buildPracticeTestingPrompt(sp, pageText, {
        mcqCount: 3,
        shortAnswerCount: 2,
      });
      const r = await callOnce(
        'practice_testing_pregen',
        system,
        user,
        buildPracticeTestingSchema(3, 2),
      );
      return this.validatePracticeTestResponse(this.parseLlmJson(r.content));
    }

    if (strategy === 'distributed-practice') {
      const sp = await this.getSystemPrompt(courseId, 'DISTRIBUTED_PRACTICE');
      const { system, user } = buildDistributedPracticePrompt(sp, pageText, 5);
      const r = await callOnce(
        'distributed_practice_pregen',
        system,
        user,
        DISTRIBUTED_PRACTICE_SCHEMA,
      );
      return this.validateFlashcardResponse(this.parseLlmJson(r.content));
    }

    if (strategy === 'stepwise-learning') {
      const sp = await this.getSystemPrompt(courseId, 'STEPWISE_LEARNING');
      const { system, user } = buildStepwiseLearningPrompt(sp, pageText);
      const r = await callOnce('stepwise_learning_pregen', system, user, STEPWISE_GENERATE_SCHEMA);
      const v = this.validateStepwiseResponse(this.parseLlmJson(r.content));
      return { steps: v.steps, summary: v.summary };
    }

    // interrogative-elaboration
    const sp = await this.getSystemPrompt(courseId, 'INTERROGATIVE_ELABORATION');
    const { system, user } = buildQuestionSuggestionPrompt(sp, pageText, 6);
    const r = await callOnce('ie_pregen', system, user, INTERROGATIVE_SUGGESTION_SCHEMA);
    const v = this.validateSuggestionResponse(this.parseLlmJson(r.content));
    return { suggestedQuestions: v.suggestedQuestions, keyConcepts: v.keyConcepts };
  }

  private async findPreGeneratedExercise(
    documentId: string,
    pageNumber: number,
    strategy: string,
  ): Promise<{ content: unknown } | null> {
    try {
      return await this.prisma.preGeneratedExercise.findFirst({
        where: { documentId, pageNumber, strategy, status: 'done' },
        orderBy: { setIndex: 'asc' },
        select: { content: true },
      });
    } catch {
      return null;
    }
  }

  // ─── Generate methods ────────────────────────────────────────────────────

  async generatePracticeTest(
    userId: string,
    dto: GeneratePracticeTestDto,
    sessionId?: string,
  ): Promise<PracticeTestResult> {
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    // ─── Pre-generation cache ──────────────────────────────────────────────
    if (dto.documentId && dto.pageNumber != null) {
      const cached = await this.findPreGeneratedExercise(
        dto.documentId,
        dto.pageNumber,
        'practice-testing',
      );
      if (cached) {
        const allCached = cached.content as PracticeQuestion[];
        const cachedMcqs = allCached.filter((q) => q.type === 'mcq');
        const cachedShortAnswers = allCached.filter((q) => q.type === 'short_answer');

        // Resolve what the student actually requested (mirror the defaults used below)
        const wantMcq = dto.mcqCount ?? 3;
        const wantShort = dto.shortAnswerCount ?? 2;

        // Only serve from cache when it has enough questions of each type.
        // If the student requested more than what was pre-generated, fall
        // through to live LLM so the full count is honoured.
        if (cachedMcqs.length >= wantMcq && cachedShortAnswers.length >= wantShort) {
          const questions = [
            ...cachedMcqs.slice(0, wantMcq),
            ...cachedShortAnswers.slice(0, wantShort),
          ];
          const intervention = await this.prisma.learningIntervention.create({
            data: {
              userId,
              courseId: dto.courseId,
              contentId: dto.contentId || null,
              pageType: dto.pageType || null,
              type: 'PRACTICE_TESTING',
              status: 'IN_PROGRESS',
              selectedText: `[pre-generated page ${dto.pageNumber}]`,
              sessionData: {
                questions,
                config: {
                  mcqCount: wantMcq,
                  shortAnswerCount: wantShort,
                  coverage: { mode: 'all' },
                  usedDefaults: false,
                },
              } as unknown as Prisma.InputJsonValue,
            },
          });
          if (sessionId) {
            void this.activityLogService.record({
              sessionId,
              userId,
              action: ActivityAction.INTERVENTION_TRIGGERED,
              interventionId: intervention.id,
              courseId: dto.courseId,
              metadata: { interventionType: 'PRACTICE_TESTING', triggerReason: 'pre_generated' },
            });
          }
          return {
            interventionId: intervention.id,
            questions: questions.map((q) => ({
              question: q.question,
              type: q.type,
              options: q.options,
            })),
            coverageFallback: undefined,
            usedDefaults: false,
            usedTeacherDefaults: false,
          };
        }
        // Cache hit but not enough questions — fall through to live LLM
      }
    }

    // ─── Count resolution + validation ──────────────────────────────
    // First apply the sync DTO-only resolution (rejects bad counts
    // BEFORE we touch Prisma — keeps the validation test fixtures
    // working without a real DB). Then, when the student didn't
    // explicitly pass any counts, swap the hard-coded 3+2 for the
    // teacher's per-course configured defaults if any are set.
    const _resolved = this.resolvePracticeCounts(dto);
    const usedDefaults = _resolved.usedDefaults;
    let resolvedMcqCount = _resolved.mcqCount;
    let resolvedShortAnswerCount = _resolved.shortAnswerCount;
    let usedTeacherDefaults = false;
    if (
      usedDefaults &&
      dto.mcqCount === undefined &&
      dto.shortAnswerCount === undefined &&
      dto.questionCount === undefined
    ) {
      try {
        const teacherDefaults = await this.lookupTeacherPracticeDefaults(dto.courseId);
        if (teacherDefaults) {
          const t = {
            mcqCount: teacherDefaults.defaultMcqCount ?? resolvedMcqCount,
            shortAnswerCount: teacherDefaults.defaultShortAnswerCount ?? resolvedShortAnswerCount,
          };
          // Re-validate the teacher's configured values land in [1,10]
          // total — if a stale row would push us out of bounds, ignore
          // it and keep the hard-coded fallback (don't 400 the student
          // for a teacher misconfig).
          const total = t.mcqCount + t.shortAnswerCount;
          if (total >= 1 && total <= 10) {
            resolvedMcqCount = t.mcqCount;
            resolvedShortAnswerCount = t.shortAnswerCount;
            // Only mark teacher defaults when at least one of the
            // two slots was actually overridden by a non-null value.
            usedTeacherDefaults =
              teacherDefaults.defaultMcqCount != null ||
              teacherDefaults.defaultShortAnswerCount != null;
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[interventions] lookupTeacherPracticeDefaults failed; using hard-coded 3+2: ${(err as Error).message}`,
        );
      }
    }
    // ─── Coverage validation ────────────────────────────────────────
    this.validatePracticeCoverage(dto.coverage);

    // Resolve context: either selected text, or RAG over course material.
    // Triple-defensive: if coverage narrowing throws somewhere inside,
    // fall back to the unfiltered context with a console.warn so the
    // student still gets a test.
    let ctx;
    try {
      ctx = await this.resolveInterventionContext(userId, {
        ...dto,
        coverage: dto.coverage,
      });
    } catch (err) {
      if (err instanceof BadRequestException) {
        // Genuine "no materials" / "courseId required" — propagate.
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[interventions] resolveInterventionContext with coverage failed; retrying without coverage: ${(err as Error).message}`,
      );
      ctx = await this.resolveInterventionContext(userId, {
        selectedText: dto.selectedText,
        courseId: dto.courseId,
        contentId: dto.contentId,
        topic: dto.topic,
      });
    }
    if (ctx.source !== 'selection') {
      this.logger.log(`Practice test: no selection, grounded on ${ctx.source} (${dto.courseId})`);
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    // Get system prompt (custom or default)
    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'PRACTICE_TESTING');

    const { system, user } = buildPracticeTestingPrompt(systemPrompt, ctx.text, {
      mcqCount: resolvedMcqCount,
      shortAnswerCount: resolvedShortAnswerCount,
    });

    // Per-call schema pinning the exact totals via minItems/maxItems.
    const practiceSchema = buildPracticeTestingSchema(resolvedMcqCount, resolvedShortAnswerCount);

    // Call LLM with retry on malformed JSON
    let questions: PracticeQuestion[];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Stage 06 — route through the shared grounded invoker so:
        //   - the strategy-specific system prompt picks up the
        //     verbatim grounding contract
        //   - any image chunks retrieval surfaced get attached as
        //     image_url content blocks (capped via
        //     RAG_MAX_IMAGES_PER_CALL)
        //   - faithfulness self-check (default ON for interventions)
        //     runs against the generated JSON
        const result = await this.generateInterventionGrounded({
          teacherId,
          courseId: dto.courseId,
          triggeredByUserId: userId,
          feature: 'practice_testing',
          system,
          user,
          evidence: ctx.evidence,
          jsonMode: true,
          jsonSchema: practiceSchema,
        });
        const parsed = this.parseLlmJson(result.content);
        questions = this.validatePracticeTestResponse(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Practice test generation failed after retries', err);
          throw new BadRequestException('Failed to generate practice test. Please try again.');
        }
        this.logger.warn(`Practice test generation attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'PRACTICE_TESTING',
        status: 'IN_PROGRESS',
        // Persist what the LLM actually saw — selection or RAG context —
        // so downstream grading replays use the same grounding.
        selectedText: ctx.text,
        sessionData: {
          questions: questions!,
          config: {
            mcqCount: resolvedMcqCount,
            shortAnswerCount: resolvedShortAnswerCount,
            coverage: dto.coverage ?? { mode: 'all' },
            usedDefaults,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (sessionId) {
      const configMeta = {
        interventionType: 'PRACTICE_TESTING' as const,
        mcqCount: resolvedMcqCount,
        shortAnswerCount: resolvedShortAnswerCount,
        coverageMode: dto.coverage?.mode ?? 'all',
        pageStart: dto.coverage?.pageStart ?? null,
        pageEnd: dto.coverage?.pageEnd ?? null,
        subtopic: dto.coverage?.subtopic ?? null,
        usedDefaults,
        // Distinguishes the teacher-configured 4+1 (say) default from
        // the hard-coded 3+2. Both are "the student didn't pick"
        // (usedDefaults=true) but the source differs.
        usedTeacherDefaults,
        // Coverage scope was widened (e.g. requested pp.40-50 on a
        // 20-page document). Null when coverage applied cleanly.
        coverageFallback: ctx.coverageFallback ?? null,
      };

      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.PRACTICE_TEST_CONFIGURED,
        interventionId: intervention.id,
        courseId: dto.courseId,
        metadata: configMeta,
      });

      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        courseId: dto.courseId,
        metadata: {
          interventionType: 'PRACTICE_TESTING',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: PRACTICE_TESTING`,
          config: configMeta,
        },
      });
    }

    // Return questions without answers
    return {
      interventionId: intervention.id,
      questions: questions!.map((q) => ({
        question: q.question,
        type: q.type,
        options: q.options,
      })),
      coverageFallback: ctx.coverageFallback,
      usedDefaults,
      usedTeacherDefaults,
    };
  }

  /** P4 — read the teacher's per-course
   *  `defaultMcqCount`/`defaultShortAnswerCount` from
   *  `InterventionPromptConfig` for `PRACTICE_TESTING`. Returns null
   *  when no row exists OR both columns are null. Triple-defensive
   *  via the caller's try/catch — any throw degrades to "no teacher
   *  defaults" and the hard-coded 3+2 wins. */
  private async lookupTeacherPracticeDefaults(courseId: string): Promise<{
    defaultMcqCount: number | null;
    defaultShortAnswerCount: number | null;
  } | null> {
    const row = await this.prisma.interventionPromptConfig.findUnique({
      where: {
        courseId_interventionType: {
          courseId,
          interventionType: 'PRACTICE_TESTING',
        },
      },
      select: { defaultMcqCount: true, defaultShortAnswerCount: true },
    });
    if (!row) return null;
    if (row.defaultMcqCount == null && row.defaultShortAnswerCount == null) {
      return null;
    }
    return row;
  }

  /**
   * Resolve the (mcq, short) split from the DTO. Order of preference:
   *
   *  1. Explicit `mcqCount` and/or `shortAnswerCount` — when EITHER is
   *     present, both are used (the other defaulted to 3/2).
   *  2. Legacy `questionCount` — clamp to [1, 10] then split 60/40.
   *  3. Defaults — 3 MCQ + 2 short = 5 total.
   *
   * Re-validates the resolved sum against [1, 10] and integer-ness
   * before returning. The frontend's bounds-check is advisory; this
   * is the authoritative gate.
   *
   * Exported via being public-by-omission to facilitate testing —
   * keeps the validation logic colocated with the consumer.
   */
  private resolvePracticeCounts(dto: GeneratePracticeTestDto): {
    mcqCount: number;
    shortAnswerCount: number;
    usedDefaults: boolean;
  } {
    const hasMcq = dto.mcqCount !== undefined;
    const hasShort = dto.shortAnswerCount !== undefined;
    const usedDefaults = !hasMcq && !hasShort;

    let mcqCount: number;
    let shortAnswerCount: number;

    if (hasMcq || hasShort) {
      mcqCount = hasMcq ? Number(dto.mcqCount) : 3;
      shortAnswerCount = hasShort ? Number(dto.shortAnswerCount) : 2;
    } else if (dto.questionCount !== undefined) {
      // Legacy single-count clients. Clamp to [1, 10] then split 60/40.
      const n = Math.min(Math.max(Math.round(Number(dto.questionCount)), 1), 10);
      mcqCount = Math.ceil(n * 0.6);
      shortAnswerCount = n - mcqCount;
    } else {
      mcqCount = 3;
      shortAnswerCount = 2;
    }

    if (!Number.isInteger(mcqCount) || mcqCount < 0) {
      throw new BadRequestException('mcqCount must be a non-negative integer');
    }
    if (!Number.isInteger(shortAnswerCount) || shortAnswerCount < 0) {
      throw new BadRequestException('shortAnswerCount must be a non-negative integer');
    }

    const total = mcqCount + shortAnswerCount;
    if (total < 1 || total > 10) {
      throw new BadRequestException(
        `Total questions (mcqCount + shortAnswerCount) must be between 1 and 10 (got ${total})`,
      );
    }

    return { mcqCount, shortAnswerCount, usedDefaults };
  }

  /** Throws 400 if `coverage` is structurally invalid. `all` and
   *  undefined are no-ops; `pages` requires both ints with start <=
   *  end; `subtopic` requires a non-empty trimmed string. */
  private validatePracticeCoverage(coverage: PracticeCoverage | undefined): void {
    if (!coverage) return;
    if (coverage.mode === 'all') return;
    if (coverage.mode === 'pages') {
      const start = coverage.pageStart;
      const end = coverage.pageEnd;
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(end)
      ) {
        throw new BadRequestException(
          'coverage.pageStart and coverage.pageEnd must be integers when coverage.mode === "pages"',
        );
      }
      if (start < 1 || end < 1) {
        throw new BadRequestException('coverage.pageStart and coverage.pageEnd must be >= 1');
      }
      if (start > end) {
        throw new BadRequestException('coverage.pageStart must be <= coverage.pageEnd');
      }
      return;
    }
    if (coverage.mode === 'subtopic') {
      if (!coverage.subtopic || coverage.subtopic.trim().length === 0) {
        throw new BadRequestException(
          'coverage.subtopic must be a non-empty string when coverage.mode === "subtopic"',
        );
      }
      return;
    }
    throw new BadRequestException(
      `coverage.mode must be one of "pages" | "subtopic" | "all" (got ${(coverage as { mode: string }).mode})`,
    );
  }

  async submitPracticeTestAnswers(
    userId: string,
    interventionId: string,
    dto: SubmitPracticeTestAnswersDto,
  ): Promise<GradedResult> {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: interventionId },
    });

    if (!intervention) {
      throw new NotFoundException('Practice test not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot submit answers for another user');
    }

    if (intervention.status === 'COMPLETED') {
      throw new BadRequestException('Practice test already completed');
    }

    const sessionData = intervention.sessionData as unknown as {
      questions: PracticeQuestion[];
    };
    const questions = sessionData?.questions;

    if (!questions || !Array.isArray(questions)) {
      throw new BadRequestException('Invalid practice test data');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    // Grade answers — MCQs deterministically, short answers via LLM
    const results: GradedAnswer[] = await Promise.all(
      questions.map(async (q, index) => {
        const submission = dto.answers.find((a) => a.questionIndex === index);
        const userAnswer = submission?.answer || '';

        if (q.type === 'short_answer' && userAnswer.trim()) {
          // LLM-based grading for open-ended answers
          const llmResult = await this.gradeShortAnswerWithLlm(
            teacherId,
            userId,
            intervention.courseId,
            q,
            userAnswer,
            intervention.selectedText || '',
          );
          return {
            questionIndex: index,
            question: q.question,
            type: q.type,
            userAnswer,
            correctAnswer: q.correctAnswer,
            correct: llmResult.isCorrect,
            explanation: q.explanation,
            feedback: llmResult.feedback,
            options: q.options,
          };
        }

        // MCQ or empty answer — use deterministic grading
        const correct = this.gradeAnswer(q, userAnswer);
        return {
          questionIndex: index,
          question: q.question,
          type: q.type,
          userAnswer,
          correctAnswer: q.correctAnswer,
          correct,
          explanation: q.explanation,
          options: q.options,
        };
      }),
    );

    const correctCount = results.filter((r) => r.correct).length;
    const score = Math.round((correctCount / questions.length) * 100);

    // Update intervention status
    await this.prisma.learningIntervention.update({
      where: { id: interventionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        sessionData: {
          questions,
          userAnswers: dto.answers,
          results,
          score,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      interventionId,
      score,
      totalQuestions: questions.length,
      results,
    };
  }

  async getPracticeTest(userId: string, interventionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: interventionId },
    });

    if (!intervention) {
      throw new NotFoundException('Practice test not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's practice test");
    }

    const sessionData = intervention.sessionData as unknown as {
      questions: PracticeQuestion[];
      results?: GradedAnswer[];
      score?: number;
    };

    if (intervention.status === 'COMPLETED') {
      return {
        interventionId: intervention.id,
        status: intervention.status,
        questions: sessionData.questions,
        results: sessionData.results,
        score: sessionData.score,
        completedAt: intervention.completedAt,
      };
    }

    // In progress — don't reveal answers
    return {
      interventionId: intervention.id,
      status: intervention.status,
      questions: sessionData.questions.map((q) => ({
        question: q.question,
        type: q.type,
        options: q.options,
      })),
    };
  }

  // ─── Interrogative Elaboration (Conversational Q&A) ─────

  async generateSuggestions(
    userId: string,
    dto: GenerateSuggestionsDto,
    sessionId?: string,
  ): Promise<SuggestionResult> {
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    // ─── Pre-generation cache ──────────────────────────────────────────────
    if (dto.documentId && dto.pageNumber != null) {
      const cached = await this.findPreGeneratedExercise(
        dto.documentId,
        dto.pageNumber,
        'interrogative-elaboration',
      );
      if (cached) {
        const c = cached.content as {
          suggestedQuestions: SuggestedQuestion[];
          keyConcepts: string[];
        };
        const intervention = await this.prisma.learningIntervention.create({
          data: {
            userId,
            courseId: dto.courseId,
            contentId: dto.contentId || null,
            pageType: dto.pageType || null,
            type: 'INTERROGATIVE_ELABORATION',
            status: 'IN_PROGRESS',
            selectedText: `[pre-generated page ${dto.pageNumber}]`,
            sessionData: {
              suggestedQuestions: c.suggestedQuestions,
              keyConcepts: c.keyConcepts,
              conversation: [],
              selectedText: `[pre-generated page ${dto.pageNumber}]`,
              questionsAsked: 0,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        if (sessionId) {
          void this.activityLogService.record({
            sessionId,
            userId,
            action: ActivityAction.INTERVENTION_TRIGGERED,
            interventionId: intervention.id,
            courseId: dto.courseId,
            metadata: {
              interventionType: 'INTERROGATIVE_ELABORATION',
              triggerReason: 'pre_generated',
            },
          });
        }
        return {
          interventionId: intervention.id,
          suggestedQuestions: c.suggestedQuestions,
          keyConcepts: c.keyConcepts,
        };
      }
    }

    const ctx = await this.resolveInterventionContext(userId, dto);
    if (ctx.source !== 'selection') {
      this.logger.log(
        `Interrogative elaboration: no selection, grounded on ${ctx.source} (${dto.courseId})`,
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    const questionCount = Math.min(Math.max(dto.questionCount || 6, 3), 10);

    // Get system prompt (custom or default)
    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'INTERROGATIVE_ELABORATION');

    const { system, user } = buildQuestionSuggestionPrompt(systemPrompt, ctx.text, questionCount);

    // Call LLM with retry on malformed JSON
    let suggestedQuestions: SuggestedQuestion[];
    let keyConcepts: string[] = [];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Stage 06 — shared grounded invoker (see practice testing).
        const result = await this.generateInterventionGrounded({
          teacherId,
          courseId: dto.courseId,
          triggeredByUserId: userId,
          feature: 'interrogative_elaboration',
          system,
          user,
          evidence: ctx.evidence,
          jsonMode: true,
          jsonSchema: INTERROGATIVE_SUGGESTION_SCHEMA,
        });
        const parsed = this.parseLlmJson(result.content);
        const validated = this.validateSuggestionResponse(parsed);
        suggestedQuestions = validated.suggestedQuestions;
        keyConcepts = validated.keyConcepts;
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Question suggestion generation failed after retries', err);
          throw new BadRequestException(
            'Failed to generate question suggestions. Please try again.',
          );
        }
        this.logger.warn(`Question suggestion attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'INTERROGATIVE_ELABORATION',
        status: 'IN_PROGRESS',
        selectedText: ctx.text,
        sessionData: {
          suggestedQuestions: suggestedQuestions!,
          keyConcepts,
          conversation: [],
          selectedText: ctx.text,
          questionsAsked: 0,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'INTERROGATIVE_ELABORATION',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: INTERROGATIVE_ELABORATION`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      suggestedQuestions: suggestedQuestions!,
      keyConcepts,
    };
  }

  async askQuestion(
    userId: string,
    sessionId: string,
    dto: AskQuestionDto,
  ): Promise<{ answer: string }> {
    if (!dto.question || dto.question.trim().length < 5) {
      throw new BadRequestException('Question must be at least 5 characters');
    }

    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    // Build the answer prompt with conversation history
    const { system, user } = buildElaborationAnswerPrompt({
      sourceText: sessionData.selectedText,
      conversationHistory: dto.conversationHistory || [],
      studentQuestion: dto.question,
    });

    let answer: string;
    try {
      const result = await this.llmService.callLlmForUser(teacherId, system, user, {
        feature: 'interrogative_elaboration',
        courseId: intervention.courseId,
        triggeredByUserId: userId,
      });
      answer = result.content;
    } catch {
      throw new BadRequestException('Failed to generate answer. Please try again.');
    }

    // Append both messages to the conversation
    const now = new Date().toISOString();
    const updatedConversation = [
      ...sessionData.conversation,
      { role: 'user' as const, content: dto.question, timestamp: now },
      { role: 'assistant' as const, content: answer, timestamp: now },
    ];

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          conversation: updatedConversation,
          questionsAsked: sessionData.questionsAsked + 1,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { answer };
  }

  async completeElaborationSession(
    userId: string,
    sessionId: string,
  ): Promise<ConversationSummary> {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot complete another user's session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    // Generate conversation summary via LLM
    let summary: ConversationSummary;

    if (sessionData.conversation.length >= 2) {
      try {
        const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);
        const { system, user } = buildConversationSummaryPrompt({
          sourceText: sessionData.selectedText,
          conversation: sessionData.conversation,
        });
        const result = await this.llmService.callLlmForUser(
          teacherId,
          system,
          user,
          {
            feature: 'interrogative_elaboration',
            courseId: intervention.courseId,
            triggeredByUserId: userId,
          },
          {
            jsonMode: true,
            jsonSchema: INTERROGATIVE_SUMMARY_SCHEMA,
          },
        );
        const parsed = this.parseLlmJson(result.content);
        summary = this.validateConversationSummary(parsed);
      } catch {
        // Fallback summary if LLM fails
        summary = {
          summary: 'The student explored the text through questions and answers.',
          conceptsCovered: sessionData.keyConcepts.slice(0, 3),
          questionsAsked: sessionData.questionsAsked,
          depthRating: sessionData.questionsAsked >= 3 ? 'moderate' : 'surface',
        };
      }
    } else {
      summary = {
        summary: 'Session completed without asking questions.',
        conceptsCovered: [],
        questionsAsked: 0,
        depthRating: 'surface',
      };
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return summary;
  }

  async getElaborationSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Elaboration session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's elaboration session");
    }

    if (intervention.type !== 'INTERROGATIVE_ELABORATION') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as ElaborationSessionData;

    return {
      interventionId: intervention.id,
      status: intervention.status,
      suggestedQuestions: sessionData.suggestedQuestions,
      keyConcepts: sessionData.keyConcepts,
      conversation: sessionData.conversation,
      questionsAsked: sessionData.questionsAsked,
      completedAt: intervention.completedAt,
    };
  }

  // ─── Stepwise Learning ──────────────────────────────────

  async generateSteps(
    userId: string,
    dto: GenerateStepwiseDto,
    sessionId?: string,
  ): Promise<{
    interventionId: string;
    steps: Array<{ stepNumber: number; title: string }>;
    totalSteps: number;
  }> {
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    // ─── Pre-generation cache ──────────────────────────────────────────────
    if (dto.documentId && dto.pageNumber != null) {
      const cached = await this.findPreGeneratedExercise(
        dto.documentId,
        dto.pageNumber,
        'stepwise-learning',
      );
      if (cached) {
        const c = cached.content as { steps: StepwiseStep[]; summary: string };
        const intervention = await this.prisma.learningIntervention.create({
          data: {
            userId,
            courseId: dto.courseId,
            contentId: dto.contentId || null,
            pageType: dto.pageType || null,
            type: 'STEPWISE_LEARNING',
            status: 'IN_PROGRESS',
            selectedText: `[pre-generated page ${dto.pageNumber}]`,
            sessionData: {
              steps: c.steps,
              summary: c.summary,
              currentStep: 1,
              selectedText: `[pre-generated page ${dto.pageNumber}]`,
              stepResults: {},
            } as unknown as Prisma.InputJsonValue,
          },
        });
        if (sessionId) {
          void this.activityLogService.record({
            sessionId,
            userId,
            action: ActivityAction.INTERVENTION_TRIGGERED,
            interventionId: intervention.id,
            courseId: dto.courseId,
            metadata: { interventionType: 'STEPWISE_LEARNING', triggerReason: 'pre_generated' },
          });
        }
        return {
          interventionId: intervention.id,
          steps: c.steps.map((s) => ({ stepNumber: s.stepNumber, title: s.title })),
          totalSteps: c.steps.length,
        };
      }
    }

    const ctx = await this.resolveInterventionContext(userId, dto);
    if (ctx.source !== 'selection') {
      this.logger.log(
        `Stepwise learning: no selection, grounded on ${ctx.source} (${dto.courseId})`,
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'STEPWISE_LEARNING');
    const { system, user } = buildStepwiseLearningPrompt(systemPrompt, ctx.text);

    let steps: StepwiseStep[];
    let summary = '';
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Stage 06 — shared grounded invoker.
        const result = await this.generateInterventionGrounded({
          teacherId,
          courseId: dto.courseId,
          triggeredByUserId: userId,
          feature: 'stepwise_learning',
          system,
          user,
          evidence: ctx.evidence,
          jsonMode: true,
          jsonSchema: STEPWISE_GENERATE_SCHEMA,
        });
        const parsed = this.parseLlmJson(result.content);
        const validated = this.validateStepwiseResponse(parsed);
        steps = validated.steps;
        summary = validated.summary;
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Stepwise learning generation failed after retries', err);
          throw new BadRequestException('Failed to generate learning steps. Please try again.');
        }
        this.logger.warn(`Stepwise generation attempt ${attempts} failed, retrying...`);
      }
    }

    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'STEPWISE_LEARNING',
        status: 'IN_PROGRESS',
        selectedText: ctx.text,
        sessionData: {
          steps: steps!,
          summary,
          currentStep: 1,
          selectedText: ctx.text,
          stepResults: {},
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'STEPWISE_LEARNING',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: STEPWISE_LEARNING`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      steps: steps!.map((s) => ({ stepNumber: s.stepNumber, title: s.title })),
      totalSteps: steps!.length,
    };
  }

  async checkStepResponse(
    userId: string,
    sessionId: string,
    dto: SubmitStepCheckDto,
  ): Promise<StepCheckResponse> {
    if (!dto.userResponse || dto.userResponse.trim().length < 10) {
      throw new BadRequestException('Response must be at least 10 characters');
    }

    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    if (intervention.status === 'COMPLETED') {
      throw new BadRequestException('Session already completed');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const step = sessionData.steps.find((s) => s.stepNumber === dto.stepNumber);

    if (!step) {
      throw new BadRequestException(`Step ${dto.stepNumber} not found`);
    }

    const existingResult = sessionData.stepResults[dto.stepNumber];
    if (existingResult?.passed) {
      throw new BadRequestException(`Step ${dto.stepNumber} already passed`);
    }

    const currentAttempts = (existingResult?.attempts || 0) + 1;
    const maxAttemptsAllowed = 2;

    const teacherId = await this.getCourseTeacherIdWithApiKey(intervention.courseId);

    const { system, user } = buildStepCheckPrompt({
      stepTitle: step.title,
      stepContent: step.content,
      question: step.comprehensionCheck.question,
      sampleAnswer: step.comprehensionCheck.sampleAnswer,
      userResponse: dto.userResponse,
    });

    let isCorrect = false;
    let feedback = '';
    let encouragement = '';

    try {
      const result = await this.llmService.callLlmForUser(
        teacherId,
        system,
        user,
        {
          feature: 'stepwise_learning',
          courseId: intervention.courseId,
          triggeredByUserId: userId,
        },
        {
          jsonMode: true,
          jsonSchema: STEPWISE_CHECK_SCHEMA,
        },
      );
      const parsed = this.parseLlmJson(result.content);
      const validated = this.validateStepCheckResponse(parsed);
      isCorrect = validated.isCorrect;
      feedback = validated.feedback;
      encouragement = validated.encouragement;
    } catch {
      feedback = 'We had trouble evaluating your answer. Please try again.';
      encouragement = 'Keep going!';
    }

    const showAnswer = !isCorrect && currentAttempts >= maxAttemptsAllowed;

    const userResponse: StepUserResponse = {
      response: dto.userResponse,
      feedback,
      isCorrect,
      timestamp: new Date().toISOString(),
    };

    const updatedResult: StepResult = {
      attempts: currentAttempts,
      passed: isCorrect,
      userResponses: [...(existingResult?.userResponses || []), userResponse],
    };

    // If showing answer after max attempts, mark as passed so student can proceed
    if (showAnswer) {
      updatedResult.passed = true;
    }

    const updatedStepResults = {
      ...sessionData.stepResults,
      [dto.stepNumber]: updatedResult,
    };

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          stepResults: updatedStepResults,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      isCorrect,
      feedback,
      encouragement,
      attempts: currentAttempts,
      showAnswer,
      sampleAnswer: showAnswer ? step.comprehensionCheck.sampleAnswer : undefined,
    };
  }

  async advanceStep(
    userId: string,
    sessionId: string,
  ): Promise<{ currentStep: number; totalSteps: number; step: StepwiseStep; completed: boolean }> {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot interact with another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const currentResult = sessionData.stepResults[sessionData.currentStep];

    if (!currentResult?.passed) {
      throw new BadRequestException('Must pass the current step before advancing');
    }

    const nextStep = sessionData.currentStep + 1;
    const totalSteps = sessionData.steps.length;
    const completed = nextStep > totalSteps;

    if (completed) {
      await this.prisma.learningIntervention.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          sessionData: {
            ...sessionData,
            currentStep: totalSteps,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        currentStep: totalSteps,
        totalSteps,
        step: sessionData.steps[totalSteps - 1]!,
        completed: true,
      };
    }

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        sessionData: {
          ...sessionData,
          currentStep: nextStep,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      currentStep: nextStep,
      totalSteps,
      step: sessionData.steps[nextStep - 1]!,
      completed: false,
    };
  }

  async getStepwiseSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;

    return {
      interventionId: intervention.id,
      status: intervention.status,
      steps: sessionData.steps,
      summary: sessionData.summary,
      currentStep: sessionData.currentStep,
      totalSteps: sessionData.steps.length,
      stepResults: sessionData.stepResults,
      completedAt: intervention.completedAt,
    };
  }

  async completeStepwiseSession(userId: string, sessionId: string) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: sessionId },
    });

    if (!intervention) {
      throw new NotFoundException('Stepwise session not found');
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException("Cannot complete another user's session");
    }

    if (intervention.type !== 'STEPWISE_LEARNING') {
      throw new BadRequestException('Invalid intervention type');
    }

    const sessionData = intervention.sessionData as unknown as StepwiseSessionData;
    const stepsCompleted = Object.values(sessionData.stepResults).filter((r) => r.passed).length;

    await this.prisma.learningIntervention.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    return {
      summary: sessionData.summary,
      totalSteps: sessionData.steps.length,
      stepsCompleted,
    };
  }

  // ─── Distributed Practice ─────────────────────────────────

  async generateCards(userId: string, dto: GenerateCardsDto, sessionId?: string) {
    if (!dto.courseId) {
      throw new BadRequestException('courseId is required');
    }

    // ─── Pre-generation cache ──────────────────────────────────────────────
    if (dto.documentId && dto.pageNumber != null) {
      const cached = await this.findPreGeneratedExercise(
        dto.documentId,
        dto.pageNumber,
        'distributed-practice',
      );
      if (cached) {
        const cards = cached.content as FlashcardData[];
        const intervention = await this.prisma.learningIntervention.create({
          data: {
            userId,
            courseId: dto.courseId,
            contentId: dto.contentId || null,
            pageType: dto.pageType || null,
            type: 'DISTRIBUTED_PRACTICE',
            status: 'COMPLETED',
            selectedText: `[pre-generated page ${dto.pageNumber}]`,
            completedAt: new Date(),
            sessionData: { cards } as unknown as Prisma.InputJsonValue,
          },
        });
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const createdCards = await Promise.all(
          cards.map((card) =>
            this.prisma.spacedRepetitionCard.create({
              data: {
                userId,
                interventionId: intervention.id,
                courseId: dto.courseId,
                front: card.front,
                back: card.back,
                ease: 2.5,
                interval: 0,
                repetitions: 0,
                nextReviewAt: tomorrow,
              },
            }),
          ),
        );
        if (sessionId) {
          void this.activityLogService.record({
            sessionId,
            userId,
            action: ActivityAction.INTERVENTION_TRIGGERED,
            interventionId: intervention.id,
            courseId: dto.courseId,
            metadata: { interventionType: 'DISTRIBUTED_PRACTICE', triggerReason: 'pre_generated' },
          });
        }
        return {
          interventionId: intervention.id,
          cards: createdCards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
          totalCreated: createdCards.length,
        };
      }
    }

    const ctx = await this.resolveInterventionContext(userId, dto);
    if (ctx.source !== 'selection') {
      this.logger.log(
        `Distributed practice: no selection, grounded on ${ctx.source} (${dto.courseId})`,
      );
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);
    const cardCount = Math.min(Math.max(dto.cardCount || 5, 1), 15);

    const systemPrompt = await this.getSystemPrompt(dto.courseId, 'DISTRIBUTED_PRACTICE');
    const { system, user } = buildDistributedPracticePrompt(systemPrompt, ctx.text, cardCount);

    let cards: FlashcardData[];
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Stage 06 — shared grounded invoker.
        const result = await this.generateInterventionGrounded({
          teacherId,
          courseId: dto.courseId,
          triggeredByUserId: userId,
          feature: 'distributed_practice',
          system,
          user,
          evidence: ctx.evidence,
          jsonMode: true,
          jsonSchema: DISTRIBUTED_PRACTICE_SCHEMA,
        });
        const parsed = this.parseLlmJson(result.content);
        cards = this.validateFlashcardResponse(parsed);
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          this.logger.error('Flashcard generation failed after retries', err);
          throw new BadRequestException('Failed to generate flashcards. Please try again.');
        }
        this.logger.warn(`Flashcard generation attempt ${attempts} failed, retrying...`);
      }
    }

    // Create LearningIntervention record
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        type: 'DISTRIBUTED_PRACTICE',
        status: 'COMPLETED',
        selectedText: ctx.text,
        completedAt: new Date(),
        sessionData: { cards: cards! } as unknown as Prisma.InputJsonValue,
      },
    });

    // Create SpacedRepetitionCard records — first review tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const createdCards = await Promise.all(
      cards!.map((card) =>
        this.prisma.spacedRepetitionCard.create({
          data: {
            userId,
            interventionId: intervention.id,
            courseId: dto.courseId,
            front: card.front,
            back: card.back,
            ease: 2.5,
            interval: 0,
            repetitions: 0,
            nextReviewAt: tomorrow,
          },
        }),
      ),
    );

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.INTERVENTION_TRIGGERED,
        interventionId: intervention.id,
        metadata: {
          interventionType: 'DISTRIBUTED_PRACTICE',
          triggerReason: 'student_initiated',
          summary: `Intervention triggered: DISTRIBUTED_PRACTICE`,
        },
      });
    }

    return {
      interventionId: intervention.id,
      cards: createdCards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
      totalCreated: createdCards.length,
    };
  }

  async getDueCards(userId: string, limit: number, courseId?: string) {
    const where: Prisma.SpacedRepetitionCardWhereInput = {
      userId,
      nextReviewAt: { lte: new Date() },
    };

    if (courseId) {
      where.courseId = courseId;
    }

    const cards = await this.prisma.spacedRepetitionCard.findMany({
      where,
      orderBy: { nextReviewAt: 'asc' },
      take: Math.min(limit || 20, 50),
    });

    return {
      cards: cards.map((c) => ({
        id: c.id,
        front: c.front,
        back: c.back,
        ease: c.ease,
        interval: c.interval,
        repetitions: c.repetitions,
        nextReviewAt: c.nextReviewAt,
        courseId: c.courseId,
      })),
      total: cards.length,
    };
  }

  async reviewCard(userId: string, cardId: string, dto: ReviewCardDto, sessionId?: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot review another user's card");
    }

    const validQualities: QualityRating[] = ['again', 'hard', 'good', 'easy'];
    if (!validQualities.includes(dto.quality)) {
      throw new BadRequestException('Invalid quality rating');
    }

    const quality = QUALITY_MAP[dto.quality];
    const result = calculateNextReview(quality, {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
    });

    await this.prisma.spacedRepetitionCard.update({
      where: { id: cardId },
      data: {
        ease: result.ease,
        interval: result.interval,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
        lastReviewedAt: new Date(),
      },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId,
        action: ActivityAction.SPACED_REP_CARD_RATED,
        metadata: {
          cardId: card.id,
          rating: quality,
          nextReviewAt: result.nextReviewAt?.toISOString(),
          summary: `Flashcard rated: ${quality}/5`,
        },
      });
    }

    return {
      nextReviewAt: result.nextReviewAt,
      interval: result.interval,
      ease: result.ease,
    };
  }

  async getCardStats(userId: string) {
    const now = new Date();
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [totalCards, dueToday, dueThisWeek, cardsByStage] = await Promise.all([
      this.prisma.spacedRepetitionCard.count({ where: { userId } }),
      this.prisma.spacedRepetitionCard.count({
        where: { userId, nextReviewAt: { lte: now } },
      }),
      this.prisma.spacedRepetitionCard.count({
        where: { userId, nextReviewAt: { lte: endOfWeek } },
      }),
      this.prisma.spacedRepetitionCard.findMany({
        where: { userId },
        select: { repetitions: true, interval: true },
      }),
    ]);

    // Categorize cards by stage
    let newCount = 0;
    let learningCount = 0;
    let matureCount = 0;
    for (const card of cardsByStage) {
      if (card.repetitions === 0) newCount++;
      else if (card.interval < 21) learningCount++;
      else matureCount++;
    }

    return {
      totalCards,
      dueToday,
      dueThisWeek,
      cardsByStage: { new: newCount, learning: learningCount, mature: matureCount },
    };
  }

  async previewCardRatings(userId: string, cardId: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot preview another user's card");
    }

    const previews = previewAllRatings({
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
    });

    return {
      again: { nextReviewAt: previews.again.nextReviewAt, interval: previews.again.interval },
      hard: { nextReviewAt: previews.hard.nextReviewAt, interval: previews.hard.interval },
      good: { nextReviewAt: previews.good.nextReviewAt, interval: previews.good.interval },
      easy: { nextReviewAt: previews.easy.nextReviewAt, interval: previews.easy.interval },
    };
  }

  async deleteCard(userId: string, cardId: string) {
    const card = await this.prisma.spacedRepetitionCard.findUnique({
      where: { id: cardId },
    });

    if (!card) {
      throw new NotFoundException('Card not found');
    }

    if (card.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's card");
    }

    await this.prisma.spacedRepetitionCard.delete({ where: { id: cardId } });

    return { deleted: true };
  }

  // ─── Private Helpers ──────────────────────────────────────

  /**
   * Resolve the teacher who owns a course and verify they have an LLM API key.
   * Learning interventions use the course teacher's API key, not the student's.
   */
  private async getCourseTeacherIdWithApiKey(courseId: string): Promise<string> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const hasKey = await this.llmService.hasApiKey(course.teacherId);
    if (!hasKey) {
      throw new BadRequestException(
        'The course instructor has not configured an LLM API key. Please contact your instructor.',
      );
    }

    return course.teacherId;
  }

  private parseLlmJson(content: string): unknown {
    // Try to extract JSON from possibly markdown-wrapped response
    let cleaned = content.trim();

    // Remove markdown code fences
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      cleaned = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  private validatePracticeTestResponse(parsed: unknown): PracticeQuestion[] {
    const data = parsed as { questions?: unknown[] };

    if (!data?.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('LLM response missing questions array');
    }

    return data.questions.map((q: unknown) => {
      const item = q as Record<string, unknown>;
      if (!item.question || !item.type || !item.correctAnswer) {
        throw new Error('Invalid question structure in LLM response');
      }

      return {
        question: String(item.question),
        type: item.type === 'short_answer' ? 'short_answer' : 'mcq',
        options: Array.isArray(item.options) ? item.options.map(String) : undefined,
        correctAnswer: String(item.correctAnswer),
        explanation: String(item.explanation || ''),
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : undefined,
      } as PracticeQuestion;
    });
  }

  private validateSuggestionResponse(parsed: unknown): {
    suggestedQuestions: SuggestedQuestion[];
    keyConcepts: string[];
  } {
    const data = parsed as { suggestedQuestions?: unknown[]; keyConcepts?: unknown[] };

    if (
      !data?.suggestedQuestions ||
      !Array.isArray(data.suggestedQuestions) ||
      data.suggestedQuestions.length === 0
    ) {
      throw new Error('LLM response missing suggestedQuestions array');
    }

    const suggestedQuestions = data.suggestedQuestions.map((q: unknown) => {
      const item = q as Record<string, unknown>;
      if (!item.question || !item.type) {
        throw new Error('Invalid suggested question structure in LLM response');
      }

      const type = String(item.type).toLowerCase();
      const difficulty = String(item.difficulty || 'intermediate').toLowerCase();

      return {
        question: String(item.question),
        type: type === 'how' ? ('how' as const) : ('why' as const),
        topic: String(item.topic || ''),
        difficulty: (['beginner', 'intermediate', 'advanced'].includes(difficulty)
          ? difficulty
          : 'intermediate') as SuggestedQuestion['difficulty'],
      };
    });

    const keyConcepts = Array.isArray(data.keyConcepts) ? data.keyConcepts.map(String) : [];

    return { suggestedQuestions, keyConcepts };
  }

  private validateConversationSummary(parsed: unknown): ConversationSummary {
    const data = parsed as Record<string, unknown>;

    return {
      summary: String(data?.summary || 'Session completed.'),
      conceptsCovered: Array.isArray(data?.conceptsCovered)
        ? (data.conceptsCovered as unknown[]).map(String)
        : [],
      questionsAsked: typeof data?.questionsAsked === 'number' ? data.questionsAsked : 0,
      depthRating: (['surface', 'moderate', 'deep'].includes(String(data?.depthRating || ''))
        ? String(data.depthRating)
        : 'surface') as ConversationSummary['depthRating'],
    };
  }

  private validateStepwiseResponse(parsed: unknown): {
    steps: StepwiseStep[];
    summary: string;
  } {
    const data = parsed as { steps?: unknown[]; summary?: string };

    if (!data?.steps || !Array.isArray(data.steps) || data.steps.length === 0) {
      throw new Error('LLM response missing steps array');
    }

    const steps = data.steps.map((s: unknown, index: number) => {
      const item = s as Record<string, unknown>;
      if (!item.title || !item.content) {
        throw new Error(`Invalid step structure at index ${index}`);
      }

      const check = item.comprehensionCheck as Record<string, unknown> | undefined;
      if (!check?.question) {
        throw new Error(`Missing comprehension check at step ${index}`);
      }

      return {
        stepNumber: typeof item.stepNumber === 'number' ? item.stepNumber : index + 1,
        title: String(item.title),
        content: String(item.content),
        comprehensionCheck: {
          question: String(check.question),
          hint: String(check.hint || ''),
          sampleAnswer: String(check.sampleAnswer || ''),
        },
      };
    });

    return {
      steps,
      summary: String(data.summary || ''),
    };
  }

  private validateStepCheckResponse(parsed: unknown): {
    isCorrect: boolean;
    feedback: string;
    encouragement: string;
  } {
    const data = parsed as Record<string, unknown>;

    return {
      isCorrect: Boolean(data?.isCorrect),
      feedback: String(data?.feedback || 'Unable to evaluate response.'),
      encouragement: String(data?.encouragement || 'Keep going!'),
    };
  }

  private validateFlashcardResponse(parsed: unknown): FlashcardData[] {
    const data = parsed as { cards?: unknown[] };

    if (!data?.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
      throw new Error('LLM response missing cards array');
    }

    return data.cards.map((c: unknown, index: number) => {
      const item = c as Record<string, unknown>;
      if (!item.front || !item.back) {
        throw new Error(`Invalid card structure at index ${index}`);
      }

      return {
        front: String(item.front),
        back: String(item.back),
      };
    });
  }

  private gradeAnswer(question: PracticeQuestion, userAnswer: string): boolean {
    if (!userAnswer.trim()) return false;

    if (question.type === 'mcq') {
      // Extract just the letter (A, B, C, D) for comparison
      const normalize = (s: string) =>
        s
          .trim()
          .toUpperCase()
          .replace(/[^A-D]/g, '')
          .charAt(0);
      return normalize(userAnswer) === normalize(question.correctAnswer);
    }

    // Short answer: keyword matching
    if (question.keywords && question.keywords.length > 0) {
      const answerLower = userAnswer.toLowerCase();
      const matchedKeywords = question.keywords.filter((kw) =>
        answerLower.includes(kw.toLowerCase()),
      );
      // Require at least half the keywords
      return matchedKeywords.length >= Math.ceil(question.keywords.length / 2);
    }

    // Fallback: simple string similarity
    const answerLower = userAnswer.toLowerCase().trim();
    const correctLower = question.correctAnswer.toLowerCase().trim();
    return answerLower.includes(correctLower) || correctLower.includes(answerLower);
  }

  /**
   * Grade a short-answer question using LLM evaluation.
   * Falls back to keyword-based grading if the LLM call fails.
   */
  private async gradeShortAnswerWithLlm(
    teacherId: string,
    userId: string,
    courseId: string,
    question: PracticeQuestion,
    userAnswer: string,
    sourceText: string,
  ): Promise<{ isCorrect: boolean; feedback: string }> {
    try {
      const { system, user } = buildPracticeAnswerCheckPrompt({
        question: question.question,
        correctAnswer: question.correctAnswer,
        keywords: question.keywords || [],
        userAnswer,
        sourceText,
      });

      const result = await this.llmService.callLlmForUser(
        teacherId,
        system,
        user,
        {
          feature: 'practice_testing',
          courseId,
          triggeredByUserId: userId,
        },
        {
          jsonMode: true,
          jsonSchema: PRACTICE_GRADE_SCHEMA,
        },
      );

      const parsed = this.parseLlmJson(result.content);
      const data = parsed as Record<string, unknown>;

      return {
        isCorrect: Boolean(data?.isCorrect),
        feedback: String(data?.feedback || ''),
      };
    } catch (err) {
      this.logger.warn(
        `LLM grading failed for short answer, falling back to keyword matching: ${err}`,
      );
      // Fallback to deterministic grading
      return {
        isCorrect: this.gradeAnswer(question, userAnswer),
        feedback: '',
      };
    }
  }

  // ─── Saved Reviews CRUD ──────────────────────────────────

  async createSavedReview(userId: string, dto: CreateSavedReviewDto) {
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: dto.interventionId },
    });

    if (!intervention) {
      throw new NotFoundException(`Intervention ${dto.interventionId} not found`);
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot save a review for another user');
    }

    return this.prisma.savedInterventionReview.create({
      data: {
        userId,
        interventionId: dto.interventionId,
        interventionType: dto.interventionType,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        title: dto.title,
        selectedText: dto.selectedText,
        savedData: dto.savedData as Prisma.InputJsonValue,
        notes: dto.notes || null,
      },
    });
  }

  async findAllSavedReviews(
    userId: string,
    filters: {
      interventionType?: InterventionType;
      courseId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SavedInterventionReviewWhereInput = { userId };

    if (filters.interventionType) {
      where.interventionType = filters.interventionType;
    }

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    const [items, total] = await Promise.all([
      this.prisma.savedInterventionReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          interventionId: true,
          interventionType: true,
          courseId: true,
          contentId: true,
          pageType: true,
          title: true,
          selectedText: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.savedInterventionReview.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's review");
    }

    return review;
  }

  async updateSavedReview(userId: string, id: string, dto: UpdateSavedReviewDto) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot update another user's review");
    }

    const data: Prisma.SavedInterventionReviewUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.title !== undefined) data.title = dto.title;

    return this.prisma.savedInterventionReview.update({
      where: { id },
      data,
    });
  }

  async deleteSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's review");
    }

    await this.prisma.savedInterventionReview.delete({ where: { id } });

    return { deleted: true };
  }

  // ─── Chat ──────────────────────────────────────────────────

  async chat(
    userId: string,
    dto: ChatRequestDto,
    activitySessionId?: string,
  ): Promise<{ reply: string; suggestedStrategy: string | null }> {
    if (!dto.message || dto.message.trim().length < 2) {
      throw new BadRequestException('Message is too short');
    }

    const teacherId = await this.getCourseTeacherIdWithApiKey(dto.courseId);

    // Fire text-mining detection for the student's utterance so EF
    // detections show up in the teacher's text-mining tab + replay for
    // standard-mode courses. Mirrors dialogue.service.ts:226 which does
    // the same for dialogue messages. Best-effort: failures are swallowed
    // inside the service. We key on activitySessionId (the studentSession
    // id) so the dashboard's /activity-sessions/* endpoints can find
    // these rows. messageId is synthetic since the floating chatbot
    // doesn't persist messages in its own table.
    if (activitySessionId) {
      this.textMining
        .ingest({
          messageId: randomUUID(),
          sessionId: activitySessionId,
          studentId: userId,
          courseId: dto.courseId,
          teacherId,
          utterance: dto.message,
        })
        .catch((err) =>
          this.logger.warn(`textMining.ingest failed for chat message: ${err?.message ?? err}`),
        );
    }

    // Ground the chat reply on whatever context is most relevant for what
    // the student is looking at. Resolution order, first hit wins:
    //
    //  1. STANDARD-MODE PDF: if dto.contentId is a PDF module item the
    //     student is currently reading, use that PDF's already-extracted
    //     text (via the matching teacher SourceDocument). This makes the
    //     chatbot able to answer "summarise this chapter" for a PDF
    //     lesson without the student having to highlight first.
    //  2. SELECTION: if the student highlighted ≥20 chars on the page,
    //     trust that as the most precise signal of what they care about.
    //  3. STUDENT-RAG: dialogue-mode fallback — the student's own
    //     uploaded materials (never the teacher's master corpus,
    //     never another student's data).
    //
    // All three are best-effort; if none yield context we still let the
    // LLM answer with conversation history alone.
    // Stage 06 — context resolution returns the SAME shared
    // `GroundedEvidence` shape as the four intervention generators.
    // Selection / pdf-source paths build a single synthetic chunk so
    // the grounding contract still applies (the model is reminded
    // to cite [Source 1: …] when quoting).
    let evidence: GroundedEvidence | null = null;
    let contextSource: 'pdf-source' | 'selection' | 'student-rag' | 'none' = 'none';

    if (dto.contentId) {
      try {
        const pdfText = await this.tryResolveFromModuleItem(dto.courseId, dto.contentId);
        if (pdfText) {
          const filename = await this.lookupPdfFilenameForContent(dto.courseId, dto.contentId);
          evidence = {
            contextChunks: [
              {
                id: `pdf-source:${dto.contentId}`,
                text: pdfText,
                citationLabel: `Source 1: ${filename ?? 'lesson PDF'}`,
              },
            ],
            images: [],
            hasImages: false,
            totalImageBytes: 0,
          };
          contextSource = 'pdf-source';
        }
      } catch {
        // Best-effort; continue.
      }
    }

    if (!evidence) {
      const sel = (dto.selectedText ?? '').trim();
      if (sel.length >= 20) {
        evidence = {
          contextChunks: [
            {
              id: 'selection:current',
              text: sel,
              citationLabel: `Source 1: highlighted passage`,
            },
          ],
          images: [],
          hasImages: false,
          totalImageBytes: 0,
        };
        contextSource = 'selection';
      }
    }

    if (!evidence) {
      try {
        const rawChunks = await this.queryStudentRagRawChunks(userId, dto.courseId, dto.message);
        if (rawChunks.length > 0) {
          const imageMeta = await loadImageChunkMetadata(this.prisma, rawChunks);
          evidence = await this.groundedEvidence.buildEvidence(rawChunks, imageMeta);
          contextSource = 'student-rag';
        }
      } catch {
        // Best-effort; continue without context.
      }
    }

    this.logger.log(
      `chat() course=${dto.courseId} content=${dto.contentId ?? '-'} contextSource=${contextSource} images=${evidence?.images.length ?? 0}`,
    );

    // Stage 06 — strategy-suggesting persona kept intact; the
    // grounding contract is appended via `buildGroundedMessages`.
    const systemPersona = `You are a friendly and supportive learning assistant embedded in an educational platform. Your role is to help students understand their course material and guide them to use effective learning strategies.

You have access to four learning strategies the student can use:
- **Practice Testing**: Generate quiz questions from selected text to test knowledge retention
- **Distributed Practice**: Create spaced-repetition flashcards for long-term memory
- **Stepwise Learning**: Break complex text into guided steps with comprehension checks
- **Interrogative Elaboration**: Explore "why" and "how" questions through dialogue

Guidelines:
- Keep responses concise (2-4 sentences) since this is a small chat widget.
- When the student seems to be struggling with a concept, confused, or asking about a topic, suggest a relevant learning strategy. Include a recommendation in the LAST line using this exact format: [SUGGEST:STRATEGY_KEY] where STRATEGY_KEY is one of: PRACTICE_TESTING, DISTRIBUTED_PRACTICE, STEPWISE_LEARNING, INTERROGATIVE_ELABORATION.
- Only suggest a strategy when it is genuinely relevant. Do NOT suggest one on every message.
- When to suggest which strategy:
  - PRACTICE_TESTING: when the student wants to test their understanding, review for exams, or check recall
  - DISTRIBUTED_PRACTICE: when the student wants to memorize key terms, definitions, or facts for the long term
  - STEPWISE_LEARNING: when the student is confused by complex or dense material and needs it broken down
  - INTERROGATIVE_ELABORATION: when the student is curious about why or how something works and wants deeper understanding
- If the student asks about something unrelated to the course, politely redirect them.

Formatting (the UI renders GitHub-flavored Markdown with KaTeX math):
- Use Markdown: bold for emphasis, bullet/numbered lists, fenced code blocks with a language tag (\`\`\`python), and pipe tables when presenting comparisons.
- Render math with LaTeX inside dollar-sign delimiters: $E = mc^2$ for inline and $$...$$ on its own line for display equations. Use \\frac, \\sum, \\int, \\sqrt, etc.
- Prefer plain prose for short answers; reach for tables / code / equations only when they genuinely help.

When the student is viewing ${dto.contentTitle ? `"${dto.contentTitle}"` : 'course material'}, remember they are looking at that page right now.`;

    const grounded = buildGroundedMessages({
      systemPersona,
      contextChunks: evidence?.contextChunks ?? [],
      images: evidence?.images ?? [],
      history: (dto.conversationHistory || []).slice(-10).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      question: dto.message,
    });

    let reply: string;
    let llmPromptTokens: number | null = null;
    let llmCompletionTokens: number | null = null;
    let llmModel: string | null = null;
    try {
      const result = await this.llmService.callLlmStructured(
        teacherId,
        {
          systemPrompt: grounded.systemPrompt,
          messages: grounded.messages,
        },
        {
          feature: 'chatbot',
          courseId: dto.courseId,
          triggeredByUserId: userId,
        },
      );
      reply = result.content;
      llmPromptTokens = result.promptTokens;
      llmCompletionTokens = result.completionTokens;
      llmModel = result.model;
    } catch {
      reply =
        "I'm having trouble responding right now. Try selecting some text and using one of the learning strategies instead!";
    }

    // Extract strategy suggestion if present
    let suggestedStrategy: string | null = null;
    const strategyMatch = reply.match(
      /\[SUGGEST:(PRACTICE_TESTING|DISTRIBUTED_PRACTICE|STEPWISE_LEARNING|INTERROGATIVE_ELABORATION)\]/,
    );
    if (strategyMatch) {
      suggestedStrategy = strategyMatch[1]!;
      // Remove the tag from the visible reply
      reply = reply.replace(strategyMatch[0], '').trim();
    }

    // Persist both turns to chatbot_messages so:
    //   - the teacher's Review tab can render the actual conversation
    //     inline on the replay timeline
    //   - the student can review past conversations from the new "Chat
    //     History" page even after their session ends. Retention is now
    //     owned by `studentId` (cascades only on user deletion); the
    //     session FK is nullable / SET NULL so a session purge no
    //     longer destroys the rows. See migration
    //     `20260531030000_retain_chatbot_messages_per_student`.
    //
    // Mirrors dialogue.service.ts which writes DialogueMessage rows for
    // every turn. Fire-and-forget so persistence failures never break
    // the student's chat experience.
    const selPersist = (dto.selectedText ?? '').trim().slice(0, 4000) || null;
    this.prisma.chatbotMessage
      .createMany({
        data: [
          {
            studentId: userId,
            studentSessionId: activitySessionId ?? null,
            courseId: dto.courseId,
            moduleItemId: dto.contentId ?? null,
            role: 'USER',
            content: dto.message.slice(0, 8000),
            contextSource,
            selectedText: selPersist,
            // suggestedStrategy / tokens / model are reply-side fields
            suggestedStrategy: null,
            promptTokens: null,
            completionTokens: null,
            model: null,
          },
          {
            studentId: userId,
            studentSessionId: activitySessionId ?? null,
            courseId: dto.courseId,
            moduleItemId: dto.contentId ?? null,
            role: 'ASSISTANT',
            content: reply.slice(0, 8000),
            contextSource,
            selectedText: null,
            suggestedStrategy,
            promptTokens: llmPromptTokens,
            completionTokens: llmCompletionTokens,
            model: llmModel,
          },
        ],
      })
      .catch((err) =>
        this.logger.warn(
          `chatbot_messages persist failed for user ${userId} (session=${activitySessionId ?? 'none'}): ${err?.message ?? err}`,
        ),
      );

    return { reply, suggestedStrategy };
  }
}
