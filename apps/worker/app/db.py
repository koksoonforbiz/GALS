import json
import uuid
import logging
from datetime import datetime, timezone
from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extras

from app.config import get_settings

logger = logging.getLogger(__name__)

psycopg2.extras.register_uuid()


@contextmanager
def get_connection() -> Generator:
    settings = get_settings()
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
    finally:
        conn.close()


def poll_event(topic: str) -> dict | None:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE event_queue
                SET status = 'processing'
                WHERE id = (
                    SELECT id FROM event_queue
                    WHERE topic = %s AND status = 'pending'
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, topic, payload
                """,
                (topic,),
            )
            row = cur.fetchone()
            conn.commit()
            if row:
                return dict(row)
            return None


def mark_processed(event_id: str) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE event_queue
                SET status = 'processed', processed_at = %s
                WHERE id = %s
                """,
                (datetime.now(timezone.utc), event_id),
            )
            conn.commit()


def mark_failed(event_id: str) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE event_queue SET status = 'failed' WHERE id = %s",
                (event_id,),
            )
            conn.commit()


def publish_event(topic: str, payload: dict) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO event_queue (id, topic, payload, status, created_at)
                VALUES (%s, %s, %s, 'pending', %s)
                """,
                (
                    str(uuid.uuid4()),
                    topic,
                    json.dumps(payload),
                    datetime.now(timezone.utc),
                ),
            )
            conn.commit()


def update_attempt_status(attempt_id: str, status: str) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE attempts
                SET status = %s, updated_at = %s
                WHERE id = %s
                """,
                (status, datetime.now(timezone.utc), attempt_id),
            )
            conn.commit()


def insert_grading_result(
    attempt_id: str,
    score: float,
    feedback: str,
    graded_by: str,
) -> str:
    result_id = str(uuid.uuid4())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO grading_results (id, attempt_id, score, feedback, graded_by, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    result_id,
                    attempt_id,
                    score,
                    feedback,
                    graded_by,
                    datetime.now(timezone.utc),
                ),
            )
            conn.commit()
    return result_id


def check_db_health() -> bool:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                return True
    except Exception:
        return False
