"""FastAPI application factory. Run: `uvicorn --factory app.main:create_app --no-access-log`."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings, get_settings
from app.container import Container, build_container
from app.infrastructure.persistence.repositories import sync_curated_aliases
from app.infrastructure.security.redaction import RedactingFilter
from app.interfaces.errors import install_error_handlers
from app.interfaces.middleware import AccessLogMiddleware, BodySizeLimitMiddleware, SecurityHeadersMiddleware
from app.interfaces.routers import catalog, runs

log = logging.getLogger("sandroid")

API_VERSION = "1.0.0"


def configure_logging(level: str) -> None:
    root = logging.getLogger()
    if not root.handlers:
        stream = logging.StreamHandler()
        stream.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root.addHandler(stream)
    root.setLevel(level.upper())
    redactor = RedactingFilter()
    for handler in root.handlers:
        if not any(isinstance(f, RedactingFilter) for f in handler.filters):
            handler.addFilter(redactor)
    # httpx/httpcore debug logs include request lines; keep them quiet.
    for noisy in ("httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not index.exists():
        return
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    async def spa(path: str) -> FileResponse | JSONResponse:
        if path.startswith("api/"):
            return JSONResponse({"error": "not_found"}, status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index)


def create_app(
    settings: Settings | None = None,
    container_factory: Callable[[Settings], Container] = build_container,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        container = container_factory(settings)
        app.state.container = container
        try:
            await sync_curated_aliases(container.sessions, container.alias_rules)
            await container.research.ensure_seeded()
        except Exception as exc:  # noqa: BLE001 — DB may be down; the API still serves runs
            log.warning("startup DB step skipped: %s", type(exc).__name__)
        try:
            yield
        finally:
            await container.aclose()

    app = FastAPI(
        title="Sandroid AI Play & Battle",
        version=API_VERSION,
        description=(
            "Playground, Arena, Leaderboard and Pricing for any OpenAI-compatible endpoint. "
            "**This service NEVER stores provider credentials** and never stores prompts or outputs. "
            "All AI usage is billed to the API key you supply."
        ),
        license_info={"name": "MIT"},
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    install_error_handlers(app)

    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["content-type", "x-api-key", *(f"x-api-key-{i}" for i in range(4))],
            allow_credentials=False,
            max_age=600,
        )
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AccessLogMiddleware)

    @app.get("/api/v1/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": API_VERSION}

    app.include_router(runs.router)
    app.include_router(catalog.router)
    _mount_frontend(app, settings.frontend_dist)
    return app
