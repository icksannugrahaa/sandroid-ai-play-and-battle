from __future__ import annotations

from typing import Protocol

from app.domain.entities import PricingQuote


class PricingSourceError(Exception):
    """A source could not be fetched/parsed. `reason` is a short code, never upstream text."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class PricingSource(Protocol):
    """A public, credential-free price list."""

    name: str

    async def fetch(self) -> list[PricingQuote]: ...
