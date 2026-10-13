"""Read-only aggregate views: leaderboard, pricing, canonical models. Plus the Research trigger."""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.application.challenge_results import SubmittedResult
from app.application.leaderboard_query import (
    COMPOSITE_FORMULA,
    PAGE_SIZE,
    Period,
    decode_cursor,
    encode_cursor,
    period_since,
)
from app.application.research_pricing import CooldownActive, ResearchInProgress
from app.domain.entities import Modality, ResearchLog, RunMode
from app.domain.ports.repositories import (
    ChallengeBoardQuery,
    CompositeWeights,
    LeaderboardGrouping,
    LeaderboardQuery,
    LeaderboardSort,
)
from app.interfaces.deps import get_container, rate_limited
from app.interfaces.dto import (
    AliasCandidateDTO,
    CatalogModelDTO,
    CatalogResponse,
    ChallengeBoardCellDTO,
    ChallengeBoardResponse,
    ChallengeBoardRowDTO,
    ChallengeLevel,
    ChallengeResultsRequest,
    ChallengeResultsResponse,
    ErrorResponse,
    FacetsDTO,
    LeaderboardResponse,
    LeaderboardRowDTO,
    PricingEntryDTO,
    PricingResponse,
    ResearchLogDTO,
    ResearchResponse,
    SourceStatusDTO,
)

router = APIRouter(prefix="/api/v1", tags=["aggregates"])
read_limit = Depends(rate_limited(lambda c: c.limiters.read))

Weight = Annotated[float, Query(ge=0, le=10)]


def _cursor(cursor: str | None) -> int:
    try:
        return decode_cursor(cursor)
    except ValueError:
        raise HTTPException(400, detail={"error": "invalid_cursor"}) from None


