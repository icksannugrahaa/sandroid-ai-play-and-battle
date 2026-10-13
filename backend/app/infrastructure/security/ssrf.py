"""SSRF guard.

Two layers:
  1. `validate_base_url` — static checks (scheme, no userinfo/query/fragment) plus a
     DNS pre-check that rejects private/loopback/link-local/reserved targets early
     with a friendly error.
  2. `GuardedNetworkBackend` — an httpcore network backend that resolves the host
     itself, re-validates EVERY resolved address, and connects to the vetted IP.
     TLS SNI/certificate checks still use the original hostname (httpcore passes
     it separately to `start_tls`), so this defeats DNS-rebinding without
     weakening TLS.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Iterable
from typing import Any
from urllib.parse import urlsplit

import httpcore
import httpx


class BlockedDestination(Exception):
    """The endpoint is not allowed. Message is safe to show to the client."""


IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def is_forbidden_ip(ip: IPAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


def normalize_base_url(raw: str, *, allow_http: bool = False) -> str:
    url = raw.strip()
    parts = urlsplit(url)
    allowed = {"https", "http"} if allow_http else {"https"}
    if parts.scheme.lower() not in allowed:
        raise BlockedDestination("only https endpoints are allowed")
    if not parts.hostname:
        raise BlockedDestination("endpoint has no host")
    if parts.username or parts.password:
        raise BlockedDestination("credentials in the URL are not allowed — use the API key field")
    if parts.query or parts.fragment:
        raise BlockedDestination("query strings and fragments are not allowed in the base URL")
    return url.rstrip("/")


async def resolve_host(host: str, port: int) -> list[IPAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise BlockedDestination("endpoint host could not be resolved") from exc
    addresses: list[IPAddress] = []
    for info in infos:
        addr = str(info[4][0]).split("%", 1)[0]
        addresses.append(ipaddress.ip_address(addr))
    if not addresses:
        raise BlockedDestination("endpoint host could not be resolved")
    return addresses


def check_addresses(addresses: Iterable[IPAddress]) -> None:
    for ip in addresses:
        if is_forbidden_ip(ip):
            raise BlockedDestination("endpoint resolves to a private or reserved address")


async def validate_base_url(raw: str, *, allow_private: bool = False, allow_http: bool = False) -> str:
    url = normalize_base_url(raw, allow_http=allow_http)
    if not allow_private:
        parts = urlsplit(url)
        assert parts.hostname is not None
        check_addresses(await resolve_host(parts.hostname, parts.port or 443))
    return url


class GuardedNetworkBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, inner: httpcore.AsyncNetworkBackend | None = None, *, allow_private: bool = False) -> None:
        self._inner = inner or httpcore.AnyIOBackend()
        self._allow_private = allow_private

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if self._allow_private:
            return await self._inner.connect_tcp(host, port, timeout, local_address, socket_options)
        addresses = await resolve_host(host, port)
        check_addresses(addresses)
        last_exc: Exception | None = None
        for ip in addresses:
            try:
                return await self._inner.connect_tcp(str(ip), port, timeout, local_address, socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as exc:
                last_exc = exc
        raise httpcore.ConnectError("could not connect") from last_exc

    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Iterable[Any] | None = None
    ) -> httpcore.AsyncNetworkStream:
        raise BlockedDestination("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class GuardedTransport(httpx.AsyncHTTPTransport):
    """httpx transport whose connection pool dials only vetted public IPs. No proxies, no env."""

    def __init__(self, *, allow_private: bool = False, max_connections: int = 100) -> None:
        super().__init__(trust_env=False, limits=httpx.Limits(max_connections=max_connections))
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=max_connections,
            max_keepalive_connections=20,
            keepalive_expiry=30.0,
            network_backend=GuardedNetworkBackend(allow_private=allow_private),
        )
