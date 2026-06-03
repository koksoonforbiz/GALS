import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { once } from 'node:events';
import archiver from 'archiver';
import { createReadStream } from 'node:fs';
import type { FileIntegrity } from './types.js';

/**
 * Writes files into a bundle directory while accumulating sha256 + byteSize
 * for each, so the manifest's `files` map is built as a side effect of writing.
 */
export class BundleWriter {
  readonly files: Record<string, FileIntegrity> = {};

  constructor(private readonly root: string) {}

  private abs(rel: string): string {
    return join(this.root, rel);
  }

  /** Write a complete buffer/string and record its integrity. */
  async writeFileTracked(rel: string, data: Buffer | string): Promise<void> {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const path = this.abs(rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
    this.files[rel] = {
      sha256: createHash('sha256').update(buf).digest('hex'),
      byteSize: buf.byteLength,
    };
  }

  /**
   * Stream JSONL line-by-line from an async iterable while hashing as we go,
   * so 65k+ row tables never live in memory all at once. Returns row count.
   */
  async writeJsonl(rel: string, rows: AsyncIterable<unknown>): Promise<number> {
    const path = this.abs(rel);
    await mkdir(dirname(path), { recursive: true });
    const hash = createHash('sha256');
    let byteSize = 0;
    let count = 0;
    const out = createWriteStream(path);
    for await (const row of rows) {
      const line = JSON.stringify(row) + '\n';
      const buf = Buffer.from(line, 'utf8');
      hash.update(buf);
      byteSize += buf.byteLength;
      count += 1;
      if (!out.write(buf)) {
        await once(out, 'drain');
      }
    }
    out.end();
    await once(out, 'finish');
    this.files[rel] = { sha256: hash.digest('hex'), byteSize };
    return count;
  }

  /** Produce a zip alongside the bundle dir; returns the zip path. */
  async zipTo(zipPath: string): Promise<string> {
    await mkdir(dirname(zipPath), { recursive: true });
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const done = once(output, 'close');
    archive.pipe(output);
    archive.directory(this.root, false);
    await archive.finalize();
    await done;
    return zipPath;
  }
}

/** Verify a manifest's file checksums against the bytes on disk. */
export async function verifyChecksums(
  root: string,
  files: Record<string, FileIntegrity>,
): Promise<{ ok: boolean; mismatches: string[] }> {
  const mismatches: string[] = [];
  for (const [rel, integrity] of Object.entries(files)) {
    try {
      const hash = createHash('sha256');
      const stream = createReadStream(join(root, rel));
      for await (const chunk of stream) hash.update(chunk as Buffer);
      if (hash.digest('hex') !== integrity.sha256) mismatches.push(rel);
    } catch {
      mismatches.push(rel);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
