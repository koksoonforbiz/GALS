#!/usr/bin/env node
/**
 * gals-export — turn one (or many) GALS student session(s) into portable
 * file-based bundles. Connects directly to Postgres (Prisma) + MinIO (S3);
 * the Nest app does not need to be running.
 *
 *   gals-export --session <id> --out ./exports --zip
 *   gals-export --all-since 2026-06-01T00:00:00Z --out ./exports
 *   gals-export --user <userId> --out ./exports --include-webcam false
 */
import { S3Client } from '@aws-sdk/client-s3';
import { exportSession, bundleByteSize } from './export.js';
import { PrismaDataSource } from './datasource.js';

interface Args {
  session?: string;
  allSince?: string;
  user?: string;
  out: string;
  zip: boolean;
  includeWebcam: boolean;
  db?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { out: './exports', zip: false, includeWebcam: true, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case '--session': a.session = next(); break;
      case '--all-since': a.allSince = next(); break;
      case '--user': a.user = next(); break;
      case '--out': a.out = next(); break;
      case '--zip': a.zip = true; break;
      case '--force': a.force = true; break;
      case '--include-webcam': a.includeWebcam = next() !== 'false'; break;
      case '--db': a.db = next(); break;
      case '--minio': next(); break; // accepted for symmetry; creds come from env
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
        if (k.startsWith('--')) { console.error(`Unknown flag: ${k}`); process.exit(1); }
    }
  }
  return a;
}

function printHelp(): void {
  console.log(`gals-export — export GALS sessions to portable bundles

  --session <id>          export one session
  --all-since <ISO>       export all sessions started since a timestamp
  --user <id>             export all sessions for a user
  --out <dir>             output directory (default ./exports)
  --zip                   also produce session_<id>.zip
  --include-webcam <b>    include MP4/WebM webcam (default true)
  --force                 overwrite an existing bundle
  --db <postgres-url>     defaults to env DATABASE_URL
  --minio <endpoint>      MinIO/S3 creds come from BLOB_STORAGE_* env

Env: DATABASE_URL, BLOB_STORAGE_ENDPOINT, BLOB_STORAGE_BUCKET,
     BLOB_STORAGE_ACCESS_KEY, BLOB_STORAGE_SECRET_KEY, BLOB_STORAGE_REGION`);
}

async function makePrisma(dbUrl?: string): Promise<any> {
  // Lazy import so `--help` and unit tests don't require a generated client.
  const mod: any = await import('@prisma/client');
  const PrismaClient = mod.PrismaClient;
  return dbUrl
    ? new PrismaClient({ datasources: { db: { url: dbUrl } } })
    : new PrismaClient();
}

function makeS3(): { s3: S3Client; bucket: string } {
  const endpoint = process.env.BLOB_STORAGE_ENDPOINT;
  const bucket = process.env.BLOB_STORAGE_BUCKET ?? 'ats-blobs';
  const s3 = new S3Client({
    endpoint,
    region: process.env.BLOB_STORAGE_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.BLOB_STORAGE_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.BLOB_STORAGE_SECRET_KEY ?? 'minioadmin',
    },
    forcePathStyle: true,
  });
  return { s3, bucket };
}

async function resolveSessionIds(prisma: any, args: Args): Promise<string[]> {
  if (args.session) return [args.session];
  if (args.user) {
    const rows = await prisma.studentSession.findMany({
      where: { userId: args.user }, select: { id: true }, orderBy: { startedAt: 'asc' },
    });
    return rows.map((r: any) => r.id);
  }
  if (args.allSince) {
    const rows = await prisma.studentSession.findMany({
      where: { startedAt: { gte: new Date(args.allSince) } },
      select: { id: true }, orderBy: { startedAt: 'asc' },
    });
    return rows.map((r: any) => r.id);
  }
  throw new Error('Specify one of --session, --user, or --all-since');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = await makePrisma(args.db ?? process.env.DATABASE_URL);
  const { s3, bucket } = makeS3();
  const ds = new PrismaDataSource(prisma, s3, bucket);

  try {
    const ids = await resolveSessionIds(prisma, args);
    if (ids.length === 0) { console.log('No sessions matched.'); return; }
    console.log(`Exporting ${ids.length} session(s) to ${args.out}\n`);
    for (const sessionId of ids) {
      try {
        const result = await exportSession(ds, {
          sessionId, outDir: args.out, zip: args.zip,
          includeWebcam: args.includeWebcam, force: args.force,
          log: (m) => console.log(`  · ${m}`),
        });
        const bytes = await bundleByteSize(result.bundleDir);
        console.log(`\n✓ session_${sessionId}`);
        console.log(`  bundle: ${result.bundleDir}`);
        if (result.zipPath) console.log(`  zip:    ${result.zipPath}`);
        console.log(`  rows:   ${JSON.stringify(result.manifest.counts)}`);
        console.log(`  bytes:  ${bytes.toLocaleString()}`);
        if (result.missingWebcamSegments.length)
          console.log(`  ⚠ missing webcam: ${result.missingWebcamSegments.join(', ')}`);
        console.log('');
      } catch (err) {
        console.error(`✗ session_${sessionId}: ${(err as Error).message}`);
      }
    }
  } finally {
    await prisma.$disconnect?.();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
