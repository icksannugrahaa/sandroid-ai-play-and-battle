"""Exception handlers: generic messages + categories. No tracebacks, upstream text, or secrets reach clients."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.ports.provider import ProviderError
from app.infrastructure.security.ssrf import BlockedDestination

log = logging.getLogger(__name__)

PROVIDER_STATUS = {"auth": 401, "rate_limit": 429, "timeout": 504, "network": 502, "server": 502}


def _validation_details(exc: RequestValidationError) -> list[dict[str, Any]]:
    # Drop `input`/`ctx`: they may echo prompts or header values.
    return [{"loc": list(e.get("loc", ())), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        body = exc.detail if isinstance(exc.detail, dict) else {"error": "http_error", "detail": str(exc.detail)}
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "validation_error", "detail": _validation_details(exc)}, status_code=422)

    @app.exception_handler(BlockedDestination)
    async def blocked(_: Request, exc: BlockedDestination) -> JSONResponse:
        return JSONResponse({"error": "endpoint_not_allowed", "detail": str(exc)}, status_code=400)

    @app.exception_handler(ProviderError)
    async def provider_error(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(
            # the upstream's numeric status only (never its text): tells "gateway down" (530)
            # from "bad key" (401) or "proxy timeout" (524)
            {"error": "provider_error", "category": exc.category.value, "upstream_status": exc.status_code},
            status_code=PROVIDER_STATUS.get(exc.category.value, 502),
        )

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled %s", type(exc).__name__)  # type only — messages may embed request data
        return JSONResponse({"error": "internal_error"}, status_code=500)
