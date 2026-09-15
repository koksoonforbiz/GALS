import sys
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    port: int = 8000
    database_url: str
    redis_url: str
    blob_storage_endpoint: str = "http://localhost:9000"
    blob_storage_bucket: str = "ats-blobs"
    # Required (no 'minioadmin' default — SMU checklist items 1/4); the
    # validation error below is the intended failure mode when unset.
    blob_storage_access_key: str
    blob_storage_secret_key: str

    model_config = {"env_file": ".env"}


def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as e:
        print(f"\n❌ Environment validation failed:\n  {e}\n", file=sys.stderr)
        sys.exit(1)
