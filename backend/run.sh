#!/usr/bin/env bash
# Senior project FastAPI only — port 8765 avoids Django/other apps on 8000–8001.
set -e
cd "$(dirname "$0")"

FRONTEND_DIR="../frontend"
FRONTEND_DIST="${FRONTEND_DIR}/dist"

# Create/use local virtualenv automatically for local workstation runs.
if [[ -z "${VIRTUAL_ENV:-}" ]]; then
  if [[ ! -d ".venv" ]]; then
    echo "Creating virtual environment at backend/.venv"
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# Install Python dependencies on startup if missing or requirements changed.
REQ_FILE="requirements.txt"
REQ_STAMP=".venv/.requirements.sha256"
if command -v shasum >/dev/null 2>&1; then
  REQ_HASH="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  REQ_HASH="$(sha256sum "$REQ_FILE" | awk '{print $1}')"
else
  REQ_HASH=""
fi

PREV_HASH=""
if [[ -f "$REQ_STAMP" ]]; then
  PREV_HASH="$(cat "$REQ_STAMP")"
fi

if [[ ! -f ".venv/.deps-installed" || -z "$REQ_HASH" || "$REQ_HASH" != "$PREV_HASH" ]]; then
  echo "Installing backend dependencies (this may download models/packages)..."
  python -m pip install --upgrade pip
  python -m pip install -r "$REQ_FILE"
  touch .venv/.deps-installed
  if [[ -n "$REQ_HASH" ]]; then
    echo "$REQ_HASH" > "$REQ_STAMP"
  fi
fi

# Build frontend once so FastAPI can serve a single UI+API service.
if [[ "${SKIP_FRONTEND_BUILD:-0}" != "1" && -d "$FRONTEND_DIR" ]]; then
  if [[ "${FORCE_FRONTEND_BUILD:-0}" == "1" || ! -d "$FRONTEND_DIST" ]]; then
    echo "Building frontend bundle for single-service mode..."
    if command -v npm >/dev/null 2>&1; then
      (cd "$FRONTEND_DIR" && npm install && npm run build)
    else
      echo "WARNING: npm not found; skipping frontend build."
      echo "         Install Node.js/npm, or set SKIP_FRONTEND_BUILD=1 to silence this warning."
    fi
  fi
fi

export UVICORN_PORT="${UVICORN_PORT:-8765}"
if lsof -Pi ":${UVICORN_PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "ERROR: port ${UVICORN_PORT} is already in use (Address already in use)."
  echo "  Stop the old server:  kill \$(lsof -ti :${UVICORN_PORT})"
  echo "  Or use another port:  UVICORN_PORT=8766 ./run.sh"
  echo "  (If you change the port, set the same in frontend/vite.config.ts proxy target.)"
  exit 1
fi
echo "Starting UAV API on http://127.0.0.1:${UVICORN_PORT}"
echo "  Docs: http://127.0.0.1:${UVICORN_PORT}/docs"
echo "  Health: http://127.0.0.1:${UVICORN_PORT}/health"
echo "  UI: http://127.0.0.1:${UVICORN_PORT}/"
exec uvicorn app.main:app --reload --host 127.0.0.1 --port "${UVICORN_PORT}" --no-access-log
