import httpx
import pytest

from app.domain.ports.pricing_source import PricingSourceError
from app.infrastructure.pricing.sources import HeliconeSource, LiteLLMSource, OpenRouterSource


def client(payload=None, status=200) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=payload)))


async def test_openrouter_per_token_to_per_million() -> None:
    src = OpenRouterSource(
        client({"data": [{"id": "openai/gpt-4o", "pricing": {"prompt": "0.0000025", "completion": "0.00001"}}]}),
        "https://x",
    )
    [q] = await src.fetch()
    assert (q.raw_name, q.input_per_1m, q.output_per_1m) == ("openai/gpt-4o", 2.5, 10.0)


async def test_litellm_skips_sample_spec_and_embeddings() -> None:
    body = {
        "sample_spec": {"input_cost_per_token": 0},
        "gpt-4o": {"mode": "chat", "input_cost_per_token": 2.5e-6, "output_cost_per_token": 1e-5},
        "text-embedding-3-small": {"mode": "embedding", "input_cost_per_token": 2e-8},
        "dall-e-3": {"mode": "image_generation", "output_cost_per_image": 0.04},
    }
    quotes = await LiteLLMSource(client(body), "https://x").fetch()
    assert {q.raw_name: (q.input_per_1m, q.image_price) for q in quotes} == {
        "gpt-4o": (2.5, None),
        "dall-e-3": (None, 0.04),
    }


async def test_helicone_equals_only() -> None:
    body = {
        "data": [
            {"model": "gpt-4o", "operator": "equals", "input_cost_per_1m": 2.5, "output_cost_per_1m": 10},
            {"model": "gpt-4", "operator": "startsWith", "input_cost_per_1m": 30, "output_cost_per_1m": 60},
        ]
    }
    quotes = await HeliconeSource(client(body), "https://x").fetch()
    assert [(q.raw_name, q.input_per_1m) for q in quotes] == [("gpt-4o", 2.5)]


async def test_http_error_reason() -> None:
    with pytest.raises(PricingSourceError) as info:
        await OpenRouterSource(client({}, status=503), "https://x").fetch()
    assert info.value.reason == "http_503"
