"""Arena: one prompt, 2–4 models, pluggable execution strategy."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from app.application.execution import (
    Emit,
    PricingLookup,
    PromptSpec,
    RunEvent,
    RunOutcome,
    RunTarget,
    execute_target,
    stream_worker,
)
from app.application.record_runs import RunRecorder
from app.domain.entities import ArenaStrategy, Modality, RunMode, RunStatus
from app.domain.ports.provider import ProviderClient
from app.domain.services.normalizer import AliasRegistry

MIN_ARENA_MODELS = 1  # challenge follow-ups may continue with one model; the UI requires 2 to start
MAX_ARENA_MODELS = 4

RunOne = Callable[[RunTarget], Awaitable[RunOutcome]]


class TicketIssuer(Protocol):
    """Signs what the server saw of a run (see infrastructure/security/tickets.py)."""

    def issue(self, claims: dict[str, Any]) -> str: ...


class ArenaValidationError(ValueError):
    pass


class StrategyRunner(Protocol):
    async def run(self, targets: Sequence[RunTarget], run_one: RunOne) -> list[RunOutcome]: ...


class ParallelStrategy:
    """Battle-All: every model at once — wall-clock comparison."""

    def __init__(self, concurrency: int = MAX_ARENA_MODELS) -> None:
        self._concurrency = concurrency

    async def run(self, targets: Sequence[RunTarget], run_one: RunOne) -> list[RunOutcome]:
        semaphore = asyncio.Semaphore(self._concurrency)

        async def guarded(target: RunTarget) -> RunOutcome:
            async with semaphore:
                return await run_one(target)

        return list(await asyncio.gather(*(guarded(t) for t in targets)))


class SequentialStrategy:
    """One after another, in pick order — purer latency, kinder to rate limits."""

    async def run(self, targets: Sequence[RunTarget], run_one: RunOne) -> list[RunOutcome]:
        return [await run_one(t) for t in targets]


def build_strategies(parallel_concurrency: int = MAX_ARENA_MODELS) -> dict[ArenaStrategy, StrategyRunner]:
    return {
        ArenaStrategy.PARALLEL: ParallelStrategy(parallel_concurrency),
        ArenaStrategy.SEQUENTIAL: SequentialStrategy(),
    }


def validate_arena(targets: Sequence[RunTarget]) -> None:
    if not MIN_ARENA_MODELS <= len(targets) <= MAX_ARENA_MODELS:
        raise ArenaValidationError(f"arena needs {MIN_ARENA_MODELS}-{MAX_ARENA_MODELS} models")


@dataclass(slots=True)
class RunArena:
    provider: ProviderClient
    aliases: AliasRegistry
    pricing_lookup: PricingLookup
    recorder: RunRecorder
    strategies: dict[ArenaStrategy, StrategyRunner]
    tickets: TicketIssuer | None = None

    def stream(
        self,
        targets: Sequence[RunTarget],
        spec: PromptSpec,
        *,
        strategy: ArenaStrategy,
        timeout_s: float,
        contribute: bool,
    ) -> AsyncIterator[RunEvent]:
        validate_arena(targets)
        slotted = [
            RunTarget(base_url=t.base_url, model=t.model, api_key=t.api_key, slot=i, history=t.history, prompt=t.prompt)
            for i, t in enumerate(targets)
        ]
        runner = self.strategies[strategy]

        async def work(emit: Emit) -> None:
            async def run_one(target: RunTarget) -> RunOutcome:
                outcome = await execute_target(
                    provider=self.provider,
                    aliases=self.aliases,
                    pricing_lookup=self.pricing_lookup,
                    target=target,
                    spec=spec,
                    timeout_s=timeout_s,
                    emit=emit,
                )
                if contribute and (ticket := self._ticket(outcome, spec)):
                    await emit(RunEvent("ticket", {"ticket": ticket}, target.slot))
                return outcome

            outcomes = await runner.run(slotted, run_one)
            recorded = False
            if contribute:
                recorded, _ = await self.recorder.record(
                    outcomes, modality=spec.modality, mode=RunMode.ARENA, strategy=strategy
                )
            costs = [o.metrics.cost_usd for o in outcomes if o.metrics.cost_usd is not None]
            await emit(
                RunEvent(
                    "done",
                    {
                        "strategy": strategy.value,
                        "contributed": recorded,
                        "total_cost_usd": round(sum(costs), 10) if costs else None,
                    },
                )
            )

        return stream_worker(work)

    def _ticket(self, outcome: RunOutcome, spec: PromptSpec) -> str | None:
        """A signed ticket for the challenge leaderboard — only for runs that say something about
        the model: it answered, or it ran out of the time it was given. Gateway errors don't count."""
        m = outcome.metrics
        answered = m.status is RunStatus.SUCCESS
        if self.tickets is None or spec.modality is not Modality.CHAT or not (answered or outcome.hit_time_limit):
            return None
        c = outcome.canonical
        return self.tickets.issue(
            {
                "k": c.canonical_key,
                "n": c.display_name,
                "f": c.family,
                "m": outcome.target.model[:300],
                "p": outcome.target.provider_label,
                "ms": m.total_ms,
                "ct": m.completion_tokens,
                "c": m.cost_usd,
                "ok": answered,
            }
        )
