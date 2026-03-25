# Prompt 08 — Data Export & Backup: CSV + JSONL Auto-Export Pipeline

## Stack Context

- **Python**: 3.10+
- **Database**: PostgreSQL via `psycopg2-binary` (NOT sqlalchemy)
- **Object storage**: `minio` Python SDK (NOT boto3, NOT pyarrow)
- **DO NOT use**: `sqlalchemy`, `pyarrow`, `boto3`
- **Export formats**: CSV (primary) + JSON Lines `.jsonl` (human-readable sidecar)
- **Parquet**: use `fastparquet` only if explicitly available; otherwise CSV is fine
- All code lives in the `analysis/` directory

---

## Why CSV + JSONL (not Parquet)

Since `pyarrow` is not in the stack, we use:

- **CSV** as the primary export: universally readable, opens in Excel/Sheets,
  works with `pandas.read_csv()` — sufficient for research use
- **JSONL** as a sidecar: preserves nested JSON fields (`metadata`, `auEvidence`,
  `reasons`) that CSV would flatten awkwardly; one JSON object per line,
  human-inspectable with any text editor, grep-able

---

## Task

Create `analysis/export_logs.py` with the following full implementation.

---

## Database Connection

```python
import psycopg2
import pandas as pd

def get_connection(db_url: str | None = None):
    import os
    return psycopg2.connect(db_url or os.environ['DATABASE_URL'])
```

Use `pd.read_sql(query, conn)` for all queries.
Cast BigInt columns with `.astype('int64')` after loading (psycopg2 returns `Decimal`
for Prisma BigInt fields).

---

## CLASS: `SessionExporter`

```python
class SessionExporter:
    def __init__(
        self,
        session_id: str,
        db_url: str | None = None,
        output_dir: str = './exports'
    ): ...

    def export_table(
        self,
        table_name: str,
        query: str | None = None,  # custom SQL; if None: SELECT * WHERE "sessionId" = %s
        write_csv: bool = True,
        write_jsonl: bool = True
    ) -> dict:
        """Returns { csv_path, jsonl_path, row_count }"""

    def export_session(self) -> dict:
        """Export ALL tables for this session. Returns manifest dict."""

    def export_aligned_master(self, fps: float = 30.0) -> dict:
        """
        Calls multimodal_sync.build_aligned_master() then exports as CSV + JSONL.
        Returns { csv_path, jsonl_path, row_count }
        """
```

---

## Tables to Export in `export_session()`

Export the following tables filtered by `sessionId`:

**Raw sensor logs:**
`pupil_size_logs`, `webgazer_logs`,
`cursor_logs`, `click_logs`, `scroll_logs`, `keystroke_logs`,
`visibility_logs`, `clipboard_logs`, `viewport_logs`,
`performance_logs`, `error_logs`

AU data (requires JOIN — use a custom SQL query):

```sql
SELECT r.*, j."sessionId", s."startedAt" as segment_start_ms
FROM pyfeat_au_results r
JOIN pyfeat_jobs j ON r."jobId" = j.id
JOIN recording_segments s ON j."segmentId" = s.id
WHERE j."sessionId" = %s
```

**Session & event logs:**
`student_sessions`, `session_summaries`, `activity_logs`,
`learning_interventions`, `attempts`, `grading_results`,
`dialogue_sessions`, `dialogue_messages`, `llm_usage_logs`,
`recording_segments`, `spaced_repetition_cards`,
`user_mastery`, `kc_evidence`

**Derived analytics:**
`derived_engagement`, `derived_cognitive_load`, `derived_emotion_timeline`,
`derived_learning_velocity`, `derived_at_risk_flags`

**Sync infrastructure:**
`session_sync_anchors`, `modality_offsets`

**Aligned output:**
`aligned_frames`

---

## Output Directory Structure

```
exports/
  {session_id}/
    {YYYY-MM-DD_HH-MM}/           ← export timestamp folder
      manifest.json
      raw/
        pupil_size_logs.csv
        pupil_size_logs.jsonl
        webgazer_logs.csv
        webgazer_logs.jsonl
        pyfeat_au_results.csv
        pyfeat_au_results.jsonl
        cursor_logs.csv
        cursor_logs.jsonl
        click_logs.csv
        scroll_logs.csv
        keystroke_logs.csv
        visibility_logs.csv
        clipboard_logs.csv
        viewport_logs.csv
        performance_logs.csv
        error_logs.csv
      events/
        activity_logs.csv
        activity_logs.jsonl
        learning_interventions.csv
        attempts.csv
        grading_results.csv
        dialogue_sessions.csv
        dialogue_messages.csv
        llm_usage_logs.csv
        recording_segments.csv
        spaced_repetition_cards.csv
        student_sessions.csv
        session_summaries.csv
      derived/
        derived_engagement.csv
        derived_engagement.jsonl
        derived_cognitive_load.csv
        derived_emotion_timeline.csv
        derived_emotion_timeline.jsonl
        derived_learning_velocity.csv
        derived_at_risk_flags.csv
        derived_at_risk_flags.jsonl
      aligned/
        aligned_frames.csv
        aligned_master.csv          ← from export_aligned_master()
      sync/
        session_sync_anchors.csv
        modality_offsets.csv
```

