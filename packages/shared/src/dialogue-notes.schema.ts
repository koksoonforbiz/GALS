import { z } from 'zod';

export const CreateNoteSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  sourceDocumentId: z.string().optional(),
  pageNumber: z.number().int().optional(),
  highlightedText: z.string().optional(),
  noteText: z.string(),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).default('yellow'),
});

export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z.object({
  noteText: z.string().optional(),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple']).optional(),
});

export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;

export const DialogueNoteSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sourceDocumentId: z.string().nullable(),
  pageNumber: z.number().nullable(),
  highlightedText: z.string().nullable(),
  noteText: z.string(),
  color: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DialogueNote = z.infer<typeof DialogueNoteSchema>;
