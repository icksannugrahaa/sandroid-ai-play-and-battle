#!/usr/bin/env bash
# PM2 deploy pipeline: git pull → pip install → npm ci && build → alembic upgrade → pm2 reload
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3.14}"
command -v "$PYTHON" >/dev/null || { echo "Python 3.14 is required (set PYTHON=/path/to/python3.14)"; exit 1; }
"$PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 14), sys.version' \
  || { echo "This project pins Python 3.14"; exit 1; }

if [ "${SKIP_PULL:-false}" != "true" ] && git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  echo "→ git pull"
  git pull --ff-only
else
  echo "→ git pull skipped (no upstream or SKIP_PULL=true)"
fi

echo "→ backend dependencies"
[ -d backend/.venv ] || "$PYTHON" -m venv backend/.venv
VENV_PY=backend/.venv/bin/python
"$VENV_PY" -m pip --version >/dev/null 2>&1 || "$VENV_PY" -m ensurepip --upgrade >/dev/null
"$VENV_PY" -m pip install --quiet --upgrade pip
"$VENV_PY" -m pip install --quiet ./backend

echo "→ frontend build"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

echo "→ database migrations"
[ -f backend/.env ] || { echo "backend/.env missing (copy .env.example)"; exit 1; }
# Local machine: the project's own Postgres (.pgtest, port 5433) is started by hand, so it is
# down after a reboot/shutdown — bring it back first. LC_ALL avoids macOS's "postmaster became
# multithreaded during startup" refusal. Servers with a real Postgres have no .pgtest folder.
if [ -d .pgtest/data ]; then
  PG_CTL="$(command -v pg_ctl || echo /opt/homebrew/opt/postgresql@16/bin/pg_ctl)"
  if ! "$PG_CTL" -D .pgtest/data status >/dev/null 2>&1; then
    echo "→ starting local Postgres (.pgtest, port 5433)"
    LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}" \
      "$PG_CTL" -D .pgtest/data -l .pgtest/pg.log -w -o "-p 5433 -k $PWD/.pgtest" start >/dev/null
  fi
fi
(cd backend && .venv/bin/alembic upgrade head)

echo "→ pm2 reload"
if pm2 describe sandroid-ai-play-and-battle >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save
echo "✓ deployed"
