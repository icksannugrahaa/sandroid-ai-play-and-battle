from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.container import Container
from app.domain.entities import (
    ErrorCategory,
    Modality,
    RunMetrics,
    RunMode,
    RunRecord,
    RunStatus,
)
from app.domain.services.normalizer import AliasRegistry
from app.infrastructure.persistence.repositories import SqlLeaderboardRepository, SqlMetricsRepository
from tests.conftest import FakeSource

NOW = datetime.now(UTC)


def record(
    raw: str,
    total_ms: float,
    *,
    status=RunStatus.SUCCESS,
    tps=50.0,
    cost=0.01,
    provider="p.test",
    mode=RunMode.PLAYGROUND,
    modality=Modality.CHAT,
    age_days: float = 0,
) -> RunRecord:
    ok = status is RunStatus.SUCCESS
    return RunRecord(
        canonical=AliasRegistry().resolve(raw),
        raw_model_name=raw,
        provider_label=provider,
        modality=modality,
        mode=mode,
        metrics=RunMetrics(
            ttft_ms=100.0 if ok else None,
            ttft_supported=True,
            total_ms=total_ms,
            prompt_tokens=10,
            completion_tokens=20,
            tokens_estimated=False,
            throughput_tps=tps if ok else None,
            cost_usd=cost,
            status=status,
            error_category=None if ok else ErrorCategory.SERVER,
        ),
        created_at=NOW - timedelta(days=age_days),
    )


@pytest.fixture
async def seeded(container: Container) -> Container:
    repo = SqlMetricsRepository(container.sessions)
    runs = [record("fast-model", ms, tps=100, cost=0.001) for ms in (100, 200, 300, 400, 500)]
    runs += [record("slow-model", ms, tps=10, cost=0.05) for ms in (1000, 2000, 3000, 4000)]
    runs += [record("slow-model", 9999, status=RunStatus.ERROR)]
    runs += [record("qwen3.8-max", 700, provider="other.test", mode=RunMode.ARENA)]
    runs += [record("qwen3.8", 600, age_days=40, modality=Modality.VISION)]
    await repo.record_runs(runs)
    return container


