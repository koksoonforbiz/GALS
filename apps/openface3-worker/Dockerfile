FROM python:3.11-slim

# Worker logs go straight to docker stdout; don't buffer.
ENV PYTHONUNBUFFERED=1

# System libs needed by opencv (libgl, libglib) and ffmpeg (for webm/mp4 decoding).
# git is required by huggingface_hub when downloading via git LFS for some
# model repos. ca-certificates keeps HTTPS to PyPI / HuggingFace working.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglx-mesa0 \
    libglib2.0-0 \
    ffmpeg \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# ── Step 1: CPU-only torch wheels.
# Done as a separate layer so:
#   (a) openface-test's unpinned `torch` dep is satisfied without pip falling
#       back to the default index's CUDA build (~2GB),
#   (b) when iterating on application code (main.py / inference.py) the
#       expensive torch download stays cached.
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    torch torchvision

# ── Step 2: everything else — openface-test + worker glue libs.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Step 3: model weights from HuggingFace.
# Models live at ${OPENFACE3_MODEL_PATH} (default /models/openface3) and are
# resolved by inference.py at startup. Baked into the image so the container
# is self-contained and starts immediately. To override (e.g. swap to a
# fine-tuned checkpoint without rebuilding), mount a host directory or named
# volume at /models/openface3 — that hides the baked copy.
ENV OPENFACE3_MODEL_PATH=/models/openface3
# NOTE: do NOT pre-mkdir the target. The openface CLI's download_weights_from_hf
# checks `if not os.path.exists(save_path)` — if the dir exists it short-circuits
# with "Weights already exist. Skipping download." Letting the CLI create the
# directory itself is the only way to actually trigger the snapshot_download.
RUN openface download --output ${OPENFACE3_MODEL_PATH} && \
    ls -la ${OPENFACE3_MODEL_PATH} && \
    test -f ${OPENFACE3_MODEL_PATH}/Alignment_RetinaFace.pth && \
    test -f ${OPENFACE3_MODEL_PATH}/MTL_backbone.pth && \
    test -f ${OPENFACE3_MODEL_PATH}/mobilenetV1X0.25_pretrain.tar

# Symlink so the openface package's hardcoded `./weights/...` paths resolve.
# Specifically Pytorch_Retinaface/models/retinaface.py:60 hardcodes
# `./weights/mobilenetV1X0.25_pretrain.tar` regardless of the model_path arg
# passed to FaceDetector. With WORKDIR=/app, `./weights/...` resolves to
# /app/weights/..., which we point at the real model directory.
RUN ln -s ${OPENFACE3_MODEL_PATH} /app/weights

COPY . .

CMD ["python", "main.py"]
