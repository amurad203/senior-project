"""
Local FastAPI server: image + text -> YOLO-World detection boxes.

Run (default port 8765 — avoids Django on 8000/8001):
  cd backend && ./run.sh

Env:
  YOLO_WORLD_MODEL=yolov8s-worldv2.pt  (or m/l/x variants)
"""

from __future__ import annotations

import io
import logging
import time

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.stream_manager import stream_manager
from app.yolo_world import service as yolo_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
SUPPORTED_MODELS = (
    "yolov8s-worldv2.pt",
    "yolov8m-worldv2.pt",
    "yolov8l-worldv2.pt",
    "yolov8x-worldv2.pt",
)

app = FastAPI(
    title="UAV Local API",
    description="YOLO-World open-vocabulary detection. No persistence.",
    version="0.4.0",
)

_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    yolo_service.load()
    if yolo_service.is_ready:
        logger.info("YOLO-World ready (%s)", yolo_service.model_id)
    else:
        logger.warning("YOLO-World not ready: %s", yolo_service.load_error or "unknown")


@app.get("/health")
def health() -> dict:
    stream_state = stream_manager.get_state()
    return {
        "ok": True,
        "vl_backend": "yolo_world",
        "yolo_world": {
            "loaded": yolo_service.is_ready,
            "model_id": yolo_service.model_id,
            "error": yolo_service.load_error,
            "supported_models": SUPPORTED_MODELS,
        },
        "stream": {
            "running": stream_state.running,
            "source_url": stream_state.source_url,
            "last_error": stream_state.last_error,
            "fps": round(stream_state.fps, 2),
            "has_frame": stream_state.has_frame,
        },
    }


@app.post("/api/vlm")
async def vlm(
    image: UploadFile = File(...),
    prompt: str = Form(...),
    box_threshold: float | None = Form(None),
    text_threshold: float | None = Form(None),
    model_id: str | None = Form(None),
    tile_grid: int | None = Form(None),
) -> dict:
    """Image + prompt -> YOLO-World detection boxes (+ short summary text)."""
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")

    try:
        pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except UnidentifiedImageError as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}") from e

    if model_id:
        if model_id not in SUPPORTED_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported model_id '{model_id}'.",
            )
        yolo_service.set_model(model_id)

    tile_grid_value: int | None = None
    if tile_grid is not None:
        if tile_grid < 1 or tile_grid > 4:
            raise HTTPException(status_code=400, detail="tile_grid must be in [1, 4].")
        tile_grid_value = int(tile_grid)

    if not yolo_service.is_ready:
        reason = yolo_service.load_error or "unknown"
        raise HTTPException(
            status_code=503,
            detail=(
                f"Detection model not loaded: {reason}. "
                "Install dependencies (see README) and restart the server."
            ),
        )
    boxes, normalized = yolo_service.detect(
        pil,
        prompt,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        tile_grid=tile_grid_value,
    )
    summary = f"Detected {len(boxes)} object(s). Targets: {normalized}"
    return {
        "mode": "yolo_world",
        "response": summary,
        "boxes": boxes,
        "count": len(boxes),
        "prompt_normalized": normalized,
    }


@app.post("/api/detect")
async def detect(
    image: UploadFile = File(..., description="Current frame (JPEG/PNG)"),
    prompt: str = Form(..., description="What to detect (e.g. comma-separated names)"),
    box_threshold: float | None = Form(None),
    text_threshold: float | None = Form(None),
    model_id: str | None = Form(None),
    tile_grid: int | None = Form(None),
) -> dict:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")

    try:
        pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except UnidentifiedImageError as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}") from e

    if model_id:
        if model_id not in SUPPORTED_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported model_id '{model_id}'.",
            )
        yolo_service.set_model(model_id)

    tile_grid_value: int | None = None
    if tile_grid is not None:
        if tile_grid < 1 or tile_grid > 4:
            raise HTTPException(status_code=400, detail="tile_grid must be in [1, 4].")
        tile_grid_value = int(tile_grid)

    if not yolo_service.is_ready:
        raise HTTPException(
            status_code=503,
            detail=f"Detection model not loaded: {yolo_service.load_error or 'unknown'}",
        )
    boxes, normalized_prompt = yolo_service.detect(
        pil,
        prompt,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        tile_grid=tile_grid_value,
    )

    return {
        "prompt_normalized": normalized_prompt,
        "count": len(boxes),
        "boxes": boxes,
    }


@app.get("/api/rtmp")
def rtmp_info() -> dict:
    """
    RTMP ingest is not implemented in code here — DJI streams to an RTMP URL.
    Typical local setup: FFmpeg receives RTMP and you grab frames (or restream).
    See backend/README.md.
    """
    return {
        "note": "Ingest RTMP with FFmpeg or similar; send frames to POST /api/detect",
        "example_ffmpeg_snapshot": (
            "ffmpeg -i rtmp://127.0.0.1/live/drone -vframes 1 -y /tmp/frame.jpg"
        ),
    }


class StreamStartRequest(BaseModel):
    source_url: str


@app.post("/api/stream/start")
def stream_start(payload: StreamStartRequest) -> dict:
    source = payload.source_url.strip()
    if not source:
        raise HTTPException(status_code=400, detail="source_url is required")
    try:
        stream_manager.start(source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "source_url": source}


@app.post("/api/stream/stop")
def stream_stop() -> dict:
    stream_manager.stop()
    return {"ok": True}


@app.get("/api/stream/status")
def stream_status() -> dict:
    s = stream_manager.get_state()
    return {
        "running": s.running,
        "source_url": s.source_url,
        "last_error": s.last_error,
        "fps": round(s.fps, 2),
        "has_frame": s.has_frame,
        "preview_url": "/api/stream/frame" if s.has_frame else None,
    }


@app.get("/api/stream/frame")
def stream_frame() -> Response:
    jpeg = stream_manager.get_latest_jpeg()
    if not jpeg:
        raise HTTPException(status_code=404, detail="No stream frame available")
    return Response(content=jpeg, media_type="image/jpeg")


@app.get("/api/stream/mjpeg")
def stream_mjpeg() -> StreamingResponse:
    boundary = "frame"

    def generate():
        while True:
            jpeg = stream_manager.get_latest_jpeg()
            if jpeg:
                yield (
                    b"--" + boundary.encode("ascii") + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg)).encode("ascii") + b"\r\n\r\n"
                    + jpeg
                    + b"\r\n"
                )
            else:
                time.sleep(0.05)

    return StreamingResponse(
        generate(),
        media_type=f"multipart/x-mixed-replace; boundary={boundary}",
    )
