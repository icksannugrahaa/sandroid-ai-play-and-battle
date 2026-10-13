"""Turns run outcomes into metric records — the only thing the server keeps."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from uuid import UUID

from app.application.execution import RunOutcome
from app.domain.entities import ArenaStrategy, Modality, RunMode, RunRecord
from app.domain.ports.repositories import MetricsRepository

log = logging.getLogger(__name__)


class RunRecorder:
    def __init__(
        self,
        repo: MetricsRepository,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._repo = repo
        self._now = now

    async def record(
        self,
        outcomes: Sequence[RunOutcome],
        *,
        modality: Modality,
        mode: RunMode,
        strategy: ArenaStrategy | None = None,
    ) -> tuple[bool, UUID | None]:
        """Persist contributable outcomes → (recorded?, arena_session_id).

        Failures are logged, never raised to the user.
        """
        eligible = [o for o in outcomes if o.contributable]
        if not eligible:
            return False, None
        try:
            session_id = (
                await self._repo.create_arena_session(strategy)
                if mode is RunMode.ARENA and strategy is not None
                else None
            )
            created = self._now()
            await self._repo.record_runs(
                [
                    RunRecord(
                        canonical=o.canonical,
                        raw_model_name=o.target.model,
                        provider_label=o.target.provider_label,
                        modality=modality,
                        mode=mode,
                        metrics=o.metrics,
                        created_at=created,
                        arena_session_id=session_id,
                    )
                    for o in eligible
                ]
            )
            return True, session_id
        except Exception as exc:  # noqa: BLE001 — leaderboard is best-effort
            log.warning("could not record runs: %s", type(exc).__name__)
            return False, None
