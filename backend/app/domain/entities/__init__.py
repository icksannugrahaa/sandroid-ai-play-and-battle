"""Domain entities — pure data, no I/O, no framework imports.

PRIVACY NOTE: nothing in this package may carry credentials (api keys, tokens)
or content (prompts, outputs, messages). `tests/guard` enforces this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class Modality(StrEnum):
    CHAT = "chat"
    VISION = "vision"
    IMAGE_GEN = "image_gen"


class RunMode(StrEnum):
    PLAYGROUND = "playground"
    ARENA = "arena"


class ArenaStrategy(StrEnum):
    PARALLEL = "parallel"
    SEQUENTIAL = "sequential"


class RunStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    TIMEOUT = "timeout"


class ErrorCategory(StrEnum):
    """Only the category is ever stored — never the raw upstream message."""

    AUTH = "auth"
    RATE_LIMIT = "rate_limit"
    SERVER = "server"
    NETWORK = "network"
    TIMEOUT = "timeout"


@dataclass(frozen=True, slots=True)
class CanonicalModel:
    canonical_key: str
    display_name: str
    family: str


@dataclass(frozen=True, slots=True)
class PricingQuote:
    """A raw price as published by a public source (before normalization)."""

    raw_name: str
    input_per_1m: float | None
    output_per_1m: float | None
    image_price: float | None = None
    currency: str = "USD"


@dataclass(frozen=True, slots=True)
class PricingEntry:
    canonical_key: str
    raw_name: str
    input_per_1m: float | None
    output_per_1m: float | None
    image_price: float | None
    currency: str
    source: str
    fetched_at: datetime


@dataclass(frozen=True, slots=True)
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class RunMetrics:
    ttft_ms: float | None
    ttft_supported: bool
    total_ms: float
    prompt_tokens: int
    completion_tokens: int
    tokens_estimated: bool
    throughput_tps: float | None
    cost_usd: float | None
    status: RunStatus
    error_category: ErrorCategory | None

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True, slots=True)
class RunRecord:
    """What the server persists for one run: metrics + context. No content, no identity."""

    canonical: CanonicalModel
    raw_model_name: str
    provider_label: str
    modality: Modality
    mode: RunMode
    metrics: RunMetrics
    created_at: datetime
    arena_session_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class ChallengeResult:
    """One model's checked answer to one generated challenge. Scores only — no puzzle, no answer."""

    ticket_id: str  # the run ticket it was posted with (each ticket counts once)
    canonical: CanonicalModel
    raw_model_name: str
    provider_label: str
    challenge_id: str
    difficulty: str
    seed: int
    score: int  # 0–100 from the browser's checker
    solved: bool
    moves: int | None
    timed_out: bool  # ran out of the time limit (scores 0)
    time_limit_s: int | None
    total_ms: float
    completion_tokens: int
    cost_usd: float | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class AliasCandidate:
    model_key: str
    suggested_key: str
    score: float


@dataclass(slots=True)
class SourceStatus:
    ok: bool
    entries: int = 0
    error: str | None = None


@dataclass(frozen=True, slots=True)
class ResearchLog:
    sources_status: dict[str, SourceStatus]
    entries_updated: int
    created_at: datetime
    alias_candidates: list[AliasCandidate] = field(default_factory=list)
