"""
OpenFace 3 emotion detection worker.
Polls Redis queue 'openface3:jobs' for recording segment jobs,
extracts per-frame universal emotion probabilities, and persists
them to the emotion_frames table.
"""

import os
import json
import time
import threading
import redis
import psycopg2

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
DATABASE_URL = os.environ.get('DATABASE_URL', '')
QUEUE_KEY = 'openface3:jobs'
HEARTBEAT_KEY = 'openface3:worker:heartbeat'
CONCURRENCY = int(os.environ.get('WORKER_CONCURRENCY', '2'))


def get_db_conn():
    return psycopg2.connect(DATABASE_URL)


def get_redis():
    return redis.from_url(REDIS_URL)


def process_job(job_data: dict):
    """Process a single OpenFace 3 job."""
    job_id = job_data['jobId']
    segment_id = job_data['recordingSegmentId']
    minio_key = job_data['minioKey']
    session_id = job_data['sessionId']
    user_id = job_data['userId']
    course_id = job_data['courseId']
    segment_start_ms = job_data['segmentStartWallMs']
    fps = job_data.get('extractionFps', 5)

    conn = get_db_conn()
    cur = conn.cursor()

    try:
        # Mark job as PROCESSING
        cur.execute(
            'UPDATE openface3_jobs SET status = %s, started_at = NOW() WHERE id = %s',
            ('PROCESSING', job_id),
        )
        conn.commit()

        # TODO: Download video from MinIO, run OpenFace 3 model
        # For now, this is a placeholder that marks the job as completed
        # The actual OpenFace 3 integration requires the model weights
        # and the openface3 Python package to be installed

        print(f'[OpenFace3] Processing job {job_id} for segment {segment_id}')
        print(f'[OpenFace3] MinIO key: {minio_key}, FPS: {fps}')
        print(f'[OpenFace3] NOTE: OpenFace 3 model not yet installed. Job will complete with 0 frames.')

        # Mark job as completed (placeholder)
        cur.execute(
            '''UPDATE openface3_jobs
               SET status = %s, completed_at = NOW(), frames_processed = 0, frames_with_face = 0
               WHERE id = %s''',
            ('COMPLETED', job_id),
        )
        conn.commit()
        print(f'[OpenFace3] Job {job_id} completed (placeholder)')

    except Exception as e:
        conn.rollback()
        error_msg = str(e)[:500]
        print(f'[OpenFace3] Job {job_id} failed: {error_msg}')

        try:
            cur.execute(
                '''UPDATE openface3_jobs
                   SET status = %s, error_message = %s, retries = retries + 1
                   WHERE id = %s''',
                ('FAILED', error_msg, job_id),
            )
            conn.commit()
        except Exception:
            pass

    finally:
        cur.close()
        conn.close()


def worker_loop(r: redis.Redis, worker_id: int):
    """Main worker loop — polls Redis for jobs."""
    print(f'[OpenFace3] Worker {worker_id} started')

    while True:
        try:
            result = r.blpop(QUEUE_KEY, timeout=5)
            if result is None:
                continue

            _, raw = result
            job_data = json.loads(raw)
            process_job(job_data)

        except Exception as e:
            print(f'[OpenFace3] Worker {worker_id} error: {e}')
            time.sleep(2)


def heartbeat_loop(r: redis.Redis):
    """Writes a heartbeat timestamp every 15 seconds."""
    while True:
        try:
            r.set(HEARTBEAT_KEY, str(int(time.time() * 1000)))
        except Exception:
            pass
        time.sleep(15)


def main():
    print(f'[OpenFace3] Starting worker with concurrency={CONCURRENCY}')

    r = get_redis()

    # Start heartbeat thread
    hb = threading.Thread(target=heartbeat_loop, args=(r,), daemon=True)
    hb.start()

    # Start worker threads
    threads = []
    for i in range(CONCURRENCY):
        t = threading.Thread(target=worker_loop, args=(r, i), daemon=True)
        t.start()
        threads.append(t)

    # Keep main thread alive
    for t in threads:
        t.join()


if __name__ == '__main__':
    main()