async def get(client: httpx.AsyncClient, **params) -> dict:
    resp = await client.get("/api/v1/leaderboard", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_exact_leaderboard_aggregates(client: httpx.AsyncClient, seeded: Container) -> None:
    body = await get(client, sort="p50_latency_ms", order="asc")
    rows = {r["key"]: r for r in body["rows"]}
    fast, slow = rows["fastmodel"], rows["slowmodel"]
    assert fast["total_runs"] == 5 and fast["success_rate"] == 1.0
    assert fast["p50_latency_ms"] == pytest.approx(300) and fast["p95_latency_ms"] == pytest.approx(480)
    assert fast["avg_latency_ms"] == pytest.approx(300)
    assert slow["total_runs"] == 5 and slow["success_rate"] == pytest.approx(0.8)
    assert slow["avg_latency_ms"] == pytest.approx(2500)  # failed run excluded from latency
    assert rows["qwen38max"]["insufficient_data"] is True
    assert body["rows"][0]["key"] == "fastmodel"
    assert body["facets"]["providers"] == ["other.test", "p.test"]
    assert "w_throughput" in body["composite_formula"]
    assert "raw_model_name" not in body["rows"][0]  # aggregates only


async def test_composite_ranks_fast_cheap_reliable_first(client: httpx.AsyncClient, seeded: Container) -> None:
    rows = (await get(client, hide_insufficient=True))["rows"]
    assert [r["key"] for r in rows] == ["fastmodel", "slowmodel"]
    assert rows[0]["composite_score"] > rows[1]["composite_score"]
    rows = (await get(client, hide_insufficient=True, w_throughput=0, w_reliability=0, w_latency=0, w_cost=0))["rows"]
    assert all(r["composite_score"] == 0 for r in rows)


async def test_filters(client: httpx.AsyncClient, seeded: Container) -> None:
    assert [r["key"] for r in (await get(client, provider="other.test"))["rows"]] == ["qwen38max"]
    assert [r["key"] for r in (await get(client, mode="arena"))["rows"]] == ["qwen38max"]
    assert [r["key"] for r in (await get(client, modality="vision"))["rows"]] == ["qwen38"]
    assert "qwen38" not in [r["key"] for r in (await get(client, period="30d"))["rows"]]
    assert {r["key"] for r in (await get(client, family="qwen38"))["rows"]} == {"qwen38", "qwen38max"}


async def test_family_grouping(client: httpx.AsyncClient, seeded: Container) -> None:
    rows = {r["key"]: r for r in (await get(client, grouping="family"))["rows"]}
    assert rows["qwen38"]["variants"] == 2 and rows["qwen38"]["total_runs"] == 2


async def test_load_more_pagination(client: httpx.AsyncClient, container: Container) -> None:
    repo = SqlMetricsRepository(container.sessions)
    await repo.record_runs([record(f"model-{i:02d}", 100 + i) for i in range(30)])
    first = await get(client, sort="avg_latency_ms", order="asc")
    assert len(first["rows"]) == 25 and first["next_cursor"] and first["facets"] is not None
    second = await get(client, sort="avg_latency_ms", order="asc", cursor=first["next_cursor"])
    assert len(second["rows"]) == 5 and second["next_cursor"] is None and second["facets"] is None
    keys = [r["key"] for r in first["rows"] + second["rows"]]
    assert len(set(keys)) == 30
    assert (await client.get("/api/v1/leaderboard", params={"cursor": "garbage!"})).status_code == 400


def test_leaderboard_query_compiles_for_postgres() -> None:
    from sqlalchemy.dialects import postgresql

    from app.domain.ports.repositories import LeaderboardQuery

    sql = str(
        SqlLeaderboardRepository.build_query(LeaderboardQuery(), "postgresql").compile(dialect=postgresql.dialect())
    )
    assert "percentile_cont" in sql and "WITHIN GROUP" in sql and "NULLS LAST" in sql


async def test_research_merges_sources_and_enforces_cooldown(
    client: httpx.AsyncClient, sources: list[FakeSource], container: Container
) -> None:
    resp = await client.post("/api/v1/pricing/research")
    assert resp.status_code == 200, resp.text
    research = resp.json()["research"]
    assert research["sources_status"]["openrouter"] == {"ok": True, "entries": 1, "error": None}
    assert research["sources_status"]["helicone"] == {"ok": False, "entries": 0, "error": "network"}
    assert resp.json()["cooldown_remaining_s"] > 3500

    again = await client.post("/api/v1/pricing/research")
    assert again.status_code == 429 and again.json()["error"] == "research_cooldown"
    assert int(again.headers["retry-after"]) > 3500
    assert sources[0].calls == 1  # cooldown blocked the second fetch

    table = (await client.get("/api/v1/pricing")).json()
    entries = {e["canonical_key"]: e for e in table["entries"]}
    assert entries["qwen38max"]["source"] == "openrouter" and entries["qwen38max"]["input_per_1m"] == 1.0
    assert table["last_research"]["entries_updated"] == 2
    assert table["cooldown_remaining_s"] > 0
    assert (await client.get("/api/v1/pricing", params={"search": "Qwen3.8"})).json()["total"] == 1


async def test_cooldown_survives_restart(container: Container) -> None:
    await container.research.execute()
    from app.application.research_pricing import CooldownGate

    container.research.gate = CooldownGate(3600)  # simulate a fresh process
    assert await container.research.cooldown_remaining() > 3500


async def test_pricing_feeds_run_cost(client: httpx.AsyncClient) -> None:
    from tests.conftest import parse_sse

    await client.post("/api/v1/pricing/research")
    body = {"base_url": "https://provider.test/v1", "model": "ok-model", "config": {"prompt": "hi"}}
    events = parse_sse((await client.post("/api/v1/playground/run", json=body)).text)
    metrics = next(d for e, d in events if e == "metrics")
    assert metrics["cost_usd"] == pytest.approx(10 * 1 / 1e6 + 20 * 1 / 1e6)


async def test_no_pricing_write_endpoint(client: httpx.AsyncClient) -> None:
    for method in ("put", "patch", "delete"):
        resp = await client.request(method.upper(), "/api/v1/pricing", json={"canonical_key": "x"})
        assert resp.status_code == 405


async def test_cost_falls_back_to_base_model_price(client: httpx.AsyncClient, container: Container) -> None:
    from datetime import UTC, datetime

    from app.domain.entities import PricingEntry
    from tests.conftest import parse_sse

    await container.pricing_repo.upsert_many(
        [PricingEntry("okmodel", "ok-model", 1.0, 2.0, None, "USD", "litellm", datetime.now(UTC))]
    )
    body = {"base_url": "https://provider.test/v1", "model": "ok-model-low", "config": {"prompt": "hi"}}
    metrics = next(
        d for e, d in parse_sse((await client.post("/api/v1/playground/run", json=body)).text) if e == "metrics"
    )
    assert metrics["cost_usd"] == pytest.approx(10 * 1 / 1e6 + 20 * 2 / 1e6)
    assert (metrics["price_key"], metrics["price_exact"]) == ("okmodel", False)
