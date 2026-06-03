import { z } from 'zod';
import { BUNDLE_VERSION } from './spec.js';

/** A finite wall-clock millisecond value. */
export const wallMs = z.number().finite();

export const fileIntegritySchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().nonnegative(),
});

export const manifestSchema = z.object({
  bundleVersion: z.literal(BUNDLE_VERSION),
  exporterVersion: z.string(),
  exportedAt: z.string(),
  sessionId: z.string().min(1),
  userId: z.string(),
  courseId: z.string(),
  moduleId: z.string().optional(),
  timezone: z.string(),
  baseWallClockMs: wallMs,
  durationMs: z.number().nonnegative(),
  counts: z.record(z.number()),
  files: z.record(fileIntegritySchema),
  notes: z.array(z.string()).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const sessionJsonSchema = z.object({
  session: z.object({
    id: z.string(),
    userId: z.string(),
    courseId: z.string(),
    moduleId: z.string().optional(),
    startedAt: z.string(),
    endedAt: z.string().nullable().optional(),
    durationSecs: z.number().nullable().optional(),
    userAgent: z.string().nullable().optional(),
    device: z.string().nullable().optional(),
  }),
  syncAnchor: z
    .object({
      wallClockMs: wallMs,
      monotonicMs: z.number(),
      serverReceiveMs: z.number(),
      timezone: z.string().nullable().optional(),
      userAgent: z.string().nullable().optional(),
    })
    .nullable(),
  context: z.object({
    userDisplayName: z.string().nullable().optional(),
    courseTitle: z.string().nullable().optional(),
    moduleTitle: z.string().nullable().optional(),
  }),
});
export type SessionJson = z.infer<typeof sessionJsonSchema>;

const aoiSchema = z.object({
  region: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const scrollHostSchema = z.object({
  region: z.string().optional().nullable(),
  scrollTop: z.number(),
  scrollHeight: z.number(),
  clientHeight: z.number(),
});

export const snapshotIndexEntrySchema = z.object({
  snapshotId: z.string(),
  wallMs,
  trigger: z.string(),
  pageUrl: z.string(),
  width: z.number(),
  height: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  aois: z.array(aoiSchema).nullable(),
  scrollHosts: z.array(scrollHostSchema).nullable(),
  pdfCurrentPage: z.number().nullable(),
  pdfTotalPages: z.number().nullable(),
  htmlFile: z.string(),
  screenshotFile: z.string().optional(),
});
export type SnapshotIndexEntry = z.infer<typeof snapshotIndexEntrySchema>;
export const snapshotIndexSchema = z.array(snapshotIndexEntrySchema);

export const webcamIndexEntrySchema = z.object({
  segmentId: z.string(),
  startWallMs: wallMs,
  endWallMs: wallMs.nullable(),
  file: z.string(),
  byteSize: z.number().nonnegative(),
  status: z.enum(['ok', 'missing']),
  mimeType: z.string().optional(),
  durationMs: z.number().nullable().optional(),
});
export type WebcamIndexEntry = z.infer<typeof webcamIndexEntrySchema>;
export const webcamIndexSchema = z.array(webcamIndexEntrySchema);

/** Base stream-record shape: a finite wallMs plus arbitrary native fields. */
export const streamRecordSchema = z
  .object({ wallMs })
  .passthrough();
export type StreamRecord = z.infer<typeof streamRecordSchema>;

/** AOI region names the analysis layer understands (nested-resolution order). */
export const AOI_REGIONS = ['header', 'sidebar', 'lesson', 'pdf-viewer', 'chatbot'] as const;
export type AoiRegion = (typeof AOI_REGIONS)[number];
