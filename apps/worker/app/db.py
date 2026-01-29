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


def update_mastery_after_grading(
    grading_result_id: str,
    attempt_id: str,
    score: float,
) -> None:
    """Update KC evidence and user mastery after grading."""
    ema_alpha = 0.3
    initial_probability = 0.5
    correct_threshold = 0.5

    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Get attempt + question info
            cur.execute(
                """
                SELECT a.student_id, a.question_id, q.max_score
                FROM attempts a
                JOIN questions q ON q.id = a.question_id
                WHERE a.id = %s
                """,
                (attempt_id,),
            )
            attempt_row = cur.fetchone()
            if not attempt_row:
                return

            student_id = attempt_row["student_id"]
            max_score = attempt_row["max_score"]
            fractional_score = score / max_score if max_score > 0 else 0
            is_correct = fractional_score >= correct_threshold
            now = datetime.now(timezone.utc)

            # Get KCs tagged to this question
            cur.execute(
                "SELECT kc_id FROM question_kcs WHERE question_id = %s",
                (attempt_row["question_id"],),
            )
            kc_rows = cur.fetchall()

            for kc_row in kc_rows:
                kc_id = kc_row["kc_id"]

                # Insert KC evidence (append-only)
                cur.execute(
                    """
                    INSERT INTO kc_evidence (id, grading_result_id, kc_id, is_correct, score, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(uuid.uuid4()),
                        grading_result_id,
                        kc_id,
                        is_correct,
                        fractional_score,
                        now,
                    ),
                )

                # Check if user_mastery row exists
                cur.execute(
                    """
                    SELECT id, probability_known, correct_attempts
                    FROM user_mastery
                    WHERE user_id = %s AND kc_id = %s
                    """,
                    (student_id, kc_id),
                )
                mastery_row = cur.fetchone()

                if mastery_row:
                    old_p = mastery_row["probability_known"]
                    new_p = ema_alpha * fractional_score + (1 - ema_alpha) * old_p
                    new_correct = mastery_row["correct_attempts"] + (1 if is_correct else 0)

                    cur.execute(
                        """
                        UPDATE user_mastery
                        SET probability_known = %s,
                            total_attempts = total_attempts + 1,
                            correct_attempts = %s,
                            last_attempt_at = %s
                        WHERE id = %s
                        """,
                        (new_p, new_correct, now, mastery_row["id"]),
                    )
                else:
                    new_p = ema_alpha * fractional_score + (1 - ema_alpha) * initial_probability
                    cur.execute(
                        """
                        INSERT INTO user_mastery
                        (id, user_id, kc_id, probability_known, total_attempts, correct_attempts,
                         last_attempt_at)
                        VALUES (%s, %s, %s, %s, 1, %s, %s)
                        """,
                        (
                            str(uuid.uuid4()),
                            student_id,
                            kc_id,
                            new_p,
                            1 if is_correct else 0,
                            now,
                        ),
                    )

            conn.commit()

    logger.info(
        "Mastery updated for attempt %s: %d KCs processed",
        attempt_id,
        len(kc_rows) if kc_rows else 0,
    )


def check_db_health() -> bool:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                return True
    except Exception:
        return False
