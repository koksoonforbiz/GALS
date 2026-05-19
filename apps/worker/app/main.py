import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from app.config import get_settings
from app.db import check_db_health
from app.event_loop import EventLoop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

settings = get_settings()
event_loop = EventLoop()


@asynccontextmanager
async def lifespan(application: FastAPI):
    event_loop.start()
    yield
    event_loop.stop()


app = FastAPI(title="ATS Worker", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health_check():
    db_status = "ok" if check_db_health() else "error"
    loop_status = "ok" if event_loop.is_running else "error"
    all_ok = db_status == "ok" and loop_status == "ok"

    return {
        "status": "ok" if all_ok else "degraded",
        "service": "worker",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": {
            "database": db_status,
            "eventLoop": loop_status,
        },
    }
