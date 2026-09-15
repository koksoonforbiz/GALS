FROM python:3.12-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Non-root runtime (SMU checklist items 8/50, CIS Docker 4.1). The service
# only reads its source tree and writes nothing to disk; /tmp stays
# world-writable for anything that needs scratch space.
RUN groupadd --system --gid 10001 worker \
    && useradd --system --uid 10001 --gid worker --create-home --home-dir /home/worker worker \
    && chown -R worker:worker /app
ENV HOME=/home/worker

COPY --chown=worker:worker . .

USER worker

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
