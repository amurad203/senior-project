from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

SUPPORTED_YOLO_E_MODELS = (
    "yoloe-11s-seg.pt",
    "yoloe-11m-seg.pt",
    "yoloe-11l-seg.pt",
)

_BOX_COLORS = [
    "#7dd3fc",
    "#e879f9",
    "#86efac",
    "#fcd34d",
    "#fca5a5",
    "#c4b5fd",
]


def _pick_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _classes_from_prompt(user_text: str) -> tuple[list[str], str]:
    parts: list[str] = []
    for token in user_text.replace(";", ",").replace("\n", ",").split(","):
        t = token.strip().lower()
        if not t:
            continue
        t = re.sub(r"[^a-z0-9_\-\s]", "", t).strip()
        if not t:
            continue
        if t not in parts:
            parts.append(t)
    if not parts:
        parts = ["object"]
    return parts, ", ".join(parts)


def _color_for_label(label: str) -> str:
    return _BOX_COLORS[hash(label) % len(_BOX_COLORS)]


class YoloEService:
    def __init__(self) -> None:
        self._model = None
        self._device: str | None = None
        self._model_id = os.getenv("YOLO_E_MODEL", SUPPORTED_YOLO_E_MODELS[0])
        if self._model_id not in SUPPORTED_YOLO_E_MODELS:
            self._model_id = SUPPORTED_YOLO_E_MODELS[0]
        self._load_error: str | None = None

    @property
    def is_ready(self) -> bool:
        return self._model is not None

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def active_device(self) -> str:
        return self._device or "unknown"

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def load(self) -> None:
        try:
            from ultralytics import YOLO

            self._device = _pick_device()
            self._model = YOLO(self._model_id)
            self._load_error = None
        except Exception as e:
            self._model = None
            self._load_error = str(e)
            logger.warning("YOLO-E load failed: %s", e)

    def set_model(self, model_id: str) -> None:
        next_model = model_id.strip()
        if not next_model or next_model == self._model_id:
            return
        if next_model not in SUPPORTED_YOLO_E_MODELS:
            logger.warning("Unsupported YOLO-E model ignored: %s", next_model)
            return
        self._model_id = next_model
        self._model = None
        self._load_error = None
        self.load()

    def detect(
        self,
        image: Image.Image,
        prompt: str,
        *,
        box_threshold: float | None = None,
        text_threshold: float | None = None,
        tile_grid: int | None = None,
    ) -> tuple[list[dict[str, Any]], str]:
        del text_threshold
        del tile_grid
        classes, normalized = _classes_from_prompt(prompt)
        if self._model is None:
            return [], normalized
        conf = 0.2 if box_threshold is None else float(box_threshold)
        try:
            if hasattr(self._model, "set_classes"):
                self._model.set_classes(classes)
            results = self._model.predict(
                source=image,
                conf=conf,
                imgsz=int(os.getenv("YOLO_E_IMGSZ", "640")),
                max_det=int(os.getenv("YOLO_E_MAX_DET", "300")),
                verbose=False,
                device=self._device or "cpu",
            )
        except Exception as e:
            logger.warning("YOLO-E predict failed: %s", e)
            return [], normalized

        if not results:
            return [], normalized
        r = results[0]
        if r.boxes is None or len(r.boxes) == 0:
            return [], normalized
        names = r.names
        w_px, h_px = image.size
        boxes_out: list[dict[str, Any]] = []
        xyxy = r.boxes.xyxy.cpu().tolist()
        confs = r.boxes.conf.cpu().tolist()
        clss = r.boxes.cls.cpu().int().tolist()
        for idx in range(len(xyxy)):
            x1, y1, x2, y2 = [float(v) for v in xyxy[idx]]
            ci = int(clss[idx])
            if 0 <= ci < len(classes):
                label = classes[ci]
            elif isinstance(names, dict):
                label = str(names.get(ci, ci))
            else:
                label = str(ci)
            boxes_out.append(
                {
                    "id": str(uuid.uuid4())[:8],
                    "label": label,
                    "confidence": round(float(confs[idx]), 3),
                    "x": round(max(0.0, min(100.0, (x1 / w_px) * 100.0)), 2),
                    "y": round(max(0.0, min(100.0, (y1 / h_px) * 100.0)), 2),
                    "width": round(max(0.0, min(100.0, ((x2 - x1) / w_px) * 100.0)), 2),
                    "height": round(max(0.0, min(100.0, ((y2 - y1) / h_px) * 100.0)), 2),
                    "color": _color_for_label(label),
                }
            )
        return boxes_out, normalized


service = YoloEService()
