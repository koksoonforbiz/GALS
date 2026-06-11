"""
py-feat worker — polls Redis queue 'pyfeat:jobs' and processes AU extraction jobs.

Each job is a JSON object:
{
  "jobId": str,
  "studentId": str,
  "sessionId": str,
  "courseId": str,
  "sourceMinioKey": str,
  "extractionFps": float,
  "enabledAus": list[str],
  "detectorBackend": str,
  "auPredictor": str,
  "clipStartWallTime": str  // ISO8601
}
"""

import os
import sys
import json
import logging
import threading
import time

import redis
from dotenv import load_dotenv

from processor import process_job
from db import update_job_status

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)s] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
QUEUE_KEY = "pyfeat:jobs"
CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "2"))


def create_redis_client() -> redis.Redis:
    """Create a Redis client with keepalive and health-check to survive idle periods."""
    return redis.from_url(
        REDIS_URL,
        socket_keepalive=True,
        retry_on_timeout=True,
        health_check_interval=30,
    )


def worker_loop(worker_id: int) -> None:
    """Block-wait on the Redis queue and process jobs."""
    logger.info(f"Worker {worker_id} started, waiting for jobs on '{QUEUE_KEY}'")

    redis_client = create_redis_client()

    while True:
        try:
            # BLPOP with 5-second timeout to avoid busy polling
            result = redis_client.blpop(QUEUE_KEY, timeout=5)
            if result is None:
                continue

            _, raw_payload = result
            job = json.loads(raw_payload)
            job_id = job["jobId"]

            logger.info(f"Worker {worker_id} processing job {job_id}")

            # Mark as PROCESSING
            update_job_status(job_id, "PROCESSING")

            # Process the job
            result_key = process_job(job)

            # Mark as COMPLETED
            update_job_status(job_id, "COMPLETED", result_minio_key=result_key)
            logger.info(f"Worker {worker_id} completed job {job_id} -> {result_key}")

        except redis.ConnectionError as e:
            logger.warning(f"Worker {worker_id} Redis connection lost: {e}. Reconnecting in 2s...")
            time.sleep(2)
            try:
                redis_client = create_redis_client()
                redis_client.ping()
                logger.info(f"Worker {worker_id} reconnected to Redis")
            except Exception as reconnect_err:
                logger.error(f"Worker {worker_id} failed to reconnect: {reconnect_err}")

        except Exception as e:
            logger.error(f"Worker {worker_id} error: {e}", exc_info=True)
            try:
                if "job_id" in dir():
                    update_job_status(job_id, "FAILED", error=str(e))
            except Exception:
                pass
            # Brief pause before retrying
            time.sleep(1)


def main() -> None:
    logger.info(f"Starting py-feat worker with {CONCURRENCY} threads")

    # Verify Redis connectivity at startup
    try:
        probe = create_redis_client()
        probe.ping()
        probe.close()
        logger.info("Connected to Redis")
    except redis.ConnectionError:
        logger.error("Cannot connect to Redis")
        sys.exit(1)

    threads = []
    for i in range(CONCURRENCY):
        t = threading.Thread(
            target=worker_loop,
            args=(i,),
            name=f"pyfeat-worker-{i}",
            daemon=True,
        )
        t.start()
        threads.append(t)

    # Keep main thread alive
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Shutting down py-feat worker")


if __name__ == "__main__":
    main()
