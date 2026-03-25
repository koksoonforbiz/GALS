"""
Data export pipeline: CSV + JSONL auto-export for student sessions.

Usage:
    python analysis/export_logs.py <session_id> [--db-url URL] [--output-dir ./exports] [--upload]
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timezone

import pandas as pd
import psycopg2
import orjson


# ─── Database Connection ─────────────────────────────────

def get_connection(db_url: str | None = None):
    return psycopg2.connect(db_url or os.environ['DATABASE_URL'])


# ─── JSONL Writer ────────────────────────────────────────

def write_jsonl(df: pd.DataFrame, path: str):
    """Write DataFrame as JSON Lines — one JSON object per line."""
    with open(path, 'wb') as f:
        for record in df.to_dict(orient='records'):
            f.write(orjson.dumps(record, option=orjson.OPT_NON_STR_KEYS) + b'\n')


# ─── BigInt Cast Helper ─────────────────────────────────

BIGINT_COLUMNS = [
    'timestamp', 'wallClockMs', 'monotonicMs', 'serverReceiveMs',
    'estimatedAt', 'windowStartMs', 'windowEndMs', 'flaggedAt',
    'frameTMs', 'tRel', 'durationMs', 'hiddenDurationMs',
]

def cast_bigints(df: pd.DataFrame) -> pd.DataFrame:
    for col in BIGINT_COLUMNS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').astype('Int64')
    return df


# ─── Tables with JSON fields (need JSONL sidecar) ───────

JSONL_TABLES = {
    'activity_logs', 'pyfeat_au_results',
    'derived_engagement', 'derived_emotion_timeline',
    'derived_at_risk_flags', 'performance_logs',
}


# ─── Session Exporter ───────────────────────────────────

class SessionExporter:
    def __init__(
        self,
        session_id: str,
        db_url: str | None = None,
        output_dir: str = './exports',
    ):
        self.session_id = session_id
        self.db_url = db_url
        self.output_dir = output_dir
        self.timestamp_str = datetime.now(timezone.utc).strftime('%Y-%m-%d_%H-%M')
        self.session_export_dir = os.path.join(
            output_dir, session_id, self.timestamp_str
        )

    def export_table(
        self,
        table_name: str,
        subfolder: str = 'raw',
        query: str | None = None,
        write_csv: bool = True,
        write_jsonl_file: bool = False,
    ) -> dict:
        """Export a single table. Returns { csv_path, jsonl_path, row_count }."""
        conn = get_connection(self.db_url)
        try:
            if query:
                df = pd.read_sql(query, conn, params=(self.session_id,))
            else:
                df = pd.read_sql(
                    f'SELECT * FROM {table_name} WHERE "sessionId" = %s',
                    conn,
                    params=(self.session_id,),
                )
        except Exception:
            # Table might not have sessionId column
            df = pd.DataFrame()
        finally:
            conn.close()

        df = cast_bigints(df)

        out_dir = os.path.join(self.session_export_dir, subfolder)
        os.makedirs(out_dir, exist_ok=True)

        result = {'csv_path': None, 'jsonl_path': None, 'row_count': len(df)}

        if write_csv and len(df) > 0:
            csv_path = os.path.join(out_dir, f'{table_name}.csv')
            df.to_csv(csv_path, index=False)
            result['csv_path'] = csv_path

        if write_jsonl_file and len(df) > 0:
            jsonl_path = os.path.join(out_dir, f'{table_name}.jsonl')
            write_jsonl(df, jsonl_path)
            result['jsonl_path'] = jsonl_path

        return result

    def export_session(self) -> dict:
        """Export ALL tables for this session. Returns manifest dict."""
        start_time = time.time()
        manifest_tables = {}

        # ─── Raw sensor logs ──────────────────────────
        raw_tables = [
            'pupil_size_logs', 'webgazer_logs',
            'cursor_logs', 'click_logs', 'scroll_logs', 'keystroke_logs',
            'visibility_logs', 'clipboard_logs', 'viewport_logs',
            'performance_logs', 'error_logs',
        ]
        for table in raw_tables:
            needs_jsonl = table in JSONL_TABLES
            result = self.export_table(table, subfolder='raw', write_jsonl_file=needs_jsonl)
            manifest_tables[table] = {
                'row_count': result['row_count'],
                'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
                'jsonl_bytes': os.path.getsize(result['jsonl_path']) if result['jsonl_path'] else None,
            }

        # AU data with JOIN
        au_query = '''
            SELECT r.*, j."sessionId", s."startedAt" as segment_start_ms
            FROM pyfeat_au_results r
            JOIN pyfeat_jobs j ON r."jobId" = j.id
            JOIN recording_segments s ON j."segmentId" = s.id
            WHERE j."sessionId" = %s
        '''
        result = self.export_table('pyfeat_au_results', subfolder='raw', query=au_query, write_jsonl_file=True)
        manifest_tables['pyfeat_au_results'] = {
            'row_count': result['row_count'],
            'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
            'jsonl_bytes': os.path.getsize(result['jsonl_path']) if result['jsonl_path'] else None,
        }

        # ─── Event / session logs ────────────────────
        event_tables = [
            'activity_logs', 'learning_interventions', 'attempts',
            'grading_results', 'dialogue_sessions', 'dialogue_messages',
            'llm_usage_logs', 'recording_segments', 'spaced_repetition_cards',
            'student_sessions', 'session_summaries',
        ]
        for table in event_tables:
            needs_jsonl = table in JSONL_TABLES
            # student_sessions uses 'id' not 'sessionId'
            query = None
            if table == 'student_sessions':
                query = f'SELECT * FROM {table} WHERE id = %s'
            elif table == 'session_summaries':
                query = f'SELECT * FROM {table} WHERE "sessionId" = %s'
            result = self.export_table(table, subfolder='events', query=query, write_jsonl_file=needs_jsonl)
            manifest_tables[table] = {
                'row_count': result['row_count'],
                'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
                'jsonl_bytes': os.path.getsize(result['jsonl_path']) if result['jsonl_path'] else None,
            }

        # ─── Derived analytics ───────────────────────
        derived_tables = [
            'derived_engagement', 'derived_cognitive_load',
            'derived_emotion_timeline', 'derived_learning_velocity',
            'derived_at_risk_flags',
        ]
        for table in derived_tables:
            needs_jsonl = table in JSONL_TABLES
            result = self.export_table(table, subfolder='derived', write_jsonl_file=needs_jsonl)
            manifest_tables[table] = {
                'row_count': result['row_count'],
                'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
                'jsonl_bytes': os.path.getsize(result['jsonl_path']) if result['jsonl_path'] else None,
            }

        # ─── Aligned frames ─────────────────────────
        result = self.export_table('aligned_frames', subfolder='aligned')
        manifest_tables['aligned_frames'] = {
            'row_count': result['row_count'],
            'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
            'jsonl_bytes': None,
        }

        # ─── Sync infrastructure ─────────────────────
        sync_tables = ['session_sync_anchors', 'modality_offsets']
        for table in sync_tables:
            result = self.export_table(table, subfolder='sync')
            manifest_tables[table] = {
                'row_count': result['row_count'],
                'csv_bytes': os.path.getsize(result['csv_path']) if result['csv_path'] else 0,
                'jsonl_bytes': None,
            }

        # ─── Write manifest ──────────────────────────
        total_rows = sum(t['row_count'] for t in manifest_tables.values())
        total_csv = sum(t['csv_bytes'] for t in manifest_tables.values())
        total_jsonl = sum(t['jsonl_bytes'] or 0 for t in manifest_tables.values())

        manifest = {
            'session_id': self.session_id,
            'export_timestamp': datetime.now(timezone.utc).isoformat(),
            'export_duration_ms': int((time.time() - start_time) * 1000),
            'tables': manifest_tables,
            'total_rows': total_rows,
            'total_csv_bytes': total_csv,
            'total_jsonl_bytes': total_jsonl,
        }

        manifest_path = os.path.join(self.session_export_dir, 'manifest.json')
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

        return manifest

    def export_aligned_master(self, fps: float = 30.0) -> dict:
        """
        Calls multimodal_sync.build_aligned_master() then exports as CSV + JSONL.
        """
        from multimodal_sync import build_aligned_master

        master = build_aligned_master(
            self.session_id,
            self.db_url,
            fps=fps,
            output_dir=self.output_dir,
        )

        if len(master) == 0:
            return {'csv_path': None, 'jsonl_path': None, 'row_count': 0}

        aligned_dir = os.path.join(self.session_export_dir, 'aligned')
        os.makedirs(aligned_dir, exist_ok=True)

        csv_path = os.path.join(aligned_dir, 'aligned_master.csv')
        master.to_csv(csv_path, index=False)

        jsonl_path = os.path.join(aligned_dir, 'aligned_master.jsonl')
        write_jsonl(master, jsonl_path)

        return {
            'csv_path': csv_path,
            'jsonl_path': jsonl_path,
            'row_count': len(master),
        }

    def upload_to_minio(
        self,
        local_export_dir: str,
        bucket: str = 'log-exports',
        prefix: str | None = None,
    ) -> dict:
        """
        Uploads entire export folder to MinIO.
        Uses minio Python SDK — NOT boto3.
        """
        from minio import Minio

        endpoint = os.environ.get('MINIO_ENDPOINT', 'localhost:9000')
        access_key = os.environ.get('MINIO_ACCESS_KEY', '')
        secret_key = os.environ.get('MINIO_SECRET_KEY', '')
        secure = os.environ.get('MINIO_USE_SSL', 'false').lower() == 'true'

        client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)

        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)

        upload_prefix = prefix or f'{self.session_id}/{self.timestamp_str}'
        uploaded_files = []

        for root, _dirs, files in os.walk(local_export_dir):
            for file_name in files:
                local_path = os.path.join(root, file_name)
                rel_path = os.path.relpath(local_path, local_export_dir)
                object_name = f'{upload_prefix}/{rel_path}'
                client.fput_object(bucket, object_name, local_path)
                uploaded_files.append(object_name)

        return {
            'uploaded_files': uploaded_files,
            'bucket': bucket,
            'prefix': upload_prefix,
        }


# ─── Main ────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('session_id')
    parser.add_argument('--db-url', default=None)
    parser.add_argument('--output-dir', default='./exports')
    parser.add_argument('--upload', action='store_true')
    args = parser.parse_args()

    exporter = SessionExporter(args.session_id, args.db_url, args.output_dir)
    manifest = exporter.export_session()

    try:
        exporter.export_aligned_master()
    except Exception as e:
        print(f"Warning: aligned master export failed: {e}")

    if args.upload:
        result = exporter.upload_to_minio(exporter.session_export_dir)
        print(f"Uploaded {len(result['uploaded_files'])} files to MinIO")

    print(f"Export complete: {manifest['total_rows']} rows across {len(manifest['tables'])} tables")
