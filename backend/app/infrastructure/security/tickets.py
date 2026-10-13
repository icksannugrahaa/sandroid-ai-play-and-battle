"""Signed run tickets: proof that a challenge result belongs to a run this server really made.

Challenge answers are checked in the browser, so the server cannot score them itself. What it
can do is vouch for the run: after an arena run it hands out a ticket — model, provider,
time, tokens, cost, outcome — signed with a key that only lives in this process's memory.
A result is accepted for the challenge leaderboard only with a valid, unexpired, unused ticket,
so nobody can post results for runs that never happened or swap in another model's name.
(The score itself still comes from the browser's checker.)
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import time
import uuid
from collections.abc import Callable
from typing import Any

TICKET_TTL_S = 4 * 3600  # a battle + its checks fit easily; long hour-limit runs too


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class TicketSigner:
    def __init__(self, signing_key: bytes | None = None, *, clock: Callable[[], float] = time.time) -> None:
        # per process: tickets from before a restart simply expire (results are posted seconds after a run)
        self._key = signing_key or os.urandom(32)
        self._clock = clock

    def _mac(self, body: str) -> str:
        return _b64(hmac.new(self._key, body.encode(), hashlib.sha256).digest())

    def issue(self, claims: dict[str, Any]) -> str:
        body = _b64(json.dumps({**claims, "id": uuid.uuid4().hex, "iat": int(self._clock())}).encode())
        return f"{body}.{self._mac(body)}"

    def verify(self, ticket: str) -> dict[str, Any] | None:
        """Claims of a genuine, unexpired ticket; None otherwise (never raises)."""
        try:
            body, mac = ticket.split(".", 1)
            if not hmac.compare_digest(mac, self._mac(body)):
                return None
            claims = json.loads(_unb64(body))
        except ValueError, binascii.Error:
            return None
        if not isinstance(claims, dict):
            return None
        iat = claims.get("iat")
        if not isinstance(iat, int) or not 0 <= self._clock() - iat <= TICKET_TTL_S:
            return None
        return claims
