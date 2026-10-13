import ipaddress
import logging

import pytest

from app.infrastructure.security.rate_limit import ArenaGuard, TokenBucketLimiter, TooManyArenas
from app.infrastructure.security.redaction import RedactingFilter, mask_ip, redact_headers, redact_text
from app.infrastructure.security.ssrf import (
    BlockedDestination,
    GuardedNetworkBackend,
    is_forbidden_ip,
    normalize_base_url,
    validate_base_url,
)


@pytest.mark.parametrize(
    "ip",
    [
        "10.0.0.1",
        "172.16.5.4",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.169.254",
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "100.64.0.1",
    ],
)
def test_private_and_special_ips_forbidden(ip: str) -> None:
    assert is_forbidden_ip(ipaddress.ip_address(ip))


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_ips_allowed(ip: str) -> None:
    assert not is_forbidden_ip(ipaddress.ip_address(ip))


@pytest.mark.parametrize(
    "url",
    [
        "http://api.example.com/v1",
        "ftp://x.com",
        "https://user:pw@x.com/v1",
        "https://x.com/v1?key=abc",
        "https://x.com/v1#f",
        "https:///v1",
        "file:///etc/passwd",
    ],
)
def test_bad_urls_rejected(url: str) -> None:
    with pytest.raises(BlockedDestination):
        normalize_base_url(url)


def test_url_normalized() -> None:
    assert normalize_base_url(" https://api.example.com/v1/ ") == "https://api.example.com/v1"
    assert normalize_base_url("http://localhost:11434/v1", allow_http=True) == "http://localhost:11434/v1"


@pytest.mark.parametrize(
    "url", ["https://127.0.0.1/v1", "https://169.254.169.254/latest", "https://[::1]/v1", "https://10.1.2.3:8443/v1"]
)
async def test_literal_private_ip_blocked(url: str) -> None:
    with pytest.raises(BlockedDestination):
        await validate_base_url(url)


async def test_private_allowed_when_opted_in() -> None:
    assert await validate_base_url("https://127.0.0.1/v1", allow_private=True) == "https://127.0.0.1/v1"


async def test_guarded_backend_blocks_at_connect_time() -> None:
    backend = GuardedNetworkBackend()
    with pytest.raises(BlockedDestination):
        await backend.connect_tcp("127.0.0.1", 443)


def test_redaction_patterns() -> None:
    text = (
        "Authorization: Bearer sk-live-abcdef1234567890 and x-api-key=gsk_ABCDEFGH12345 "
        "url?key=AIzaSy0123456789012345678901"
    )
    out = redact_text(text)
    assert "sk-live" not in out and "gsk_" not in out and "AIza" not in out
    assert out.count("[REDACTED]") >= 3


def test_redact_headers() -> None:
    out = redact_headers({"Authorization": "Bearer x", "X-Api-Key-2": "k", "Content-Type": "json"})
    assert out == {"Authorization": "[REDACTED]", "X-Api-Key-2": "[REDACTED]", "Content-Type": "json"}


def test_logging_filter_scrubs_args(caplog: pytest.LogCaptureFixture) -> None:
    logger = logging.getLogger("test.redact")
    logger.addFilter(RedactingFilter())
    with caplog.at_level(logging.INFO, logger="test.redact"):
        logger.info("upstream said %s", "Bearer sk-abcdefghijklmnop")
    assert "sk-abcdefghijklmnop" not in caplog.text
    assert "[REDACTED]" in caplog.text


def test_mask_ip() -> None:
    assert mask_ip("203.0.113.42") == "203.0.113.x"
    assert mask_ip("2001:db8:1:2::5") == "2001:db8:1:x"


def test_token_bucket() -> None:
    now = [0.0]
    limiter = TokenBucketLimiter(per_minute=2, clock=lambda: now[0])
    assert limiter.acquire("ip") == 0 and limiter.acquire("ip") == 0
    assert limiter.acquire("ip") > 0
    assert limiter.acquire("other") == 0  # per-key
    now[0] += 30
    assert limiter.acquire("ip") == 0


def test_arena_guard_limits() -> None:
    guard = ArenaGuard(max_active=2, max_parallel=1)
    release_parallel = guard.acquire("ip", parallel=True)
    with pytest.raises(TooManyArenas):
        guard.acquire("ip", parallel=True)
    release_seq = guard.acquire("ip", parallel=False)
    with pytest.raises(TooManyArenas):
        guard.acquire("ip", parallel=False)
    release_parallel()
    release_parallel()  # idempotent
    release_seq()
    assert guard.active("ip") == 0
