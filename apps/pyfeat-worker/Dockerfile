FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV and ffmpeg
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip, then pre-install heavy deps as binary wheels.
# This prevents py-feat's transitive deps (tables→h5py→numpy)
# from pulling ancient versions that try to compile from source.
RUN pip install --upgrade pip && \
    pip install --no-cache-dir \
    "numpy>=1.24,<2.5" \
    "matplotlib>=3.7" \
    "Pillow>=10.0" \
    "h5py>=3.9" \
    "scipy>=1.11" \
    "torch>=2.0" \
    "torchvision>=0.15"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download py-feat models at build time
RUN python -c "from feat import Detector; Detector(face_model='retinaface', au_model='xgb')"

COPY . .

CMD ["python", "main.py"]
