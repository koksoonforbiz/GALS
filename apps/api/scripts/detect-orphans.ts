/**
 * Orphan data detection script.
 *
 * Compares every blob key stored in the database against the objects that
 * actually exist in MinIO and reports two categories:
 *
 *   1. Orphaned MinIO objects — objects in the bucket with NO matching DB
 *      reference. These are safe to delete and are wasting storage.
 *
 *   2. Broken DB references — DB rows that reference a blob key that does
 *      NOT exist in MinIO (the object was deleted externally or never
 *      uploaded successfully).
 *
 * Run inside the API container:
 *   docker exec gals-milestone-1-monorepo-api-1 \
 *     npx ts-node -r tsconfig-paths/register scripts/detect-orphans.ts
 *
 * Or locally (set env vars to point at the right DB and MinIO):
 *   DATABASE_URL=... BLOB_STORAGE_ENDPOINT=http://localhost:9000 \
 *   BLOB_STORAGE_BUCKET=ats-blobs \
 *   BLOB_STORAGE_ACCESS_KEY=minioadmin BLOB_STORAGE_SECRET_KEY=minioadmin \
 *   npx ts-node -r tsconfig-paths/register apps/api/scripts/detect-orphans.ts
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────

const ENDPOINT = process.env.BLOB_STORAGE_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = process.env.BLOB_STORAGE_BUCKET ?? 'ats-blobs';
const ACCESS_KEY = process.env.BLOB_STORAGE_ACCESS_KEY ?? 'minioadmin';
const SECRET_KEY = process.env.BLOB_STORAGE_SECRET_KEY ?? 'minioadmin';
const REGION = process.env.BLOB_STORAGE_REGION ?? 'us-east-1';

// ─── Clients ─────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** List every object key in the bucket, handling pagination. */
async function listAllMinioKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let continuationToken: string | undefined;
  let pages = 0;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.add(obj.Key);
    }
    continuationToken = resp.NextContinuationToken;
    pages++;
  } while (continuationToken);
  console.log(`  Scanned ${pages} page(s), found ${keys.size} objects in bucket "${BUCKET}"`);
  return keys;
}

/** Collect every blob key from the database with a short description of its origin. */
async function getAllDbBlobKeys(): Promise<Map<string, string>> {
  // key → human-readable source for the report
  const keys = new Map<string, string>();

  const [
    courses,
    moduleItems,
    sourceDocs,
    docChunks,
    studentDocs,
    studentChunks,
    recordings,
    pyfeatJobs,
  ] = await Promise.all([
    prisma.course.findMany({ select: { id: true, bannerBlobKey: true } }),
    prisma.moduleItem.findMany({ select: { id: true, pdfBlobKey: true } }),
    prisma.sourceDocument.findMany({ select: { id: true, blobKey: true } }),
    prisma.documentChunk.findMany({
      where: { imageObjectKey: { not: null } },
      select: { id: true, imageObjectKey: true },
    }),
    prisma.studentSourceDocument.findMany({ select: { id: true, blobKey: true } }),
    prisma.studentRagChunk.findMany({
      where: { imageObjectKey: { not: null } },
      select: { id: true, imageObjectKey: true },
    }),
    prisma.recordingSegment.findMany({ select: { id: true, minioKey: true } }),
    prisma.pyfeatJob.findMany({ select: { id: true, sourceMinioKey: true, resultMinioKey: true } }),
  ]);

  for (const r of courses) {
    if (r.bannerBlobKey) keys.set(r.bannerBlobKey, `Course ${r.id} — banner`);
  }
  for (const r of moduleItems) {
    if (r.pdfBlobKey) keys.set(r.pdfBlobKey, `ModuleItem ${r.id} — pdf`);
  }
  for (const r of sourceDocs) {
    if (r.blobKey) keys.set(r.blobKey, `SourceDocument ${r.id}`);
  }
  for (const r of docChunks) {
    if (r.imageObjectKey) keys.set(r.imageObjectKey, `DocumentChunk ${r.id} — image`);
  }
  for (const r of studentDocs) {
    if (r.blobKey) keys.set(r.blobKey, `StudentSourceDocument ${r.id}`);
  }
  for (const r of studentChunks) {
    if (r.imageObjectKey) keys.set(r.imageObjectKey, `StudentRagChunk ${r.id} — image`);
  }
  for (const r of recordings) {
    keys.set(r.minioKey, `RecordingSegment ${r.id}`);
  }
  for (const r of pyfeatJobs) {
    keys.set(r.sourceMinioKey, `PyfeatJob ${r.id} — source`);
    if (r.resultMinioKey) keys.set(r.resultMinioKey, `PyfeatJob ${r.id} — result`);
  }

  console.log(`  Collected ${keys.size} blob key references from DB`);
  return keys;
}

