"""Persistence ports. Implementations store aggregates-to-be — never content or credentials."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from app.domain.entities import (
    ArenaStrategy,
    ChallengeResult,
    Modality,
    PricingEntry,
    ResearchLog,
    RunMode,
    RunRecord,
)


class MetricsRepository(Protocol):
    async def create_arena_session(self, strategy: ArenaStrategy) -> UUID: ...

    async def record_runs(self, runs: Sequence[RunRecord]) -> None: ...


class PricingRepository(Protocol):
    async def get(self, canonical_key: str) -> PricingEntry | None: ...

    async def get_many(self, canonical_keys: Sequence[str]) -> dict[str, PricingEntry]: ...

    async def upsert_many(self, entries: Sequence[PricingEntry]) -> int: ...

    async def page(self, *, offset: int, limit: int, search: str | None) -> tuple[list[PricingEntry], int]: ...

    async def add_research_log(self, log: ResearchLog) -> None: ...

    async def last_research(self) -> ResearchLog | None: ...


@dataclass(frozen=True, slots=True)
class CatalogModel:
    canonical_key: str
    display_name: str
    family: str
    modalities: list[Modality]
    first_seen: datetime
    aliases: list[str]


class CatalogRepository(Protocol):
    async def page(
        self, *, offset: int, limit: int, family: str | None, search: str | None
    ) -> tuple[list[CatalogModel], int]: ...

    async def keys_without_pricing(self) -> list[str]: ...


class LeaderboardGrouping(StrEnum):
    EXACT = "exact"
    FAMILY = "family"


class LeaderboardSort(StrEnum):
    AVG_LATENCY = "avg_latency_ms"
    P50_LATENCY = "p50_latency_ms"
    P95_LATENCY = "p95_latency_ms"
    AVG_TTFT = "avg_ttft_ms"
    AVG_THROUGHPUT = "avg_throughput_tps"
    AVG_COST = "avg_cost_usd"
    SUCCESS_RATE = "success_rate"
    TOTAL_RUNS = "total_runs"
    LAST_TESTED = "last_tested"
    COMPOSITE = "composite_score"


@dataclass(frozen=True, slots=True)
class CompositeWeights:
    throughput: float = 1.0
    reliability: float = 1.0
    latency: float = 1.0
    cost: float = 1.0


@dataclass(frozen=True, slots=True)
class LeaderboardQuery:
    grouping: LeaderboardGrouping = LeaderboardGrouping.EXACT
    modality: Modality | None = None
    family: str | None = None
    provider: str | None = None
    since: datetime | None = None
    mode: RunMode | None = None
    min_runs: int = 5
    hide_insufficient: bool = False
    sort: LeaderboardSort = LeaderboardSort.COMPOSITE
    descending: bool = True
    weights: CompositeWeights = field(default_factory=CompositeWeights)
    offset: int = 0
    limit: int = 25


@dataclass(frozen=True, slots=True)
class LeaderboardRow:
    key: str
    display_name: str
    family: str
    variants: int
    total_runs: int
    success_rate: float | None
    avg_latency_ms: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    avg_ttft_ms: float | None
    avg_throughput_tps: float | None
    avg_cost_usd: float | None
    last_tested: datetime | None
    composite_score: float | None
    insufficient_data: bool


@dataclass(frozen=True, slots=True)
class LeaderboardFacets:
    modalities: list[str]
    families: list[str]
    providers: list[str]


class LeaderboardRepository(Protocol):
    async def query(self, q: LeaderboardQuery) -> tuple[list[LeaderboardRow], bool]: ...

    async def facets(self) -> LeaderboardFacets: ...


@dataclass(frozen=True, slots=True)
class ChallengeBoardQuery:
    challenge_id: str
    difficulty: str
    grouping: LeaderboardGrouping = LeaderboardGrouping.EXACT
    since: datetime | None = None
    min_runs: int = 3
    hide_insufficient: bool = False


@dataclass(frozen=True, slots=True)
class ChallengeBoardRow:
    """A model's standing on one challenge at one level (ranked by avg score, solve rate, time)."""

    key: str
    display_name: str
    family: str
    variants: int
    runs: int
    avg_score: float
    solve_rate: float
    best_score: int
    avg_moves_solved: float | None
    avg_time_ms: float
    avg_tokens: float
    avg_cost_usd: float | None
    timeouts: int
    last_tested: datetime
    insufficient_data: bool


@dataclass(frozen=True, slots=True)
class ChallengeBoardCell:
    """How much data exists for one challenge × level (drives the page's picker)."""

    challenge_id: str
    difficulty: str
    runs: int
    models: int


class ChallengeResultRepository(Protocol):
    async def add(self, results: Sequence[ChallengeResult]) -> int:
        """Store new results; a ticket already used is skipped. Returns how many were stored."""
        ...

    async def board(self, q: ChallengeBoardQuery) -> list[ChallengeBoardRow]: ...

    async def cells(self, since: datetime | None) -> list[ChallengeBoardCell]: ...
