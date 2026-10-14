from __future__ import annotations

import logging

import httpx
import pytest
from sqlalchemy import text

from app.container import Container
from tests.conftest import SECRET_KEY, FakeProvider, parse_sse

BASE = "https://provider.test/v1"
CHAT = {"modality": "chat", "prompt": "Say hello", "system": "be brief", "params": {"temperature": 0.1}}


async def run_playground(client: httpx.AsyncClient, model: str, **extra) -> list:
    body = {"base_url": BASE, "model": model, "config": CHAT, **extra}
    resp = await client.post("/api/v1/playground/run", json=body, headers={"X-Api-Key": SECRET_KEY})
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/event-stream")
    return parse_sse(resp.text)


async def count_runs(container: Container) -> int:
    async with container.sessions() as s:
        return (await s.execute(text("SELECT COUNT(*) FROM runs"))).scalar_one()


async def test_health(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/v1/health")).json()["status"] == "ok"


async def test_fetch_models_annotates_and_never_caches_in_http(
    client: httpx.AsyncClient, provider: FakeProvider
) -> None:
    resp = await client.post("/api/v1/models/fetch", json={"base_url": BASE}, headers={"X-Api-Key": SECRET_KEY})
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-store"
    models = {m["id"]: m for m in resp.json()["models"]}
    assert models["vendor/Qwen3.8-Max"]["canonical_key"] == "qwen38max"
    assert models["vendor/Qwen3.8-Max"]["family"] == "qwen38"
    assert models["dall-e-3"]["capabilities"] == ["image_gen"]
    assert SECRET_KEY not in resp.text
    assert provider.seen_keys == [SECRET_KEY]


async def test_fetch_models_auth_error_is_categorized(client: httpx.AsyncClient) -> None:
    resp = await client.post("/api/v1/models/fetch", json={"base_url": BASE}, headers={"X-Api-Key": "bad"})
    assert resp.status_code == 401
    assert resp.json() == {"error": "provider_error", "category": "auth", "upstream_status": 401}


async def test_playground_stream_and_metrics(client: httpx.AsyncClient, container: Container) -> None:
    events = await run_playground(client, "ok-model")
    types = [e for e, _ in events]
    assert types[0] == "start" and types[-1] == "done"
    assert "".join(d["text"] for e, d in events if e == "delta") == "Hello world"
    metrics = next(d for e, d in events if e == "metrics")
    assert metrics["status"] == "success"
    assert metrics["ttft_ms"] is not None and metrics["total_ms"] >= metrics["ttft_ms"]
    assert (metrics["prompt_tokens"], metrics["completion_tokens"]) == (10, 20)
    assert metrics["tokens_estimated"] is False
    assert events[-1][1] == {"contributed": True}
    assert await count_runs(container) == 1


async def test_playground_contribute_off_records_nothing(client: httpx.AsyncClient, container: Container) -> None:
    events = await run_playground(client, "ok-model", contribute=False)
    assert events[-1][1] == {"contributed": False}
    assert await count_runs(container) == 0


async def test_client_fault_errors_not_recorded(client: httpx.AsyncClient, container: Container) -> None:
    def error_of(events: list) -> dict:
        return next(data for name, data in events if name == "error")

    events = await run_playground(client, "fail-auth")
    err = error_of(events)
    assert err["category"] == "auth" and err["status"] == 401 and err["after_ms"] >= 0
    assert set(err) == {"category", "status", "after_ms"}  # no upstream text
    assert await count_runs(container) == 0
    events = await run_playground(client, "fail-server")
    assert error_of(events)["category"] == "server"
    assert await count_runs(container) == 1  # provider-side failures DO count toward reliability


async def test_estimated_tokens_flag(client: httpx.AsyncClient) -> None:
    metrics = next(d for e, d in await run_playground(client, "nousage") if e == "metrics")
    assert metrics["tokens_estimated"] is True
    assert metrics["completion_tokens"] == 3  # "Hello world" = 11 chars → ceil(11/4)


async def test_image_generation(client: httpx.AsyncClient) -> None:
    body = {
        "base_url": BASE,
        "model": "dall-e-3",
        "config": {"modality": "image_gen", "prompt": "a cat", "image_size": "512x512"},
    }
    events = parse_sse((await client.post("/api/v1/playground/run", json=body)).text)
    assert ("image", {"url": "data:image/png;base64,AAAA"}) in events
    metrics = next(d for e, d in events if e == "metrics")
    assert metrics["ttft_ms"] is None and metrics["ttft_supported"] is False


async def test_images_require_vision_modality(client: httpx.AsyncClient) -> None:
    cfg = {**CHAT, "images": ["data:image/png;base64,AAAA"]}
    resp = await client.post("/api/v1/playground/run", json={"base_url": BASE, "model": "m", "config": cfg})
    assert resp.status_code == 422


async def test_non_data_url_images_rejected(client: httpx.AsyncClient) -> None:
    cfg = {**CHAT, "modality": "vision", "images": ["https://evil.test/x.png"]}
    resp = await client.post("/api/v1/playground/run", json={"base_url": BASE, "model": "m", "config": cfg})
    assert resp.status_code == 422
    assert "input" not in resp.text  # validation errors never echo input


@pytest.mark.parametrize("strategy", ["parallel", "sequential"])
async def test_arena_partial_failure_and_per_slot_keys(
    client: httpx.AsyncClient, container: Container, provider: FakeProvider, strategy: str
) -> None:
    body = {
        "slots": [{"base_url": BASE, "model": m} for m in ["ok-a", "fail-server", "ok-b"]],
        "strategy": strategy,
        "config": CHAT,
    }
    headers = {"X-Api-Key-0": "k0", "X-Api-Key-1": "k1", "X-Api-Key-2": "k2"}
    resp = await client.post("/api/v1/arena/run", json=body, headers=headers)
    assert resp.status_code == 200
    events = parse_sse(resp.text)
    by_slot = {i: next(d for e, d in events if e == "metrics" and d["slot"] == i) for i in range(3)}
    assert [by_slot[i]["status"] for i in range(3)] == ["success", "error", "success"]
    assert events[-1][0] == "done" and events[-1][1]["strategy"] == strategy
    assert sorted(provider.seen_keys) == ["k0", "k1", "k2"]
    assert await count_runs(container) == 3
    async with container.sessions() as s:
        sessions = (await s.execute(text("SELECT strategy FROM arena_sessions"))).scalars().all()
    assert sessions == [strategy]
    if strategy == "sequential":
        starts = [d["slot"] for e, d in events if e == "start"]
        assert starts == [0, 1, 2]


async def test_arena_max_four_enforced_by_backend(client: httpx.AsyncClient) -> None:
    body = {"slots": [{"base_url": BASE, "model": f"ok-{i}"} for i in range(5)], "config": CHAT}
    assert (await client.post("/api/v1/arena/run", json=body)).status_code == 422
    body["slots"] = []
    assert (await client.post("/api/v1/arena/run", json=body)).status_code == 422
    # one slot is fine: challenge follow-up turns continue with whoever is still solving
    body["slots"] = [{"base_url": BASE, "model": "ok-0"}]
    assert (await client.post("/api/v1/arena/run", json=body)).status_code == 200


async def test_arena_concurrency_guard(client: httpx.AsyncClient, container: Container) -> None:
    release = container.arena_guard.acquire("203.0.113.7", parallel=True)
    try:
        body = {"slots": [{"base_url": BASE, "model": "ok-a"}, {"base_url": BASE, "model": "ok-b"}], "config": CHAT}
        resp = await client.post("/api/v1/arena/run", json=body)
        assert resp.status_code == 429 and resp.json()["error"] == "too_many_active_arenas"
        body["strategy"] = "sequential"
        assert (await client.post("/api/v1/arena/run", json=body)).status_code == 200
    finally:
        release()
    assert container.arena_guard.active("203.0.113.7") == 0  # stream released its slot


async def test_ssrf_private_target_rejected(settings, container: Container) -> None:
    from app.main import create_app

    settings.ssrf_allow_private = False
    app = create_app(settings, container_factory=lambda _s: container)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c,
    ):
        for url in ["https://127.0.0.1/v1", "http://api.openai.com/v1", "https://169.254.169.254/v1"]:
            resp = await c.post("/api/v1/models/fetch", json={"base_url": url})
            assert resp.status_code == 400, url
            assert resp.json()["error"] == "endpoint_not_allowed"


