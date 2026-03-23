"""MinIO download/upload helpers for the py-feat worker."""

import os
from minio import Minio


def get_client() -> Minio:
    return Minio(
        f"{os.environ['MINIO_ENDPOINT']}:{os.environ.get('MINIO_PORT', '9000')}",
        access_key=os.environ["MINIO_ACCESS_KEY"],
        secret_key=os.environ["MINIO_SECRET_KEY"],
        secure=False,
    )


def download_file(minio_key: str, dest_path: str) -> None:
    client = get_client()
    bucket = os.environ.get("MINIO_BUCKET", "ats-blobs")
    client.fget_object(bucket, minio_key, dest_path)


def upload_file(local_path: str, minio_key: str, content_type: str = "text/csv") -> None:
    client = get_client()
    bucket = os.environ.get("MINIO_BUCKET", "ats-blobs")
    client.fput_object(bucket, minio_key, local_path, content_type=content_type)
