/**
 * Orphan data cleanup script.
 *
 * Detects and deletes:
 *   1. Orphaned MinIO objects — objects in the bucket with no DB reference.
 *   2. Broken imageObjectKey references — DocumentChunk / StudentRagChunk rows
 *      that point to a MinIO object that no longer exists (nulled out).
 *   3. Broken bannerBlobKey / pdfBlobKey references — Course / ModuleItem rows
 *      pointing at missing blobs (nulled out).
 *
 * Rows with missing REQUIRED blobs (sourceDocument.blobKey,
 * recordingSegment.minioKey, pyfeatJob.*) are reported but NOT auto-deleted —
 * they need manual investigation.
 *
 * Usage (dry-run — no changes, just shows what would be cleaned):
 *   docker exec gals-milestone-1-monorepo-api-1 \
 *     npx ts-node -r tsconfig-paths/register scripts/cleanup-orphans.ts
 *
 * Usage (execute — actually deletes / nulls):
 *   docker exec gals-milestone-1-monorepo-api-1 \
 *     npx ts-node -r tsconfig-paths/register scripts/cleanup-orphans.ts --execute
 */

import { PrismaClient } from '@prisma/client';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--execute');
const ENDPOINT = process.env.BLOB_STORAGE_ENDPOINT ?? 'http://localhost:9000';
const BUCKET = process.env.BLOB_STORAGE_BUCKET ?? 'ats-blobs';
const ACCESS_KEY = process.env.BLOB_STORAGE_ACCESS_KEY ?? 'minioadmin';
const SECRET_KEY = process.env.BLOB_STORAGE_SECRET_KEY ?? 'minioadmin';
const REGION = process.env.BLOB_STORAGE_REGION ?? 'us-east-1';

