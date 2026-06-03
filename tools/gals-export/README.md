# gals-export

Standalone CLI that exports **one GALS student session** into a portable,
file-based **bundle** (format: [`BUNDLE_SPEC.md`](./BUNDLE_SPEC.md), version 1).
After export the bundle has **no Postgres or MinIO dependency** — copy it to a
USB stick / the central analysis machine and import it into **GALS Studio**.

It connects directly to Postgres (via the live `@prisma/client`) and MinIO
(via the S3 client). **The Nest API does not need to be running.**

## Setup (on a study laptop)

```bash
# from the GALS monorepo root, once:
pnpm install
pnpm db:generate          # generates @prisma/client the exporter reuses

cd tools/gals-export
npm install               # exporter's own deps (archiver, aws-sdk, tsx)
```

Point it at the running Docker services via env (same values as `apps/api`):

```bash
export DATABASE_URL="postgresql://ats_user:ats_password@localhost:5432/ats_db"
export BLOB_STORAGE_ENDPOINT="http://localhost:9000"
export BLOB_STORAGE_BUCKET="ats-blobs"
export BLOB_STORAGE_ACCESS_KEY="minioadmin"
export BLOB_STORAGE_SECRET_KEY="minioadmin"
export BLOB_STORAGE_REGION="us-east-1"
```

> Docker note: if the exporter runs on the host (not inside the compose
> network), use the host-published ports — `localhost:5432` for Postgres and
> `localhost:9000` for MinIO — as shown above.

## Usage

```bash
# one session, also zipped
npm run export -- --session <sessionId> --out ./exports --zip

# every session for a user
npm run export -- --user <userId> --out ./exports

# everything since a date, skip webcam for speed
npm run export -- --all-since 2026-06-01T00:00:00Z --out ./exports --include-webcam false

# reproduce an existing bundle (identical checksums, modulo exportedAt)
npm run export -- --session <sessionId> --out ./exports --force
```

Produces `exports/session_<sessionId>/` (and `session_<sessionId>.zip` with
`--zip`). The CLI prints per-stream row counts, total bytes, any missing webcam
segments, and the bundle path.

## What's in a bundle

`manifest.json` (versions, counts, per-file sha256), `session.json`,
`streams/*.jsonl`, `snapshots/index.json` + per-snapshot `.html`/`.jpg`,
`webcam/index.json` + `.webm`/`.mp4`, `messages/*.jsonl`, `kc/*.jsonl`, and
optional `probes/`, `questionnaires/`, `annotations/`. Full field-by-field
contract in [`BUNDLE_SPEC.md`](./BUNDLE_SPEC.md).

## Guarantees

- **Self-contained:** after export you can delete Postgres + MinIO; every media
  file is a real local file and `manifest.files` checksums verify offline.
- **Resilient:** a failure fetching one stream logs a warning and writes an
  empty file; a webcam segment missing in blob storage is marked
  `status:"missing"` — neither aborts the export.
- **Idempotent:** re-running refuses to clobber an existing bundle unless
  `--force`, and with `--force` reproduces byte-identical output (except
  `manifest.exportedAt`).

## Tests

```bash
npm test
```

The smoke test exports a fixture session through an in-memory data source (no
DB required), then asserts the bundle validates against the spec: required
files present, manifest checksums match, every JSONL line parses with a finite
`wallMs`, optional-empty files are omitted, and missing webcam is tolerated.
