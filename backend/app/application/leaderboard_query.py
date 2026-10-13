"""Leaderboard = global history, as aggregate rankings only. No run-by-run access exists."""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from app.domain.ports.repositories import (
    LeaderboardFacets,
    LeaderboardQuery,
    LeaderboardRepository,
    LeaderboardRow,
)

PAGE_SIZE = 25

COMPOSITE_FORMULA = (
    "score = w_throughput·norm(avg_throughput) + w_reliability·success_rate "
    "− w_latency·norm(p50_latency) − w_cost·norm(avg_cost); "
    "norm(x) = (x − min) / (max − min) over the filtered set; missing values count as 0"
)


class Period(StrEnum):
    D7 = "7d"
    D30 = "30d"
    ALL = "all"


def period_since(period: Period, now: datetime) -> datetime | None:
    return {Period.D7: now - timedelta(days=7), Period.D30: now - timedelta(days=30)}.get(period)


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(json.dumps({"o": offset}).encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        offset = int(json.loads(base64.urlsafe_b64decode(padded))["o"])
    except (binascii.Error, ValueError, KeyError, TypeError) as exc:
        raise ValueError("invalid cursor") from exc
    if offset < 0:
        raise ValueError("invalid cursor")
    return offset


@dataclass(frozen=True, slots=True)
class LeaderboardPage:
    rows: list[LeaderboardRow]
    next_cursor: str | None
    facets: LeaderboardFacets | None


@dataclass(slots=True)
class LeaderboardQueryUseCase:
    repo: LeaderboardRepository
    now: Callable[[], datetime] = lambda: datetime.now(UTC)

    async def execute(self, query: LeaderboardQuery, *, period: Period, cursor: str | None) -> LeaderboardPage:
        offset = decode_cursor(cursor)
        q = replace(query, since=period_since(period, self.now()), offset=offset, limit=PAGE_SIZE)
        rows, has_more = await self.repo.query(q)
        return LeaderboardPage(
            rows=rows,
            next_cursor=encode_cursor(offset + len(rows)) if has_more else None,
            facets=await self.repo.facets() if offset == 0 else None,
        )
