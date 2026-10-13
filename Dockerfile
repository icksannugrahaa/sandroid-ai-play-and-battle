# syntax=docker/dockerfile:1.7
# All-in-one image: React build → static files served by FastAPI. Python 3.14 (pinned).

# ---------- frontend build ----------
FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- python base ----------
FROM python:3.14-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install .

# ---------- dev (docker-compose.yml, hot reload) ----------
FROM base AS dev
RUN pip install ".[dev]"
ENV ALIASES_PATH=/aliases.json
CMD ["sh", "-c", "alembic upgrade head && uvicorn --factory app.main:create_app --host 0.0.0.0 --port 8000 --reload --no-access-log"]

# ---------- production ----------
FROM base AS prod
RUN useradd --system --uid 10001 --home /app sandroid
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY aliases.json /app/aliases.json
COPY --from=frontend /build/dist /app/frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV ALIASES_PATH=/app/aliases.json \
    FRONTEND_DIST=/app/frontend/dist \
    RUN_MIGRATIONS=true
USER sandroid
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips=*"]
