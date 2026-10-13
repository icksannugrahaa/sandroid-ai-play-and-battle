"""OpenAI-compatible provider client (httpx async).

The API key is passed per call, placed in the Authorization header of the
outgoing request, and dropped when the call returns. httpx exceptions (which
reference the request, and therefore its headers) are converted to a sanitized
`ProviderError` and never chained, logged or returned.
"""

from __future__ import annotations

import base64
import codecs
import json
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.domain.entities import ErrorCategory, Usage
from app.domain.ports.provider import (
    ChatChunk,
    ChatRequest,
    ImageRequest,
    ImageResult,
    ProviderError,
    ProviderModel,
)
from app.infrastructure.security.ssrf import BlockedDestination, validate_base_url

# Output budgets tried, largest first, when the client leaves max_tokens on "auto".
AUTO_MAX_TOKENS = (131_072, 65_536, 32_768, 16_384, 8_192)
# A 400 that is about the output budget (e.g. "max_tokens: 131072 > 64000, which is the maximum").
_TOKEN_LIMIT_ERROR = re.compile(
    r"max_tokens|max_completion_tokens|max_output_tokens"
    r"|maximum.{0,40}tokens|tokens.{0,40}(exceed|limit|maximum|too large)"
)


def _headers(api_key: str, *, stream: bool = False) -> dict[str, str]:
    headers = {"Accept": "text/event-stream" if stream else "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _usage(obj: Any) -> Usage | None:
    if not isinstance(obj, dict):
        return None
    pt, ct = obj.get("prompt_tokens"), obj.get("completion_tokens")
    if pt is None and ct is None:
        return None
    return Usage(
        prompt_tokens=int(pt) if isinstance(pt, int | float) else None,
        completion_tokens=int(ct) if isinstance(ct, int | float) else None,
    )


def _image_url(item: Any) -> str | None:
    url: Any
    if isinstance(item, str):
        url = item
    elif isinstance(item, dict):
        inner = item.get("image_url", item.get("url"))
        url = inner.get("url") if isinstance(inner, dict) else inner
    else:
        return None
    if isinstance(url, str) and (url.startswith("data:image/") or url.startswith("https://")):
        return url
    return None


def _stream_error(err: Any) -> ProviderError:
    """An `{"error": …}` object sent inside an SSE stream (often an upstream failure mid-answer)."""
    code: Any = None
    if isinstance(err, dict):
        code = err.get("code") if err.get("code") is not None else err.get("status")
    try:
        status = int(code)
    except TypeError, ValueError:
        status = 0
    return ProviderError.from_status(status) if 400 <= status <= 599 else ProviderError(ErrorCategory.SERVER)


FINISH_REASONS = frozenset(
    {"stop", "length", "content_filter", "tool_calls", "function_call", "max_tokens", "end_turn"}
)


def _finish_reason(choice: Any) -> str | None:
    """Why the model stopped. Only known short codes pass through (never free text);
    `max_tokens` (Anthropic-style gateways) is reported as `length`."""
    value = choice.get("finish_reason") if isinstance(choice, dict) else None
    if not isinstance(value, str) or value not in FINISH_REASONS:
        return None
    return "length" if value == "max_tokens" else "stop" if value == "end_turn" else value


def _reasoning(message: Any) -> str:
    """Visible "thinking" text, as streamed by reasoning models.

    DeepSeek/Qwen/Kimi gateways use `reasoning_content`, OpenRouter `reasoning`
    (plus `reasoning_details`, which repeats it — only used when the others are absent).
    """
    if not isinstance(message, dict):
        return ""
    for key in ("reasoning_content", "reasoning"):
        if isinstance(message.get(key), str) and message[key]:
            return str(message[key])
    parts = []
    for item in message.get("reasoning_details") or []:
        if isinstance(item, dict):
            value = item.get("text") or item.get("summary")
            if isinstance(value, str):
                parts.append(value)
    return "".join(parts)


def _message_parts(message: Any) -> tuple[str, tuple[str, ...], bytes]:
    """Text, images and audio from an OpenAI-style `message` or streaming `delta`.

    Handles plain string content, content-part lists (`text` / `image_url`),
    `images` (OpenRouter/Gemini image output) and `audio` (data + transcript).
    """
    if not isinstance(message, dict):
        return "", (), b""
    text_parts: list[str] = []
    images: list[str] = []
    content = message.get("content")
    if isinstance(content, str):
        text_parts.append(content)
    elif isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                text_parts.append(part["text"])
            elif part.get("type") == "image_url" and (url := _image_url(part)):
                images.append(url)
    for item in message.get("images") or []:
        if url := _image_url(item):
            images.append(url)
    audio = b""
    audio_obj = message.get("audio")
    if isinstance(audio_obj, dict):
        if isinstance(audio_obj.get("transcript"), str) and not text_parts:
            text_parts.append(audio_obj["transcript"])
        if isinstance(audio_obj.get("data"), str):
            try:
                audio = base64.b64decode(audio_obj["data"])
            except ValueError:
                audio = b""
    return "".join(text_parts), tuple(images), audio


class OpenAICompatibleClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        allow_private: bool = False,
        allow_http: bool = False,
        max_response_bytes: int = 20 * 1024 * 1024,
        read_timeout_s: float = 300.0,
        connect_timeout_s: float = 10.0,
    ) -> None:
        self._http = http
        self._allow_private = allow_private
        self._allow_http = allow_http
        self._max_bytes = max_response_bytes
        self._timeout = httpx.Timeout(read_timeout_s, connect=connect_timeout_s)

    async def _url(self, base_url: str, path: str) -> str:
        try:
            base = await validate_base_url(base_url, allow_private=self._allow_private, allow_http=self._allow_http)
        except BlockedDestination:
            raise ProviderError(ErrorCategory.NETWORK) from None
        return f"{base}/{path.lstrip('/')}"

    async def _read_capped(self, response: httpx.Response) -> bytes:
        declared = response.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > self._max_bytes:
            raise ProviderError(ErrorCategory.SERVER)
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > self._max_bytes:
                raise ProviderError(ErrorCategory.SERVER)
            chunks.append(chunk)
        return b"".join(chunks)

    async def _json(self, response: httpx.Response) -> Any:
        try:
            return json.loads(await self._read_capped(response))
        except ValueError, UnicodeDecodeError:
            raise ProviderError(ErrorCategory.SERVER) from None

    # ------------------------------------------------------------------ models
    async def list_models(self, base_url: str, api_key: str) -> list[ProviderModel]:
        url = await self._url(base_url, "models")
        try:
            async with self._http.stream("GET", url, headers=_headers(api_key), timeout=self._timeout) as resp:
                if resp.status_code >= 400:
                    raise ProviderError.from_status(resp.status_code)
                body = await self._json(resp)
        except httpx.TimeoutException:
            raise ProviderError(ErrorCategory.TIMEOUT) from None
        except httpx.HTTPError, BlockedDestination:
            raise ProviderError(ErrorCategory.NETWORK) from None

        items: Any = body
        if isinstance(body, dict):
            items = body.get("data", body.get("models", []))
        if not isinstance(items, list):
            raise ProviderError(ErrorCategory.SERVER)
        models: list[ProviderModel] = []
        for item in items:
            if isinstance(item, str):
                models.append(ProviderModel(id=item))
            elif isinstance(item, dict) and isinstance(mid := item.get("id") or item.get("name"), str):
                meta = {k: item[k] for k in ("architecture", "modalities", "type") if k in item}
                owner = item.get("owned_by")
                models.append(ProviderModel(id=mid, owned_by=owner if isinstance(owner, str) else None, metadata=meta))
        return models

    # -------------------------------------------------------------------- chat
    async def stream_chat(self, base_url: str, api_key: str, request: ChatRequest) -> AsyncIterator[ChatChunk]:
        url = await self._url(base_url, "chat/completions")
        payload: dict[str, Any] = {
            **request.params,
            "model": request.model,
            "messages": request.messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        # "auto" output budget = as large as the provider accepts: thinking models spend most
        # of it on hidden reasoning, and a provider's small default cuts the answer off.
        auto_budget = payload.get("max_tokens") is None
        if auto_budget:
            payload["max_tokens"] = AUTO_MAX_TOKENS[0]
        try:
            for _attempt in range(len(AUTO_MAX_TOKENS) + 3):
                async with self._http.stream(
                    "POST", url, json=payload, headers=_headers(api_key, stream=True), timeout=self._timeout
                ) as resp:
                    if resp.status_code in (400, 422):
                        # 400s are not billed: adapt and retry. Too large an output budget →
                        # step down; a strict server rejecting stream_options → drop it.
                        body = (await resp.aread())[:4000].decode("utf-8", "replace").lower()
                        if auto_budget and "max_tokens" in payload and _TOKEN_LIMIT_ERROR.search(body):
                            smaller = [n for n in AUTO_MAX_TOKENS if n < payload["max_tokens"]]
                            if smaller:
                                payload["max_tokens"] = smaller[0]
                            else:
                                payload.pop("max_tokens")  # leave it to the provider's default
                            continue
                        if "stream_options" in payload:
                            payload.pop("stream_options")
                            continue
                        if auto_budget and "max_tokens" in payload:
                            # unexplained 400: try once more exactly as before auto budgets existed
                            payload.pop("max_tokens")
                            continue
                    if resp.status_code >= 400:
                        raise ProviderError.from_status(resp.status_code)
                    if "text/event-stream" in resp.headers.get("content-type", ""):
                        async for chunk in self._parse_sse(resp):
                            yield chunk
                    else:
                        yield self._parse_completion(await self._json(resp))
                    return
        except httpx.TimeoutException:
            raise ProviderError(ErrorCategory.TIMEOUT) from None
        except httpx.HTTPError, BlockedDestination:
            raise ProviderError(ErrorCategory.NETWORK) from None

    async def _utf8_lines(self, resp: httpx.Response) -> AsyncIterator[str]:
        """SSE is UTF-8 by spec. Decode bytes ourselves instead of trusting the declared
        charset — some gateways send `charset=iso-8859-1`, which turns emoji into mojibake.
        The incremental decoder keeps characters split across network chunks intact."""
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        buffer = ""
        size = 0
        async for chunk in resp.aiter_bytes():
            size += len(chunk)
            if size > self._max_bytes:
                raise ProviderError(ErrorCategory.SERVER)
            buffer += decoder.decode(chunk)
            *lines, buffer = buffer.replace("\r\n", "\n").replace("\r", "\n").split("\n")
            for line in lines:
                yield line
        buffer += decoder.decode(b"", final=True)
        if buffer:
            yield buffer

    async def _parse_sse(self, resp: httpx.Response) -> AsyncIterator[ChatChunk]:
        finished = False  # saw [DONE] or a finish_reason
        async for line in self._utf8_lines(resp):
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                obj = json.loads(data)
            except ValueError:
                continue
            if not isinstance(obj, dict):
                continue
            if "error" in obj:
                # keep only a numeric status if the gateway includes one — never its text
                raise _stream_error(obj["error"])
            images: tuple[str, ...] = ()
            text, audio, reasoning, finish = "", b"", "", None
            choices = obj.get("choices")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("delta") or choices[0].get("message")
                text, images, audio = _message_parts(message)
                reasoning = _reasoning(message)
                finish = _finish_reason(choices[0])
                finished = finished or finish is not None
            usage = _usage(obj.get("usage"))
            if text or usage or images or audio or reasoning or finish:
                yield ChatChunk(
                    text=text,
                    usage=usage,
                    streamed=True,
                    images=images,
                    audio=audio,
                    reasoning=reasoning,
                    finish_reason=finish,
                )
        if not finished:
            # the connection closed cleanly but the stream never said it was done (no
            # [DONE], no finish_reason): something between us and the model cut it short
            yield ChatChunk(finish_reason="incomplete")

    @staticmethod
    def _parse_completion(body: Any) -> ChatChunk:
        if not isinstance(body, dict) or "error" in body:
            raise ProviderError(ErrorCategory.SERVER)
        images: tuple[str, ...] = ()
        text, audio, reasoning, finish = "", b"", "", None
        choices = body.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            text, images, audio = _message_parts(choices[0].get("message"))
            reasoning = _reasoning(choices[0].get("message"))
            finish = _finish_reason(choices[0])
        return ChatChunk(
            text=text,
            usage=_usage(body.get("usage")),
            streamed=False,
            images=images,
            audio=audio,
            reasoning=reasoning,
            finish_reason=finish,
        )

    # ------------------------------------------------------------------ images
    async def generate_image(self, base_url: str, api_key: str, request: ImageRequest) -> ImageResult:
        url = await self._url(base_url, "images/generations")
        payload: dict[str, Any] = {
            "model": request.model,
            "prompt": request.prompt,
            "n": request.n,
            "response_format": "b64_json",
        }
        if request.size:
            payload["size"] = request.size
        try:
            for attempt in range(2):
                async with self._http.stream(
                    "POST", url, json=payload, headers=_headers(api_key), timeout=self._timeout
                ) as resp:
                    if resp.status_code == 400 and attempt == 0 and "response_format" in payload:
                        payload.pop("response_format")  # e.g. gpt-image-* always returns b64 and rejects it
                        continue
                    if resp.status_code >= 400:
                        raise ProviderError.from_status(resp.status_code)
                    body = await self._json(resp)
                    break
        except httpx.TimeoutException:
            raise ProviderError(ErrorCategory.TIMEOUT) from None
        except httpx.HTTPError, BlockedDestination:
            raise ProviderError(ErrorCategory.NETWORK) from None

        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise ProviderError(ErrorCategory.SERVER)
        images: list[str] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            if isinstance(b64 := item.get("b64_json"), str):
                images.append(f"data:image/png;base64,{b64}")
            elif isinstance(link := item.get("url"), str) and link.startswith("https://"):
                images.append(link)
        if not images:
            raise ProviderError(ErrorCategory.SERVER)
        return ImageResult(images=images)
