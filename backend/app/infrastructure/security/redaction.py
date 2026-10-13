"""Credential redaction for everything that could reach a log line.

Defense in depth: our own code never logs headers or keys, and this filter
scrubs anything that slips through (third-party libraries, exception text).
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping

REDACTED = "[REDACTED]"

SENSITIVE_HEADER_PREFIXES = ("authorization", "proxy-authorization", "x-api-key", "api-key", "cookie")

# Whole match is a secret.
_SECRET_TOKENS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\b(?:bearer|basic)\s+[a-z0-9._~+/=\-]{6,}"),
    re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"\b(?:gsk|xai|hf)_[A-Za-z0-9]{8,}"),
)
# Group 1 is a label worth keeping ("api_key=", "Authorization: ", "?key="); the value is the secret.
_LABELLED_SECRETS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)((?:x-)?api[-_]?key[\"']?\s*[:=]\s*[\"']?)[^\s\"',;]+"),
    re.compile(r"(?i)(authorization[\"']?\s*[:=]\s*[\"']?)(?:(?:bearer|basic)\s+)?[^\s\"',;]+"),
    re.compile(r"(?i)([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+"),
)


def redact_text(text: str) -> str:
    for pattern in _SECRET_TOKENS:
        text = pattern.sub(REDACTED, text)
    for pattern in _LABELLED_SECRETS:
        text = pattern.sub(lambda m: m.group(1) + REDACTED, text)
    return text


def is_sensitive_header(name: str) -> bool:
    lowered = name.lower()
    return lowered.startswith(SENSITIVE_HEADER_PREFIXES)


def redact_headers(headers: Mapping[str, str] | Iterable[tuple[str, str]]) -> dict[str, str]:
    items = headers.items() if isinstance(headers, Mapping) else headers
    return {k: (REDACTED if is_sensitive_header(k) else v) for k, v in items}


class RedactingFilter(logging.Filter):
    """Rewrites every record's final message with secrets removed."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        record.msg = redact_text(message)
        record.args = None
        if record.exc_text:
            record.exc_text = redact_text(record.exc_text)
        return True


def mask_ip(ip: str | None) -> str:
    """For logs only: never write a full client IP."""
    if not ip:
        return "-"
    if ":" in ip:
        return ":".join(ip.split(":")[:3]) + ":x"
    parts = ip.split(".")
    return ".".join(parts[:3]) + ".x" if len(parts) == 4 else "x"
