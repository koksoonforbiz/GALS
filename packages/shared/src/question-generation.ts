import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Source mode                                                        */
/* ------------------------------------------------------------------ */

export const SourceMode = z.enum(['lesson_based', 'question_material', 'mixed']);
export type SourceMode = z.infer<typeof SourceMode>;

/* ------------------------------------------------------------------ */
/*  Difficulty (strict: easy | medium | hard)                          */
/* ------------------------------------------------------------------ */

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

/* ------------------------------------------------------------------ */
/*  Generation request DTO                                             */
/* ------------------------------------------------------------------ */

export const GenerateQuestionsRequestSchema = z.object({
  courseId: z.string().uuid(),
  types: z.array(z.enum(['MCQ_SINGLE', 'MCQ_MULTI', 'STRUCTURED'])).min(1),
  quantity: z.number().int().min(1).max(50),
  difficultyDistribution: z.object({
    easy: z.number().int().min(0),
    medium: z.number().int().min(0),
    hard: z.number().int().min(0),
  }),
  bloomsDistribution: z
    .record(z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']), z.number().int().min(0))
    .optional(),
  kcFocus: z.array(z.string()).optional(),
  sourceMode: SourceMode,
  selectedPageIds: z.array(z.string().uuid()).optional(),
  selectedSourceIds: z.array(z.string().uuid()).optional(),
  strictSource: z.boolean().default(false),
  customPrompt: z.string().max(2000).optional(),
});
export type GenerateQuestionsRequest = z.infer<typeof GenerateQuestionsRequestSchema>;

/* ------------------------------------------------------------------ */
/*  Generated question (LLM output, before saving)                     */
/* ------------------------------------------------------------------ */

export const GeneratedOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  isCorrect: z.boolean(),
});
export type GeneratedOption = z.infer<typeof GeneratedOptionSchema>;

export const GeneratedQuestionTagsSchema = z.object({
  difficulty: Difficulty,
  bloomsLevel: z.string(),
  kcNames: z.array(z.string()),
  curriculumOutcomeRefs: z.array(z.string()).optional(),
});
export type GeneratedQuestionTags = z.infer<typeof GeneratedQuestionTagsSchema>;

export const GeneratedQuestionProvenanceSchema = z.object({
  sourceMode: z.string(),
  sourceIds: z.array(z.string()),
  chunkIds: z.array(z.string()),
  citations: z
    .array(
      z.object({
        sourceId: z.string(),
        pageStart: z.number(),
        pageEnd: z.number(),
      }),
    )
    .optional(),
});
export type GeneratedQuestionProvenance = z.infer<typeof GeneratedQuestionProvenanceSchema>;

export const GeneratedQuestionSchema = z.object({
  type: z.enum(['MCQ_SINGLE', 'MCQ_MULTI', 'STRUCTURED']),
  stem: z.string(),
  options: z.array(GeneratedOptionSchema).optional(),
  structuredAnswer: z
    .object({
      expectedAnswer: z.string(),
      rubric: z.array(z.string()),
    })
    .optional(),
  explanation: z.string(),
  tags: GeneratedQuestionTagsSchema,
  provenance: GeneratedQuestionProvenanceSchema,
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

/* ------------------------------------------------------------------ */
/*  Generation response                                                */
/* ------------------------------------------------------------------ */

export const GenerateQuestionsResponseSchema = z.object({
  status: z.enum(['OK', 'NOT_ENOUGH_INFO', 'PARTIAL']),
  questions: z.array(GeneratedQuestionSchema),
  missingInfo: z.array(z.string()).optional(),
  auditLogId: z.string().uuid().optional(),
});
export type GenerateQuestionsResponse = z.infer<typeof GenerateQuestionsResponseSchema>;

/* ------------------------------------------------------------------ */
/*  Save generated questions request                                   */
/* ------------------------------------------------------------------ */

export const SaveGeneratedQuestionsRequestSchema = z.object({
  courseId: z.string().uuid(),
  questions: z.array(GeneratedQuestionSchema),
  assessmentId: z.string().uuid().optional(), // if set, also add to this assessment
});
export type SaveGeneratedQuestionsRequest = z.infer<typeof SaveGeneratedQuestionsRequestSchema>;
