"""Shared run execution: one model, one prompt, measured.

Content (prompt/output) and the API key exist only in memory for the duration of
the request. The only thing that may outlive it is a `RunRecord` (metrics).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any, Literal
from urllib.parse import urlsplit

from app.domain.entities import (
    CanonicalModel,
    ErrorCategory,
    Modality,
    PricingEntry,
    RunMetrics,
    RunStatus,
    Usage,
)
from app.domain.ports.provider import ChatRequest, ImageRequest, ProviderClient, ProviderError
from app.domain.services.media import audio_data_url
from app.domain.services.metrics import compute_metrics
from app.domain.services.normalizer import AliasRegistry
from app.domain.services.pricing_merge import pricing_keys

log = logging.getLogger(__name__)

# Statuses meaning "this gateway/model has no /images/generations" (not billed) → fall back to chat.
IMAGE_ENDPOINT_UNSUPPORTED = frozenset({400, 404, 405, 415, 422, 501})

EventType = Literal["start", "delta", "reasoning", "image", "audio", "metrics", "ticket", "error", "done"]


@dataclass(frozen=True, slots=True)
class RunEvent:
    type: EventType
    data: dict[str, Any]
    slot: int | None = None


Emit = Callable[[RunEvent], Awaitable[None]]
PricingLookup = Callable[[str], Awaitable[PricingEntry | None]]


@dataclass(frozen=True, slots=True)
class RunTarget:
    base_url: str
    model: str
    api_key: str = field(repr=False)
    slot: int | None = None
    # Per-target conversation (arena follow-ups); None → use the prompt's shared history.
    history: tuple[tuple[str, str], ...] | None = None
    # Per-target prompt (challenge follow-up turns); None → the shared prompt.
    prompt: str | None = None

    @property
    def provider_label(self) -> str:
        return (urlsplit(self.base_url).hostname or "unknown").lower()[:128]


def _attachment_part(kind: str, name: str, data_url: str) -> dict[str, Any]:
    """OpenAI-compatible content parts (also understood by OpenRouter and most gateways)."""
    if kind == "audio":
        fmt = "mp3" if data_url.startswith(("data:audio/mpeg", "data:audio/mp3")) else "wav"
        return {"type": "input_audio", "input_audio": {"data": data_url.split(",", 1)[1], "format": fmt}}
    return {"type": "file", "file": {"filename": name, "file_data": data_url}}


@dataclass(frozen=True, slots=True)
class PromptSpec:
    modality: Modality
    prompt: str
    system: str | None = None
    history: tuple[tuple[str, str], ...] = ()
    images: tuple[str, ...] = ()
    params: dict[str, Any] = field(default_factory=dict)
    image_size: str | None = None
    # (kind, name, data_url): kind "audio" → input_audio part, "file" → file part (e.g. PDF)
    attachments: tuple[tuple[str, str, str], ...] = ()

    def to_messages(self) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        if self.system:
            messages.append({"role": "system", "content": self.system})
        messages.extend({"role": role, "content": content} for role, content in self.history)
        if self.images or self.attachments:
            parts: list[dict[str, Any]] = [{"type": "text", "text": self.prompt}] if self.prompt else []
            parts.extend({"type": "image_url", "image_url": {"url": img}} for img in self.images)
            parts.extend(_attachment_part(kind, name, url) for kind, name, url in self.attachments)
            messages.append({"role": "user", "content": parts})
        else:
            messages.append({"role": "user", "content": self.prompt})
        return messages

    def prompt_chars(self) -> int:
        return len(self.system or "") + sum(len(c) for _, c in self.history) + len(self.prompt)


@dataclass(frozen=True, slots=True)
class RunOutcome:
    target: RunTarget
    canonical: CanonicalModel
    metrics: RunMetrics
    contributable: bool  # False when the failure was the caller's fault (bad key, unknown model)
    # the run used up its own time limit (a model too slow for the task) — unlike a gateway
    # timeout such as Cloudflare's 524, which says nothing about the model
    hit_time_limit: bool = False


async def execute_target(
    *,
    provider: ProviderClient,
    aliases: AliasRegistry,
    pricing_lookup: PricingLookup,
    target: RunTarget,
    spec: PromptSpec,
    timeout_s: float,
    emit: Emit,
    clock: Callable[[], float] = time.perf_counter,
) -> RunOutcome:
    if target.history is not None:
        spec = replace(spec, history=target.history)
    if target.prompt is not None:
        spec = replace(spec, prompt=target.prompt)
    canonical = aliases.resolve(target.model)
    slot = target.slot
    await emit(
        RunEvent(
            "start",
            {"model": target.model, "canonical_key": canonical.canonical_key, "family": canonical.family},
            slot,
        )
    )

    started = clock()
    first_token: float | None = None
    streamed = spec.modality is not Modality.IMAGE_GEN
    usage: Usage | None = None
    completion_chars = 0
    images = 0
    status = RunStatus.SUCCESS
    category: ErrorCategory | None = None
    http_status: int | None = None
    finish_reason: str | None = None
    contributable = True
    hit_time_limit = False

    try:
        async with asyncio.timeout(timeout_s):
            if spec.modality is Modality.IMAGE_GEN:
                try:
                    result = await provider.generate_image(
                        target.base_url,
                        target.api_key,
                        ImageRequest(model=target.model, prompt=spec.prompt, size=spec.image_size),
                    )
                except ProviderError as exc:
                    if exc.status_code not in IMAGE_ENDPOINT_UNSUPPORTED:
                        raise
                    # Chat models that draw (gemini-*-image, nano-banana, …) aren't served on
                    # /images/generations by most gateways — ask via chat for image output instead.
                    request = ChatRequest(
                        model=target.model,
                        messages=[{"role": "user", "content": spec.prompt}],
                        params={"modalities": ["image", "text"]},
                    )
                    async for chunk in provider.stream_chat(target.base_url, target.api_key, request):
                        if chunk.text:
                            completion_chars += len(chunk.text)
                            await emit(RunEvent("delta", {"text": chunk.text}, slot))
                        for image in chunk.images:
                            images += 1
                            await emit(RunEvent("image", {"url": image}, slot))
                        if chunk.usage is not None:
                            usage = chunk.usage
                    if images == 0:
                        raise ProviderError(ErrorCategory.SERVER) from None
                else:
                    for image in result.images:
                        images += 1
                        await emit(RunEvent("image", {"url": image}, slot))
            else:
                request = ChatRequest(model=target.model, messages=spec.to_messages(), params=spec.params)
                audio = bytearray()
                async for chunk in provider.stream_chat(target.base_url, target.api_key, request):
                    if not chunk.streamed:
                        streamed = False
                    # reasoning counts: a thinking model streams tokens long before its answer
                    if (chunk.text or chunk.reasoning or chunk.images or chunk.audio) and first_token is None:
                        first_token = clock()
                    if chunk.reasoning:
                        # billed like output; shown live so long "thinking" isn't a blank wait
                        completion_chars += len(chunk.reasoning)
                        await emit(RunEvent("reasoning", {"text": chunk.reasoning}, slot))
                    if chunk.text:
                        completion_chars += len(chunk.text)
                        await emit(RunEvent("delta", {"text": chunk.text}, slot))
                    for image in chunk.images:
                        await emit(RunEvent("image", {"url": image}, slot))
                    audio.extend(chunk.audio)
                    if chunk.usage is not None:
                        usage = chunk.usage
                    if chunk.finish_reason:
                        finish_reason = chunk.finish_reason
                if url := audio_data_url(bytes(audio)):
                    await emit(RunEvent("audio", {"url": url}, slot))
    except TimeoutError:
        status, category = RunStatus.TIMEOUT, ErrorCategory.TIMEOUT
        hit_time_limit = True
    except ProviderError as exc:
        status = RunStatus.TIMEOUT if exc.category is ErrorCategory.TIMEOUT else RunStatus.ERROR
        category = exc.category
        http_status = exc.status_code
        contributable = not exc.client_fault
    except Exception as exc:  # noqa: BLE001 — never let one model break a run; log the type only
        log.warning("run failed with unexpected %s", type(exc).__name__)
        status, category = RunStatus.ERROR, ErrorCategory.SERVER
    finished = clock()

    pricing: PricingEntry | None = None
    price_exact = True
    try:
        # Exact canonical price first; else the base model without knobs like "-low"/"-thinking".
        for key, exact in pricing_keys(target.model, aliases):
            if (pricing := await pricing_lookup(key)) is not None:
                price_exact = exact
                break
    except Exception as exc:  # noqa: BLE001 — cost is optional
        log.warning("pricing lookup failed: %s", type(exc).__name__)
        pricing = None

    metrics = compute_metrics(
        started_at=started,
        first_token_at=first_token,
        finished_at=finished,
        streamed=streamed,
        usage=usage,
        prompt_chars=spec.prompt_chars(),
        completion_chars=completion_chars,
        pricing=pricing,
        status=status,
        error_category=category,
        images=images,
    )
    if metrics.error_category is not None:
        # status + timing only (no upstream text, no key): enough to tell a proxy cut-off
        # (e.g. HTTP 524 after ~100 s of silence) from a bad model name or an outage
        log.warning(
            "run failed model=%s host=%s category=%s status=%s after=%.0fs output_chars=%d",
            target.model,
            target.provider_label,
            metrics.error_category.value,
            http_status if http_status is not None else "-",
            finished - started,
            completion_chars,
        )
        await emit(
            RunEvent(
                "error",
                {
                    "category": metrics.error_category.value,
                    "status": http_status,
                    "after_ms": round((finished - started) * 1000),
                },
                slot,
            )
        )
    payload = metrics_payload(metrics)
    payload["price_key"] = pricing.canonical_key if pricing else None
    payload["price_exact"] = price_exact if pricing else None
    # "length" = the answer was cut off by the output-token cap (not by us, not by the model)
    payload["finish_reason"] = finish_reason
    await emit(RunEvent("metrics", payload, slot))
    return RunOutcome(
        target=target, canonical=canonical, metrics=metrics, contributable=contributable, hit_time_limit=hit_time_limit
    )


def metrics_payload(m: RunMetrics) -> dict[str, Any]:
    return {
        "status": m.status.value,
        "error_category": m.error_category.value if m.error_category else None,
        "ttft_ms": m.ttft_ms,
        "ttft_supported": m.ttft_supported,
        "total_ms": m.total_ms,
        "prompt_tokens": m.prompt_tokens,
        "completion_tokens": m.completion_tokens,
        "total_tokens": m.total_tokens,
        "tokens_estimated": m.tokens_estimated,
        "throughput_tps": m.throughput_tps,
        "cost_usd": m.cost_usd,
    }


async def stream_worker(work: Callable[[Emit], Awaitable[None]]) -> AsyncIterator[RunEvent]:
    """Run `work` in its own task and yield the events it emits.

    Timeouts live inside the worker task, so they never straddle a `yield`. If
    the consumer goes away (client disconnect), the worker is cancelled.
    """
    queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()

    async def emit(event: RunEvent) -> None:
        queue.put_nowait(event)

    async def runner() -> None:
        try:
            await work(emit)
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(runner())
    try:
        while (event := await queue.get()) is not None:
            yield event
        await task  # surface unexpected worker errors
    finally:
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
