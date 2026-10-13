"""Composition root: wires ports to adapters. The only module that knows every layer."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.application.challenge_results import SubmitChallengeResults
from app.application.fetch_models import FetchedModel, FetchModels, TTLCache
from app.application.leaderboard_query import LeaderboardQueryUseCase
from app.application.record_runs import RunRecorder
from app.application.research_pricing import CooldownGate, ResearchPricing
from app.application.run_arena import RunArena, build_strategies
from app.application.run_playground import RunPlayground
from app.config import Settings
from app.domain.entities import PricingEntry
from app.domain.ports.pricing_source import PricingSource
from app.domain.ports.provider import ProviderClient
from app.domain.services.normalizer import AliasRegistry, AliasRule
from app.infrastructure.persistence.db import create_engine, create_sessionmaker
from app.infrastructure.persistence.repositories import (
    SqlCatalogRepository,
    SqlChallengeResultRepository,
    SqlLeaderboardRepository,
    SqlMetricsRepository,
    SqlPricingRepository,
)
from app.infrastructure.pricing.sources import HeliconeSource, LiteLLMSource, OpenRouterSource
from app.infrastructure.providers.openai_compatible import OpenAICompatibleClient
from app.infrastructure.security.rate_limit import ArenaGuard, TokenBucketLimiter
from app.infrastructure.security.ssrf import GuardedTransport
from app.infrastructure.security.tickets import TicketSigner

log = logging.getLogger(__name__)


def load_alias_rules(path: Path) -> list[AliasRule]:
    if not path.exists():
        log.info("no aliases file at %s — using normalizer only", path.name)
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    registry_rules = data.get("aliases", [])
    AliasRegistry.from_mapping(data)  # validate early, fail fast on a bad PR
    return [
        AliasRule(pattern=str(r["pattern"]), canonical=str(r["canonical"]), regex=bool(r.get("regex", False)))
        for r in registry_rules
    ]


@dataclass
class Limiters:
    read: TokenBucketLimiter
    run: TokenBucketLimiter
    arena: TokenBucketLimiter
    research: TokenBucketLimiter


@dataclass
class Container:
    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    provider_http: httpx.AsyncClient
    public_http: httpx.AsyncClient
    alias_rules: list[AliasRule]
    aliases: AliasRegistry
    provider: ProviderClient
    pricing_repo: SqlPricingRepository
    catalog_repo: SqlCatalogRepository
    fetch_models: FetchModels
    playground: RunPlayground
    arena: RunArena
    research: ResearchPricing
    leaderboard: LeaderboardQueryUseCase
    challenge_results: SqlChallengeResultRepository
    submit_challenge_results: SubmitChallengeResults
    limiters: Limiters
    arena_guard: ArenaGuard

    async def aclose(self) -> None:
        await self.provider_http.aclose()
        await self.public_http.aclose()
        await self.engine.dispose()


def build_container(
    settings: Settings,
    *,
    provider: ProviderClient | None = None,
    pricing_sources: list[PricingSource] | None = None,
    engine: AsyncEngine | None = None,
) -> Container:
    engine = engine or create_engine(settings.database_url)
    sessions = create_sessionmaker(engine)

    # Provider traffic: SSRF-guarded transport, no redirects, no proxy env.
    provider_http = httpx.AsyncClient(
        transport=GuardedTransport(allow_private=settings.ssrf_allow_private),
        follow_redirects=False,
        trust_env=False,
    )
    # Fixed public pricing URLs only.
    public_http = httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": "sandroid-ai-play-and-battle"})

    alias_rules = load_alias_rules(settings.aliases_path)
    aliases = AliasRegistry(alias_rules)
    provider = provider or OpenAICompatibleClient(
        provider_http,
        allow_private=settings.ssrf_allow_private,
        allow_http=settings.ssrf_allow_http,
        max_response_bytes=settings.max_upstream_response_bytes,
        connect_timeout_s=settings.upstream_connect_timeout_s,
    )

    metrics_repo = SqlMetricsRepository(sessions)
    pricing_repo = SqlPricingRepository(sessions)
    catalog_repo = SqlCatalogRepository(sessions)
    recorder = RunRecorder(metrics_repo)
    tickets = TicketSigner()
    challenge_results = SqlChallengeResultRepository(sessions)

    async def pricing_lookup(key: str) -> PricingEntry | None:
        return await pricing_repo.get(key)

    sources: list[PricingSource] = (
        pricing_sources
        if pricing_sources is not None
        else [
            OpenRouterSource(public_http, settings.pricing_openrouter_url),
            LiteLLMSource(public_http, settings.pricing_litellm_url),
            HeliconeSource(public_http, settings.pricing_helicone_url),
        ]
    )

    return Container(
        settings=settings,
        engine=engine,
        sessions=sessions,
        provider_http=provider_http,
        public_http=public_http,
        alias_rules=alias_rules,
        aliases=aliases,
        provider=provider,
        pricing_repo=pricing_repo,
        catalog_repo=catalog_repo,
        fetch_models=FetchModels(
            provider=provider,
            aliases=aliases,
            cache=TTLCache[list[FetchedModel]](settings.model_list_cache_ttl_s),
        ),
        playground=RunPlayground(provider, aliases, pricing_lookup, recorder),
        arena=RunArena(
            provider,
            aliases,
            pricing_lookup,
            recorder,
            build_strategies(settings.arena_parallel_concurrency),
            tickets=tickets,
        ),
        challenge_results=challenge_results,
        submit_challenge_results=SubmitChallengeResults(challenge_results, tickets),
        research=ResearchPricing(
            sources=sources,
            pricing_repo=pricing_repo,
            catalog_repo=catalog_repo,
            aliases=aliases,
            gate=CooldownGate(settings.research_cooldown_seconds),
            lock=asyncio.Lock(),
        ),
        leaderboard=LeaderboardQueryUseCase(SqlLeaderboardRepository(sessions)),
        limiters=Limiters(
            read=TokenBucketLimiter(settings.rate_limit_read_per_min),
            run=TokenBucketLimiter(settings.rate_limit_run_per_min),
            arena=TokenBucketLimiter(settings.rate_limit_arena_per_min),
            research=TokenBucketLimiter(settings.rate_limit_research_per_min),
        ),
        arena_guard=ArenaGuard(
            max_active=settings.arena_max_active_per_ip, max_parallel=settings.arena_max_parallel_per_ip
        ),
    )
