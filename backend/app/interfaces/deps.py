from __future__ import annotations

import math
from collections.abc import Callable

from fastapi import HTTPException, Request

from app.container import Container
from app.infrastructure.security.client_ip import client_ip
from app.infrastructure.security.rate_limit import TokenBucketLimiter

API_KEY_HEADER = "x-api-key"
MAX_ARENA_SLOTS = 4


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


def request_ip(request: Request) -> str:
    return client_ip(request, trust_proxy=get_container(request).settings.trust_proxy_headers)


def rate_limited(pick: Callable[[Container], TokenBucketLimiter]) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        wait = pick(get_container(request)).acquire(request_ip(request))
        if wait > 0:
            retry = max(1, math.ceil(wait))
            raise HTTPException(
                status_code=429,
                detail={"error": "rate_limited", "retry_after_s": retry},
                headers={"Retry-After": str(retry)},
            )

    return dependency


def api_key(request: Request) -> str:
    """Single-endpoint key. Lives only for this request; never logged or stored."""
    return request.headers.get(API_KEY_HEADER, "").strip()


def slot_api_keys(request: Request) -> list[str]:
    """Arena keys: `X-Api-Key-0` … `X-Api-Key-3` (falls back to `X-Api-Key` for every slot)."""
    shared = api_key(request)
    return [request.headers.get(f"{API_KEY_HEADER}-{i}", shared).strip() for i in range(MAX_ARENA_SLOTS)]
