"""Contract tests against a mock OpenAI-compatible server (httpx.MockTransport)."""

import base64
import json

import httpx
import pytest

from app.domain.entities import ErrorCategory
from app.domain.ports.provider import ChatRequest, ImageRequest, ProviderError
from app.infrastructure.providers.openai_compatible import OpenAICompatibleClient

BASE = "https://provider.test/v1"
KEY = "sk-test-contract-0123456789"


def make_client(handler, **kw) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(httpx.AsyncClient(transport=httpx.MockTransport(handler)), allow_private=True, **kw)


def sse(*chunks: dict | str) -> bytes:
    lines = [f"data: {c if isinstance(c, str) else json.dumps(c)}\n\n" for c in chunks]
    return "".join(lines).encode()


async def collect(client, request=None):
    req = request or ChatRequest(model="m", messages=[{"role": "user", "content": "hi"}], params={"temperature": 0.2})
    return [c async for c in client.stream_chat(BASE, KEY, req)]


async def test_list_models_sends_bearer_and_parses() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"data": [{"id": "gpt-4o", "owned_by": "openai"}, {"id": "x/qwen3.8"}]})

    models = await make_client(handler).list_models(BASE, KEY)
    assert [m.id for m in models] == ["gpt-4o", "x/qwen3.8"]
    assert seen == {"auth": f"Bearer {KEY}", "url": f"{BASE}/models"}


async def test_list_models_without_key_sends_no_auth_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "authorization" not in request.headers
        return httpx.Response(200, json=["a", "b"])

    assert [m.id for m in await make_client(handler).list_models(BASE, "")] == ["a", "b"]


async def test_stream_chat_parses_sse_and_usage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
        assert body["temperature"] == 0.2
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse(
                {"choices": [{"delta": {"role": "assistant"}}]},
                {"choices": [{"delta": {"content": "Hel"}}]},
                {"choices": [{"delta": {"content": "lo"}}]},
                {"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 2}},
                "[DONE]",
            ),
        )

    chunks = await collect(make_client(handler))
    assert "".join(c.text for c in chunks) == "Hello"
    assert chunks[-1].usage is not None and chunks[-1].usage.completion_tokens == 2
    assert all(c.streamed for c in chunks)


async def test_stream_chat_non_streaming_fallback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "full"}}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}},
        )

    chunks = await collect(make_client(handler))
    assert len(chunks) == 1 and chunks[0].text == "full" and chunks[0].streamed is False


async def test_retries_without_stream_options_on_400() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append("stream_options" in body)
        if "stream_options" in body:
            return httpx.Response(400, json={"error": "unknown field"})
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse({"choices": [{"delta": {"content": "ok"}}]}, "[DONE]"),
        )

    chunks = await collect(make_client(handler))
    assert calls == [True, False] and chunks[0].text == "ok"


def _ok() -> httpx.Response:
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content=sse({"choices": [{"delta": {"content": "ok"}}]}, "[DONE]"),
    )


async def test_auto_max_tokens_starts_large_and_steps_down_on_limit_errors() -> None:
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body.get("max_tokens"))
        if body.get("max_tokens", 0) > 32_768:
            return httpx.Response(
                400, json={"error": {"message": f"max_tokens: {body['max_tokens']} > 32768, which is the maximum"}}
            )
        return _ok()

    chunks = await collect(make_client(handler))
    assert sent == [131_072, 65_536, 32_768] and chunks[0].text == "ok"


async def test_explicit_max_tokens_is_sent_as_is() -> None:
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content).get("max_tokens"))
        return _ok()

    req = ChatRequest(model="m", messages=[{"role": "user", "content": "hi"}], params={"max_tokens": 500})
    await collect(make_client(handler), req)
    assert sent == [500]


async def test_unexplained_400_falls_back_to_the_plain_request() -> None:
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(("stream_options" in body, body.get("max_tokens")))
        if "max_tokens" in body:
            return httpx.Response(400, json={"error": "bad request"})
        return _ok()

    chunks = await collect(make_client(handler))
    assert sent == [(True, 131_072), (False, 131_072), (False, None)] and chunks[0].text == "ok"


@pytest.mark.parametrize(
    ("status", "category"),
    [(401, ErrorCategory.AUTH), (429, ErrorCategory.RATE_LIMIT), (500, ErrorCategory.SERVER)],
)
async def test_http_errors_become_sanitized_categories(status: int, category: ErrorCategory) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"message": f"bad key {KEY} at https://internal.corp"}})

    with pytest.raises(ProviderError) as info:
        await collect(make_client(handler))
    assert info.value.category is category
    assert KEY not in str(info.value) and "internal.corp" not in str(info.value)
    assert (info.value.__cause__ is None and info.value.__context__ is None) or KEY not in repr(info.value.__context__)


async def test_network_and_timeout_errors() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(ProviderError) as info:
        await collect(make_client(boom))
    assert info.value.category is ErrorCategory.NETWORK

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(ProviderError) as info:
        await collect(make_client(slow))
    assert info.value.category is ErrorCategory.TIMEOUT


async def test_in_stream_error_object() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=sse({"error": {"message": "overloaded"}})
        )

    with pytest.raises(ProviderError):
        await collect(make_client(handler))


async def test_response_size_cap() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "x" * 5000}]})

    with pytest.raises(ProviderError):
        await make_client(handler, max_response_bytes=1000).list_models(BASE, KEY)


async def test_generate_image_b64_and_retry_without_response_format() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body.get("response_format"))
        if "response_format" in body:
            return httpx.Response(400, json={})
        return httpx.Response(200, json={"data": [{"b64_json": "AAAA"}, {"url": "http://insecure/img.png"}]})

    result = await make_client(handler).generate_image(
        BASE, KEY, ImageRequest(model="gpt-image-1", prompt="cat", size="512x512")
    )
    assert calls == ["b64_json", None]
    assert result.images == ["data:image/png;base64,AAAA"]  # http URL dropped


