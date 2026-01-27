import sys
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    port: int = 8000
    database_url: str
    redis_url: str

    model_config = {"env_file": ".env"}


def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as e:
        print(f"\n❌ Environment validation failed:\n  {e}\n", file=sys.stderr)
        sys.exit(1)
