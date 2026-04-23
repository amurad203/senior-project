"""
YOLO-World: open-vocabulary detection via Ultralytics (text class names).

Prompt: comma-separated class names, e.g. "person, car, dog".
Env:
  YOLO_WORLD_MODEL  — default yolov8m-worldv2.pt (s/m/l/x-worldv2 also work)
  YOLO_CONF         — default confidence threshold 0.25
  YOLO_TILE_2X2     — set 1/true/yes to run detection on 4 tiles for better small-object recall
  DINO_DEVICE       — cpu | cuda | mps (same as other vision backends)
"""

from __future__ import annotations

import importlib.util
import logging
import os
import re
import uuid
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

_BOX_COLORS = [
    "#7dd3fc",
    "#e879f9",
    "#86efac",
    "#fcd34d",
    "#fca5a5",
    "#c4b5fd",
]

_CLASS_ALIASES = {
    "persons": "person",
    "people": "person",
    "human": "person",
    "humans": "person",
    "pedestrian": "person",
    "pedestrians": "person",
    "man": "person",
    "men": "person",
    "woman": "person",
    "women": "person",
    # Common typos seen in quick prompts.
    "persaon": "person",
    "perosn": "person",
    "preson": "person",
}


def _color_for_label(label: str) -> str:
    return _BOX_COLORS[hash(label) % len(_BOX_COLORS)]


def _pick_device() -> str:
    import torch

    pref = os.getenv("DINO_DEVICE", "").lower()
    if pref == "cpu":
        return "cpu"
    if pref == "cuda":
        if torch.cuda.is_available():
            return "cuda"
        logger.warning("DINO_DEVICE=cuda set, but CUDA is unavailable; falling back.")
    if pref == "mps":
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        logger.warning("DINO_DEVICE=mps set, but MPS is unavailable; falling back.")
    # Default behavior: always prefer GPU before CPU.
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _configure_mps_fallback(device: str) -> None:
    """
    Allow unsupported MPS ops to transparently fallback to CPU.
    This improves stability for mixed operator paths (e.g., CLIP text encoding).
    """
    if device != "mps":
        return
    # Keep user override if already explicitly set.
    if os.getenv("PYTORCH_ENABLE_MPS_FALLBACK") is None:
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        logger.info("Enabled PYTORCH_ENABLE_MPS_FALLBACK=1 for MPS stability")


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _trt_enforced() -> bool:
    return _is_truthy(os.getenv("YOLO_ENFORCE_TENSORRT"))


def _is_trt_engine_model(model_name: str) -> bool:
    return model_name.strip().lower().endswith(".engine")


def _classes_from_prompt(user_text: str) -> tuple[list[str], str]:
    raw_parts = [
        p.strip()
        for p in user_text.replace(";", ",").replace("\n", ",").split(",")
        if p.strip()
    ]
    parts: list[str] = []
    for p in raw_parts:
        key = p.lower().strip()
        normalized = _CLASS_ALIASES.get(key, key)
        if normalized and normalized not in parts:
            parts.append(normalized)
    if not parts:
        parts = ["object"]
    return parts, ", ".join(parts)


def _fallback_classes_from_freeform(user_text: str) -> list[str]:
    """Extract simple class keywords when user sends sentence-like prompts."""
    text = user_text.strip().lower()
    if not text:
        return []

    # Drop common command verbs at the start.
    text = re.sub(r"^(detect|find|locate|track|identify|show)\s+", "", text)
    text = text.replace(" and ", ",")
    text = re.sub(r"[^a-z0-9,\s-]", " ", text)

    stop = {
        "a",
        "an",
        "the",
        "in",
        "on",
        "at",
        "of",
        "to",
        "for",
        "with",
        "near",
        "around",
        "from",
        "this",
        "that",
        "these",
        "those",
        "me",
        "please",
    }
    out: list[str] = []
    for token in re.split(r"[,\s]+", text):
        t = token.strip()
        if not t or t in stop or len(t) < 2:
            continue
        t = _CLASS_ALIASES.get(t, t)
        if t not in out:
            out.append(t)
    return out[:8]


