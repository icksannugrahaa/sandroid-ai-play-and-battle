"""SQLAlchemy async implementations of the persistence ports."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, and_, case, distinct, exists, func, literal, or_, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from app.domain.entities import (
    AliasCandidate,
    ArenaStrategy,
    ChallengeResult,
    Modality,
    PricingEntry,
    ResearchLog,
    RunRecord,
    SourceStatus,
)
from app.domain.ports.repositories import (
    CatalogModel,
    ChallengeBoardCell,
    ChallengeBoardQuery,
    ChallengeBoardRow,
    LeaderboardFacets,
    LeaderboardGrouping,
    LeaderboardQuery,
    LeaderboardRow,
)
from app.domain.services.normalizer import AliasRule, canonical_key
from app.infrastructure.persistence.orm import (
    ArenaSessionRow,
    CanonicalModelRow,
    ChallengeResultRow,
    ModelAliasRow,
    PricingEntryRow,
    ResearchLogRow,
    RunRow,
)

Sessions = async_sessionmaker[AsyncSession]


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _float(v: Any) -> float | None:
    return float(v) if v is not None else None


def _dialect(session: AsyncSession) -> str:
    return session.get_bind().dialect.name


def _insert(session: AsyncSession, table: Any) -> Any:
    return (postgresql.insert if _dialect(session) == "postgresql" else sqlite.insert)(table)


# ---------------------------------------------------------------------------- metrics
class SqlMetricsRepository:
    def __init__(self, sessions: Sessions) -> None:
        self._sessions = sessions

    async def create_arena_session(self, strategy: ArenaStrategy) -> uuid.UUID:
        session_id = uuid.uuid4()
        async with self._sessions() as s, s.begin():
            s.add(ArenaSessionRow(id=session_id, strategy=strategy.value, created_at=datetime.now(UTC)))
        return session_id

    async def record_runs(self, runs: Sequence[RunRecord]) -> None:
        async with self._sessions() as s, s.begin():
            for run in runs:
                model_id = await self._upsert_model(s, run)
                await s.execute(
                    _insert(s, ModelAliasRow)
                    .values(raw_name=run.raw_model_name[:300], canonical_key=run.canonical.canonical_key, source="auto")
                    .on_conflict_do_nothing()
                )
                m = run.metrics
                s.add(
                    RunRow(
                        canonical_model_id=model_id,
                        raw_model_name=run.raw_model_name[:300],
                        provider_label=run.provider_label,
                        modality=run.modality.value,
                        mode=run.mode.value,
                        arena_session_id=run.arena_session_id,
                        ttft_ms=m.ttft_ms,
                        total_ms=m.total_ms,
                        prompt_tokens=m.prompt_tokens,
                        completion_tokens=m.completion_tokens,
                        tokens_estimated=m.tokens_estimated,
                        throughput_tps=m.throughput_tps,
                        cost_usd=m.cost_usd,
                        status=m.status.value,
                        error_category=m.error_category.value if m.error_category else None,
                        created_at=run.created_at,
                    )
                )

    @staticmethod
    async def _upsert_model(s: AsyncSession, run: RunRecord) -> int:
        c = run.canonical
        await s.execute(
            _insert(s, CanonicalModelRow)
            .values(
                canonical_key=c.canonical_key,
                display_name=c.display_name[:200],
                family=c.family,
                supports_chat=False,
                supports_vision=False,
                supports_image_gen=False,
                first_seen=run.created_at,
            )
            .on_conflict_do_nothing(index_elements=["canonical_key"])
        )
        row = (
            await s.execute(select(CanonicalModelRow).where(CanonicalModelRow.canonical_key == c.canonical_key))
        ).scalar_one()
        if run.modality is Modality.CHAT:
            row.supports_chat = True
        elif run.modality is Modality.VISION:
            row.supports_chat = row.supports_vision = True
        elif run.modality is Modality.IMAGE_GEN:
            row.supports_image_gen = True
        return row.id


async def sync_curated_aliases(sessions: Sessions, rules: Sequence[AliasRule]) -> None:
    """Mirror `aliases.json` into `model_aliases` (source='aliases.json') for browsing."""
    rows = [
        {"raw_name": r.pattern[:300], "canonical_key": canonical_key(r.canonical), "source": "aliases.json"}
        for r in rules
    ]
    if not rows:
        return
    async with sessions() as s, s.begin():
        await s.execute(_insert(s, ModelAliasRow).values(rows).on_conflict_do_nothing())


# ---------------------------------------------------------------------------- pricing
def _pricing_entry(row: PricingEntryRow) -> PricingEntry:
    return PricingEntry(
        canonical_key=row.canonical_key,
        raw_name=row.raw_name,
        input_per_1m=row.input_per_1m,
        output_per_1m=row.output_per_1m,
        image_price=row.image_price,
        currency=row.currency,
        source=row.source,
        fetched_at=_utc(row.fetched_at) or datetime.now(UTC),
    )


class SqlPricingRepository:
    def __init__(self, sessions: Sessions) -> None:
        self._sessions = sessions

    async def get(self, canonical_key: str) -> PricingEntry | None:
        async with self._sessions() as s:
            row = (
                await s.execute(select(PricingEntryRow).where(PricingEntryRow.canonical_key == canonical_key))
            ).scalar_one_or_none()
            return _pricing_entry(row) if row else None

    async def get_many(self, canonical_keys: Sequence[str]) -> dict[str, PricingEntry]:
        out: dict[str, PricingEntry] = {}
        async with self._sessions() as s:
            for i in range(0, len(canonical_keys), 500):
                chunk = canonical_keys[i : i + 500]
                rows = (
                    await s.execute(select(PricingEntryRow).where(PricingEntryRow.canonical_key.in_(chunk)))
                ).scalars()
                out.update({r.canonical_key: _pricing_entry(r) for r in rows})
        return out

    async def upsert_many(self, entries: Sequence[PricingEntry]) -> int:
        if not entries:
            return 0
        async with self._sessions() as s, s.begin():
            for i in range(0, len(entries), 500):
                values = [
                    {
                        "canonical_key": e.canonical_key,
                        "raw_name": e.raw_name[:300],
                        "input_per_1m": e.input_per_1m,
                        "output_per_1m": e.output_per_1m,
                        "image_price": e.image_price,
                        "currency": e.currency,
                        "source": e.source,
                        "fetched_at": e.fetched_at,
                    }
                    for e in entries[i : i + 500]
                ]
                stmt = _insert(s, PricingEntryRow).values(values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["canonical_key"],
                    set_={k: stmt.excluded[k] for k in values[0] if k != "canonical_key"},
                )
                await s.execute(stmt)
        return len(entries)

    async def page(self, *, offset: int, limit: int, search: str | None) -> tuple[list[PricingEntry], int]:
        cond: ColumnElement[bool] = literal(True)
        if search:
            like = f"%{search.lower()}%"
            cond = or_(
                PricingEntryRow.canonical_key.like(f"%{_safe_key(search)}%"),
                func.lower(PricingEntryRow.raw_name).like(like),
            )
        async with self._sessions() as s:
            total = (await s.execute(select(func.count()).select_from(PricingEntryRow).where(cond))).scalar_one()
            rows = (
                await s.execute(
                    select(PricingEntryRow)
                    .where(cond)
                    .order_by(PricingEntryRow.canonical_key)
                    .offset(offset)
                    .limit(limit)
                )
            ).scalars()
            return [_pricing_entry(r) for r in rows], int(total)

    async def add_research_log(self, log: ResearchLog) -> None:
        async with self._sessions() as s, s.begin():
            s.add(
                ResearchLogRow(
                    sources_status={
                        name: {"ok": st.ok, "entries": st.entries, "error": st.error}
                        for name, st in log.sources_status.items()
                    },
                    entries_updated=log.entries_updated,
                    alias_candidates=[
                        {"model_key": c.model_key, "suggested_key": c.suggested_key, "score": c.score}
                        for c in log.alias_candidates
                    ],
                    created_at=log.created_at,
                )
            )

    async def last_research(self) -> ResearchLog | None:
        async with self._sessions() as s:
            row = (
                await s.execute(select(ResearchLogRow).order_by(ResearchLogRow.created_at.desc()).limit(1))
            ).scalar_one_or_none()
        if row is None:
            return None
        return ResearchLog(
            sources_status={
                name: SourceStatus(ok=bool(v.get("ok")), entries=int(v.get("entries") or 0), error=v.get("error"))
                for name, v in (row.sources_status or {}).items()
            },
            entries_updated=row.entries_updated,
            created_at=_utc(row.created_at) or datetime.now(UTC),
            alias_candidates=[
                AliasCandidate(model_key=c["model_key"], suggested_key=c["suggested_key"], score=float(c["score"]))
                for c in (row.alias_candidates or [])
            ],
        )


def _safe_key(search: str) -> str:
    try:
        return canonical_key(search)
    except ValueError:
        return search.lower()


# ---------------------------------------------------------------------------- catalog
class SqlCatalogRepository:
    def __init__(self, sessions: Sessions) -> None:
        self._sessions = sessions

    async def page(
        self, *, offset: int, limit: int, family: str | None, search: str | None
    ) -> tuple[list[CatalogModel], int]:
        conds: list[ColumnElement[bool]] = []
        if family:
            conds.append(CanonicalModelRow.family == family)
        if search:
            conds.append(
                or_(
                    CanonicalModelRow.canonical_key.like(f"%{_safe_key(search)}%"),
                    func.lower(CanonicalModelRow.display_name).like(f"%{search.lower()}%"),
                )
            )
        where = and_(literal(True), *conds)
        async with self._sessions() as s:
            total = (await s.execute(select(func.count()).select_from(CanonicalModelRow).where(where))).scalar_one()
            rows = list(
                (
                    await s.execute(
                        select(CanonicalModelRow)
                        .where(where)
                        .order_by(CanonicalModelRow.canonical_key)
                        .offset(offset)
                        .limit(limit)
                    )
                ).scalars()
            )
            keys = [r.canonical_key for r in rows]
            aliases: dict[str, list[str]] = {k: [] for k in keys}
            if keys:
                for raw, key in await s.execute(
                    select(ModelAliasRow.raw_name, ModelAliasRow.canonical_key)
                    .where(ModelAliasRow.canonical_key.in_(keys))
                    .order_by(ModelAliasRow.raw_name)
                ):
                    aliases[key].append(raw)
        out = []
        for r in rows:
            modalities = [
                m
                for m, flag in (
                    (Modality.CHAT, r.supports_chat),
                    (Modality.VISION, r.supports_vision),
                    (Modality.IMAGE_GEN, r.supports_image_gen),
                )
                if flag
            ]
            out.append(
                CatalogModel(
                    canonical_key=r.canonical_key,
                    display_name=r.display_name,
                    family=r.family,
                    modalities=modalities,
                    first_seen=_utc(r.first_seen) or datetime.now(UTC),
                    aliases=aliases[r.canonical_key],
                )
            )
        return out, int(total)

    async def keys_without_pricing(self) -> list[str]:
        async with self._sessions() as s:
            rows = await s.execute(
                select(CanonicalModelRow.canonical_key).where(
                    ~exists().where(PricingEntryRow.canonical_key == CanonicalModelRow.canonical_key)
                )
            )
            return [r[0] for r in rows]


# ---------------------------------------------------------------------------- leaderboard
class SqlLeaderboardRepository:
    """Aggregate-only. There is intentionally no method that returns individual runs."""

    def __init__(self, sessions: Sessions) -> None:
        self._sessions = sessions

    @staticmethod
    def build_query(q: LeaderboardQuery, dialect: str) -> Select[Any]:
        R, M = RunRow, CanonicalModelRow
        success = R.status == "success"
        ok_total = case((success, R.total_ms))
        ok_ttft = case((success, R.ttft_ms))

        def pct(expr: ColumnElement[Any], p: float) -> ColumnElement[Any]:
            if dialect == "postgresql":
                return func.percentile_cont(p).within_group(expr)
            return func.sb_percentile(expr, p)

        total = func.count(R.id)
        if q.grouping is LeaderboardGrouping.EXACT:
            key_cols: list[ColumnElement[Any]] = [
                M.canonical_key.label("key"),
                func.max(M.display_name).label("display_name"),
                M.family.label("family"),
                literal(1).label("variants"),
            ]
            group_by: list[Any] = [M.canonical_key, M.family]
        else:
            key_cols = [
                M.family.label("key"),
                M.family.label("display_name"),
                M.family.label("family"),
                func.count(distinct(M.id)).label("variants"),
            ]
            group_by = [M.family]

        agg = (
            select(
                *key_cols,
                total.label("total_runs"),
                (func.sum(case((success, 1), else_=0)) * 1.0 / total).label("success_rate"),
                func.avg(ok_total).label("avg_latency_ms"),
                pct(ok_total, 0.5).label("p50_latency_ms"),
                pct(ok_total, 0.95).label("p95_latency_ms"),
                func.avg(ok_ttft).label("avg_ttft_ms"),
                func.avg(R.throughput_tps).label("avg_throughput_tps"),
                func.avg(R.cost_usd).label("avg_cost_usd"),
                func.max(R.created_at).label("last_tested"),
            )
            .select_from(R)
            .join(M, R.canonical_model_id == M.id)
            .group_by(*group_by)
        )
        if q.modality is not None:
            agg = agg.where(R.modality == q.modality.value)
        if q.family:
            agg = agg.where(M.family == q.family)
        if q.provider:
            agg = agg.where(R.provider_label == q.provider)
        if q.since is not None:
            agg = agg.where(R.created_at >= q.since)
        if q.mode is not None:
            agg = agg.where(R.mode == q.mode.value)
        if q.hide_insufficient and q.min_runs > 0:
            agg = agg.having(total >= q.min_runs)

        sub = agg.subquery("agg")

        def norm(col: ColumnElement[Any]) -> ColumnElement[Any]:
            lo, hi = func.min(col).over(), func.max(col).over()
            return func.coalesce((col - lo) * 1.0 / func.nullif(hi - lo, 0), 0)

        w = q.weights
        composite = (
            w.throughput * norm(sub.c.avg_throughput_tps)
            + w.reliability * func.coalesce(sub.c.success_rate, 0)
            - w.latency * norm(sub.c.p50_latency_ms)
            - w.cost * norm(sub.c.avg_cost_usd)
        )
        scored = select(sub, composite.label("composite_score")).subquery("scored")
        sort_col = scored.c[q.sort.value]
        order = sort_col.desc().nulls_last() if q.descending else sort_col.asc().nulls_last()
        return (
            select(scored)
            .order_by(order, scored.c.total_runs.desc(), scored.c.key.asc())
            .offset(q.offset)
            .limit(q.limit + 1)
        )

    async def query(self, q: LeaderboardQuery) -> tuple[list[LeaderboardRow], bool]:
        async with self._sessions() as s:
            result = (await s.execute(self.build_query(q, _dialect(s)))).mappings().all()
        has_more = len(result) > q.limit
        rows = [
            LeaderboardRow(
                key=r["key"],
                display_name=r["display_name"],
                family=r["family"],
                variants=int(r["variants"]),
                total_runs=int(r["total_runs"]),
                success_rate=_float(r["success_rate"]),
                avg_latency_ms=_float(r["avg_latency_ms"]),
                p50_latency_ms=_float(r["p50_latency_ms"]),
                p95_latency_ms=_float(r["p95_latency_ms"]),
                avg_ttft_ms=_float(r["avg_ttft_ms"]),
                avg_throughput_tps=_float(r["avg_throughput_tps"]),
                avg_cost_usd=_float(r["avg_cost_usd"]),
                last_tested=_utc(_as_datetime(r["last_tested"])),
                composite_score=_float(r["composite_score"]),
                insufficient_data=int(r["total_runs"]) < q.min_runs,
            )
            for r in result[: q.limit]
        ]
        return rows, has_more

    async def facets(self) -> LeaderboardFacets:
        async with self._sessions() as s:
            modalities = (await s.execute(select(RunRow.modality).distinct().order_by(RunRow.modality))).scalars()
            families = (
                await s.execute(
                    select(CanonicalModelRow.family)
                    .distinct()
                    .join(RunRow, RunRow.canonical_model_id == CanonicalModelRow.id)
                    .order_by(CanonicalModelRow.family)
                    .limit(1000)
                )
            ).scalars()
            providers = (
                await s.execute(select(RunRow.provider_label).distinct().order_by(RunRow.provider_label).limit(1000))
            ).scalars()
            return LeaderboardFacets(modalities=list(modalities), families=list(families), providers=list(providers))


def _as_datetime(value: Any) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))  # SQLite returns aggregates of DATETIME as text


# ---------------------------------------------------------------------------- challenges
class SqlChallengeResultRepository:
    """Challenge leaderboard: aggregates per challenge × level. No method returns single results."""

    BOARD_LIMIT = 200

    def __init__(self, sessions: Sessions) -> None:
        self._sessions = sessions

    async def add(self, results: Sequence[ChallengeResult]) -> int:
        stored = 0
        async with self._sessions() as s, s.begin():
            for r in results:
                c = r.canonical
                await s.execute(
                    _insert(s, CanonicalModelRow)
                    .values(
                        canonical_key=c.canonical_key,
                        display_name=c.display_name[:200],
                        family=c.family,
                        supports_chat=True,
                        supports_vision=False,
                        supports_image_gen=False,
                        first_seen=r.created_at,
                    )
                    .on_conflict_do_nothing(index_elements=["canonical_key"])
                )
                model_id = (
                    await s.execute(
                        select(CanonicalModelRow.id).where(CanonicalModelRow.canonical_key == c.canonical_key)
                    )
                ).scalar_one()
                result = await s.execute(
                    _insert(s, ChallengeResultRow)
                    .values(
                        ticket_id=r.ticket_id[:32],
                        canonical_model_id=model_id,
                        raw_model_name=r.raw_model_name[:300],
                        provider_label=r.provider_label[:128],
                        challenge_id=r.challenge_id,
                        difficulty=r.difficulty,
                        seed=r.seed,
                        score=r.score,
                        solved=r.solved,
                        moves=r.moves,
                        timed_out=r.timed_out,
                        time_limit_s=r.time_limit_s,
                        total_ms=r.total_ms,
                        completion_tokens=r.completion_tokens,
                        cost_usd=r.cost_usd,
                        created_at=r.created_at,
                    )
                    .on_conflict_do_nothing(index_elements=["ticket_id"])
                )
                stored += max(0, getattr(result, "rowcount", 0) or 0)  # 0 when the ticket was used before
        return stored

    async def board(self, q: ChallengeBoardQuery) -> list[ChallengeBoardRow]:
        R, M = ChallengeResultRow, CanonicalModelRow
        runs = func.count(R.id)
        solve_rate = func.sum(case((R.solved, 1), else_=0)) * 1.0 / runs
        avg_score = func.avg(R.score)
        avg_time = func.avg(R.total_ms)
        if q.grouping is LeaderboardGrouping.EXACT:
            key_cols: list[ColumnElement[Any]] = [
                M.canonical_key.label("key"),
                func.max(M.display_name).label("display_name"),
                M.family.label("family"),
                literal(1).label("variants"),
            ]
            group_by: list[Any] = [M.canonical_key, M.family]
        else:
            key_cols = [
                M.family.label("key"),
                M.family.label("display_name"),
                M.family.label("family"),
                func.count(distinct(M.id)).label("variants"),
            ]
            group_by = [M.family]
        stmt = (
            select(
                *key_cols,
                runs.label("runs"),
                avg_score.label("avg_score"),
                solve_rate.label("solve_rate"),
                func.max(R.score).label("best_score"),
                func.avg(case((R.solved, R.moves))).label("avg_moves_solved"),
                avg_time.label("avg_time_ms"),
                func.avg(R.completion_tokens).label("avg_tokens"),
                func.avg(R.cost_usd).label("avg_cost_usd"),
                func.sum(case((R.timed_out, 1), else_=0)).label("timeouts"),
                func.max(R.created_at).label("last_tested"),
            )
            .select_from(R)
            .join(M, R.canonical_model_id == M.id)
            .where(R.challenge_id == q.challenge_id, R.difficulty == q.difficulty)
            .group_by(*group_by)
            # models with enough runs first (one lucky run shouldn't top the table); then the same
            # test for everyone → rank by quality, then reliability, then speed
            .order_by(case((runs >= q.min_runs, 0), else_=1), avg_score.desc(), solve_rate.desc(), avg_time.asc())
            .limit(self.BOARD_LIMIT)
        )
        if q.since is not None:
            stmt = stmt.where(R.created_at >= q.since)
        if q.hide_insufficient and q.min_runs > 0:
            stmt = stmt.having(runs >= q.min_runs)
        async with self._sessions() as s:
            rows = (await s.execute(stmt)).mappings().all()
        return [
            ChallengeBoardRow(
                key=r["key"],
                display_name=r["display_name"],
                family=r["family"],
                variants=int(r["variants"]),
                runs=int(r["runs"]),
                avg_score=float(r["avg_score"]),
                solve_rate=float(r["solve_rate"]),
                best_score=int(r["best_score"]),
                avg_moves_solved=float(r["avg_moves_solved"]) if r["avg_moves_solved"] is not None else None,
                avg_time_ms=float(r["avg_time_ms"]),
                avg_tokens=float(r["avg_tokens"]),
                avg_cost_usd=float(r["avg_cost_usd"]) if r["avg_cost_usd"] is not None else None,
                timeouts=int(r["timeouts"]),
                last_tested=_utc(r["last_tested"]) or datetime.now(UTC),
                insufficient_data=int(r["runs"]) < q.min_runs,
            )
            for r in rows
        ]

    async def cells(self, since: datetime | None) -> list[ChallengeBoardCell]:
        R = ChallengeResultRow
        stmt = (
            select(
                R.challenge_id,
                R.difficulty,
                func.count(R.id).label("runs"),
                func.count(distinct(R.canonical_model_id)).label("models"),
            )
            .group_by(R.challenge_id, R.difficulty)
            .order_by(R.challenge_id, R.difficulty)
        )
        if since is not None:
            stmt = stmt.where(R.created_at >= since)
        async with self._sessions() as s:
            rows = (await s.execute(stmt)).all()
        return [ChallengeBoardCell(challenge_id=a, difficulty=b, runs=int(n), models=int(m)) for a, b, n, m in rows]