async def test_body_size_limit(client: httpx.AsyncClient) -> None:
    cfg = {**CHAT, "modality": "vision", "images": ["data:image/png;base64," + "A" * 300_000]}
    resp = await client.post("/api/v1/playground/run", json={"base_url": BASE, "model": "m", "config": cfg})
    assert resp.status_code == 413


async def test_rate_limit(settings, container: Container) -> None:
    from app.infrastructure.security.rate_limit import TokenBucketLimiter
    from app.main import create_app

    # Capacity 2, no refill: the budget must not be replenished mid-test, otherwise the
    # continuous token-bucket refill makes the 3rd call pass on a slow/loaded machine.
    container.limiters.read = TokenBucketLimiter(per_minute=0, burst=2)
    app = create_app(settings, container_factory=lambda _s: container)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c,
    ):
        codes = [(await c.get("/api/v1/pricing")).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


async def test_key_never_logged(client: httpx.AsyncClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG):
        await run_playground(client, "ok-model")
        await run_playground(client, "fail-server")
        await client.post("/api/v1/models/fetch", json={"base_url": BASE}, headers={"X-Api-Key": SECRET_KEY})
    assert SECRET_KEY not in caplog.text
    assert "203.0.113.7" not in caplog.text  # full IPs never logged


async def test_security_headers(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/v1/health")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cache-control"] == "no-store"


async def test_openapi_lists_only_designed_endpoints(client: httpx.AsyncClient) -> None:
    paths = set((await client.get("/api/openapi.json")).json()["paths"])
    assert paths == {
        "/api/v1/health",
        "/api/v1/models/fetch",
        "/api/v1/playground/run",
        "/api/v1/arena/run",
        "/api/v1/leaderboard",
        "/api/v1/challenge-results",
        "/api/v1/challenge-leaderboard",
        "/api/v1/pricing",
        "/api/v1/pricing/research",
        "/api/v1/models",
    }


async def test_catalog_lists_seen_models_with_aliases(client: httpx.AsyncClient) -> None:
    await run_playground(client, "vendor/Qwen3.8-Max")
    await run_playground(client, "other/qwen3.8max")
    body = (await client.get("/api/v1/models", params={"family": "qwen38"})).json()
    assert body["total"] == 1
    model = body["models"][0]
    assert model["canonical_key"] == "qwen38max" and model["modalities"] == ["chat"]
    assert {"vendor/Qwen3.8-Max", "other/qwen3.8max", "qwen-3.8-maximum"} <= set(model["aliases"])


async def test_chat_media_events(client: httpx.AsyncClient) -> None:
    events = await run_playground(client, "media")
    assert ("image", {"url": "data:image/png;base64,AAAA"}) in events
    audio = [d["url"] for e, d in events if e == "audio"]
    assert len(audio) == 1 and audio[0].startswith("data:audio/wav;base64,")
    assert [e for e, _ in events].index("audio") < [e for e, _ in events].index("metrics")


async def test_attachment_validation(client: httpx.AsyncClient) -> None:
    def body(config: dict) -> dict:
        return {"base_url": BASE, "model": "ok-model", "config": config}

    ok = {
        "prompt": "",
        "attachments": [{"kind": "file", "name": "a.pdf", "data_url": "data:application/pdf;base64,JVBE"}],
    }
    assert (await client.post("/api/v1/playground/run", json=body(ok))).status_code == 200
    bad_audio = {
        "prompt": "x",
        "attachments": [{"kind": "audio", "name": "a.ogg", "data_url": "data:audio/ogg;base64,AAAA"}],
    }
    assert (await client.post("/api/v1/playground/run", json=body(bad_audio))).status_code == 422
    not_data = {"prompt": "x", "attachments": [{"kind": "file", "name": "a", "data_url": "https://evil.test/x.pdf"}]}
    assert (await client.post("/api/v1/playground/run", json=body(not_data))).status_code == 422
    assert (await client.post("/api/v1/playground/run", json=body({"prompt": "  "}))).status_code == 422
    gen = {"modality": "image_gen", "prompt": "cat", "attachments": ok["attachments"]}
    assert (await client.post("/api/v1/playground/run", json=body(gen))).status_code == 422


async def test_arena_follow_up_uses_each_models_own_history(client: httpx.AsyncClient, provider: FakeProvider) -> None:
    body = {
        "slots": [
            {
                "base_url": BASE,
                "model": "ok-a",
                "history": [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "A said X"}],
            },
            {
                "base_url": BASE,
                "model": "ok-b",
                "history": [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "B said Y"}],
            },
        ],
        "config": {"prompt": "patch #1 please"},
    }
    assert (await client.post("/api/v1/arena/run", json=body)).status_code == 200
    a, b = provider.seen_messages["ok-a"], provider.seen_messages["ok-b"]
    assert [m["content"] for m in a] == ["q1", "A said X", "patch #1 please"]
    assert [m["content"] for m in b] == ["q1", "B said Y", "patch #1 please"]


async def test_image_gen_falls_back_to_chat_for_hybrid_models(client: httpx.AsyncClient) -> None:
    body = {"base_url": BASE, "model": "gemini-image-chat", "config": {"modality": "image_gen", "prompt": "a red bike"}}
    events = parse_sse((await client.post("/api/v1/playground/run", json=body)).text)
    assert ("image", {"url": "data:image/png;base64,QkJC"}) in events
    assert next(d for e, d in events if e == "metrics")["status"] == "success"


async def test_arena_per_slot_prompt(client: httpx.AsyncClient, provider) -> None:
    body = {
        "slots": [
            {"base_url": BASE, "model": "ok-a", "prompt": "cube state for A"},
            {"base_url": BASE, "model": "ok-b"},
        ],
        "config": {"prompt": "shared prompt"},
    }
    assert (await client.post("/api/v1/arena/run", json=body)).status_code == 200
    assert provider.seen_messages["ok-a"][-1]["content"] == "cube state for A"
    assert provider.seen_messages["ok-b"][-1]["content"] == "shared prompt"
