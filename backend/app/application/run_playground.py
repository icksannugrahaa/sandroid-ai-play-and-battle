from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.application.execution import (
    Emit,
    PricingLookup,
    PromptSpec,
    RunEvent,
    RunTarget,
    execute_target,
    stream_worker,
)
from app.application.record_runs import RunRecorder
from app.domain.entities import RunMode
from app.domain.ports.provider import ProviderClient
from app.domain.services.normalizer import AliasRegistry


@dataclass(slots=True)
class RunPlayground:
    provider: ProviderClient
    aliases: AliasRegistry
    pricing_lookup: PricingLookup
    recorder: RunRecorder

    def stream(
        self, target: RunTarget, spec: PromptSpec, *, timeout_s: float, contribute: bool
    ) -> AsyncIterator[RunEvent]:
        async def work(emit: Emit) -> None:
            outcome = await execute_target(
                provider=self.provider,
                aliases=self.aliases,
                pricing_lookup=self.pricing_lookup,
                target=target,
                spec=spec,
                timeout_s=timeout_s,
                emit=emit,
            )
            recorded = False
            if contribute:
                recorded, _ = await self.recorder.record([outcome], modality=spec.modality, mode=RunMode.PLAYGROUND)
            await emit(RunEvent("done", {"contributed": recorded}))

        return stream_worker(work)
