from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.container import Container, build_container
from app.domain.entities import PricingQuote, Usage
from app.domain.ports.provider import ChatChunk, ChatRequest, ImageRequest, ImageResult, ProviderError, ProviderModel
from app.infrastructure.persistence.db import create_engine
from app.infrastructure.persistence.orm import Base
from app.main import create_app

SECRET_KEY = "sk-secret-never-store-0123456789abcdef"


class FakeProvider:
    """Behaviour by model name: ok-*, slow, fail-auth, fail-server, nousage."""

    def __init__(self) -> None:
        self.seen_keys: list[str] = []
        self.seen_messages: dict[str, list[dict[str, Any]]] = {}

    async def list_models(self, base_url: str, api_key: str) -> list[ProviderModel]:
        self.seen_keys.append(api_key)
        if api_key == "bad":
            raise ProviderError.from_status(401)
        return [ProviderModel(id="vendor/Qwen3.8-Max"), ProviderModel(id="dall-e-3")]

    async def stream_chat(self, base_url: str, api_key: str, request: ChatRequest) -> AsyncIterator[ChatChunk]:
        self.seen_keys.append(api_key)
        self.seen_messages[request.model] = request.messages
        model = request.model
        if model == "fail-auth":
            raise ProviderError.from_status(401)
        if model == "fail-server":
            raise ProviderError.from_status(503)
        if model == "slow":
            await asyncio.sleep(10)
        if "image-chat" in model:
            assert request.params.get("modalities") == ["image", "text"]
            yield ChatChunk(text="Here you go")
            yield ChatChunk(images=("data:image/png;base64,QkJC",))
            return
        if model == "media":
            yield ChatChunk(images=("data:image/png;base64,AAAA",))
            yield ChatChunk(audio=b"\x01\x00\x02\x00")
        await asyncio.sleep(0.01)
        yield ChatChunk(text="Hello ")
        await asyncio.sleep(0.01)
        yield ChatChunk(text="world")
        if model != "nousage":
            yield ChatChunk(usage=Usage(prompt_tokens=10, completion_tokens=20))

    async def generate_image(self, base_url: str, api_key: str, request: ImageRequest) -> ImageResult:
        if "image-chat" in request.model:  # like gemini-*-image on most gateways
            raise ProviderError.from_status(404)
        return ImageResult(images=["data:image/png;base64,AAAA"])


class FakeSource:
    def __init__(self, name: str, quotes: list[PricingQuote] | None = None, fail: bool = False) -> None:
        self.name = name
        self.quotes = quotes or []
        self.fail = fail
        self.calls = 0

    async def fetch(self) -> list[PricingQuote]:
        self.calls += 1
        if self.fail:
            from app.domain.ports.pricing_source import PricingSourceError

            raise PricingSourceError("network")
        return self.quotes


@pytest.fixture
def aliases_file(tmp_path: Path) -> Path:
    path = tmp_path / "aliases.json"
    path.write_text(json.dumps({"aliases": [{"pattern": "qwen-3.8-maximum", "canonical": "qwen38max"}]}))
    return path


@pytest.fixture
def settings(tmp_path: Path, aliases_file: Path) -> Settings:
    return Settings(
        _env_file=None,
        # CI sets TEST_DATABASE_URL to a real Postgres; locally SQLite is enough.
        database_url=os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        ssrf_allow_private=True,
        aliases_path=aliases_file,
        frontend_dist=tmp_path / "no-dist",
        rate_limit_read_per_min=10_000,
        rate_limit_run_per_min=10_000,
        rate_limit_arena_per_min=10_000,
        rate_limit_research_per_min=10_000,
        max_body_bytes=200_000,
    )


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def sources() -> list[FakeSource]:
    return [
        FakeSource("openrouter", [PricingQuote("vendor/qwen3.8-max", 1.0, 2.0)]),
        FakeSource("litellm", [PricingQuote("qwen3.8-max", 9.0, 9.0), PricingQuote("ok-model", 1.0, 1.0)]),
        FakeSource("helicone", fail=True),
    ]


@pytest.fixture
async def container(settings: Settings, provider: FakeProvider, sources: list[FakeSource]) -> AsyncIterator[Container]:
    engine = create_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)  # clean slate (matters on a shared Postgres)
        await conn.run_sync(Base.metadata.create_all)
    c = build_container(settings, provider=provider, pricing_sources=sources, engine=engine)  # type: ignore[arg-type]
    yield c


@pytest.fixture
async def client(settings: Settings, container: Container) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, container_factory=lambda _s: container)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 5555))
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            yield http


def parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.splitlines()
        etype = next((line[7:] for line in lines if line.startswith("event: ")), None)
        data = next((line[6:] for line in lines if line.startswith("data: ")), None)
        if etype and data:
            events.append((etype, json.loads(data)))
    return events
