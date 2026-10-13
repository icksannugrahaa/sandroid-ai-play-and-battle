from __future__ import annotations

import math
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine


class _SqlitePercentile:
    """`sb_percentile(x, q)` — linear-interpolated percentile (same as Postgres percentile_cont).

    Postgres uses the native ordered-set aggregate; SQLite (tests/local) gets this.
    """

    def __init__(self) -> None:
        self.values: list[float] = []
        self.q = 0.5

    def step(self, value: Any, q: float) -> None:
        self.q = q
        if value is not None:
            self.values.append(float(value))

    def finalize(self) -> float | None:
        if not self.values:
            return None
        data = sorted(self.values)
        pos = (len(data) - 1) * self.q
        lo, hi = math.floor(pos), math.ceil(pos)
        return data[lo] + (data[hi] - data[lo]) * (pos - lo)


def create_engine(database_url: str, *, echo: bool = False) -> AsyncEngine:
    kwargs: dict[str, Any] = {"echo": echo, "pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        kwargs.pop("pool_pre_ping")
    engine = create_async_engine(database_url, **kwargs)
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine.sync_engine, "connect")
        def _register(dbapi_conn: Any, _record: Any) -> None:
            # aiosqlite owns the sqlite3 connection on its own thread; register there.
            dbapi_conn.run_async(
                lambda conn: conn._execute(conn._conn.create_aggregate, "sb_percentile", 2, _SqlitePercentile)
            )
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[Any]:
    return async_sessionmaker(engine, expire_on_commit=False)
