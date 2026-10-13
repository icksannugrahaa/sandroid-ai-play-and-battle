from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi.responses import StreamingResponse

from app.application.execution import RunEvent

SSE_HEADERS = {
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",  # disable Nginx buffering so tokens arrive live
    "Connection": "keep-alive",
}


def format_event(event: RunEvent) -> str:
    payload = dict(event.data)
    if event.slot is not None:
        payload["slot"] = event.slot
    return f"event: {event.type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


async def _encode(events: AsyncIterator[RunEvent]) -> AsyncIterator[str]:
    yield ": stream-open\n\n"
    async for event in events:
        yield format_event(event)


def sse_response(events: AsyncIterator[RunEvent]) -> StreamingResponse:
    return StreamingResponse(_encode(events), media_type="text/event-stream", headers=SSE_HEADERS)
