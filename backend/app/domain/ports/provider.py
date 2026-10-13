"""Port: an AI provider reachable through some API dialect.

`api_key` flows through these calls as a plain argument and must never be stored,
logged, or attached to an exception by an implementation.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.domain.entities import ErrorCategory, Usage
from app.domain.services.errors import classify_status, is_client_fault


class ProviderError(Exception):
    """Sanitized upstream failure: a category and a status code, never the upstream text."""

    def __init__(self, category: ErrorCategory, status_code: int | None = None) -> None:
        super().__init__(category.value)
        self.category = category
        self.status_code = status_code

    @property
    def client_fault(self) -> bool:
        return is_client_fault(self.status_code)

    @classmethod
    def from_status(cls, status_code: int) -> ProviderError:
        return cls(classify_status(status_code), status_code)


@dataclass(frozen=True, slots=True)
class ProviderModel:
    id: str
    owned_by: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ChatRequest:
    model: str
    messages: list[dict[str, Any]]
    params: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ChatChunk:
    text: str = ""
    usage: Usage | None = None
    streamed: bool = True
    images: tuple[str, ...] = ()  # data:image/… or https URLs returned by the model
    audio: bytes = b""  # decoded audio bytes (a fragment when streaming)
    reasoning: str = ""  # visible "thinking" text of reasoning models (streamed to the UI, never stored)
    finish_reason: str | None = None  # "stop" | "length" (hit the output-token cap) | "content_filter" | …


@dataclass(frozen=True, slots=True)
class ImageRequest:
    model: str
    prompt: str
    size: str | None = None
    n: int = 1


@dataclass(frozen=True, slots=True)
class ImageResult:
    images: list[str]  # data URLs or https URLs


class ProviderClient(Protocol):
    async def list_models(self, base_url: str, api_key: str) -> list[ProviderModel]: ...

    def stream_chat(self, base_url: str, api_key: str, request: ChatRequest) -> AsyncIterator[ChatChunk]: ...

    async def generate_image(self, base_url: str, api_key: str, request: ImageRequest) -> ImageResult: ...
