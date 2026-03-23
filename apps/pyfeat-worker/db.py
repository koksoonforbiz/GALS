"""PostgreSQL helpers for the py-feat worker."""

import os
from datetime import datetime
from typing import Optional
import psycopg2
from psycopg2.extras import execute_values


def get_connection():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def update_job_status(
    job_id: str,
    status: str,
    error: Optional[str] = None,
    result_minio_key: Optional[str] = None,
) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            now = datetime.utcnow()
            if status == "PROCESSING":
                cur.execute(
                    'UPDATE pyfeat_jobs SET status=%s, started_at=%s, updated_at=%s WHERE id=%s',
                    (status, now, now, job_id),
                )
            elif status == "COMPLETED":
                cur.execute(
                    'UPDATE pyfeat_jobs SET status=%s, completed_at=%s, result_minio_key=%s, updated_at=%s WHERE id=%s',
                    (status, now, result_minio_key, now, job_id),
                )
            elif status == "FAILED":
                cur.execute(
                    'UPDATE pyfeat_jobs SET status=%s, error=%s, updated_at=%s WHERE id=%s',
                    (status, error, now, job_id),
                )
        conn.commit()
    finally:
        conn.close()


def bulk_insert_au_results(rows: list[dict]) -> None:
    """Insert AU result rows into pyfeat_au_results table."""
    if not rows:
        return
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            columns = [
                "id", "job_id", "frame_index", "timestamp", "wall_time",
                "au01", "au02", "au04", "au05", "au06", "au07", "au09", "au10",
                "au12", "au14", "au15", "au17", "au20", "au23", "au24", "au25",
                "au26", "au28", "face_conf", "face_box", "created_at",
            ]
            col_str = ", ".join(columns)
            template = "(" + ", ".join(["%s"] * len(columns)) + ")"

            values = []
            for r in rows:
                values.append(tuple(r.get(c) for c in columns))

            execute_values(
                cur,
                f"INSERT INTO pyfeat_au_results ({col_str}) VALUES %s",
                values,
                template=template,
            )
        conn.commit()
    finally:
        conn.close()
