#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_URL="http://127.0.0.1:8000"
FRONTEND_URL="http://127.0.0.1:5173"

if [ ! -x "$BACKEND_DIR/.venv/bin/uvicorn" ]; then
  echo "Backend virtualenv is missing dependencies."
  echo "Run: cd backend && python3 -m venv .venv && .venv/bin/python -m pip install -e ."
  exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Frontend dependencies are missing."
  echo "Run: cd frontend && npm install"
  exit 1
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl -fsS "$BACKEND_URL/health" >/dev/null 2>&1; then
  echo "Atlas API is already healthy on $BACKEND_URL."
else
  if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 8000 is in use, but Atlas API is not healthy."
    echo "Stop the stale process, then run this script again."
    lsof -nP -iTCP:8000 -sTCP:LISTEN || true
    exit 1
  fi

  cd "$BACKEND_DIR"
  ATLAS_ENV=development "$BACKEND_DIR/.venv/bin/uvicorn" app.main:app --host 0.0.0.0 --port 8000 &
  BACKEND_PID=$!

  echo "Waiting for Atlas API on $BACKEND_URL/health ..."
  for _ in {1..40}; do
    if curl -fsS "$BACKEND_URL/health" >/dev/null 2>&1; then
      echo "Atlas API is ready."
      break
    fi
    sleep 0.25
  done

  if ! curl -fsS "$BACKEND_URL/health" >/dev/null 2>&1; then
    echo "Atlas API did not become healthy."
    exit 1
  fi
fi

if curl -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
  echo "Atlas frontend is already running on $FRONTEND_URL."
  echo "Atlas cockpit: http://localhost:5173"
  exit 0
fi

if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 5173 is in use, but Atlas frontend is not responding."
  echo "Stop the stale process, then run this script again."
  lsof -nP -iTCP:5173 -sTCP:LISTEN || true
  exit 1
fi

cd "$FRONTEND_DIR"
npm run dev -- --host 0.0.0.0 --strictPort &
FRONTEND_PID=$!

echo "Atlas cockpit: http://localhost:5173"
wait "$FRONTEND_PID"
