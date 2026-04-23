"""
Local FastAPI server: image + text -> YOLO-World detection boxes.

Run (default port 8765 — avoids Django on 8000/8001):
  cd backend && ./run.sh

Env:
  YOLO_WORLD_MODEL=yolov8s-worldv2.pt  (or n/m variants)
"""

from __future__ import annotations

import io
import logging
import os
import platform
import re
import subprocess
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app.stream_manager import stream_manager
from app.yolo_world import service as yolo_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
SUPPORTED_MODELS = (
    "yolov8n-worldv2.pt",
    "yolov8s-worldv2.pt",
    "yolov8m-worldv2.pt",
    "yolov8l-worldv2.pt",
    "yolov8x-worldv2.pt",
)
_perf_lock = threading.Lock()
_perf_state = {
    "vlm_last_ms": 0.0,
    "vlm_avg_ms": 0.0,
    "vlm_count": 0,
    "detect_last_ms": 0.0,
    "detect_avg_ms": 0.0,
    "detect_count": 0,
    "last_updated_ms": 0,
}
_cpu_prev_total = 0
_cpu_prev_idle = 0
_cpu_psutil_warmed = False
_gpu_tegrastats_last = 0.0
_gpu_tegrastats_value: float | None = None


def _read_cuda_memory_stats() -> dict[str, float | int | None]:
    """
    Read CUDA memory counters from PyTorch when available.
    Returns null-like values when CUDA is unavailable.
    """
    empty = {
        "gpu_cuda_memory_used_mb": None,
        "gpu_cuda_memory_free_mb": None,
        "gpu_cuda_memory_total_mb": None,
        "gpu_cuda_memory_percent": None,
    }
    try:
        import torch

        if not torch.cuda.is_available():
            return empty

        device_idx = torch.cuda.current_device()
        free_bytes, total_bytes = torch.cuda.mem_get_info(device_idx)
        used_bytes = max(0, total_bytes - free_bytes)
        if total_bytes <= 0:
            return empty

        used_pct = (used_bytes / total_bytes) * 100.0
        mib = 1024.0 * 1024.0
        return {
            "gpu_cuda_memory_used_mb": round(used_bytes / mib, 1),
            "gpu_cuda_memory_free_mb": round(free_bytes / mib, 1),
            "gpu_cuda_memory_total_mb": round(total_bytes / mib, 1),
            "gpu_cuda_memory_percent": round(max(0.0, min(100.0, used_pct)), 1),
        }
    except Exception:
        return empty


def _record_perf(kind: str, elapsed_ms: float) -> None:
    with _perf_lock:
        key_last = f"{kind}_last_ms"
        key_avg = f"{kind}_avg_ms"
        key_count = f"{kind}_count"
        prev_count = int(_perf_state[key_count])
        prev_avg = float(_perf_state[key_avg])
        next_count = prev_count + 1
        next_avg = ((prev_avg * prev_count) + elapsed_ms) / next_count
        _perf_state[key_last] = elapsed_ms
        _perf_state[key_avg] = next_avg
        _perf_state[key_count] = next_count
        _perf_state["last_updated_ms"] = int(time.time() * 1000)


def _read_cpu_percent() -> float | None:
    """Compute host CPU utilization with cross-platform fallback."""
    global _cpu_prev_total, _cpu_prev_idle, _cpu_psutil_warmed
    # Prefer psutil if available (works on macOS and Linux).
    try:
        import psutil

        val = float(psutil.cpu_percent(interval=None))
        if not _cpu_psutil_warmed:
            _cpu_psutil_warmed = True
            return None
        return max(0.0, min(100.0, val))
    except Exception:
        pass

    # Linux /proc fallback.
    try:
        with open("/proc/stat", "r", encoding="utf-8") as f:
            line = f.readline().strip()
        if not line.startswith("cpu "):
            return None
        parts = line.split()
        nums = [int(x) for x in parts[1:9]]
        user, nice, system, idle, iowait, irq, softirq, steal = nums
        idle_all = idle + iowait
        total = user + nice + system + idle + iowait + irq + softirq + steal
        if _cpu_prev_total == 0:
            _cpu_prev_total = total
            _cpu_prev_idle = idle_all
            return None
        total_delta = total - _cpu_prev_total
        idle_delta = idle_all - _cpu_prev_idle
        _cpu_prev_total = total
        _cpu_prev_idle = idle_all
        if total_delta <= 0:
            return None
        used_pct = (1.0 - (idle_delta / total_delta)) * 100.0
        return max(0.0, min(100.0, used_pct))
    except Exception:
        return None


def _normalize_gpu_load(raw: int) -> float:
    """Normalize common Jetson/NVIDIA load formats to percent."""
    if raw <= 100:
        return float(raw)
    if raw <= 255:
        return (raw / 255.0) * 100.0
    if raw <= 1000:
        return raw / 10.0
    if raw <= 10000:
        return raw / 100.0
    return min(100.0, float(raw))


def _read_gpu_percent() -> float | None:
    """Read GPU usage estimate across supported hosts."""
    if platform.system() == "Darwin":
        return _read_gpu_percent_macos()

    # Try common GPU load files on Jetson/NVIDIA hosts, then tegrastats.
    candidates = [
        "/sys/devices/gpu.0/load",
        "/sys/class/kgsl/kgsl-3d0/gpubusy",
    ]
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = f.read().strip()
            if not raw:
                continue
            # kgsl gpubusy can be "busy total"; fallback to first integer.
            token = raw.split()[0]
            value = int(token)
            return max(0.0, min(100.0, _normalize_gpu_load(value)))
        except Exception:
            continue
    return _read_gpu_percent_from_tegrastats()


