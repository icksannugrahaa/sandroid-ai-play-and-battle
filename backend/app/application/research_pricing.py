"""Pricing Research: fetch public price lists, normalize, merge, persist.

Read-only for users — this is the ONLY write path for prices. Guarded by a
GLOBAL cooldown (per instance): in-memory timestamp, seeded from the last
`research_logs.created_at` after a restart.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.domain.entities import ResearchLog, SourceStatus
from app.domain.ports.pricing_source import PricingSource, PricingSourceError
from app.domain.ports.repositories import CatalogRepository, PricingRepository
from app.domain.services.normalizer import AliasRegistry
from app.domain.services.pricing_merge import (
    DEFAULT_SOURCE_PRIORITY,
    merge_pricing,
    quotes_to_entries,
    suggest_alias_candidates,
)

log = logging.getLogger(__name__)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


class CooldownActive(Exception):
    def __init__(self, remaining_s: int) -> None:
        super().__init__(f"cooldown active for {remaining_s}s")
        self.remaining_s = remaining_s


class ResearchInProgress(Exception):
    pass


class CooldownGate:
    def __init__(self, cooldown_s: int, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._cooldown = timedelta(seconds=cooldown_s)
        self._now = now
        self.last_run_at: datetime | None = None
        self.seeded = False

    def seed(self, last_run_at: datetime | None) -> None:
        if last_run_at is not None:
            last = _aware(last_run_at)
            if self.last_run_at is None or last > self.last_run_at:
                self.last_run_at = last
        self.seeded = True

    def remaining_s(self) -> int:
        if self.last_run_at is None:
            return 0
        remaining = (self.last_run_at + self._cooldown - self._now()).total_seconds()
        return max(0, int(remaining + 0.999))

    def mark(self) -> datetime:
        self.last_run_at = self._now()
        return self.last_run_at


def _source_error(exc: BaseException) -> str:
    return exc.reason if isinstance(exc, PricingSourceError) else "unexpected"


@dataclass(slots=True)
class ResearchPricing:
    sources: Sequence[PricingSource]
    pricing_repo: PricingRepository
    catalog_repo: CatalogRepository
    aliases: AliasRegistry
    gate: CooldownGate
    lock: asyncio.Lock

    async def ensure_seeded(self) -> None:
        if not self.gate.seeded:
            last = await self.pricing_repo.last_research()
            self.gate.seed(last.created_at if last else None)

    async def cooldown_remaining(self) -> int:
        await self.ensure_seeded()
        return self.gate.remaining_s()

    async def execute(self) -> ResearchLog:
        if self.lock.locked():
            raise ResearchInProgress()
        async with self.lock:
            await self.ensure_seeded()
            if (remaining := self.gate.remaining_s()) > 0:
                raise CooldownActive(remaining)
            started = self.gate.mark()  # claim the slot before any network I/O

            results = await asyncio.gather(*(s.fetch() for s in self.sources), return_exceptions=True)
            statuses: dict[str, SourceStatus] = {}
            fetched = []
            for source, result in zip(self.sources, results, strict=True):
                if isinstance(result, BaseException):
                    log.warning("pricing source %s failed: %s", source.name, type(result).__name__)
                    statuses[source.name] = SourceStatus(ok=False, error=_source_error(result))
                    continue
                entries = quotes_to_entries(result, source=source.name, fetched_at=started, aliases=self.aliases)
                statuses[source.name] = SourceStatus(ok=True, entries=len(entries))
                fetched.extend(entries)

            winners = merge_pricing(fetched, DEFAULT_SOURCE_PRIORITY)
            existing = await self.pricing_repo.get_many(list(winners))
            merged = merge_pricing([*existing.values(), *winners.values()], DEFAULT_SOURCE_PRIORITY)
            changed = [e for k, e in merged.items() if existing.get(k) != e]
            updated = await self.pricing_repo.upsert_many(changed) if changed else 0

            unpriced = await self.catalog_repo.keys_without_pricing()
            research = ResearchLog(
                sources_status=statuses,
                entries_updated=updated,
                created_at=started,
                alias_candidates=suggest_alias_candidates(unpriced, merged.keys()),
            )
            await self.pricing_repo.add_research_log(research)
            return research
