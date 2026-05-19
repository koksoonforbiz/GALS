"""
OpenFace 3.0 inference wrapper.

Loads CMU's OpenFace 3.0 face detector + multitask model once, then exposes a
single `infer_frame(bgr_image) -> FrameResult` call used by the worker per
sampled frame.

Implementation notes
--------------------
* `FaceDetector.get_face()` in openface-test 0.1.26 takes a file path (not an
  in-memory ndarray), so each frame is written to a NamedTemporaryFile PNG
  before detection. The cost is a few ms per frame versus ~50-200ms for the
  detector forward pass, so it's negligible.
* Emotion logits use AffectNet's 8-category order. This is fixed by the
  multitask model — do not reorder.

Swap-in path: replace this file if/when a different emotion model is desired.
The worker only depends on the public `Openface3Inferencer` and `FrameResult`.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import torch
import torch.nn.functional as F

# AffectNet emotion order returned by OpenFace 3.0's multitask head.
# Index 0..7 is fixed by the model; do not reorder.
AFFECTNET_EMOTIONS = (
    'neutral',
    'happiness',
    'sadness',
    'surprise',
    'fear',
    'disgust',
    'anger',
    'contempt',
)


@dataclass
class FrameResult:
    """Per-frame inference output. Probabilities sum to 1.0 when face_detected."""

    face_detected: bool
    p_neutral: Optional[float] = None
    p_happiness: Optional[float] = None
    p_sadness: Optional[float] = None
    p_surprise: Optional[float] = None
    p_fear: Optional[float] = None
    p_disgust: Optional[float] = None
    p_anger: Optional[float] = None
    p_contempt: Optional[float] = None
    dominant_emotion: Optional[str] = None
    dominant_probability: Optional[float] = None


class Openface3Inferencer:
    """Holds the loaded models. Construct once per worker process."""

    def __init__(self, model_dir: str, device: str = 'cpu'):
        # Imports are deferred to construction so unit tests / dry runs that
        # don't actually invoke inference don't have to install the heavy
        # openface-test + torch stack.
        from openface.face_detection import FaceDetector
        from openface.multitask_model import MultitaskPredictor

        face_weights = os.path.join(model_dir, 'Alignment_RetinaFace.pth')
        mtl_weights = os.path.join(model_dir, 'MTL_backbone.pth')

        if not os.path.exists(face_weights):
            raise FileNotFoundError(
                f'Face detector weights missing at {face_weights}. The Dockerfile '
                f'runs `openface download --output {model_dir}` at build time; if '
                f'you mounted an empty volume over {model_dir} the baked weights '
                f'are hidden.'
            )
        if not os.path.exists(mtl_weights):
            raise FileNotFoundError(f'MTL backbone weights missing at {mtl_weights}.')

        self.device = device
        self.face_detector = FaceDetector(model_path=face_weights, device=device)
        self.multitask_model = MultitaskPredictor(model_path=mtl_weights, device=device)
        print(f'[OpenFace3] Loaded models from {model_dir} on device={device}')

    def infer_frame(self, bgr_frame: np.ndarray) -> FrameResult:
        """Run face detection + emotion classification on a single BGR frame.

        Returns face_detected=False (with all probabilities None) when no face
        is found — the row is honest about the absence rather than padding
        with neutral.
        """
        cropped = self._detect_face(bgr_frame)
        if cropped is None:
            return FrameResult(face_detected=False)

        try:
            emotion_logits, _gaze, _au = self.multitask_model.predict(cropped)
        except Exception as exc:
            print(f'[OpenFace3] multitask prediction error: {exc}')
            return FrameResult(face_detected=False)

        # Tensor shape can be (1, 8) or (8,); flatten and validate length.
        if not isinstance(emotion_logits, torch.Tensor):
            emotion_logits = torch.tensor(emotion_logits)
        logits = emotion_logits.detach().cpu().reshape(-1)
        if logits.numel() != len(AFFECTNET_EMOTIONS):
            print(
                f'[OpenFace3] unexpected emotion logits length {logits.numel()}; '
                f'expected {len(AFFECTNET_EMOTIONS)}'
            )
            return FrameResult(face_detected=False)

        probs = F.softmax(logits, dim=0).tolist()
        dominant_idx = int(np.argmax(probs))

        return FrameResult(
            face_detected=True,
            p_neutral=float(probs[0]),
            p_happiness=float(probs[1]),
            p_sadness=float(probs[2]),
            p_surprise=float(probs[3]),
            p_fear=float(probs[4]),
            p_disgust=float(probs[5]),
            p_anger=float(probs[6]),
            p_contempt=float(probs[7]),
            dominant_emotion=AFFECTNET_EMOTIONS[dominant_idx],
            dominant_probability=float(probs[dominant_idx]),
        )

    def _detect_face(self, bgr_frame: np.ndarray) -> Optional[np.ndarray]:
        """Write the frame to a temp PNG and call get_face() on the path.

        get_face() returns (cropped_face_ndarray, dets_array) or (None, None)
        when no face passes the visibility threshold.
        """
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                tmp_path = tmp.name
            # Write outside the with-block so the file handle is closed before
            # cv2 reopens it via the path.
            ok = cv2.imwrite(tmp_path, bgr_frame)
            if not ok:
                print('[OpenFace3] cv2.imwrite failed')
                return None
            cropped, _dets = self.face_detector.get_face(tmp_path)
            return cropped
        except Exception as exc:
            print(f'[OpenFace3] face detection error: {exc}')
            return None
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
