"""Level 2 — family (aggregation, never identity).

Variant suffixes are cut off the display name repeatedly until nothing more
matches. `qwen3.8`, `qwen3.8-max` and `qwen3.8-2026-07-06` all share family
`qwen38` while staying three distinct canonical models.

A suffix only counts when it is separated from the stem — by punctuation
(`-`, `_`, `.`, `:`, `@`, space) or by a camelCase boundary (`DeepseekV1Flash`).
That keeps words like `gemini` from losing their trailing `mini`.
"""

from __future__ import annotations

import re

from app.domain.services.naming import strip_namespace

_SEP = r"(?:[-_.:@\s]+|(?<=[a-z0-9])(?=[A-Z]))"
_SEP_STRICT = r"[-_.:@\s]+"

_TIER = r"max|mini|pro|turbo|flash|lite|ultra"
_ROLE = r"instruct|chat|latest|base|free"
_QUANT = r"fp4|fp8|fp16|int4|int8|bf16"
_DATE = r"\d{4}[-.]?\d{2}[-.]?\d{2}|(?:0[1-9]|1[0-2])\d{2}"
_PARAMS = r"\d+x\d+(?:\.\d+)?b|[ae]\d+(?:\.\d+)?b|\d+(?:\.\d+)?[bm]"

_SUFFIXES: tuple[re.Pattern[str], ...] = (
    re.compile(rf"{_SEP}(?i:{_TIER})$"),
    re.compile(rf"{_SEP}(?i:{_ROLE})$"),
    re.compile(rf"{_SEP_STRICT}(?:{_DATE})$"),
    re.compile(rf"{_SEP_STRICT}(?i:{_PARAMS})$"),
    re.compile(rf"{_SEP_STRICT}(?i:{_QUANT})$"),
)

_NON_ALNUM = re.compile(r"[^a-z0-9]")


def _strip_once(name: str) -> str:
    for pattern in _SUFFIXES:
        stripped = pattern.sub("", name)
        if stripped != name and _NON_ALNUM.sub("", stripped.lower()):
            return stripped
    return name


def extract_family(display_name: str) -> str:
    name = strip_namespace(display_name)
    while True:
        stripped = _strip_once(name)
        if stripped == name:
            break
        name = stripped
    family = _NON_ALNUM.sub("", name.lower())
    if not family:
        raise ValueError("model name has no alphanumeric characters")
    return family
