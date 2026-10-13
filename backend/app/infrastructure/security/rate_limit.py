"""In-memory abuse controls (single instance). IPs live only here, in RAM, never in DB or logs.

Multi-instance path: swap these classes for Postgres-backed ones behind the same
methods (e.g. an UNLOGGED table keyed by a salted IP hash) — no Redis required.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass(slots=True)
class _Bucket:
    tokens: float
    updated: float


class TokenBucketLimiter:
    def __init__(
        self,
        per_minute: int,
        *,
        burst: int | None = None,
        max_keys: int = 50_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.capacity = float(burst if burst is not None else per_minute)
        self.rate = per_minute / 60.0
        self._max_keys = max_keys
        self._clock = clock
        self._buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def acquire(self, key: str) -> float:
        """Consume one token. Returns 0 on success, else seconds until the next token."""
        now = self._clock()
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = _Bucket(tokens=self.capacity, updated=now)
            self._buckets[key] = bucket
        else:
            bucket.tokens = min(self.capacity, bucket.tokens + (now - bucket.updated) * self.rate)
            bucket.updated = now
            self._buckets.move_to_end(key)
        while len(self._buckets) > self._max_keys:
            self._buckets.popitem(last=False)
        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return 0.0
        return (1 - bucket.tokens) / self.rate if self.rate > 0 else 60.0


class TooManyArenas(Exception):
    pass


@dataclass(slots=True)
class _ArenaCount:
    total: int = 0
    parallel: int = 0


@dataclass(slots=True)
class ArenaGuard:
    """Max N active arenas per IP, of which at most M may be Battle-All (parallel)."""

    max_active: int = 2
    max_parallel: int = 1
    _active: dict[str, _ArenaCount] = field(default_factory=dict)

    def acquire(self, ip: str, *, parallel: bool) -> Callable[[], None]:
        """Reserve a slot or raise `TooManyArenas`. Returns an idempotent release function."""
        count = self._active.get(ip) or _ArenaCount()
        if count.total >= self.max_active or (parallel and count.parallel >= self.max_parallel):
            raise TooManyArenas()
        count.total += 1
        count.parallel += int(parallel)
        self._active[ip] = count
        released = False

        def release() -> None:
            nonlocal released
            if released:
                return
            released = True
            count.total -= 1
            count.parallel -= int(parallel)
            if count.total <= 0 and self._active.get(ip) is count:
                del self._active[ip]

        return release

    def active(self, ip: str) -> int:
        c = self._active.get(ip)
        return c.total if c else 0