Only write JSONL for tables that contain nested JSON fields
(`metadata`, `auEvidence`, `reasons`, `resourceTimingsJson`, etc.).
CSV is sufficient for flat tables.

---

## JSONL Writing

```python
import orjson

def write_jsonl(df: pd.DataFrame, path: str):
    """Write DataFrame as JSON Lines — one JSON object per line."""
    with open(path, 'wb') as f:
        for record in df.to_dict(orient='records'):
            f.write(orjson.dumps(record, option=orjson.OPT_NON_STR_KEYS) + b'\n')
```

---

## Manifest Format (`manifest.json`)

```json
{
  "session_id": "...",
  "export_timestamp": "2024-01-15T10:30:00Z",
  "export_duration_ms": 4231,
  "tables": {
    "pupil_size_logs": { "row_count": 18420, "csv_bytes": 921000, "jsonl_bytes": null },
    "webgazer_logs": { "row_count": 36000, "csv_bytes": 1820000, "jsonl_bytes": null },
    "activity_logs": { "row_count": 340, "csv_bytes": 84000, "jsonl_bytes": 124000 },
    "...": "..."
  },
  "total_rows": 94231,
  "total_csv_bytes": 12400000,
  "total_jsonl_bytes": 3200000
}
```

---

## MinIO Upload

```python
from minio import Minio
from minio.error import S3Error
import os

def upload_to_minio(
    self,
    local_export_dir: str,
    bucket: str = 'log-exports',
    prefix: str | None = None
) -> dict:
    """
    Uploads entire export folder to MinIO.
    Uses minio Python SDK — NOT boto3.
    Credentials from environment variables already used in the project.
    Returns { uploaded_files: [...], bucket, prefix }
    """
```

Connect using the same MinIO credentials/endpoint already configured in the project.
Check the existing codebase for the MinIO env vars (likely `MINIO_ENDPOINT`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`).

Use `minio_client.fput_object(bucket, object_name, file_path)` for each file.
Create the bucket if it does not exist: `minio_client.make_bucket(bucket)`.

---

## NestJS Export Trigger Endpoint

Add to the NestJS backend:

### `POST /jobs/export-session`

Protected by `JwtAuthGuard`.

Body: `{ sessionId: string, uploadToMinio?: boolean }`

- Spawns a Python subprocess:
  ```typescript
  import { exec } from 'child_process';
  exec(`python analysis/export_logs.py ${sessionId} ${uploadToMinio ? '--upload' : ''}`);
  ```
- Or, if a job queue (Bull/BullMQ) already exists in the project, add it to the queue instead
- Returns `{ success: true, message: 'Export job started', sessionId }`

### `GET /jobs/export-session/status?sessionId={id}`

Checks if `exports/{sessionId}/` exists and returns the latest `manifest.json` content.
Returns `{ exported: false }` if no export found.

---

## Auto-Trigger on Session End

In the existing NestJS service that sets `student_sessions.endedAt`:

After marking the session ended, fire-and-forget:

```typescript
// In sessions.service.ts, after updating endedAt:
this.httpService
  .post('/jobs/export-session', { sessionId, uploadToMinio: true })
  .subscribe({ error: (e) => this.logger.error('Export trigger failed', e) });
// Or if using a job queue — add to queue here
```

---

## Scheduled Full-Database Backup Script

Create `analysis/backup_all_sessions.py`:

```python
"""
Daily cron job: exports all ended sessions not yet backed up.

Usage:
  python analysis/backup_all_sessions.py [--db-url URL] [--output-dir ./exports]

Recommended cron entry:
  0 3 * * * cd /app && python analysis/backup_all_sessions.py >> logs/backup.log 2>&1
"""
```

Logic:

1. Connect to PostgreSQL with psycopg2
2. Query: all `student_sessions` where `"endedAt" IS NOT NULL`
3. Load `export_log.sqlite` (local SQLite tracking file at `exports/export_log.sqlite`)
   — table `exported_sessions` with columns `session_id TEXT PRIMARY KEY, exported_at TEXT, manifest_path TEXT`
4. For each session not yet in `exported_sessions`:
   - Run `SessionExporter(session_id).export_session()`
   - Run `upload_to_minio()`
   - Insert into `exported_sessions`
5. Print: `Exported N sessions, skipped M already exported, N errors`

Use Python's built-in `sqlite3` module for the tracking log.

---

## `__main__` Block for `export_logs.py`

```python
if __name__ == '__main__':
    import sys, argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('session_id')
    parser.add_argument('--db-url', default=None)
    parser.add_argument('--output-dir', default='./exports')
    parser.add_argument('--upload', action='store_true')
    args = parser.parse_args()

    exporter = SessionExporter(args.session_id, args.db_url, args.output_dir)
    manifest = exporter.export_session()
    exporter.export_aligned_master()
    if args.upload:
        result = exporter.upload_to_minio(exporter.session_export_dir)
        print(f"Uploaded {len(result['uploaded_files'])} files to MinIO")
    print(f"Export complete: {manifest['total_rows']} rows across {len(manifest['tables'])} tables")
```

---

## `analysis/requirements-analysis.txt` (final, complete list)

```
pandas>=2.0
psycopg2-binary>=2.9
numpy>=1.24
scipy>=1.10
minio>=7.2
redis>=4.6
fastparquet>=2023.10
tqdm>=4.66
orjson>=3.9
```
