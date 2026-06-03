# GALS Studio — Operator Guide

For the person running the study laptops and the central analysis machine.

## 1. Export bundles on each study laptop

On a laptop running live GALS (Docker: Postgres + MinIO + api + web):

```bash
cd <gals-monorepo>
pnpm install && pnpm db:generate     # once
cd tools/gals-export && npm install  # once

export DATABASE_URL="postgresql://ats_user:ats_password@localhost:5432/ats_db"
export BLOB_STORAGE_ENDPOINT="http://localhost:9000"
export BLOB_STORAGE_BUCKET="ats-blobs"
export BLOB_STORAGE_ACCESS_KEY="minioadmin"
export BLOB_STORAGE_SECRET_KEY="minioadmin"

# one session, zipped
npm run export -- --session <sessionId> --out ./exports --zip
# or everything since a date
npm run export -- --all-since 2026-06-01T00:00:00Z --out ./exports --zip
```

Each produces a self-contained `session_<id>/` (+ `.zip`). After export the
laptop's Postgres/MinIO are irrelevant — the bundle is the contract.

## 2. Copy bundles to the central machine

Copy the `session_*.zip` files (USB stick or network share) into one folder on
the central computer that runs GALS Studio.

## 3. Bulk import

```bash
cd gals-studio
npm install            # once
npm run db:migrate     # once — creates studio.db under STUDIO_DATA_DIR
# bulk import a folder of bundles
npm -w @gals-studio/server run import -- '/path/to/bundles/*.zip'
```

Or use the **Library → Import** UI per bundle. One bad bundle never poisons the
rest of a bulk run; each reports its own validation result.

## 4. Run the app

```bash
npm run dev      # server (5174) + web (5173) for development
# or single-process / packaged:
npm run studio   # builds web, server serves it
```

Data lives under `STUDIO_DATA_DIR` (default `~/.gals-studio`): `studio.db` +
`media/<sessionId>/`. Override with `STUDIO_DATA_DIR=/path npm run dev`.

## 5. Desktop build (no terminal for researchers)

```bash
npm -w @gals-studio/web run build
npm -w @gals-studio/desktop run dist:mac   # or dist:win / dist:linux
```

The launcher ensures the data dir, runs migrations, starts the server on a free
port, and opens the window. Signing/notarization is out of scope but slots into
`apps/desktop/package.json` → `build`.

## 6. Back up coding

The single most important artifact is coding. Library → **Export all coding**
(zip of coders, codebook versions, annotations, reliability runs). Restore with
**Import coding**. This is independent of media, so labels survive even if
bundles are deleted or the DB is rebuilt.
