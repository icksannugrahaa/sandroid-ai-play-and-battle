"""Shared name helpers for the normalizer and family extractor (pure)."""

from __future__ import annotations

import re

_BARE_VERSION = re.compile(r"[^A-Za-z]*\d[^A-Za-z]*")


def strip_namespace(raw_name: str) -> str:
    """Last path segment — unless it is a bare version ("…/text-to-image/3.2"), which
    alone would collide across unrelated models; then keep the preceding segment(s)."""
    parts = [p.strip() for p in raw_name.strip().split("/") if p.strip()]
    if not parts:
        return ""
    tail = [parts.pop()]
    while parts and _BARE_VERSION.fullmatch(tail[0]):
        tail.insert(0, parts.pop())
    return "/".join(tail)
