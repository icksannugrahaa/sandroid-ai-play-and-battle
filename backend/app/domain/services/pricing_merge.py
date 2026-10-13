"""Pricing merge: source priority first, then recency. Pure."""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterable, Mapping
from datetime import datetime

from app.domain.entities import AliasCandidate, PricingEntry, PricingQuote
from app.domain.services.naming import strip_namespace
from app.domain.services.normalizer import AliasRegistry

DEFAULT_SOURCE_PRIORITY: Mapping[str, int] = {"openrouter": 1, "litellm": 2, "helicone": 3}
_UNKNOWN_PRIORITY = 99


def _valid_price(value: float | None) -> float | None:
    if value is None or value != value or value < 0:  # None, NaN, or OpenRouter's "-1" sentinel
        return None
    return float(value)


def quotes_to_entries(
    quotes: Iterable[PricingQuote],
    *,
    source: str,
    fetched_at: datetime,
    aliases: AliasRegistry,
) -> list[PricingEntry]:
    entries: list[PricingEntry] = []
    for q in quotes:
        input_price = _valid_price(q.input_per_1m)
        output_price = _valid_price(q.output_per_1m)
        image_price = _valid_price(q.image_price)
        if input_price is None and output_price is None and image_price is None:
            continue
        try:
            key = aliases.resolve_key(q.raw_name)
        except ValueError:
            continue
        entries.append(
            PricingEntry(
                canonical_key=key,
                raw_name=q.raw_name,
                input_per_1m=input_price,
                output_per_1m=output_price,
                image_price=image_price,
                currency=q.currency,
                source=source,
                fetched_at=fetched_at,
            )
        )
    return entries


def merge_pricing(
    entries: Iterable[PricingEntry],
    priority: Mapping[str, int] = DEFAULT_SOURCE_PRIORITY,
) -> dict[str, PricingEntry]:
    """Pick one entry per canonical key.

    Order: source priority (lower wins) > newer `fetched_at` > un-namespaced raw
    name (the vendor's own listing beats a reseller's) > shorter raw name >
    raw name alphabetically (determinism).
    """

    def rank(e: PricingEntry) -> tuple[int, float, int, int, str]:
        return (
            priority.get(e.source, _UNKNOWN_PRIORITY),
            -e.fetched_at.timestamp(),
            1 if "/" in e.raw_name else 0,
            len(e.raw_name),
            e.raw_name,
        )

    best: dict[str, PricingEntry] = {}
    for entry in entries:
        current = best.get(entry.canonical_key)
        if current is None or rank(entry) < rank(current):
            best[entry.canonical_key] = entry
    return best


def suggest_alias_candidates(
    unpriced_model_keys: Iterable[str],
    priced_keys: Iterable[str],
    *,
    threshold: float = 0.88,
    limit: int = 50,
) -> list[AliasCandidate]:
    """Near-miss names worth a PR to `aliases.json`. Suggestions only — never applied."""
    priced = sorted(set(priced_keys))
    out: list[AliasCandidate] = []
    for key in sorted(set(unpriced_model_keys)):
        if key in priced:
            continue
        best: AliasCandidate | None = None
        for close in difflib.get_close_matches(key, priced, n=3, cutoff=threshold):
            score = difflib.SequenceMatcher(None, key, close).ratio()
            if best is None or score > best.score:
                best = AliasCandidate(model_key=key, suggested_key=close, score=round(score, 3))
        if best is not None:
            out.append(best)
    out.sort(key=lambda c: (-c.score, c.model_key))
    return out[:limit]


# Provider/router knobs appended to a model id that do not change which model is billed.
_CONFIG_SUFFIXES = frozenset(
    {
        "low",
        "medium",
        "med",
        "high",
        "xhigh",
        "minimal",
        "none",
        "thinking",
        "nothinking",
        "nonthinking",
        "think",
        "nothink",
        "reasoning",
        "noreasoning",
    }
)
_SPLIT = re.compile(r"[-_.:@\s]+")


def pricing_keys(raw_name: str, aliases: AliasRegistry) -> list[tuple[str, bool]]:
    """Keys to try when pricing a run: the exact canonical key first (exact=True), then the
    base model with config suffixes such as `-low` / `-thinking` removed (exact=False)."""
    exact = aliases.resolve_key(raw_name)
    keys: list[tuple[str, bool]] = [(exact, True)]
    tokens = [t for t in _SPLIT.split(strip_namespace(raw_name).lower()) if t]
    while len(tokens) > 1 and tokens[-1] in _CONFIG_SUFFIXES:
        tokens.pop()
        try:
            key = aliases.resolve_key("".join(tokens))
        except ValueError:
            break
        if all(key != k for k, _ in keys):
            keys.append((key, False))
    return keys
