import { z } from 'zod';

export const CreateGazeLogSchema = z.object({
  timestamp: z.string().datetime(),
  gazeX: z.number(),
  gazeY: z.number(),
  confidence: z.number().min(0).max(1).optional(),
  pageUrl: z.string().optional(),
});
export type CreateGazeLogInput = z.infer<typeof CreateGazeLogSchema>;

export const WebgazerBatchSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  readings: z.array(CreateGazeLogSchema),
});
export type WebgazerBatchInput = z.infer<typeof WebgazerBatchSchema>;

export const WebgazerConfigSchema = z.object({
  isEnabled: z.boolean(),
  calibrationOnNewSession: z.boolean(),
  recalibrationEnabled: z.boolean(),
  inactivityTimeoutSecs: z.number().int().min(300).max(7200),
});
export type WebgazerConfigInput = z.infer<typeof WebgazerConfigSchema>;

export const CalibrationEventSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  triggeredBy: z.enum(['new_session', 'inactivity', 'manual']),
  completedAt: z.string().datetime().optional(),
  accuracy: z.number().nonnegative().optional(),
});
export type CalibrationEventInput = z.infer<typeof CalibrationEventSchema>;
