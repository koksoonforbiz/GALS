# OpenFace 3 Emotion Detection Worker

Processes webcam recording segments to extract per-frame universal emotion probabilities using OpenFace 3.

## Prerequisites

1. **OpenFace 3 model weights**: Download from [CMU MultiComp Lab](https://github.com/CMU-MultiComp-Lab/OpenFace-3.0). Place model files in the path specified by `OPENFACE3_MODEL_PATH`.
2. **GPU (optional)**: Set `OPENFACE3_DEVICE=cuda` for GPU acceleration, `cpu` for CPU-only mode.

## Environment Variables

| Variable               | Default                  | Description               |
| ---------------------- | ------------------------ | ------------------------- |
| `REDIS_URL`            | `redis://localhost:6379` | Redis connection URL      |
| `DATABASE_URL`         | (required)               | PostgreSQL connection URL |
| `MINIO_ENDPOINT`       | `localhost`              | MinIO host                |
| `MINIO_PORT`           | `9000`                   | MinIO port                |
| `MINIO_ACCESS_KEY`     | `minioadmin`             | MinIO access key          |
| `MINIO_SECRET_KEY`     | `minioadmin`             | MinIO secret key          |
| `MINIO_BUCKET`         | `ats-blobs`              | MinIO bucket name         |
| `OPENFACE3_MODEL_PATH` | `/models/openface3`      | Path to model weights     |
| `OPENFACE3_DEVICE`     | `cpu`                    | `cpu` or `cuda`           |
| `WORKER_CONCURRENCY`   | `2`                      | Number of worker threads  |

## Timestamp Alignment

Each `EmotionFrame` row stores `frameWallMs` = `segmentStartWallMs + (frameIndex / extractionFps) * 1000`. This is the same wall-clock convention used by py-feat AU results and pupil-size logs, enabling multimodal alignment via `analysis/multimodal_sync.py`.

## Running Locally

```bash
pip install -r requirements.txt
OPENFACE3_DEVICE=cpu python main.py
```

## Docker

```bash
docker compose up openface3-worker
```

## License Note

OpenFace 3 is released under a non-commercial academic license. Check the official repository for terms before deploying in production.
