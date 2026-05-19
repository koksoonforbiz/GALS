import { z } from 'zod';

export const CreatePupilLogSchema = z.object({
  timestamp: z.string().datetime(),
  pupilDiameter: z.number().nonnegative(),
  rawData: z.record(z.unknown()).optional(),
});
export type CreatePupilLogInput = z.infer<typeof CreatePupilLogSchema>;

export const PupilSizeBatchSchema = z.object({
  sessionId: z.string(),
  courseId: z.string(),
  readings: z.array(CreatePupilLogSchema),
});
export type PupilSizeBatchInput = z.infer<typeof PupilSizeBatchSchema>;

export const PupilSizeConfigSchema = z.object({
  isEnabled: z.boolean(),
});
export type PupilSizeConfigInput = z.infer<typeof PupilSizeConfigSchema>;
