"""
Daily cron job: exports all ended sessions not yet backed up.

Usage:
  python analysis/backup_all_sessions.py [--db-url URL] [--output-dir ./exports]

Recommended cron entry:
  0 3 * * * cd /app && python analysis/backup_all_sessions.py >> logs/backup.log 2>&1
"""

import os
import sys
import sqlite3
import argparse
from datetime import datetime, timezone

import psycopg2
import pandas as pd

from export_logs import SessionExporter


def get_tracking_db(output_dir: str) -> sqlite3.Connection:
    """Open or create the local SQLite tracking database."""
    db_path = os.path.join(output_dir, 'export_log.sqlite')
    os.makedirs(output_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS exported_sessions (
            session_id TEXT PRIMARY KEY,
            exported_at TEXT,
            manifest_path TEXT
        )
    ''')
    conn.commit()
    return conn


def main():
    parser = argparse.ArgumentParser(description='Backup all ended sessions')
    parser.add_argument('--db-url', default=None)
    parser.add_argument('--output-dir', default='./exports')
    args = parser.parse_args()

    # 1. Connect to PostgreSQL
    db_url = args.db_url or os.environ['DATABASE_URL']
    pg_conn = psycopg2.connect(db_url)

    # 2. Get all ended sessions
    sessions_df = pd.read_sql(
        'SELECT id FROM student_sessions WHERE "endedAt" IS NOT NULL',
        pg_conn,
    )
    pg_conn.close()

    if len(sessions_df) == 0:
        print('No ended sessions found.')
        return

    # 3. Load tracking DB
    tracking = get_tracking_db(args.output_dir)
    already_exported = set(
        row[0] for row in tracking.execute('SELECT session_id FROM exported_sessions').fetchall()
    )

    to_export = [sid for sid in sessions_df['id'].tolist() if sid not in already_exported]
    skipped = len(sessions_df) - len(to_export)

    exported = 0
    errors = 0

    for session_id in to_export:
        try:
            exporter = SessionExporter(session_id, args.db_url, args.output_dir)
            manifest = exporter.export_session()

            try:
                exporter.export_aligned_master()
            except Exception:
                pass  # Non-fatal

            try:
                exporter.upload_to_minio(exporter.session_export_dir)
            except Exception as e:
                print(f"  Warning: MinIO upload failed for {session_id}: {e}")

            manifest_path = os.path.join(exporter.session_export_dir, 'manifest.json')
            tracking.execute(
                'INSERT INTO exported_sessions (session_id, exported_at, manifest_path) VALUES (?, ?, ?)',
                (session_id, datetime.now(timezone.utc).isoformat(), manifest_path),
            )
            tracking.commit()
            exported += 1
            print(f"  Exported {session_id}: {manifest['total_rows']} rows")

        except Exception as e:
            errors += 1
            print(f"  ERROR exporting {session_id}: {e}")

    tracking.close()
    print(f"\nDone: exported {exported}, skipped {skipped} already exported, {errors} errors")


if __name__ == '__main__':
    main()
