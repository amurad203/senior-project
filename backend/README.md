# Backend — YOLO-World

FastAPI: **image + text** → open-vocabulary **bounding boxes** via **`POST /api/vlm`**. No database.

## Setup

1. Create a virtual environment (recommended):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
```

2. Run on **port 8765**:

```bash
chmod +x run.sh   # once
./run.sh
```

`run.sh` now auto-creates `.venv` and installs/updates `requirements.txt` packages when needed.  
It also builds `frontend/dist` (unless `SKIP_FRONTEND_BUILD=1`) so FastAPI can serve both API + UI from one service.

Or manually: `uvicorn app.main:app --reload --host 127.0.0.1 --port 8765`

- Health: [http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)
- Docs: [http://127.0.0.1:8765/docs](http://127.0.0.1:8765/docs)
- UI: [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

Override port: `UVICORN_PORT=9000 ./run.sh` (match Vite proxy in `frontend/vite.config.ts`).

### YOLO-World prompts

Comma-separated **class names**, e.g. `person, car, laptop`.

## Troubleshooting

- **`GET /health`** — check `yolo_world.loaded` and `yolo_world.error`.
- **YOLO-World** — needs `import clip` (OpenAI CLIP in `requirements.txt`). Use **ultralytics ≥ 8.3** if `set_classes` fails after `predict`.
- **Python 3.13** — if installs fail, try **3.11 or 3.12**.

## Port already in use

```bash
lsof -i :8765
kill $(lsof -ti :8765)
# or: UVICORN_PORT=8766 ./run.sh
```

## Tuning detection threshold

- **Web UI** — Command panel **Detection threshold** slider sends `box_threshold` on every `/api/vlm` call (overrides env defaults for that request).
- **Server defaults** — If the client omits `box_threshold`, the API uses:
  - **YOLO-World:** `YOLO_CONF` (default `0.25`)
  Lower values → more boxes (often more false positives); higher → stricter.
- **curl example:**  
  `curl -F "image=@frame.jpg" -F "prompt=car,person" -F "box_threshold=0.3" http://127.0.0.1:8765/api/vlm`

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `YOLO_WORLD_MODEL` | `yolov8m-worldv2.pt` | Ultralytics world weights |
| `YOLO_CONF` | `0.25` | YOLO confidence when request has no `box_threshold` |
| `YOLO_IMGSZ` | `640` | Inference resolution (higher helps small objects; slower) |
| `YOLO_MAX_DET` | `300` | Maximum detections per frame |
| `YOLO_TILE_2X2` | `0` | Set `1` to run 2x2 tiled inference for better small-object recall (slower) |
| `DEVICE_PROFILE` | `auto` | Platform profile defaults (`mac`, `jetson`, `windows-cuda`, `linux-cuda`, `cpu`) |
| `DINO_DEVICE` | auto (`cuda` / `mps` / `cpu`) | Force device for vision models |
| `YOLO_ENFORCE_TENSORRT` | `0` | Set `1` to require TensorRT (`.engine` model + CUDA + `tensorrt` package) |
| `SKIP_MODEL_LOAD` | unset | Set to `1` to skip loading weights |
| `SKIP_FRONTEND_BUILD` | `0` | Set to `1` to skip automatic frontend build in `run.sh` |
| `FORCE_FRONTEND_BUILD` | `0` | Set to `1` to force rebuilding `frontend/dist` in `run.sh` |

`DEVICE_PROFILE=auto` picks defaults by host:
- macOS -> prefers MPS
- Linux arm64/aarch64 (Jetson-style) -> prefers CUDA
- Windows -> prefers CUDA
- Linux x86_64 -> prefers CUDA
- unknown -> CPU

`DINO_DEVICE` still has highest priority and overrides profile behavior.

## API

### `POST /api/vlm` (used by the React app)

Multipart: `image`, `prompt`. Returns `{ "mode", "response", "boxes", "count", "prompt_normalized" }`.  
Optional: `box_threshold`, `text_threshold`, `model_id`, `tile_grid` (`1`..`4`).

### `POST /api/detect`

YOLO-World detections; same box shape (percentages 0–100).

### `GET /api/rtmp`

Notes only — RTMP ingest is outside this app.

### Stream bridge endpoints (UI-friendly)

Use these to connect RTSP/RTMP/file sources from the frontend without shell commands.

- `POST /api/stream/start` with JSON `{ "source_url": "rtsp://... or rtmp://..." }`
- `POST /api/stream/stop`
- `GET /api/stream/status`
- `GET /api/stream/frame` (single JPEG snapshot)
- `GET /api/stream/mjpeg` (multipart MJPEG preview for browser `<img>`)

## Frontend

- **Single-service mode (recommended):** FastAPI serves built UI at `/`.
- **Dev mode:** Vite proxies `/api` → `http://127.0.0.1:8765` (`frontend/vite.config.ts`).
