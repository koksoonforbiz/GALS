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

# Pre-download py-feat models at build time (skip gracefully if import path changed)
RUN python -c "exec('try:\n from feat import Detector\nexcept ImportError:\n from feat.detector import Detector\nDetector(face_model=\"retinaface\", au_model=\"xgb\")')" \
    || echo "Model pre-download skipped, will download at runtime"

COPY . .

CMD ["python", "main.py"]
