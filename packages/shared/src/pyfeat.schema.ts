import { z } from 'zod';

export const PyfeatConfigSchema = z.object({
  isEnabled: z.boolean(),
  extractionFps: z.number().min(0.5).max(5.0),
  enabledAus: z.array(z.string()),
  detectorBackend: z.enum(['retinaface', 'mtcnn', 'img2pose']),
  auPredictor: z.enum(['xgb', 'svm', 'logistic']),
});
export type PyfeatConfigInput = z.infer<typeof PyfeatConfigSchema>;

export const EnqueueJobSchema = z.object({
  studentId: z.string(),
  sessionId: z.string(),
  courseId: z.string(),
  sourceMinioKey: z.string(),
  clipStartWallTime: z.string().datetime(),
});
export type EnqueueJobInput = z.infer<typeof EnqueueJobSchema>;
