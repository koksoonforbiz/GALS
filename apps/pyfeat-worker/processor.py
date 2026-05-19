"""Core AU extraction logic using py-feat."""

import os
import uuid
import tempfile
import json
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
try:
    from feat import Detector
except ImportError:
    from feat.detector import Detector

from minio_client import download_file, upload_file
from db import bulk_insert_au_results

# AU column names used in the database
AU_COLUMNS = [
    "au01", "au02", "au04", "au05", "au06", "au07", "au09", "au10",
    "au12", "au14", "au15", "au17", "au20", "au23", "au24", "au25",
    "au26", "au28",
]

# Mapping from py-feat output columns to our DB columns
PYFEAT_AU_MAP = {
    "AU01": "au01", "AU02": "au02", "AU04": "au04", "AU05": "au05",
    "AU06": "au06", "AU07": "au07", "AU09": "au09", "AU10": "au10",
    "AU12": "au12", "AU14": "au14", "AU15": "au15", "AU17": "au17",
    "AU20": "au20", "AU23": "au23", "AU24": "au24", "AU25": "au25",
    "AU26": "au26", "AU28": "au28",
}


def process_job(job: dict) -> str:
    """
    Process a py-feat job:
    1. Download video from MinIO
    2. Extract frames at the configured FPS
    3. Run py-feat Detector
    4. Build AU result rows with wall timestamps
    5. Bulk-insert rows into PostgreSQL
    6. Write results CSV to MinIO
    7. Return the MinIO key for the CSV

    Returns the result MinIO key.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        # 1. Download video
        video_path = os.path.join(tmpdir, "input.webm")
        download_file(job["sourceMinioKey"], video_path)

        # 2. Extract frames
        cap = cv2.VideoCapture(video_path)
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
        # Browser-encoded webms can report unreliable FPS metadata. Clamp to a
        # sane range so wall-time math and fallback frame-step sampling remain stable.
        if not np.isfinite(native_fps) or native_fps <= 0:
            native_fps = 15.0
        native_fps = float(min(max(native_fps, 1.0), 120.0))

        extraction_fps = float(job.get("extractionFps", 1.0) or 1.0)
        extraction_fps = float(min(max(extraction_fps, 0.1), 30.0))
        sample_every = max(1, round(native_fps / extraction_fps))
        sample_interval_ms = 1000.0 / extraction_fps

        frames_dir = os.path.join(tmpdir, "frames")
        os.makedirs(frames_dir)

        frame_paths = []
        frame_indices = []
        frame_offsets_sec = []
        idx = 0
        next_sample_ms = 0.0

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Prefer timestamp-based sampling so requested extraction_fps is honored
            # even when container FPS metadata is inaccurate.
            pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
            should_sample = False
            if np.isfinite(pos_msec) and pos_msec >= 0:
                if pos_msec + 1e-3 >= next_sample_ms:
                    should_sample = True
                    next_sample_ms += sample_interval_ms
            else:
                # Fallback to frame-step sampling when timestamps are unavailable.
                should_sample = (idx % sample_every == 0)

            if should_sample:
                frame_path = os.path.join(frames_dir, f"frame_{idx:06d}.png")
                cv2.imwrite(frame_path, frame)
                frame_paths.append(frame_path)
                frame_indices.append(idx)
                if np.isfinite(pos_msec) and pos_msec >= 0:
                    frame_offsets_sec.append(float(pos_msec) / 1000.0)
                else:
                    frame_offsets_sec.append(float(idx) / native_fps)
            idx += 1
        cap.release()

        if not frame_paths:
            raise ValueError("No frames extracted from video")

        # 3. Run py-feat detection
        detector = Detector(
            face_model=job.get("detectorBackend", "retinaface"),
            au_model=job.get("auPredictor", "xgb"),
            emotion_model="resmasknet",
            identity_model=None,
        )

        result_df = detector.detect_image(frame_paths)

        # 4. Build AU result rows with wall timestamps
        clip_start = datetime.fromisoformat(job["clipStartWallTime"].replace("Z", "+00:00"))
        now = datetime.utcnow()
        rows = []

        for i, (_, row) in enumerate(result_df.iterrows()):
            if i >= len(frame_indices):
                break
            frame_idx = frame_indices[i]
            seconds_offset = frame_offsets_sec[i] if i < len(frame_offsets_sec) else (frame_idx / native_fps)
            wall_time = clip_start + timedelta(seconds=seconds_offset)

            au_values = {}
            for pyfeat_col, db_col in PYFEAT_AU_MAP.items():
                val = row.get(pyfeat_col)
                au_values[db_col] = float(val) if pd.notna(val) else None

            face_conf = None
            face_box = None
            if "FaceScore" in row:
                face_conf = float(row["FaceScore"]) if pd.notna(row["FaceScore"]) else None
            if all(k in row for k in ["FaceRectX", "FaceRectY", "FaceRectWidth", "FaceRectHeight"]):
                face_box = json.dumps({
                    "x": float(row["FaceRectX"]),
                    "y": float(row["FaceRectY"]),
                    "w": float(row["FaceRectWidth"]),
                    "h": float(row["FaceRectHeight"]),
                })

            db_row = {
                "id": str(uuid.uuid4())[:25],  # cuid-like
                "job_id": job["jobId"],
                "frame_index": frame_idx,
                "timestamp": seconds_offset,
                "wall_time": wall_time,
                "face_conf": face_conf,
                "face_box": face_box,
                "created_at": now,
                **au_values,
            }
            rows.append(db_row)

        # 5. Bulk-insert into PostgreSQL
        bulk_insert_au_results(rows)

        # 6. Write CSV to MinIO
        csv_path = os.path.join(tmpdir, "au_results.csv")
        csv_columns = [
            "job_id", "frame_index", "timestamp", "wall_time",
        ] + AU_COLUMNS + ["face_conf"]

        csv_rows = []
        for r in rows:
            csv_row = {k: r.get(k, "") for k in csv_columns}
            csv_row["wall_time"] = r["wall_time"].isoformat()
            csv_rows.append(csv_row)

        df = pd.DataFrame(csv_rows, columns=csv_columns)
        df.to_csv(csv_path, index=False)

        result_key = f"pyfeat/{job['studentId']}/{job['sessionId']}/{job['jobId']}_au_results.csv"
        upload_file(csv_path, result_key)

        return result_key
