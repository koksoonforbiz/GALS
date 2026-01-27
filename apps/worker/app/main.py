from fastapi import FastAPI
from app.config import get_settings

settings = get_settings()

app = FastAPI(title="ATS Worker", version="0.1.0")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "worker",
        "timestamp": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    }
