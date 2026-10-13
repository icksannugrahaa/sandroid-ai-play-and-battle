"""Public, credential-free pricing sources (priority: OpenRouter > LiteLLM > Helicone)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.domain.entities import PricingQuote
from app.domain.ports.pricing_source import PricingSourceError

PER_MILLION = 1_000_000


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _per_million(per_token: Any) -> float | None:
    value = _num(per_token)
    return round(value * PER_MILLION, 6) if value is not None else None


class _HttpJsonSource:
    name = "base"

    def __init__(self, http: httpx.AsyncClient, url: str, *, max_bytes: int = 50 * 1024 * 1024) -> None:
        self._http = http
        self._url = url
        self._max_bytes = max_bytes

    async def _get_json(self) -> Any:
        try:
            async with self._http.stream("GET", self._url, timeout=httpx.Timeout(30.0)) as resp:
                if resp.status_code >= 400:
                    raise PricingSourceError(f"http_{resp.status_code}")
                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > self._max_bytes:
                        raise PricingSourceError("too_large")
        except httpx.TimeoutException:
            raise PricingSourceError("timeout") from None
        except httpx.HTTPError:
            raise PricingSourceError("network") from None
        try:
            return json.loads(bytes(buf))
        except ValueError:
            raise PricingSourceError("parse") from None


class OpenRouterSource(_HttpJsonSource):
    """`GET /api/v1/models` — `pricing.prompt`/`pricing.completion` are USD per token."""

    name = "openrouter"

    async def fetch(self) -> list[PricingQuote]:
        body = await self._get_json()
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise PricingSourceError("parse")
        return self.parse(data)

    @staticmethod
    def parse(data: list[Any]) -> list[PricingQuote]:
        out: list[PricingQuote] = []
        for item in data:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            pricing = item.get("pricing")
            if not isinstance(pricing, dict):
                continue
            out.append(
                PricingQuote(
                    raw_name=item["id"],
                    input_per_1m=_per_million(pricing.get("prompt")),
                    output_per_1m=_per_million(pricing.get("completion")),
                    image_price=None,  # OpenRouter's `image` is an *input* image price, not generation
                )
            )
        return out


class LiteLLMSource(_HttpJsonSource):
    """`model_prices_and_context_window.json` — `*_cost_per_token` in USD."""

    name = "litellm"

    async def fetch(self) -> list[PricingQuote]:
        body = await self._get_json()
        if not isinstance(body, dict):
            raise PricingSourceError("parse")
        return self.parse(body)

    @staticmethod
    def parse(body: dict[str, Any]) -> list[PricingQuote]:
        out: list[PricingQuote] = []
        for name, spec in body.items():
            if name == "sample_spec" or not isinstance(spec, dict):
                continue
            mode = spec.get("mode")
            if mode not in (None, "chat", "completion", "image_generation", "responses"):
                continue
            out.append(
                PricingQuote(
                    raw_name=name,
                    input_per_1m=_per_million(spec.get("input_cost_per_token")),
                    output_per_1m=_per_million(spec.get("output_cost_per_token")),
                    image_price=_num(spec.get("output_cost_per_image")),
                )
            )
        return out


class HeliconeSource(_HttpJsonSource):
    """Helicone cost map — already per 1M tokens. Only exact (`equals`) entries map cleanly."""

    name = "helicone"

    async def fetch(self) -> list[PricingQuote]:
        body = await self._get_json()
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise PricingSourceError("parse")
        return self.parse(data)

    @staticmethod
    def parse(data: list[Any]) -> list[PricingQuote]:
        out: list[PricingQuote] = []
        for item in data:
            if not isinstance(item, dict) or item.get("operator") != "equals":
                continue
            model = item.get("model")
            if not isinstance(model, str):
                continue
            out.append(
                PricingQuote(
                    raw_name=model,
                    input_per_1m=_num(item.get("input_cost_per_1m")),
                    output_per_1m=_num(item.get("output_cost_per_1m")),
                )
            )
        return out
