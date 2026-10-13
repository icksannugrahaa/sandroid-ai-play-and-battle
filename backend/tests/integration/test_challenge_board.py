from __future__ import annotations

import httpx

from app.application.challenge_results import SubmitChallengeResults, SubmittedResult
from app.container import Container
from app.domain.entities import ChallengeResult
from app.infrastructure.security.tickets import TicketSigner
from tests.conftest import parse_sse

BASE = "https://api.example.com/v1"
CHAT = {"modality": "chat", "prompt": "solve the maze"}


async def arena_tickets(client: httpx.AsyncClient, models: list[str], contribute: bool = True) -> dict[int, str]:
    body = {"slots": [{"base_url": BASE, "model": m} for m in models], "config": CHAT, "contribute": contribute}
    headers = {f"X-Api-Key-{i}": f"k{i}" for i in range(len(models))}
    resp = await client.post("/api/v1/arena/run", json=body, headers=headers)
    assert resp.status_code == 200
    return {d["slot"]: d["ticket"] for e, d in parse_sse(resp.text) if e == "ticket"}


def result(ticket: str, score: int, solved: bool, **extra) -> dict:
    return {
        "ticket": ticket,
        "challenge_id": "maze",
        "difficulty": "hard",
        "seed": 42,
        "score": score,
        "solved": solved,
        **extra,
    }


async def test_only_real_answered_runs_get_tickets(client: httpx.AsyncClient) -> None:
    tickets = await arena_tickets(client, ["ok-a", "fail-server", "ok-b"])
    assert sorted(tickets) == [0, 2]  # a gateway error says nothing about the model
    assert await arena_tickets(client, ["ok-a", "ok-b"], contribute=False) == {}


async def test_results_rank_per_challenge_and_level(client: httpx.AsyncClient) -> None:
    for _ in range(2):
        t = await arena_tickets(client, ["ok-a", "ok-b"])
        resp = await client.post(
            "/api/v1/challenge-results",
            json={"results": [result(t[0], 100, True, moves=48), result(t[1], 40, False, moves=12)]},
        )
        assert resp.json() == {"stored": 2}

    board = (
        await client.get("/api/v1/challenge-leaderboard", params={"challenge": "maze", "difficulty": "hard"})
    ).json()
    assert [(r["rank"], r["display_name"], r["avg_score"], r["solve_rate"]) for r in board["rows"]] == [
        (1, board["rows"][0]["display_name"], 100.0, 1.0),
        (2, board["rows"][1]["display_name"], 40.0, 0.0),
    ]
    assert board["rows"][0]["avg_moves_solved"] == 48.0 and board["rows"][1]["avg_moves_solved"] is None
    assert board["rows"][0]["insufficient_data"] is True  # 2 runs < default min 3
    assert board["cells"] == [{"challenge_id": "maze", "difficulty": "hard", "runs": 4, "models": 2}]

    other = (
        await client.get("/api/v1/challenge-leaderboard", params={"challenge": "maze", "difficulty": "easy"})
    ).json()
    assert other["rows"] == []  # levels never mix


async def test_forged_reused_and_tampered_tickets_are_ignored(client: httpx.AsyncClient, container: Container) -> None:
    t = await arena_tickets(client, ["ok-a"])
    forged = TicketSigner(b"x" * 32).issue({"k": "ok-a", "ok": True})
    body, mac = t[0].split(".")
    tampered = f"{body[:-2]}AA.{mac}"
    resp = await client.post(
        "/api/v1/challenge-results",
        json={"results": [result(forged, 100, True), result(tampered, 100, True), result(t[0], 70, False)]},
    )
    assert resp.json() == {"stored": 1}
    again = await client.post("/api/v1/challenge-results", json={"results": [result(t[0], 100, True)]})
    assert again.json() == {"stored": 0}  # each run counts once


async def test_submission_is_validated(client: httpx.AsyncClient) -> None:
    t = await arena_tickets(client, ["ok-a"])
    bad = [
        result(t[0], 101, True),
        result(t[0], 50, True, difficulty="impossible"),
        result(t[0], 50, True, challenge_id="Maze Route!"),
        {**result(t[0], 50, True), "answer": "RRDD"},  # no content is accepted
    ]
    for item in bad:
        assert (await client.post("/api/v1/challenge-results", json={"results": [item]})).status_code == 422


class _Repo:
    def __init__(self) -> None:
        self.saved: list[ChallengeResult] = []

    async def add(self, results):
        self.saved.extend(results)
        return len(results)

    async def board(self, q):  # pragma: no cover
        return []

    async def cells(self, since):  # pragma: no cover
        return []


async def test_a_run_that_ran_out_of_time_scores_zero_whatever_is_posted() -> None:
    signer = TicketSigner(b"k" * 32)
    repo = _Repo()
    use_case = SubmitChallengeResults(repo, signer)
    ticket = signer.issue({"k": "slow-model", "ok": False, "ms": 300_000.0, "ct": 9000})
    item = SubmittedResult(ticket, "maze", "hard", 1, score=100, solved=True, moves=40, time_limit_s=300)
    assert await use_case.execute([item]) == 1
    saved = repo.saved[0]
    assert (saved.score, saved.solved, saved.moves, saved.timed_out) == (0, False, None, True)
    assert saved.total_ms == 300_000.0 and saved.completion_tokens == 9000


def test_tickets_expire() -> None:
    now = [1_000_000.0]
    signer = TicketSigner(b"k" * 32, clock=lambda: now[0])
    ticket = signer.issue({"k": "m"})
    assert signer.verify(ticket) is not None
    now[0] += 5 * 3600
    assert signer.verify(ticket) is None
    assert signer.verify("garbage") is None and signer.verify("a.b") is None


async def test_models_with_too_few_runs_rank_below_the_rest(client: httpx.AsyncClient) -> None:
    for i in range(3):
        t = await arena_tickets(client, ["ok-a", "ok-b"] if i == 0 else ["ok-a"])
        results = [result(t[0], 60, True)]
        if i == 0:
            results.append(result(t[1], 100, True))  # one perfect run only
        await client.post("/api/v1/challenge-results", json={"results": results})
    rows = (
        await client.get("/api/v1/challenge-leaderboard", params={"challenge": "maze", "difficulty": "hard"})
    ).json()["rows"]
    assert [(r["avg_score"], r["runs"], r["insufficient_data"]) for r in rows] == [(60.0, 3, False), (100.0, 1, True)]
