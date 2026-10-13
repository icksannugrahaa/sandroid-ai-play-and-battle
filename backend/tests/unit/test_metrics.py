from datetime import UTC, datetime

import pytest

from app.domain.entities import ErrorCategory, PricingEntry, RunStatus, Usage
from app.domain.services.errors import classify_status, is_client_fault
from app.domain.services.metrics import compute_metrics, cost_usd, estimate_tokens, throughput

PRICE = PricingEntry("m", "m", 2.0, 8.0, 0.04, "USD", "openrouter", datetime(2026, 1, 1, tzinfo=UTC))


def test_estimate_tokens_chars_div_4_rounded_up() -> None:
    assert (estimate_tokens(0), estimate_tokens(1), estimate_tokens(8), estimate_tokens(9)) == (0, 1, 2, 3)


def test_throughput_uses_generation_window() -> None:
    assert throughput(100, total_ms=2500, ttft_ms=500) == pytest.approx(50.0)
    assert throughput(100, total_ms=2000, ttft_ms=None) == pytest.approx(50.0)
    assert throughput(0, total_ms=2000, ttft_ms=100) is None


def test_throughput_ignores_a_sliver_window_after_hidden_reasoning() -> None:
    # 9906 tokens, first visible token at 213.4 s of 213.7 s: not 33k tok/s
    assert throughput(9906, total_ms=213_700, ttft_ms=213_400) == pytest.approx(9906 / 213.7)


def test_cost_from_pricing() -> None:
    assert cost_usd(PRICE, 1_000_000, 500_000) == pytest.approx(2.0 + 4.0)
    assert cost_usd(PRICE, 0, 0, images=2) == pytest.approx(0.08)
    assert cost_usd(None, 10, 10) is None


def test_compute_metrics_streaming_with_usage() -> None:
    m = compute_metrics(
        started_at=10.0,
        first_token_at=10.25,
        finished_at=12.25,
        streamed=True,
        usage=Usage(prompt_tokens=50, completion_tokens=100),
        prompt_chars=999,
        completion_chars=999,
        pricing=PRICE,
        status=RunStatus.SUCCESS,
    )
    assert m.ttft_ms == 250.0
    assert m.total_ms == 2250.0
    assert (m.prompt_tokens, m.completion_tokens, m.total_tokens) == (50, 100, 150)
    assert m.tokens_estimated is False
    assert m.throughput_tps == pytest.approx(50.0)
    assert m.cost_usd == pytest.approx(50 * 2 / 1e6 + 100 * 8 / 1e6)
    assert m.error_category is None


def test_compute_metrics_estimates_and_flags_without_usage() -> None:
    m = compute_metrics(
        started_at=0,
        first_token_at=None,
        finished_at=1,
        streamed=False,
        usage=None,
        prompt_chars=40,
        completion_chars=80,
        pricing=None,
        status=RunStatus.SUCCESS,
    )
    assert m.ttft_ms is None and m.ttft_supported is False
    assert (m.prompt_tokens, m.completion_tokens, m.tokens_estimated) == (10, 20, True)
    assert m.cost_usd is None


def test_failed_run_has_category_and_no_throughput() -> None:
    m = compute_metrics(
        started_at=0,
        first_token_at=0.1,
        finished_at=1,
        streamed=True,
        usage=None,
        prompt_chars=4,
        completion_chars=40,
        pricing=None,
        status=RunStatus.TIMEOUT,
        error_category=ErrorCategory.TIMEOUT,
    )
    assert m.throughput_tps is None
    assert m.error_category is ErrorCategory.TIMEOUT


@pytest.mark.parametrize(
    ("code", "category", "client_fault"),
    [
        (401, ErrorCategory.AUTH, True),
        (403, ErrorCategory.AUTH, True),
        (429, ErrorCategory.RATE_LIMIT, False),
        (500, ErrorCategory.SERVER, False),
        (503, ErrorCategory.SERVER, False),
        (504, ErrorCategory.TIMEOUT, False),
        (404, ErrorCategory.SERVER, True),
    ],
)
def test_error_classification(code: int, category: ErrorCategory, client_fault: bool) -> None:
    assert classify_status(code) is category
    assert is_client_fault(code) is client_fault


def test_zero_usage_with_text_is_estimated_not_trusted() -> None:
    m = compute_metrics(
        started_at=0,
        first_token_at=0.1,
        finished_at=1,
        streamed=True,
        usage=Usage(prompt_tokens=0, completion_tokens=0),
        prompt_chars=400,
        completion_chars=8000,
        pricing=PRICE,
        status=RunStatus.SUCCESS,
    )
    assert (m.prompt_tokens, m.completion_tokens, m.tokens_estimated) == (100, 2000, True)
    assert m.cost_usd and m.cost_usd > 0
