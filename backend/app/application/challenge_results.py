"""Challenge leaderboard: accept checked results for real runs, rank models per challenge × level."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from app.domain.entities import CanonicalModel, ChallengeResult
from app.domain.ports.repositories import ChallengeResultRepository


class TicketVerifier(Protocol):
    def verify(self, ticket: str) -> dict[str, Any] | None: ...


@dataclass(frozen=True, slots=True)
class SubmittedResult:
    ticket: str
    challenge_id: str
    difficulty: str
    seed: int
    score: int
    solved: bool
    moves: int | None
    time_limit_s: int | None


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


@dataclass(slots=True)
class SubmitChallengeResults:
    repo: ChallengeResultRepository
    tickets: TicketVerifier
    now: Callable[[], datetime] = lambda: datetime.now(UTC)

    async def execute(self, submitted: Sequence[SubmittedResult]) -> int:
        """Store the results whose ticket is genuine; returns how many were stored."""
        results: list[ChallengeResult] = []
        created = self.now()
        for item in submitted:
            claims = self.tickets.verify(item.ticket)
            if claims is None or not isinstance(claims.get("id"), str) or not isinstance(claims.get("k"), str):
                continue
            answered = claims.get("ok") is True
            results.append(
                ChallengeResult(
                    ticket_id=claims["id"],
                    canonical=CanonicalModel(
                        canonical_key=claims["k"],
                        display_name=str(claims.get("n") or claims["k"]),
                        family=str(claims.get("f") or "unknown"),
                    ),
                    raw_model_name=str(claims.get("m") or claims["k"]),
                    provider_label=str(claims.get("p") or ""),
                    challenge_id=item.challenge_id,
                    difficulty=item.difficulty,
                    seed=item.seed,
                    # a run that ran out of time never produced an answer: it scores 0, whatever is posted
                    score=item.score if answered else 0,
                    solved=item.solved if answered else False,
                    moves=item.moves if answered else None,
                    timed_out=not answered,
                    time_limit_s=item.time_limit_s,
                    total_ms=_num(claims.get("ms")) or 0.0,
                    completion_tokens=int(_num(claims.get("ct")) or 0),
                    cost_usd=_num(claims.get("c")),
                    created_at=created,
                )
            )
        return await self.repo.add(results) if results else 0