class YoloWorldService:
    def __init__(self) -> None:
        self._model = None
        self._device: str | None = None
        self._runtime_device_override: str | None = None
        self._last_classes: tuple[str, ...] | None = None
        self._last_classes_device: str | None = None
        # "m" is a better default for small/distant objects than "s".
        self._model_name = os.getenv("YOLO_WORLD_MODEL", "yolov8m-worldv2.pt")
        self._load_error: str | None = None

    @property
    def model_id(self) -> str:
        return self._model_name

    @property
    def is_ready(self) -> bool:
        return self._model is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    @property
    def active_device(self) -> str:
        return self._device or "unknown"

    def load(self) -> None:
        if os.getenv("SKIP_MODEL_LOAD", "").lower() in ("1", "true", "yes"):
            self._load_error = "SKIP_MODEL_LOAD is set; model not loaded."
            logger.warning(self._load_error)
            return

        if importlib.util.find_spec("torch") is None:
            self._load_error = "PyTorch not installed (pip install torch)."
            return

        try:
            import clip  # noqa: F401 — YOLO-World text encoder (OpenAI CLIP)
        except ImportError:
            self._load_error = (
                "CLIP not installed. YOLO-World needs: "
                "pip install 'git+https://github.com/openai/CLIP.git'"
            )
            return

        try:
            from ultralytics import YOLO
        except ImportError as e:
            self._load_error = f"ultralytics not installed: {e} (pip install ultralytics)"
            return

        try:
            dev = self._runtime_device_override or _pick_device()
            _configure_mps_fallback(dev)
            if _trt_enforced():
                if not _is_trt_engine_model(self._model_name):
                    self._load_error = (
                        "TensorRT is enforced but YOLO_WORLD_MODEL is not a .engine file. "
                        "Set YOLO_WORLD_MODEL to a TensorRT engine path."
                    )
                    return
                if dev != "cuda":
                    self._load_error = (
                        "TensorRT is enforced but CUDA is unavailable. "
                        "Install CUDA-enabled PyTorch/TensorRT on Jetson."
                    )
                    return
                if importlib.util.find_spec("tensorrt") is None:
                    self._load_error = (
                        "TensorRT is enforced but Python tensorrt package is unavailable."
                    )
                    return
            logger.info("Loading YOLO-World %s on %s", self._model_name, dev)
            model = YOLO(self._model_name)
            self._device = dev
            self._model = model
            self._last_classes = None
            self._last_classes_device = None
            self._load_error = None
        except Exception as e:
            self._load_error = str(e)
            self._model = None
            logger.exception("YOLO-World load failed: %s", e)

    def _is_mps_placeholder_error(self, err: Exception) -> bool:
        msg = str(err).lower()
        return "placeholder storage has not been allocated on mps device" in msg

    def _fallback_to_cpu(self, reason: Exception) -> None:
        if self._runtime_device_override == "cpu" and self._device == "cpu":
            return
        logger.warning(
            "MPS runtime failed (%s). Falling back YOLO-World to CPU.",
            reason,
        )
        self._runtime_device_override = "cpu"
        self._model = None
        self._last_classes = None
        self._last_classes_device = None
        self._load_error = None
        self.load()

    def set_model(self, model_name: str) -> None:
        """Hot-switch YOLO-World weights at runtime."""
        next_model = model_name.strip()
        if not next_model or next_model == self._model_name:
            return
        if _trt_enforced() and not _is_trt_engine_model(next_model):
            logger.warning(
                "TensorRT is enforced; ignoring non-engine model switch request: %s",
                next_model,
            )
            return
        logger.info("Switching YOLO-World model: %s -> %s", self._model_name, next_model)
        self._model_name = next_model
        self._model = None
        self._last_classes = None
        self._last_classes_device = None
        self._load_error = None
        self.load()

    def _set_classes_for_device(self, classes: list[str]) -> None:
        """
        Set prompt classes for the current runtime device.
        On MPS, compute text features on CPU to avoid CLIP/MPS placeholder errors,
        then run detection on MPS with cached text features.
        """
        if self._model is None:
            return
        device = self._device or "cpu"
        key = tuple(classes)
        if key == self._last_classes and self._last_classes_device == device:
            return
        if device == "mps":
            # Workaround: generate class embeddings on CPU, then switch back to MPS.
            self._model.to("cpu")
            self._model.set_classes(classes)
            self._model.to("mps")
            logger.info("Prepared YOLO-World classes on CPU; running inference on MPS")
        else:
            self._model.set_classes(classes)
        self._last_classes = key
        self._last_classes_device = device

    def detect(
        self,
        image: Image.Image,
        prompt: str,
        *,
        box_threshold: float | None = None,
        text_threshold: float | None = None,
        tile_grid: int | None = None,
    ) -> tuple[list[dict[str, Any]], str]:
        """text_threshold ignored (YOLO-World uses single conf)."""
        del text_threshold
        logger.info("YOLO-World detect request on device=%s", self.active_device)

        classes, summary = _classes_from_prompt(prompt)
        if not self.is_ready or self._model is None:
            return [], summary

        conf = box_threshold
        if conf is None:
            conf = float(os.getenv("YOLO_CONF", "0.25"))

        w_px, h_px = image.size

        tile_n = tile_grid if tile_grid is not None else (2 if os.getenv("YOLO_TILE_2X2", "0").lower() in ("1", "true", "yes") else 1)
        tile_n = max(1, min(4, int(tile_n)))

        try:
            if tile_n > 1:
                boxes_out = self._predict_tiled_grid(image, classes, conf, w_px, h_px, tile_n)
            else:
                boxes_out = self._predict_with_classes(image, classes, conf, w_px, h_px)
        except Exception as e:
            logger.exception("YOLO-World predict failed: %s", e)
            return [], summary

        # Fallback for sentence-like prompts when first attempt returns nothing.
        if not boxes_out and len(classes) == 1 and "," not in prompt:
            fallback = _fallback_classes_from_freeform(prompt)
            if len(fallback) > 1:
                logger.info("Retrying YOLO-World with fallback classes: %s", fallback)
                try:
                    if tile_n > 1:
                        boxes_out = self._predict_tiled_grid(
                            image, fallback, conf, w_px, h_px, tile_n
                        )
                    else:
                        boxes_out = self._predict_with_classes(image, fallback, conf, w_px, h_px)
                except Exception as e:
                    logger.warning("Fallback predict failed: %s", e)

        return boxes_out, summary

    def _predict_with_classes(
        self,
        image: Image.Image,
        classes: list[str],
        conf: float,
        w_px: int,
        h_px: int,
        *,
        x_offset_px: int = 0,
        y_offset_px: int = 0,
    ) -> list[dict[str, Any]]:
        if self._model is None:
            return []

        try:
            self._set_classes_for_device(classes)
        except Exception as e:
            if self._device == "mps" and self._is_mps_placeholder_error(e):
                self._fallback_to_cpu(e)
                if self._model is None:
                    return []
                try:
                    self._set_classes_for_device(classes)
                except Exception as retry_err:
                    logger.warning("set_classes failed after CPU fallback: %s", retry_err)
                    return []
            logger.warning("set_classes failed: %s", e)
            return []

        try:
            results = self._model.predict(
                source=image,
                conf=conf,
                imgsz=int(os.getenv("YOLO_IMGSZ", "640")),
                max_det=int(os.getenv("YOLO_MAX_DET", "300")),
                verbose=False,
                device=self._device or "cpu",
            )
        except Exception as e:
            if self._device == "mps" and self._is_mps_placeholder_error(e):
                self._fallback_to_cpu(e)
                if self._model is None:
                    return []
                results = self._model.predict(
                    source=image,
                    conf=conf,
                    imgsz=int(os.getenv("YOLO_IMGSZ", "640")),
                    max_det=int(os.getenv("YOLO_MAX_DET", "300")),
                    verbose=False,
                    device=self._device or "cpu",
                )
            else:
                raise
        if not results:
            return []

        r = results[0]
        if r.boxes is None or len(r.boxes) == 0:
            return []

        names = r.names
        boxes_out: list[dict[str, Any]] = []
        xyxy = r.boxes.xyxy.cpu().tolist()
        confs = r.boxes.conf.cpu().tolist()
        clss = r.boxes.cls.cpu().int().tolist()

        for j in range(len(xyxy)):
            x1, y1, x2, y2 = [float(t) for t in xyxy[j]]
            score = float(confs[j])
            ci = int(clss[j])
            if 0 <= ci < len(classes):
                label = classes[ci]
            elif isinstance(names, dict):
                label = str(names.get(ci, ci))
            else:
                label = str(ci)

            x1_abs = x1 + x_offset_px
            y1_abs = y1 + y_offset_px
            x2_abs = x2 + x_offset_px
            y2_abs = y2 + y_offset_px

            x_pct = max(0.0, min(100.0, x1_abs / w_px * 100))
            y_pct = max(0.0, min(100.0, y1_abs / h_px * 100))
            bw_pct = max(0.0, min(100.0, (x2_abs - x1_abs) / w_px * 100))
            bh_pct = max(0.0, min(100.0, (y2_abs - y1_abs) / h_px * 100))

            boxes_out.append(
                {
                    "id": str(uuid.uuid4())[:8],
                    "label": label,
                    "confidence": round(score, 3),
                    "x": round(x_pct, 2),
                    "y": round(y_pct, 2),
                    "width": round(bw_pct, 2),
                    "height": round(bh_pct, 2),
                    "color": _color_for_label(label),
                }
            )

        return boxes_out

    def _predict_tiled_grid(
        self,
        image: Image.Image,
        classes: list[str],
        conf: float,
        w_px: int,
        h_px: int,
        tiles_per_side: int,
    ) -> list[dict[str, Any]]:
        """Run YOLO on NxN tiles and map boxes back to full-frame percentages."""
        step_x = max(1, w_px // tiles_per_side)
        step_y = max(1, h_px // tiles_per_side)
        out: list[dict[str, Any]] = []
        for row in range(tiles_per_side):
            for col in range(tiles_per_side):
                x1 = col * step_x
                y1 = row * step_y
                x2 = w_px if col == tiles_per_side - 1 else min(w_px, (col + 1) * step_x)
                y2 = h_px if row == tiles_per_side - 1 else min(h_px, (row + 1) * step_y)
                tile = image.crop((x1, y1, x2, y2))
                out.extend(
                    self._predict_with_classes(
                        tile,
                        classes,
                        conf,
                        w_px,
                        h_px,
                        x_offset_px=x1,
                        y_offset_px=y1,
                    )
                )
        return out


service = YoloWorldService()
