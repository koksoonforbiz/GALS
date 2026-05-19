import time
import logging
import threading

from app.db import (
    poll_event,
    mark_processed,
    mark_failed,
    publish_event,
    update_attempt_status,
    insert_grading_result,
    update_mastery_after_grading,
)
from app.grader import grade_attempt

logger = logging.getLogger(__name__)

GRADE_SUBMISSION_TOPIC = "grade_submission"
GRADE_COMPLETED_TOPIC = "grade_completed"
POLL_INTERVAL_SECONDS = 2


def process_grading_event(event: dict) -> None:
    payload = event["payload"]
    attempt_id = payload["attemptId"]
    event_id = event["id"]

    logger.info("Processing grading event for attempt %s", attempt_id)

    update_attempt_status(attempt_id, "grading")

    result = grade_attempt(payload)

    grading_result_id = insert_grading_result(
        attempt_id=attempt_id,
        score=result["score"],
        feedback=result["feedback"],
        graded_by=result["gradedBy"],
    )

    update_attempt_status(attempt_id, "graded")

    # Update KC mastery (if question has KC tags)
    try:
        update_mastery_after_grading(grading_result_id, attempt_id, result["score"])
    except Exception:
        logger.exception("Failed to update mastery for attempt %s", attempt_id)

    publish_event(
        GRADE_COMPLETED_TOPIC,
        {
            "attemptId": attempt_id,
            "studentId": payload["studentId"],
            "questionId": payload["questionId"],
            "score": result["score"],
            "feedback": result["feedback"],
            "gradedBy": result["gradedBy"],
        },
    )

    mark_processed(event_id)
    logger.info("Grading complete for attempt %s: score=%s", attempt_id, result["score"])


def _poll_loop(stop_event: threading.Event) -> None:
    logger.info("Event loop started, polling every %ss", POLL_INTERVAL_SECONDS)
    while not stop_event.is_set():
        try:
            event = poll_event(GRADE_SUBMISSION_TOPIC)
            if event:
                try:
                    process_grading_event(event)
                except Exception:
                    logger.exception("Failed to process event %s", event["id"])
                    try:
                        mark_failed(event["id"])
                    except Exception:
                        logger.exception("Failed to mark event %s as failed", event["id"])
        except Exception:
            logger.exception("Error polling for events")

        stop_event.wait(POLL_INTERVAL_SECONDS)

    logger.info("Event loop stopped")


class EventLoop:
    def __init__(self) -> None:
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=_poll_loop, args=(self._stop_event,), daemon=True)
        self._thread.start()
        logger.info("Event loop thread started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Event loop thread stopped")

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
