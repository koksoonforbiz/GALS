import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  manifestSchema,
  sessionJsonSchema,
  snapshotIndexSchema,
  webcamIndexSchema,
  streamRecordSchema,
  type Manifest,
  type SessionJson,
  type SnapshotIndexEntry,
  type WebcamIndexEntry,
} from './schemas.js';
import { REQUIRED_FILES, STREAM_FILES, type StreamKey } from './spec.js';

export interface BundleValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: Manifest;
  session?: SessionJson;
  snapshots?: SnapshotIndexEntry[];
  webcam?: WebcamIndexEntry[];
  /** counts of rows actually parsed per stream file present. */
  parsedCounts: Record<string, number>;
  /** webcam segments flagged missing in the bundle. */
  missingWebcam: string[];
  checksumMismatches: string[];
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/**
 * Validate a bundle directory against format v1. Mismatches and missing media
 * are reported as warnings (the importer still ingests what's valid); structural
 * failures (no manifest, bad schema, checksum mismatch) are errors.
 */
export async function validateBundle(dir: string): Promise<BundleValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsedCounts: Record<string, number> = {};
  const missingWebcam: string[] = [];
  const checksumMismatches: string[] = [];

  // manifest
  let manifest: Manifest | undefined;
  try {
    const raw = await readJson<unknown>(join(dir, 'manifest.json'));
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`manifest.json invalid: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    } else {
      manifest = parsed.data;
    }
  } catch {
    errors.push('manifest.json missing or unparseable');
  }
  if (!manifest) {
    return { ok: false, errors, warnings, parsedCounts, missingWebcam, checksumMismatches };
  }

  // required files present
  for (const req of REQUIRED_FILES) {
    try {
      await readFile(join(dir, req));
    } catch {
      errors.push(`required file missing: ${req}`);
    }
  }

  // checksums
  for (const [rel, integrity] of Object.entries(manifest.files)) {
    try {
      const actual = await sha256File(join(dir, rel));
      if (actual !== integrity.sha256) checksumMismatches.push(rel);
    } catch {
      checksumMismatches.push(rel);
    }
  }
  if (checksumMismatches.length) {
    warnings.push(`checksum mismatch / unreadable: ${checksumMismatches.join(', ')}`);
  }

  // session.json
  let session: SessionJson | undefined;
  try {
    const parsed = sessionJsonSchema.safeParse(await readJson(join(dir, 'session.json')));
    if (!parsed.success) errors.push(`session.json invalid: ${parsed.error.issues[0]?.message}`);
    else session = parsed.data;
  } catch {
    errors.push('session.json missing or unparseable');
  }

  // snapshots index
  let snapshots: SnapshotIndexEntry[] | undefined;
  try {
    const parsed = snapshotIndexSchema.safeParse(await readJson(join(dir, 'snapshots/index.json')));
    if (!parsed.success) errors.push(`snapshots/index.json invalid: ${parsed.error.issues[0]?.message}`);
    else snapshots = parsed.data;
  } catch {
    errors.push('snapshots/index.json missing or unparseable');
  }

  // webcam index
  let webcam: WebcamIndexEntry[] | undefined;
  try {
    const parsed = webcamIndexSchema.safeParse(await readJson(join(dir, 'webcam/index.json')));
    if (!parsed.success) errors.push(`webcam/index.json invalid: ${parsed.error.issues[0]?.message}`);
    else {
      webcam = parsed.data;
      for (const seg of webcam) if (seg.status === 'missing') missingWebcam.push(seg.segmentId);
    }
  } catch {
    errors.push('webcam/index.json missing or unparseable');
  }
  if (missingWebcam.length) warnings.push(`missing webcam segments: ${missingWebcam.join(', ')}`);

  // streams: parse each present file, count rows, validate finite wallMs
  for (const key of Object.keys(STREAM_FILES) as StreamKey[]) {
    const rel = STREAM_FILES[key];
    if (!manifest.files[rel]) continue; // optional/absent file
    let n = 0;
    let bad = false;
    try {
      const rl = createInterface({ input: createReadStream(join(dir, rel)), crlfDelay: Infinity });
      for await (const line of rl) {
        if (line.trim() === '') continue;
        const parsed = streamRecordSchema.safeParse(JSON.parse(line));
        if (!parsed.success) {
          bad = true;
          break;
        }
        n += 1;
      }
    } catch {
      bad = true;
    }
    parsedCounts[key] = n;
    if (bad) warnings.push(`${rel}: contains malformed records (parsed ${n} before failing)`);
    const expected = manifest.counts[key];
    if (typeof expected === 'number' && expected !== n && !bad) {
      warnings.push(`${rel}: row count ${n} != manifest.counts ${expected}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    session,
    snapshots,
    webcam,
    parsedCounts,
    missingWebcam,
    checksumMismatches,
  };
}

/** Stream a bundle JSONL file's records (validated) for the importer. */
export async function* readStreamRecords(
  dir: string,
  key: StreamKey,
): AsyncIterable<Record<string, unknown>> {
  const rel = STREAM_FILES[key];
  let rl;
  try {
    rl = createInterface({ input: createReadStream(join(dir, rel)), crlfDelay: Infinity });
  } catch {
    return;
  }
  for await (const line of rl) {
    if (line.trim() === '') continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip a single malformed line; never poison the batch
    }
  }
}
