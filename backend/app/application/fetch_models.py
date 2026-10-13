"""Proxy the user's `/models` list, annotated with canonical key, family and capabilities.

Optional in-memory cache (TTL) keyed by a SHA-256 of endpoint+key — the key itself is
never kept, and nothing here ever reaches the database.
"""

from __future__ import annotations

import hashlib
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from app.domain.entities import Modality
from app.domain.ports.provider import ProviderClient
from app.domain.services.capabilities import detect_capabilities
from app.domain.services.normalizer import AliasRegistry


@dataclass(frozen=True, slots=True)
class FetchedModel:
    id: str
    display_name: str
    canonical_key: str
    family: str
    capabilities: list[Modality]
    owned_by: str | None


class TTLCache[V]:
    def __init__(self, ttl_s: float, max_items: int = 256, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_s
        self._max = max_items
        self._clock = clock
        self._items: OrderedDict[str, tuple[float, V]] = OrderedDict()

    def get(self, key: str) -> V | None:
        hit = self._items.get(key)
        if hit is None:
            return None
        expires, value = hit
        if expires < self._clock():
            del self._items[key]
            return None
        self._items.move_to_end(key)
        return value

    def set(self, key: str, value: V) -> None:
        self._items[key] = (self._clock() + self._ttl, value)
        self._items.move_to_end(key)
        while len(self._items) > self._max:
            self._items.popitem(last=False)


def cache_key(base_url: str, api_key: str) -> str:
    return hashlib.sha256(f"{base_url}\x00{api_key}".encode()).hexdigest()


@dataclass(slots=True)
class FetchModels:
    provider: ProviderClient
    aliases: AliasRegistry
    cache: TTLCache[list[FetchedModel]] | None = None

    async def execute(self, base_url: str, api_key: str) -> list[FetchedModel]:
        key = cache_key(base_url, api_key)
        if self.cache is not None and (cached := self.cache.get(key)) is not None:
            return cached

        models: list[FetchedModel] = []
        for m in await self.provider.list_models(base_url, api_key):
            try:
                canonical = self.aliases.resolve(m.id)
            except ValueError:
                continue
            models.append(
                FetchedModel(
                    id=m.id,
                    display_name=canonical.display_name,
                    canonical_key=canonical.canonical_key,
                    family=canonical.family,
                    capabilities=detect_capabilities(m.id, m.metadata),
                    owned_by=m.owned_by,
                )
            )
        models.sort(key=lambda fm: fm.id.lower())
        if self.cache is not None:
            self.cache.set(key, models)
        return models