def _read_gpu_percent_macos() -> float | None:
    """
    macOS GPU estimate using PyTorch MPS memory pressure.
    This is a proxy metric (memory usage ratio), not raw GPU compute utilization.
    """
    try:
        import torch

        if not getattr(torch.backends, "mps", None) or not torch.backends.mps.is_available():
            return None
        if not hasattr(torch, "mps"):
            return None
        recommended = float(torch.mps.recommended_max_memory())
        if recommended <= 0:
            return None
        used = float(torch.mps.driver_allocated_memory())
        if used <= 0:
            used = float(torch.mps.current_allocated_memory())
        pct = (used / recommended) * 100.0
        return max(0.0, min(100.0, pct))
    except Exception:
        return None


def _read_gpu_percent_from_tegrastats() -> float | None:
    """Fallback parser for Jetson tegrastats output (GR3D_FREQ XX%)."""
    global _gpu_tegrastats_last, _gpu_tegrastats_value
    now = time.time()
    # Avoid spawning tegrastats too frequently.
    if now - _gpu_tegrastats_last < 1.0:
        return _gpu_tegrastats_value
    _gpu_tegrastats_last = now
    try:
        proc = subprocess.run(
            ["tegrastats", "--interval", "1000", "--count", "1"],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
        out = (proc.stdout or "") + "\n" + (proc.stderr or "")
        match = re.search(r"GR3D_FREQ\s+(\d+)%", out)
        if match:
            _gpu_tegrastats_value = max(0.0, min(100.0, float(match.group(1))))
            return _gpu_tegrastats_value
    except Exception:
        pass
    return _gpu_tegrastats_value

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

_frontend_dist = (
    Path(__file__).resolve().parents[2] / "frontend" / "dist"
)
if _frontend_dist.exists():
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="frontend-assets")
else:
    logger.warning(
        "Frontend dist not found at %s. Build frontend with `npm run build` in frontend/.",
        _frontend_dist,
    )


@app.on_event("startup")
def _startup() -> None:
    yolo_service.load()
    if yolo_service.is_ready:
        logger.info(
            "YOLO-World ready (%s) device=%s",
            yolo_service.model_id,
            yolo_service.active_device,
        )
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
            "device_profile": yolo_service.device_profile,
            "active_device": yolo_service.active_device,
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


@app.get("/api/perf")
def perf() -> dict:
    stream_state = stream_manager.get_state()
    with _perf_lock:
        snapshot = dict(_perf_state)
    cpu_pct = _read_cpu_percent()
    gpu_pct = _read_gpu_percent()
    cuda_memory = _read_cuda_memory_stats()
    gpu_metric = (
        "mps_memory_ratio"
        if platform.system() == "Darwin"
        else "gpu_utilization"
    )
    return {
        "cpu_percent": round(cpu_pct, 1) if cpu_pct is not None else None,
        "gpu_percent": round(gpu_pct, 1) if gpu_pct is not None else None,
        "gpu_metric": gpu_metric,
        **cuda_memory,
        "stream_fps": round(stream_state.fps, 2),
        "stream_has_frame": stream_state.has_frame,
        "stream_running": stream_state.running,
        "vlm": {
            "last_ms": round(float(snapshot["vlm_last_ms"]), 2),
            "avg_ms": round(float(snapshot["vlm_avg_ms"]), 2),
            "count": int(snapshot["vlm_count"]),
            "est_fps": round(
                1000.0 / float(snapshot["vlm_avg_ms"]), 2
            ) if float(snapshot["vlm_avg_ms"]) > 0 else 0.0,
        },
        "detect": {
            "last_ms": round(float(snapshot["detect_last_ms"]), 2),
            "avg_ms": round(float(snapshot["detect_avg_ms"]), 2),
            "count": int(snapshot["detect_count"]),
            "est_fps": round(
                1000.0 / float(snapshot["detect_avg_ms"]), 2
            ) if float(snapshot["detect_avg_ms"]) > 0 else 0.0,
        },
        "last_updated_ms": int(snapshot["last_updated_ms"]),
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
    t0 = time.perf_counter()
    boxes, normalized = yolo_service.detect(
        pil,
        prompt,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        tile_grid=tile_grid_value,
    )
    _record_perf("vlm", (time.perf_counter() - t0) * 1000.0)
    summary = f"Detected {len(boxes)} object(s). Targets: {normalized}"
    logger.info(
        "/api/vlm completed: device=%s model=%s boxes=%d",
        yolo_service.active_device,
        yolo_service.model_id,
        len(boxes),
    )
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
    t0 = time.perf_counter()
    boxes, normalized_prompt = yolo_service.detect(
        pil,
        prompt,
        box_threshold=box_threshold,
        text_threshold=text_threshold,
        tile_grid=tile_grid_value,
    )
    _record_perf("detect", (time.perf_counter() - t0) * 1000.0)
    logger.info(
        "/api/detect completed: device=%s model=%s boxes=%d",
        yolo_service.active_device,
        yolo_service.model_id,
        len(boxes),
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


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    """Serve built React app from FastAPI in single-service mode."""
    if not _frontend_dist.exists():
        raise HTTPException(
            status_code=404,
            detail="Frontend build not found. Run `npm run build` in frontend/.",
        )
    # Keep API/docs/openapi endpoints owned by FastAPI routes.
    if full_path.startswith(("api/", "docs", "openapi.json", "redoc")):
        raise HTTPException(status_code=404, detail="Not found")
    index_html = _frontend_dist / "index.html"
    if not index_html.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html missing")
    return FileResponse(index_html)
