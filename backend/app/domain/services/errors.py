"""Upstream failure classification — only an enum category ever leaves this module."""

from __future__ import annotations

from app.domain.entities import ErrorCategory


def classify_status(status_code: int) -> ErrorCategory:
    if status_code in (401, 403):
        return ErrorCategory.AUTH
    if status_code == 429:
        return ErrorCategory.RATE_LIMIT
    # 524 = Cloudflare "origin timeout": the proxy in front of a gateway gave up waiting
    # (typically ~100 s without a byte while a reasoning model thinks silently).
    if status_code in (408, 504, 524):
        return ErrorCategory.TIMEOUT
    # Other 4xx (bad request, unknown model) are reported as `server`: the enum is
    # deliberately closed, and the upstream rejected the call either way.
    return ErrorCategory.SERVER


def is_client_fault(status_code: int | None) -> bool:
    """4xx except 429/408 — caused by the caller's key/request, not by the model.

    Such runs are not contributed to the leaderboard: a typo'd model name or an
    expired key says nothing about the model's reliability.
    """
    return status_code is not None and 400 <= status_code < 500 and status_code not in (408, 429)
