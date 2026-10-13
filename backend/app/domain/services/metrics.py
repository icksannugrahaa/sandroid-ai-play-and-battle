"""Objective run metrics — pure functions, no clocks, no I/O."""

from __future__ import annotations

import math

from app.domain.entities import (
    ErrorCategory,
    PricingEntry,
    RunMetrics,
    RunStatus,
    Usage,
)

CHARS_PER_TOKEN = 4


def estimate_tokens(chars: int) -> int:
    return math.ceil(chars / CHARS_PER_TOKEN) if chars > 0 else 0


MIN_WINDOW_SHARE = 0.25


def throughput(completion_tokens: int, total_ms: float, ttft_ms: float | None) -> float | None:
    """Completion tokens per second over the generation window (after first token)."""
    if completion_tokens <= 0 or total_ms <= 0:
        return None
    window_ms = total_ms - ttft_ms if ttft_ms is not None else total_ms
    # A window that is a sliver of the run means most tokens were produced before the first
    # visible one (hidden reasoning): dividing them by the sliver gives absurd speeds.
    if window_ms < max(1.0, total_ms * MIN_WINDOW_SHARE):
        window_ms = total_ms
    return completion_tokens / (window_ms / 1000)


def cost_usd(
    pricing: PricingEntry | None,
    prompt_tokens: int,
    completion_tokens: int,
    images: int = 0,
) -> float | None:
    if pricing is None:
        return None
    parts: list[float] = []
    if pricing.input_per_1m is not None:
        parts.append(prompt_tokens * pricing.input_per_1m / 1_000_000)
    if pricing.output_per_1m is not None:
        parts.append(completion_tokens * pricing.output_per_1m / 1_000_000)
    if images and pricing.image_price is not None:
        parts.append(images * pricing.image_price)
    if not parts:
        return None
    return round(sum(parts), 10)


def compute_metrics(
    *,
    started_at: float,
    first_token_at: float | None,
    finished_at: float,
    streamed: bool,
    usage: Usage | None,
    prompt_chars: int,
    completion_chars: int,
    pricing: PricingEntry | None,
    status: RunStatus,
    error_category: ErrorCategory | None = None,
    images: int = 0,
) -> RunMetrics:
    """Timestamps are monotonic seconds (e.g. `time.perf_counter()`)."""
    total_ms = max(0.0, (finished_at - started_at) * 1000)
    ttft_ms = max(0.0, (first_token_at - started_at) * 1000) if streamed and first_token_at is not None else None

    estimated = False
    prompt_tokens = usage.prompt_tokens if usage else None
    completion_tokens = usage.completion_tokens if usage else None
    # Some gateways report usage as 0 even though text was produced — treat as unknown.
    if prompt_tokens == 0 and prompt_chars > 0:
        prompt_tokens = None
    if completion_tokens == 0 and completion_chars > 0:
        completion_tokens = None
    if prompt_tokens is None:
        prompt_tokens = estimate_tokens(prompt_chars)
        estimated = estimated or prompt_tokens > 0
    if completion_tokens is None:
        completion_tokens = estimate_tokens(completion_chars)
        estimated = estimated or completion_tokens > 0

    success = status is RunStatus.SUCCESS
    return RunMetrics(
        ttft_ms=round(ttft_ms, 2) if ttft_ms is not None else None,
        ttft_supported=streamed,
        total_ms=round(total_ms, 2),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        tokens_estimated=estimated,
        throughput_tps=(
            round(tps, 3) if success and (tps := throughput(completion_tokens, total_ms, ttft_ms)) is not None else None
        ),
        cost_usd=cost_usd(pricing, prompt_tokens, completion_tokens, images),
        status=status,
        error_category=None if success else (error_category or ErrorCategory.SERVER),
    )
