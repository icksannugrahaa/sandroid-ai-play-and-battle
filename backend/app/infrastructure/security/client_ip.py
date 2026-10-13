from __future__ import annotations

from starlette.requests import Request


def client_ip(request: Request, *, trust_proxy: bool) -> str:
    """Best-effort client IP for rate limiting. Used in memory only."""
    if trust_proxy:
        cf = request.headers.get("cf-connecting-ip")
        if cf:
            return cf.strip()
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real = request.headers.get("x-real-ip")
        if real:
            return real.strip()
    return request.client.host if request.client else "unknown"