@router.get(
    "/leaderboard",
    response_model=LeaderboardResponse,
    description="Aggregate rankings only. There is no endpoint that returns individual runs.",
    dependencies=[read_limit],
)
async def leaderboard(
    request: Request,
    grouping: LeaderboardGrouping = LeaderboardGrouping.EXACT,
    modality: Modality | None = None,
    family: Annotated[str | None, Query(max_length=200)] = None,
    provider: Annotated[str | None, Query(max_length=128)] = None,
    period: Period = Period.ALL,
    mode: RunMode | None = None,
    min_runs: Annotated[int, Query(ge=0, le=10_000)] = 5,
    hide_insufficient: bool = False,
    sort: LeaderboardSort = LeaderboardSort.COMPOSITE,
    order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
    w_throughput: Weight = 1.0,
    w_reliability: Weight = 1.0,
    w_latency: Weight = 1.0,
    w_cost: Weight = 1.0,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> LeaderboardResponse:
    _cursor(cursor)
    query = LeaderboardQuery(
        grouping=grouping,
        modality=modality,
        family=family or None,
        provider=provider or None,
        mode=mode,
        min_runs=min_runs,
        hide_insufficient=hide_insufficient,
        sort=sort,
        descending=order == "desc",
        weights=CompositeWeights(w_throughput, w_reliability, w_latency, w_cost),
    )
    page = await get_container(request).leaderboard.execute(query, period=period, cursor=cursor)
    return LeaderboardResponse(
        rows=[LeaderboardRowDTO.model_validate(r, from_attributes=True) for r in page.rows],
        next_cursor=page.next_cursor,
        facets=FacetsDTO.model_validate(page.facets, from_attributes=True) if page.facets else None,
        composite_formula=COMPOSITE_FORMULA,
        min_runs=min_runs,
    )


CHALLENGE_RANKING = (
    "Every model played the same generated challenge at the same level. Ranked by average score "
    "(0–100, checked automatically), then solve rate, then average time. Timeouts count as 0."
)


@router.post(
    "/challenge-results",
    response_model=ChallengeResultsResponse,
    description="Checked challenge results for runs the arena made in the last hours. Each result must carry "
    "the run's signed `ticket` (from the arena's `ticket` event); unknown, expired or reused tickets are ignored.",
    dependencies=[Depends(rate_limited(lambda c: c.limiters.run))],
)
async def submit_challenge_results(body: ChallengeResultsRequest, request: Request) -> ChallengeResultsResponse:
    stored = await get_container(request).submit_challenge_results.execute(
        [
            SubmittedResult(
                ticket=r.ticket,
                challenge_id=r.challenge_id,
                difficulty=r.difficulty,
                seed=r.seed,
                score=r.score,
                solved=r.solved,
                moves=r.moves,
                time_limit_s=r.time_limit_s,
            )
            for r in body.results
        ]
    )
    return ChallengeResultsResponse(stored=stored)


@router.get(
    "/challenge-leaderboard",
    response_model=ChallengeBoardResponse,
    description="Aggregate rankings for one challenge at one level. There is no endpoint for single results.",
    dependencies=[read_limit],
)
async def challenge_leaderboard(
    request: Request,
    challenge: Annotated[str, Query(pattern=r"^[a-z0-9_-]{1,32}$")],
    difficulty: ChallengeLevel = "hard",
    grouping: LeaderboardGrouping = LeaderboardGrouping.EXACT,
    period: Period = Period.ALL,
    min_runs: Annotated[int, Query(ge=0, le=10_000)] = 3,
    hide_insufficient: bool = False,
) -> ChallengeBoardResponse:
    c = get_container(request)
    since = period_since(period, datetime.now(UTC))
    rows = await c.challenge_results.board(
        ChallengeBoardQuery(
            challenge_id=challenge,
            difficulty=difficulty,
            grouping=grouping,
            since=since,
            min_runs=min_runs,
            hide_insufficient=hide_insufficient,
        )
    )
    cells = await c.challenge_results.cells(since)
    return ChallengeBoardResponse(
        challenge_id=challenge,
        difficulty=difficulty,
        rows=[ChallengeBoardRowDTO(rank=i + 1, **dataclasses.asdict(r)) for i, r in enumerate(rows)],
        cells=[ChallengeBoardCellDTO(**dataclasses.asdict(x)) for x in cells],
        min_runs=min_runs,
        ranking=CHALLENGE_RANKING,
    )


def _research_dto(log: ResearchLog) -> ResearchLogDTO:
    return ResearchLogDTO(
        sources_status={
            k: SourceStatusDTO(ok=v.ok, entries=v.entries, error=v.error) for k, v in log.sources_status.items()
        },
        entries_updated=log.entries_updated,
        created_at=log.created_at,
        alias_candidates=[
            AliasCandidateDTO(model_key=c.model_key, suggested_key=c.suggested_key, score=c.score)
            for c in log.alias_candidates
        ],
    )


@router.get(
    "/pricing",
    response_model=PricingResponse,
    description="Read-only price table with provenance. Prices change only via Research.",
    dependencies=[read_limit],
)
async def pricing(
    request: Request,
    search: Annotated[str | None, Query(max_length=200)] = None,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> PricingResponse:
    c = get_container(request)
    offset = _cursor(cursor)
    entries, total = await c.pricing_repo.page(offset=offset, limit=PAGE_SIZE, search=search or None)
    last = await c.pricing_repo.last_research()
    nxt = offset + len(entries)
    return PricingResponse(
        entries=[PricingEntryDTO.model_validate(e, from_attributes=True) for e in entries],
        total=total,
        next_cursor=encode_cursor(nxt) if nxt < total else None,
        cooldown_remaining_s=await c.research.cooldown_remaining(),
        last_research=_research_dto(last) if last else None,
    )


@router.post(
    "/pricing/research",
    response_model=ResearchResponse,
    description="Refresh prices from public sources (no API key used). Global cooldown: 1 hour per instance.",
    responses={409: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
    dependencies=[Depends(rate_limited(lambda c: c.limiters.research))],
)
async def research(request: Request) -> ResearchResponse:
    c = get_container(request)
    try:
        log = await c.research.execute()
    except CooldownActive as exc:
        raise HTTPException(
            429,
            detail={"error": "research_cooldown", "retry_after_s": exc.remaining_s},
            headers={"Retry-After": str(exc.remaining_s)},
        ) from None
    except ResearchInProgress:
        raise HTTPException(409, detail={"error": "research_in_progress"}) from None
    return ResearchResponse(research=_research_dto(log), cooldown_remaining_s=await c.research.cooldown_remaining())


@router.get(
    "/models",
    response_model=CatalogResponse,
    description="Canonical models (and raw aliases) seen in contributed runs.",
    dependencies=[read_limit],
)
async def models(
    request: Request,
    family: Annotated[str | None, Query(max_length=200)] = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> CatalogResponse:
    offset = _cursor(cursor)
    rows, total = await get_container(request).catalog_repo.page(
        offset=offset, limit=PAGE_SIZE, family=family or None, search=search or None
    )
    nxt = offset + len(rows)
    return CatalogResponse(
        models=[CatalogModelDTO.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        next_cursor=encode_cursor(nxt) if nxt < total else None,
    )
