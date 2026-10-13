from datetime import UTC, datetime, timedelta

from app.domain.entities import PricingEntry, PricingQuote
from app.domain.services.normalizer import AliasRegistry
from app.domain.services.pricing_merge import merge_pricing, quotes_to_entries, suggest_alias_candidates

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def entry(key: str, source: str, price: float, *, raw: str | None = None, at: datetime = T0) -> PricingEntry:
    return PricingEntry(key, raw or key, price, price, None, "USD", source, at)


def test_priority_beats_recency() -> None:
    merged = merge_pricing([entry("a", "litellm", 2, at=T0 + timedelta(days=1)), entry("a", "openrouter", 1)])
    assert merged["a"].source == "openrouter"


def test_recency_breaks_ties_within_source() -> None:
    merged = merge_pricing([entry("a", "litellm", 1), entry("a", "litellm", 2, at=T0 + timedelta(hours=1))])
    assert merged["a"].input_per_1m == 2


def test_vendor_listing_beats_reseller_namespace() -> None:
    merged = merge_pricing(
        [entry("gpt4o", "litellm", 9, raw="azure/gpt-4o"), entry("gpt4o", "litellm", 5, raw="gpt-4o")]
    )
    assert merged["gpt4o"].raw_name == "gpt-4o"


def test_quotes_normalized_and_invalid_dropped() -> None:
    quotes = [
        PricingQuote("openai/GPT-4o", 2.5, 10.0),
        PricingQuote("openrouter/auto", -1_000_000, -1_000_000),  # sentinel
        PricingQuote("empty", None, None),
        PricingQuote("dall-e-3", None, None, image_price=0.04),
    ]
    entries = quotes_to_entries(quotes, source="openrouter", fetched_at=T0, aliases=AliasRegistry())
    assert [(e.canonical_key, e.input_per_1m, e.image_price) for e in entries] == [
        ("gpt4o", 2.5, None),
        ("dalle3", None, 0.04),
    ]


def test_alias_candidates_are_suggestions_for_unpriced_near_misses() -> None:
    cands = suggest_alias_candidates(["deepseekv1flsh", "qwen38", "totallyunique"], ["deepseekv1flash", "qwen38"])
    assert [(c.model_key, c.suggested_key) for c in cands] == [("deepseekv1flsh", "deepseekv1flash")]


def test_pricing_keys_fall_back_to_base_model() -> None:
    from app.domain.services.pricing_merge import pricing_keys

    reg = AliasRegistry()
    assert pricing_keys("ag/gemini-3.6-flash-low", reg) == [("gemini36flashlow", True), ("gemini36flash", False)]
    assert pricing_keys("o3-high", reg) == [("o3high", True), ("o3", False)]
    assert pricing_keys("claude-sonnet-4.5-thinking", reg) == [
        ("claudesonnet45thinking", True),
        ("claudesonnet45", False),
    ]
    assert pricing_keys("gpt-4o-mini", reg) == [("gpt4omini", True)]  # "mini" is a different model, not a knob
    assert pricing_keys("low", reg) == [("low", True)]