/** Format bytes into a human-readable string. */
function fmt(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════');
  console.log(' GALS Orphan Data Detection');
  console.log(`════════════════════════════════════════════════\n`);

  console.log('1. Listing MinIO objects...');
  const minioKeys = await listAllMinioKeys();

  console.log('\n2. Collecting DB blob key references...');
  const dbKeys = await getAllDbBlobKeys();

  // ── Category 1: in MinIO but not in DB ───────────────────────────────────
  const orphanedInMinio: string[] = [];
  for (const key of minioKeys) {
    if (!dbKeys.has(key)) {
      orphanedInMinio.push(key);
    }
  }

  // ── Category 2: in DB but not in MinIO ───────────────────────────────────
  const missingInMinio: Array<{ key: string; source: string }> = [];
  for (const [key, source] of dbKeys) {
    if (!minioKeys.has(key)) {
      missingInMinio.push({ key, source });
    }
  }

  // ── DB-level stats ────────────────────────────────────────────────────────
  const [snapshotStats, sessionCount] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint; with_screenshot: bigint; with_html: bigint }>>`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE screenshot_data_url IS NOT NULL) AS with_screenshot,
        COUNT(*) FILTER (WHERE html IS NOT NULL)        AS with_html
      FROM session_replay_snapshots
    `,
    prisma.studentSession.count(),
  ]);

  const snap = snapshotStats[0]!;

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════');
  console.log(' RESULTS');
  console.log('════════════════════════════════════════════════\n');

  // MinIO summary
  console.log(`MinIO bucket "${BUCKET}": ${minioKeys.size} objects total`);
  console.log(`DB blob references:       ${dbKeys.size}`);
  console.log('');

  // Orphaned MinIO objects
  if (orphanedInMinio.length === 0) {
    console.log('✓  No orphaned MinIO objects');
  } else {
    console.log(
      `✗  ${orphanedInMinio.length} orphaned MinIO object(s) — in MinIO but no DB reference:`,
    );
    for (const key of orphanedInMinio.slice(0, 50)) {
      console.log(`     ${key}`);
    }
    if (orphanedInMinio.length > 50) {
      console.log(`     ... and ${orphanedInMinio.length - 50} more`);
    }
  }
  console.log('');

  // Broken DB references
  if (missingInMinio.length === 0) {
    console.log('✓  No broken DB references (all blob keys exist in MinIO)');
  } else {
    console.log(
      `✗  ${missingInMinio.length} broken DB reference(s) — in DB but missing from MinIO:`,
    );
    for (const { key, source } of missingInMinio.slice(0, 50)) {
      console.log(`     ${key}  [${source}]`);
    }
    if (missingInMinio.length > 50) {
      console.log(`     ... and ${missingInMinio.length - 50} more`);
    }
  }
  console.log('');

  // Database storage stats
  console.log('─── Database storage (session_replay_snapshots) ───');
  console.log(`  Total snapshots:          ${snap.total}`);
  console.log(`  With screenshotDataUrl:   ${snap.with_screenshot}  (base64 JPEG in DB — large)`);
  console.log(`  With html:                ${snap.with_html}  (DOM html in DB — very large)`);
  console.log(`  Total sessions:           ${sessionCount}`);
  if (Number(snap.with_screenshot) > 0) {
    const avgPerSession = sessionCount > 0 ? (Number(snap.total) / sessionCount).toFixed(0) : 0;
    console.log(`  Avg snapshots/session:    ${avgPerSession}`);
    console.log(
      `  Estimated screenshot storage: ~${fmt(Number(snap.with_screenshot) * 80_000)}` +
        ` (assuming 80 KB avg per JPEG)`,
    );
  }
  if (Number(snap.with_html) > 0) {
    console.log(
      `  Estimated HTML storage:       ~${fmt(Number(snap.with_html) * 500_000)}` +
        ` (assuming 500 KB avg per HTML)`,
    );
  }
  console.log('');

  // Summary recommendation
  if (orphanedInMinio.length > 0) {
    console.log('── Recommendation ──────────────────────────────────');
    console.log(
      `   Run the cleanup script to delete ${orphanedInMinio.length} orphaned MinIO objects.`,
    );
    console.log('   They have no DB reference and cannot be recovered via the application.');
    console.log('');
    console.log('   To print a delete script, pipe output to grep and use mc or aws cli:');
    console.log(`     mc rm minio/${BUCKET}/<key>  (one per orphan)`);
    console.log('');
  }

  // Machine-readable dump to stdout if ORPHAN_JSON=1
  if (process.env.ORPHAN_JSON === '1') {
    console.log('\n── JSON dump (ORPHAN_JSON=1) ───────────────────────');
    console.log(JSON.stringify({ orphanedInMinio, missingInMinio }, null, 2));
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