async def test_ssrf_blocked_base_url_is_network_error() -> None:
    client = OpenAICompatibleClient(httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200))))
    with pytest.raises(ProviderError) as info:
        await client.list_models("https://127.0.0.1/v1", KEY)
    assert info.value.category is ErrorCategory.NETWORK


async def test_stream_images_and_audio_fragments() -> None:
    pcm_a, pcm_b = b"\x01\x00\x02\x00", b"\x03\x00"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse(
                {
                    "choices": [
                        {
                            "delta": {
                                "images": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,QQ=="}}]
                            }
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {
                                "content": [
                                    {"type": "text", "text": "see"},
                                    {"type": "image_url", "image_url": {"url": "http://insecure/x.png"}},
                                ]
                            }
                        }
                    ]
                },
                {"choices": [{"delta": {"audio": {"data": base64.b64encode(pcm_a).decode(), "transcript": "hi"}}}]},
                {"choices": [{"delta": {"audio": {"data": base64.b64encode(pcm_b).decode()}}}]},
                "[DONE]",
            ),
        )

    chunks = await collect(make_client(handler))
    assert [img for c in chunks for img in c.images] == ["data:image/png;base64,QQ=="]  # http dropped
    assert "".join(c.text for c in chunks) == "seehi"
    assert b"".join(c.audio for c in chunks) == pcm_a + pcm_b  # decoded per fragment


async def test_non_stream_message_audio_and_images() -> None:
    wav = b"RIFF\x00\x00\x00\x00WAVE"

    def handler(request: httpx.Request) -> httpx.Response:
        msg = {
            "content": None,
            "audio": {"data": base64.b64encode(wav).decode(), "transcript": "spoken"},
            "images": ["https://cdn.test/a.png"],
        }
        return httpx.Response(200, json={"choices": [{"message": msg}]})

    [chunk] = await collect(make_client(handler))
    assert (chunk.text, chunk.images, chunk.audio) == ("spoken", ("https://cdn.test/a.png",), wav)


@pytest.mark.parametrize("charset", ["", "; charset=utf-8", "; charset=iso-8859-1"])
async def test_sse_is_always_decoded_as_utf8(charset: str) -> None:
    text = "🐢 Pelan ⚡ Cepat — ñ"
    raw = ("data: " + json.dumps({"choices": [{"delta": {"content": text}}]}, ensure_ascii=False) + "\n\n").encode()

    class Chunked(httpx.AsyncByteStream):
        async def __aiter__(self):
            for i in range(0, len(raw), 3):  # split multi-byte characters across chunks
                yield raw[i : i + 3]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream" + charset}, stream=Chunked())

    assert "".join(c.text for c in await collect(make_client(handler))) == text


async def test_stream_reasoning_is_separate_from_answer() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse(
                {"choices": [{"delta": {"reasoning_content": "Let me "}}]},
                # OpenRouter repeats `reasoning` in `reasoning_details`; must not be doubled
                {
                    "choices": [
                        {
                            "delta": {
                                "reasoning": "think.",
                                "reasoning_details": [{"type": "reasoning.text", "text": "think."}],
                            }
                        }
                    ]
                },
                {"choices": [{"delta": {"reasoning_details": [{"type": "reasoning.summary", "summary": " Done."}]}}]},
                {"choices": [{"delta": {"content": "42"}}]},
                "[DONE]",
            ),
        )

    chunks = await collect(make_client(handler))
    assert "".join(c.reasoning for c in chunks) == "Let me think. Done."
    assert "".join(c.text for c in chunks) == "42"


async def test_cloudflare_origin_timeout_is_a_timeout() -> None:
    client = make_client(lambda r: httpx.Response(524, text="<html>A timeout occurred</html>"))
    with pytest.raises(ProviderError) as exc:
        await collect(client)
    assert exc.value.category is ErrorCategory.TIMEOUT and exc.value.status_code == 524


@pytest.mark.parametrize(
    ("err", "status"),
    [({"code": 503, "message": "upstream down"}, 503), ({"code": "529"}, 529), ({"message": "boom"}, None)],
)
async def test_in_stream_error_keeps_only_numeric_status(err: dict, status: int | None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse({"choices": [{"delta": {"content": "Hi"}}]}, {"error": err}),
        )

    with pytest.raises(ProviderError) as exc:
        await collect(make_client(handler))
    assert exc.value.status_code == status
    assert "upstream down" not in str(exc.value)  # never the upstream text


async def test_finish_reason_known_codes_only() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse(
                {"choices": [{"delta": {"content": "half an ans"}}]},
                {"choices": [{"delta": {}, "finish_reason": "length"}]},
                "[DONE]",
            ),
        )

    chunks = await collect(make_client(handler))
    assert [c.finish_reason for c in chunks if c.finish_reason] == ["length"]

    weird = make_client(
        lambda r: httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse({"choices": [{"delta": {}, "finish_reason": "some free text"}]}, "[DONE]"),
        )
    )
    assert all(c.finish_reason is None for c in await collect(weird))


async def test_stream_cut_without_done_is_marked_incomplete() -> None:
    def cut(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse({"choices": [{"delta": {"content": "Wait reverse of UBR→DB"}}]}),
        )

    chunks = await collect(make_client(cut))
    assert chunks[-1].finish_reason == "incomplete"

    def complete(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=sse({"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}),
        )

    assert all(c.finish_reason != "incomplete" for c in await collect(make_client(complete)))