const prisma = new PrismaClient();
const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${n} B`;
}

/** List every object key+size in the bucket, handling pagination. */
async function listAllMinioObjects(): Promise<Map<string, number>> {
  const objects = new Map<string, number>(); // key → size in bytes
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: continuationToken }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) objects.set(obj.Key, obj.Size ?? 0);
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

/** Delete MinIO objects in batches of 1000 (S3 API limit). */
async function deleteMinioObjects(keys: string[]): Promise<void> {
  const BATCH = 1000;
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
  }
}

/** Check whether a MinIO object exists (used for required-blob validation). */
async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Collect every blob key from the database. Returns Map<key, description>. */
async function getAllDbBlobKeys(): Promise<Map<string, string>> {
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

  for (const r of courses) if (r.bannerBlobKey) keys.set(r.bannerBlobKey, `Course ${r.id} banner`);
  for (const r of moduleItems) if (r.pdfBlobKey) keys.set(r.pdfBlobKey, `ModuleItem ${r.id} pdf`);
  for (const r of sourceDocs) if (r.blobKey) keys.set(r.blobKey, `SourceDocument ${r.id}`);
  for (const r of docChunks)
    if (r.imageObjectKey) keys.set(r.imageObjectKey, `DocumentChunk ${r.id} image`);
  for (const r of studentDocs) if (r.blobKey) keys.set(r.blobKey, `StudentSourceDocument ${r.id}`);
  for (const r of studentChunks)
    if (r.imageObjectKey) keys.set(r.imageObjectKey, `StudentRagChunk ${r.id} image`);
  for (const r of recordings) keys.set(r.minioKey, `RecordingSegment ${r.id}`);
  for (const r of pyfeatJobs) {
    keys.set(r.sourceMinioKey, `PyfeatJob ${r.id} source`);
    if (r.resultMinioKey) keys.set(r.resultMinioKey, `PyfeatJob ${r.id} result`);
  }

  return keys;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════');
  console.log(` GALS Orphan Cleanup  [${DRY_RUN ? 'DRY RUN — no changes' : 'EXECUTE MODE'}]`);
  console.log('════════════════════════════════════════════════\n');
  if (DRY_RUN) {
    console.log('  Pass --execute to actually delete/null the orphaned data.\n');
  }

  // ── Step 1: scan ─────────────────────────────────────────────────────────
  console.log('Scanning MinIO...');
  const minioObjects = await listAllMinioObjects();
  const totalMinioSize = [...minioObjects.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${minioObjects.size} objects, ${fmt(totalMinioSize)} total\n`);

  console.log('Scanning DB blob references...');
  const dbKeys = await getAllDbBlobKeys();
  console.log(`  ${dbKeys.size} references\n`);

  // ── Step 2: classify ─────────────────────────────────────────────────────

  // Orphaned MinIO objects (in MinIO, not in DB)
  const orphanKeys: string[] = [];
  let orphanBytes = 0;
  for (const [key, size] of minioObjects) {
    if (!dbKeys.has(key)) {
      orphanKeys.push(key);
      orphanBytes += size;
    }
  }

  // Broken DB references split by fixability
  // Optional fields → can be nulled safely
  interface NullableRef {
    table: string;
    id: string;
    field: string;
    key: string;
  }
  // Required fields → needs manual review
  interface RequiredRef {
    source: string;
    key: string;
  }

  const nullableRefs: NullableRef[] = [];
  const requiredMissing: RequiredRef[] = [];

  const [
    courses,
    moduleItems,
    docChunks,
    studentChunks,
    sourceDocs,
    studentDocs,
    recordings,
    pyfeatJobs,
  ] = await Promise.all([
    prisma.course.findMany({ select: { id: true, bannerBlobKey: true } }),
    prisma.moduleItem.findMany({ select: { id: true, pdfBlobKey: true } }),
    prisma.documentChunk.findMany({
      where: { imageObjectKey: { not: null } },
      select: { id: true, imageObjectKey: true },
    }),
    prisma.studentRagChunk.findMany({
      where: { imageObjectKey: { not: null } },
      select: { id: true, imageObjectKey: true },
    }),
    prisma.sourceDocument.findMany({ select: { id: true, blobKey: true } }),
    prisma.studentSourceDocument.findMany({ select: { id: true, blobKey: true } }),
    prisma.recordingSegment.findMany({ select: { id: true, minioKey: true } }),
    prisma.pyfeatJob.findMany({ select: { id: true, sourceMinioKey: true, resultMinioKey: true } }),
  ]);

  for (const r of courses) {
    if (r.bannerBlobKey && !minioObjects.has(r.bannerBlobKey))
      nullableRefs.push({
        table: 'Course',
        id: r.id,
        field: 'bannerBlobKey',
        key: r.bannerBlobKey,
      });
  }
  for (const r of moduleItems) {
    if (r.pdfBlobKey && !minioObjects.has(r.pdfBlobKey))
      nullableRefs.push({ table: 'ModuleItem', id: r.id, field: 'pdfBlobKey', key: r.pdfBlobKey });
  }
  for (const r of docChunks) {
    if (r.imageObjectKey && !minioObjects.has(r.imageObjectKey))
      nullableRefs.push({
        table: 'DocumentChunk',
        id: r.id,
        field: 'imageObjectKey',
        key: r.imageObjectKey,
      });
  }
  for (const r of studentChunks) {
    if (r.imageObjectKey && !minioObjects.has(r.imageObjectKey))
      nullableRefs.push({
        table: 'StudentRagChunk',
        id: r.id,
        field: 'imageObjectKey',
        key: r.imageObjectKey,
      });
  }
  for (const r of sourceDocs) {
    if (!minioObjects.has(r.blobKey))
      requiredMissing.push({ source: `SourceDocument ${r.id}`, key: r.blobKey });
  }
  for (const r of studentDocs) {
    if (!minioObjects.has(r.blobKey))
      requiredMissing.push({ source: `StudentSourceDocument ${r.id}`, key: r.blobKey });
  }
  for (const r of recordings) {
    if (!minioObjects.has(r.minioKey))
      requiredMissing.push({ source: `RecordingSegment ${r.id}`, key: r.minioKey });
  }
  for (const r of pyfeatJobs) {
    if (!minioObjects.has(r.sourceMinioKey))
      requiredMissing.push({ source: `PyfeatJob ${r.id} source`, key: r.sourceMinioKey });
    if (r.resultMinioKey && !minioObjects.has(r.resultMinioKey))
      requiredMissing.push({ source: `PyfeatJob ${r.id} result`, key: r.resultMinioKey });
  }

  // ── Step 3: report ───────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════');
  console.log(' FINDINGS');
  console.log('════════════════════════════════════════════════\n');

  console.log(
    `Orphaned MinIO objects (no DB reference): ${orphanKeys.length}  (${fmt(orphanBytes)})`,
  );
  if (orphanKeys.length > 0) {
    for (const k of orphanKeys.slice(0, 30)) console.log(`  - ${k}`);
    if (orphanKeys.length > 30) console.log(`  ... and ${orphanKeys.length - 30} more`);
  }
  console.log('');

  console.log(`Broken nullable refs (will be nulled out): ${nullableRefs.length}`);
  if (nullableRefs.length > 0) {
    for (const r of nullableRefs.slice(0, 20))
      console.log(`  - ${r.table} ${r.id}.${r.field} → "${r.key}"`);
    if (nullableRefs.length > 20) console.log(`  ... and ${nullableRefs.length - 20} more`);
  }
  console.log('');

  console.log(`Broken required refs (MANUAL review needed): ${requiredMissing.length}`);
  if (requiredMissing.length > 0) {
    for (const r of requiredMissing) console.log(`  ⚠  ${r.source}  →  "${r.key}"`);
  }
  console.log('');

  if (orphanKeys.length === 0 && nullableRefs.length === 0 && requiredMissing.length === 0) {
    console.log('✓ Nothing to clean up. Storage is consistent.\n');
    return;
  }

  if (DRY_RUN) {
    console.log(`──────────────────────────────────────────────`);
    console.log(`DRY RUN complete. Would free ~${fmt(orphanBytes)} from MinIO.`);
    console.log(`Run with --execute to apply changes.\n`);
    return;
  }

  // ── Step 4: execute ──────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════');
  console.log(' EXECUTING CLEANUP');
  console.log('════════════════════════════════════════════════\n');

  // 4a. Delete orphaned MinIO objects
  if (orphanKeys.length > 0) {
    process.stdout.write(`Deleting ${orphanKeys.length} orphaned MinIO object(s)... `);
    await deleteMinioObjects(orphanKeys);
    console.log('done');
  }

  // 4b. Null out broken optional references
  if (nullableRefs.length > 0) {
    process.stdout.write(`Nulling ${nullableRefs.length} broken optional DB reference(s)... `);
    await prisma.$transaction(async (tx) => {
      for (const r of nullableRefs) {
        if (r.table === 'Course')
          await tx.course.update({ where: { id: r.id }, data: { bannerBlobKey: null } });
        else if (r.table === 'ModuleItem')
          await tx.moduleItem.update({ where: { id: r.id }, data: { pdfBlobKey: null } });
        else if (r.table === 'DocumentChunk')
          await tx.documentChunk.update({ where: { id: r.id }, data: { imageObjectKey: null } });
        else if (r.table === 'StudentRagChunk')
          await tx.studentRagChunk.update({ where: { id: r.id }, data: { imageObjectKey: null } });
      }
    });
    console.log('done');
  }

  // ── Step 5: summary ──────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('════════════════════════════════════════════════\n');
  console.log(`✓  MinIO objects deleted:       ${orphanKeys.length}  (freed ${fmt(orphanBytes)})`);
  console.log(`✓  Broken refs nulled in DB:    ${nullableRefs.length}`);

  if (requiredMissing.length > 0) {
    console.log(`\n⚠  ${requiredMissing.length} required-blob reference(s) need manual review:`);
    for (const r of requiredMissing) console.log(`     ${r.source}  →  "${r.key}"`);
    console.log(
      '\n   These are main document/recording files. Decide whether to delete the DB row',
    );
    console.log('   or re-upload the file before removing it.');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
