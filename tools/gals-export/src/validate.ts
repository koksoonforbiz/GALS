import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { verifyChecksums } from './writer.js';
import type { BundleManifest } from './types.js';

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: BundleManifest;
}

const REQUIRED = ['manifest.json', 'session.json', 'snapshots/index.json', 'webcam/index.json'];

/**
 * Self-contained bundle validation for the exporter smoke test: required files
 * present, manifest checksums verify, every JSONL line parses and carries a
 * finite numeric `wallMs`.
 */
export async function validateBundleDir(dir: string): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let manifest: BundleManifest | undefined;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return { ok: false, errors: ['manifest.json missing or unparseable'], warnings };
  }

  for (const req of REQUIRED) {
    try {
      await readFile(join(dir, req));
    } catch {
      errors.push(`required file missing: ${req}`);
    }
  }

  if (manifest!.bundleVersion !== 1) errors.push(`unexpected bundleVersion ${manifest!.bundleVersion}`);

  const { ok, mismatches } = await verifyChecksums(dir, manifest!.files ?? {});
  if (!ok) errors.push(`checksum mismatch on: ${mismatches.join(', ')}`);

  // Every listed .jsonl file: parse each line, assert finite wallMs.
  for (const rel of Object.keys(manifest!.files ?? {})) {
    if (!rel.endsWith('.jsonl')) continue;
    let lineNo = 0;
    const rl = createInterface({ input: createReadStream(join(dir, rel)), crlfDelay: Infinity });
    for await (const line of rl) {
      lineNo++;
      if (line.trim() === '') continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.wallMs !== 'number' || !Number.isFinite(obj.wallMs)) {
          errors.push(`${rel}:${lineNo} wallMs is not a finite number`);
          break;
        }
      } catch {
        errors.push(`${rel}:${lineNo} is not valid JSON`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, manifest };
}
