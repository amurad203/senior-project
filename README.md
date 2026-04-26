# Senior UAV Detection App

YOLO-World open-vocabulary detection app with FastAPI backend and React frontend.

## Run (Native, single service)

```bash
cd backend
./run.sh
```

Then open:

- UI: <http://127.0.0.1:8765/>
- Health: <http://127.0.0.1:8765/health>
- Docs: <http://127.0.0.1:8765/docs>

`run.sh` auto-installs backend dependencies and builds `frontend/dist` (unless `SKIP_FRONTEND_BUILD=1`).

## Run (Docker, single service)

```bash
docker compose up --build
```

Then open:

- UI: <http://127.0.0.1:8765/>

Notes:

- Model downloads are cached in a named Docker volume (`model_cache`).
- Set runtime options with env vars (for example `YOLO_WORLD_MODEL=yolov8s-worldv2.pt`).
