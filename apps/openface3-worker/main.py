"""
OpenFace 3 emotion-detection worker.

Polls Redis queue 'openface3:jobs' for jobs enqueued by RecordingService.completeSegment,
downloads the recorded video segment from MinIO, samples frames at the configured
extraction FPS, runs OpenFace 3.0's face detector + multitask model on each sampled
frame, and persists per-frame emotion probabilities to public.emotion_frames.

Job lifecycle written to public.openface3_jobs:
    PENDING -> PROCESSING -> COMPLETED (with frames_processed, frames_with_face)
    PENDING -> PROCESSING -> FAILED    (with error_message)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from typing import Iterable, Tuple
from urllib.parse import urlparse

import cv2
import cuid
import numpy as np
import psycopg2
import psycopg2.extras
import redis
from minio import Minio

from inference import FrameResult, Openface3Inferencer

# ─── Config ─────────────────────────────────────────────────────────────────

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379')
DATABASE_URL = os.environ.get('DATABASE_URL', '')
QUEUE_KEY = 'openface3:jobs'
HEARTBEAT_KEY = 'openface3:worker:heartbeat'
CONCURRENCY = int(os.environ.get('WORKER_CONCURRENCY', '2'))

MINIO_ENDPOINT = os.environ.get('MINIO_ENDPOINT', 'minio')
MINIO_PORT = os.environ.get('MINIO_PORT', '9000')
MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET = os.environ.get('MINIO_BUCKET', 'ats-blobs')
MINIO_SECURE = os.environ.get('MINIO_SECURE', 'false').lower() == 'true'

OPENFACE3_MODEL_PATH = os.environ.get('OPENFACE3_MODEL_PATH', '/models/openface3')
OPENFACE3_DEVICE = os.environ.get('OPENFACE3_DEVICE', 'cpu')


# ─── Connection helpers ─────────────────────────────────────────────────────


def get_db_conn():
    return psycopg2.connect(DATABASE_URL)


def get_redis():
    return redis.from_url(REDIS_URL)


def get_minio() -> Minio:
    return Minio(
        f'{MINIO_ENDPOINT}:{MINIO_PORT}',
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )


# ─── Frame sampling ─────────────────────────────────────────────────────────


def remux_to_mp4(input_path: str) -> str:
    """Reencode a video to mp4 (h264 + yuv420p) for reliable cv2 decoding.

    Browser-recorded webms (VP8/VP9 from MediaRecorder) often have streaming-
    style fragmented metadata that breaks cv2.VideoCapture: it returns False
    from cap.read() within the first second even though ffmpeg can decode the
    whole stream fine. Reencoding through ffmpeg to a plain mp4 sidesteps the
    issue. Cost is one ffmpeg pass over the segment (~real-time decode).
    """
    out_path = input_path + '.remuxed.mp4'
    cmd = [
        'ffmpeg', '-y', '-loglevel', 'error',
        '-i', input_path,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-an',  # drop audio, we only sample frames
        out_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def iter_sampled_frames(
    video_path: str, target_fps: float
) -> Iterable[Tuple[int, float, np.ndarray]]:
    """Yield (frame_index, offset_seconds, bgr_frame) for the sampled frames.

    Always remuxes through ffmpeg first — browser-recorded webms confuse
    cv2.VideoCapture (it reports EOF after a handful of frames). The cost is
    a quick reencode of the segment.
    """
    decoded_path = remux_to_mp4(video_path)
    try:
        cap = cv2.VideoCapture(decoded_path)
        if not cap.isOpened():
            raise RuntimeError(f'cv2 could not open video {decoded_path}')

        try:
            source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            if source_fps <= 0 or source_fps > 1000:
                source_fps = 30.0
            stride = max(1, int(round(source_fps / max(target_fps, 0.1))))
            print(
                f'[OpenFace3] decoder: source_fps={source_fps:.2f} '
                f'target_fps={target_fps:.2f} stride={stride}'
            )

            sampled_idx = 0
            original_idx = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if original_idx % stride == 0:
                    offset_seconds = original_idx / source_fps
                    yield sampled_idx, offset_seconds, frame
                    sampled_idx += 1
                original_idx += 1
            print(
                f'[OpenFace3] decoder: read {original_idx} raw frames, '
                f'sampled {sampled_idx}'
            )
        finally:
            cap.release()
    finally:
        if os.path.exists(decoded_path):
            try:
                os.unlink(decoded_path)
            except OSError:
                pass


# ─── DB writes ──────────────────────────────────────────────────────────────


def insert_emotion_frames(
    cur, job_id: str, session_id: str, user_id: str, course_id: str,
    rows: list,
) -> None:
    """Batch-insert emotion_frames rows. `rows` is a list of dicts produced by
    process_job()."""
    if not rows:
        return
    psycopg2.extras.execute_batch(
        cur,
        """
        INSERT INTO emotion_frames (
            id, job_id, session_id, user_id, course_id,
            frame_wall_ms, frame_index, face_detected,
            p_happiness, p_sadness, p_surprise, p_fear,
            p_anger, p_disgust, p_contempt, p_neutral,
            dominant_emotion, dominant_probability,
            head_pose_yaw, head_pose_pitch, head_pose_roll
        ) VALUES (
            %(id)s, %(job_id)s, %(session_id)s, %(user_id)s, %(course_id)s,
            %(frame_wall_ms)s, %(frame_index)s, %(face_detected)s,
            %(p_happiness)s, %(p_sadness)s, %(p_surprise)s, %(p_fear)s,
            %(p_anger)s, %(p_disgust)s, %(p_contempt)s, %(p_neutral)s,
            %(dominant_emotion)s, %(dominant_probability)s,
            NULL, NULL, NULL
        )
        """,
        [
            {
                'id': cuid.cuid(),
                'job_id': job_id,
                'session_id': session_id,
                'user_id': user_id,
                'course_id': course_id,
                **row,
            }
            for row in rows
        ],
        page_size=200,
    )


# ─── Job processing ─────────────────────────────────────────────────────────


def process_job(job_data: dict, inferencer: Openface3Inferencer) -> None:
    job_id = job_data['jobId']
    segment_id = job_data['recordingSegmentId']
    minio_key = job_data['minioKey']
    session_id = job_data['sessionId']
    user_id = job_data['userId']
    course_id = job_data['courseId']
    segment_start_ms = int(job_data['segmentStartWallMs'])
    fps = float(job_data.get('extractionFps', 5))

    print(f'[OpenFace3] start job={job_id} segment={segment_id} fps={fps}')

    conn = get_db_conn()
    cur = conn.cursor()

    try:
        cur.execute(
            'UPDATE openface3_jobs SET status = %s, started_at = NOW() WHERE id = %s',
            ('PROCESSING', job_id),
        )
        conn.commit()

        with tempfile.NamedTemporaryFile(suffix=os.path.splitext(minio_key)[1] or '.webm') as tmp:
            mc = get_minio()
            mc.fget_object(MINIO_BUCKET, minio_key, tmp.name)
            tmp.flush()

            rows = []
            frames_with_face = 0
            for frame_index, offset_s, bgr in iter_sampled_frames(tmp.name, fps):
                result: FrameResult = inferencer.infer_frame(bgr)
                if result.face_detected:
                    frames_with_face += 1
                rows.append({
                    'frame_wall_ms': segment_start_ms + int(offset_s * 1000),
                    'frame_index': frame_index,
                    'face_detected': result.face_detected,
                    'p_happiness': result.p_happiness,
                    'p_sadness': result.p_sadness,
                    'p_surprise': result.p_surprise,
                    'p_fear': result.p_fear,
                    'p_anger': result.p_anger,
                    'p_disgust': result.p_disgust,
                    'p_contempt': result.p_contempt,
                    'p_neutral': result.p_neutral,
                    'dominant_emotion': result.dominant_emotion,
                    'dominant_probability': result.dominant_probability,
                })

            insert_emotion_frames(cur, job_id, session_id, user_id, course_id, rows)

            cur.execute(
                """
                UPDATE openface3_jobs
                SET status = %s,
                    completed_at = NOW(),
                    frames_processed = %s,
                    frames_with_face = %s,
                    error_message = NULL
                WHERE id = %s
                """,
                ('COMPLETED', len(rows), frames_with_face, job_id),
            )
            conn.commit()
            print(
                f'[OpenFace3] done  job={job_id}: '
                f'{len(rows)} frames processed, {frames_with_face} with face'
            )

    except Exception as exc:
        conn.rollback()
        error_msg = f'{type(exc).__name__}: {exc}'[:500]
        print(f'[OpenFace3] FAILED job={job_id}: {error_msg}')
        try:
            cur.execute(
                """
                UPDATE openface3_jobs
                SET status = %s, error_message = %s, retries = retries + 1
                WHERE id = %s
                """,
                ('FAILED', error_msg, job_id),
            )
            conn.commit()
        except Exception:
            pass
    finally:
        cur.close()
        conn.close()


# ─── Worker / heartbeat threads ─────────────────────────────────────────────


def worker_loop(r: redis.Redis, worker_id: int, inferencer: Openface3Inferencer) -> None:
    print(f'[OpenFace3] worker {worker_id} ready')
    while True:
        try:
            result = r.blpop(QUEUE_KEY, timeout=5)
            if result is None:
                continue
            _, raw = result
            job_data = json.loads(raw)
            process_job(job_data, inferencer)
        except Exception as exc:
            # Catch-all so a single bad job doesn't kill the worker thread.
            print(f'[OpenFace3] worker {worker_id} loop error: {exc}')
            time.sleep(2)


def heartbeat_loop(r: redis.Redis) -> None:
    while True:
        try:
            r.set(HEARTBEAT_KEY, str(int(time.time() * 1000)))
        except Exception as exc:
            print(f'[OpenFace3] heartbeat error: {exc}')
        time.sleep(15)


# ─── Entry point ────────────────────────────────────────────────────────────


def main() -> int:
    print(f'[OpenFace3] booting: concurrency={CONCURRENCY} device={OPENFACE3_DEVICE}')
    print(f'[OpenFace3] redis={REDIS_URL}')
    db_host = urlparse(DATABASE_URL).hostname or '?'
    print(f'[OpenFace3] postgres={db_host}')
    print(f'[OpenFace3] minio={MINIO_ENDPOINT}:{MINIO_PORT} bucket={MINIO_BUCKET}')

    # Load models up-front so a missing-weights misconfig fails fast at boot
    # rather than on the first job.
    inferencer = Openface3Inferencer(model_dir=OPENFACE3_MODEL_PATH, device=OPENFACE3_DEVICE)

    r = get_redis()
    r.ping()  # surface auth/network errors immediately

    threading.Thread(target=heartbeat_loop, args=(r,), daemon=True).start()

    threads = []
    for i in range(CONCURRENCY):
        t = threading.Thread(target=worker_loop, args=(r, i, inferencer), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()
    return 0


if __name__ == '__main__':
    sys.exit(main())
