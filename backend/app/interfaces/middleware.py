"""ASGI middleware: body size limit, privacy-safe access log, security headers."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, ClassVar

from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.infrastructure.security.redaction import mask_ip

access_log = logging.getLogger("sandroid.access")


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await _send_json(send, 413, {"error": "payload_too_large"})
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _TooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            await _send_json(send, 413, {"error": "payload_too_large"})


class _TooLarge(HTTPException):
    # An HTTPException so FastAPI's body parser re-raises it (as 413) instead of turning it into a 400.
    def __init__(self) -> None:
        super().__init__(status_code=413, detail={"error": "payload_too_large"})


async def _send_json(send: Send, status: int, body: dict[str, Any]) -> None:
    raw = json.dumps(body).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": raw})


class AccessLogMiddleware:
    """Logs method, path (no query string), status, duration, masked IP. Never headers or bodies."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            client = scope.get("client")
            access_log.info(
                "%s %s %s %.0fms ip=%s",
                scope.get("method"),
                scope.get("path"),
                status,
                (time.perf_counter() - started) * 1000,
                mask_ip(client[0] if client else None),
            )


class SecurityHeadersMiddleware:
    HEADERS: ClassVar[list[tuple[bytes, bytes]]] = [
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
        (b"x-frame-options", b"DENY"),
        (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    ]

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def add_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(self.HEADERS)
                if scope.get("path", "").startswith("/api/") and not any(k == b"cache-control" for k, _ in headers):
                    headers.append((b"cache-control", b"no-store"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, add_headers)
