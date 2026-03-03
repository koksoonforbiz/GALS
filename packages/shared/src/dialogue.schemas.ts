import { z } from 'zod';

// ── Teacher course creation settings ──────────────────────────────────────

export const DialogueCourseSettingsSchema = z.object({
  llmProvider: z.enum(['openai', 'gemini', 'fallback']).default('openai'),
  llmModel: z.string().default('gpt-4o-mini'),
  systemPromptOverride: z.string().optional(),
  allowStudentUploads: z.boolean().default(true),
  maxFilesPerStudent: z.number().int().min(1).max(50).default(20),
  maxFileSizeMb: z.number().min(1).max(100).default(25),
  allowedFileTypes: z
    .array(
      z.enum(['PDF', 'DOCX', 'DOC', 'TXT', 'MD', 'IMAGE_PNG', 'IMAGE_JPG', 'IMAGE_WEBP', 'CODE']),
    )
    .default(['PDF', 'DOCX', 'TXT', 'MD', 'CODE']),
  enabledInterventions: z
    .array(
      z.enum([
        'PRACTICE_TESTING',
        'DISTRIBUTED_PRACTICE',
        'STEPWISE_LEARNING',
        'INTERROGATIVE_ELABORATION',
      ]),
    )
    .default([
      'PRACTICE_TESTING',
      'DISTRIBUTED_PRACTICE',
      'STEPWISE_LEARNING',
      'INTERROGATIVE_ELABORATION',
    ]),
  enabledStudioTools: z
    .array(
      z.enum(['BRIEFING_DOC', 'FLASHCARD_SET', 'TABLE_COMPARISON', 'MIND_MAP', 'TIMELINE', 'FAQ']),
    )
    .default(['BRIEFING_DOC', 'FLASHCARD_SET', 'TABLE_COMPARISON', 'FAQ']),
  autoGenerateGuide: z.boolean().default(true),
  chunkSize: z.number().int().min(256).max(2048).default(512),
  chunkOverlap: z.number().int().min(0).max(512).default(100),
  topKChunks: z.number().int().min(1).max(20).default(8),
  citationMode: z.enum(['inline', 'footnote', 'none']).default('inline'),
});

export type DialogueCourseSettings = z.infer<typeof DialogueCourseSettingsSchema>;

// ── Citation ───────────────────────────────────────────────────────────────

export const CitationSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  pageNumber: z.number().nullable(),
  excerpt: z.string(),
  score: z.number(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ── Dialogue message ────────────────────────────────────────────────────────

export const DialogueMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['USER', 'ASSISTANT', 'SYSTEM']),
  content: z.string(),
  citations: z.array(CitationSchema).optional(),
  tokenUsage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    })
    .optional(),
  createdAt: z.string(),
});

export type DialogueMessage = z.infer<typeof DialogueMessageSchema>;

// ── Studio output content types ─────────────────────────────────────────────

export const BriefingDocContentSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
    }),
  ),
});

export const FlashcardSetContentSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      kcHint: z.string().optional(),
    }),
  ),
});

export const TableComparisonContentSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  caption: z.string().optional(),
});

export const MindMapContentSchema = z.object({
  root: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      parentId: z.string().nullable(),
      level: z.number(),
    }),
  ),
});

export const FaqContentSchema = z.object({
  items: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    }),
  ),
});

// ── Source guide ────────────────────────────────────────────────────────────

export const TocEntrySchema = z.object({
  heading: z.string(),
  level: z.number().int().min(1).max(6),
  pageRef: z.number().nullable(),
});

export const StudentSourceGuideSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  summary: z.string(),
  tableOfContents: z.array(TocEntrySchema),
  suggestedQuestions: z.array(z.string()),
  keyTopics: z.array(z.string()),
  generatedAt: z.string(),
});

export type StudentSourceGuide = z.infer<typeof StudentSourceGuideSchema>;

// ── DTOs ────────────────────────────────────────────────────────────────────

export const SendDialogueMessageDto = z.object({
  content: z.string().min(1).max(8000),
  activeSourceIds: z.array(z.string()).optional(), // override session defaults
});

export const CreateDialogueSessionDto = z.object({
  title: z.string().min(1).max(200).default('New Session'),
  activeSourceIds: z.array(z.string()).default([]),
});

export const UpdateDialogueSessionDto = z.object({
  title: z.string().min(1).max(200).optional(),
  activeSourceIds: z.array(z.string()).optional(),
});

export const GenerateStudioOutputDto = z.object({
  type: z.enum([
    'BRIEFING_DOC',
    'FLASHCARD_SET',
    'TABLE_COMPARISON',
    'MIND_MAP',
    'TIMELINE',
    'FAQ',
  ]),
  sourceIds: z.array(z.string()).min(1),
  promptHint: z.string().max(500).optional(),
  sessionId: z.string().optional(),
});

export const ToggleSourceDto = z.object({
  isActive: z.boolean(),
});
