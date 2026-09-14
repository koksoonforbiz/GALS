import { z } from 'zod';

// All fields optional — updateConfig() patches only what the caller
// sends, so a focused form (e.g. OpenFace3 settings) can update its
// own subset without clobbering the webcam-recording toggle.
export const RecordingConfigSchema = z.object({
  isEnabled: z.boolean().optional(),
  openface3Enabled: z.boolean().optional(),
  openface3ExtractionFps: z.number().int().min(1).max(30).optional(),
  // Matches PyfeatConfigDto's detectorBackend enum (same concept,
  // different worker).
  openface3DetectorBackend: z.enum(['retinaface', 'mtcnn', 'img2pose']).optional(),
  openface3RunOnNewSegments: z.boolean().optional(),
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

export const FailSegmentSchema = z.object({
  error: z.string().min(1).max(2000),
});
export type FailSegmentInput = z.infer<typeof FailSegmentSchema>;
