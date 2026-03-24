FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV, Pillow, matplotlib (freetype/png), and build tools
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    ffmpeg \
    libfreetype6-dev \
    libpng-dev \
    libjpeg-dev \
    zlib1g-dev \
    pkg-config \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Pre-install matplotlib wheel before py-feat to avoid source build issues
RUN pip install --no-cache-dir matplotlib

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download py-feat models at build time
RUN python -c "from feat import Detector; Detector(face_model='retinaface', au_model='xgb')"

COPY . .

CMD ["python", "main.py"]
