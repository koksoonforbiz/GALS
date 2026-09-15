FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV, ffmpeg, and building native extensions
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    ffmpeg \
    gcc \
    g++ \
    libhdf5-dev \
    pkg-config \
    libfreetype6-dev \
    libpng-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip first for proper wheel resolution
RUN pip install --upgrade pip setuptools wheel

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Non-root runtime (SMU checklist items 8/50, CIS Docker 4.1). py-feat 0.5.x
# stores downloaded model weights inside its own package directory
# (feat/resources), so that one directory is handed to the runtime user —
# both for the build-time pre-download below and so a runtime download
# (the fallback path when the pre-download is skipped) still works. Every
# other cache (torch hub, matplotlib config) lands under $HOME.
RUN groupadd --system --gid 10001 worker \
    && useradd --system --uid 10001 --gid worker --create-home --home-dir /home/worker worker \
    && chown -R worker:worker /app \
    && FEAT_RES="$(python -c 'import os, feat; print(os.path.join(os.path.dirname(feat.__file__), "resources"))')" \
    && mkdir -p "$FEAT_RES" && chown -R worker:worker "$FEAT_RES"
ENV HOME=/home/worker \
    TORCH_HOME=/home/worker/.cache/torch \
    MPLCONFIGDIR=/home/worker/.config/matplotlib
USER worker

# Pre-download py-feat models at build time (skip gracefully if import path changed)
RUN python -c "exec('try:\n from feat import Detector\nexcept ImportError:\n from feat.detector import Detector\nDetector(face_model=\"retinaface\", au_model=\"xgb\")')" \
    || echo "Model pre-download skipped, will download at runtime"

COPY --chown=worker:worker . .

CMD ["python", "main.py"]
