FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV and ffmpeg
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip so it resolves binary wheels correctly
RUN pip install --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download py-feat models at build time
RUN python -c "from feat import Detector; Detector(face_model='retinaface', au_model='xgb')"

COPY . .

CMD ["python", "main.py"]
