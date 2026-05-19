import { z } from 'zod';

export const RecordingConfigSchema = z.object({
  isEnabled: z.boolean(),
});
export type RecordingConfigInput = z.infer<typeof RecordingConfigSchema>;

export const CreateSegmentSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  startWallTime: z.string().datetime(),
  segmentIndex: z.number().int().nonnegative(),
  mimeType: z.string().default('video/webm'),
});
export type CreateSegmentInput = z.infer<typeof CreateSegmentSchema>;

export const CompleteSegmentSchema = z.object({
  endWallTime: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().nonnegative(),
});
export type CompleteSegmentInput = z.infer<typeof CompleteSegmentSchema>;
