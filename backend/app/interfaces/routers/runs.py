"""Model list proxy, Playground and Arena. Every call is billed to the caller's own API key."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.application.execution import PromptSpec, RunEvent, RunTarget
from app.domain.entities import ArenaStrategy, Modality
from app.infrastructure.security.rate_limit import TooManyArenas
from app.infrastructure.security.ssrf import validate_base_url
from app.interfaces.deps import api_key, get_container, rate_limited, request_ip, slot_api_keys
from app.interfaces.dto import (
    ArenaRunRequest,
    ErrorResponse,
    FetchedModelDTO,
    FetchModelsRequest,
    FetchModelsResponse,
    PlaygroundRunRequest,
    PromptConfig,
)
from app.interfaces.sse import sse_response

router = APIRouter(prefix="/api/v1", tags=["runs"])

KEY_HEADER_DOC = (
    "Provider API key goes in the `X-Api-Key` header (arena: `X-Api-Key-0`..`X-Api-Key-3`). "
    "It is used for this request only and never stored or logged."
)


async def _checked_url(request: Request, base_url: str) -> str:
    s = get_container(request).settings
    return await validate_base_url(base_url, allow_private=s.ssrf_allow_private, allow_http=s.ssrf_allow_http)


def _spec(config: PromptConfig) -> PromptSpec:
    if config.images and config.modality is not Modality.VISION:
        raise HTTPException(422, detail={"error": "validation_error", "detail": "images require modality=vision"})
    if config.attachments and config.modality is Modality.IMAGE_GEN:
        raise HTTPException(
            422, detail={"error": "validation_error", "detail": "attachments are not supported for image_gen"}
        )
    return PromptSpec(
        modality=config.modality,
        prompt=config.prompt,
        system=config.system,
        history=tuple((m.role, m.content) for m in config.history),
        images=tuple(config.images),
        attachments=tuple((a.kind, a.name, a.data_url) for a in config.attachments),
        params=config.params.to_payload(),
        image_size=config.image_size,
    )


@router.post(
    "/models/fetch",
    response_model=FetchModelsResponse,
    description="Proxy `GET {base_url}/models` with the caller's key. " + KEY_HEADER_DOC,
    responses={400: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
    dependencies=[Depends(rate_limited(lambda c: c.limiters.run))],
)
async def fetch_models(body: FetchModelsRequest, request: Request) -> JSONResponse:
    url = await _checked_url(request, body.base_url)
    models = await get_container(request).fetch_models.execute(url, api_key(request))
    payload = FetchModelsResponse(
        models=[
            FetchedModelDTO(
                id=m.id,
                display_name=m.display_name,
                canonical_key=m.canonical_key,
                family=m.family,
                capabilities=m.capabilities,
                owned_by=m.owned_by,
            )
            for m in models
        ]
    )
    return JSONResponse(payload.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post(
    "/playground/run",
    description="Run one model; Server-Sent Events stream (start, delta|image, error?, metrics, done). "
    + KEY_HEADER_DOC,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}, 400: {"model": ErrorResponse}},
    dependencies=[Depends(rate_limited(lambda c: c.limiters.run))],
)
async def playground_run(body: PlaygroundRunRequest, request: Request) -> StreamingResponse:
    url = await _checked_url(request, body.base_url)
    spec = _spec(body.config)
    target = RunTarget(base_url=url, model=body.model, api_key=api_key(request))
    events = get_container(request).playground.stream(
        target, spec, timeout_s=body.timeout_s, contribute=body.contribute
    )
    return sse_response(events)


class _ReleasingStream:
    """Async iterator that releases its arena slot when exhausted, closed, or garbage-collected.

    A plain generator's `finally` never runs if the response is cancelled before the
    first iteration — which would leak the per-IP slot.
    """

    def __init__(self, events: AsyncIterator[RunEvent], release: Callable[[], None]) -> None:
        self._events = events
        self._release = release

    def __aiter__(self) -> _ReleasingStream:
        return self

    async def __anext__(self) -> RunEvent:
        try:
            return await anext(self._events)
        except BaseException:
            self._release()
            raise

    async def aclose(self) -> None:
        self._release()
        aclose = getattr(self._events, "aclose", None)
        if aclose is not None:
            await aclose()

    def __del__(self) -> None:
        self._release()


@router.post(
    "/arena/run",
    description="Run 2–4 models on one prompt (`parallel` = Battle-All, or `sequential`). "
    "SSE stream; every event carries `slot`. Billed ×N — one call per model. " + KEY_HEADER_DOC,
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}, 429: {"model": ErrorResponse}},
    dependencies=[Depends(rate_limited(lambda c: c.limiters.arena))],
)
async def arena_run(body: ArenaRunRequest, request: Request) -> StreamingResponse:
    keys = slot_api_keys(request)
    targets = [
        RunTarget(
            base_url=await _checked_url(request, slot.base_url),
            model=slot.model,
            api_key=keys[i],
            history=None if slot.history is None else tuple((m.role, m.content) for m in slot.history),
            prompt=slot.prompt,
        )
        for i, slot in enumerate(body.slots)
    ]
    spec = _spec(body.config)
    container = get_container(request)
    try:
        release = container.arena_guard.acquire(request_ip(request), parallel=body.strategy is ArenaStrategy.PARALLEL)
    except TooManyArenas:
        raise HTTPException(
            429, detail={"error": "too_many_active_arenas", "retry_after_s": 5}, headers={"Retry-After": "5"}
        ) from None
    try:
        events = container.arena.stream(
            targets, spec, strategy=body.strategy, timeout_s=body.timeout_s, contribute=body.contribute
        )
    except BaseException:
        release()
        raise
    return sse_response(_ReleasingStream(events, release))
