import asyncio
from datetime import UTC, datetime, timedelta

from app.application.execution import PromptSpec, RunEvent, RunTarget, execute_target, stream_worker
from app.application.leaderboard_query import decode_cursor, encode_cursor
from app.application.research_pricing import CooldownGate
from app.domain.entities import ErrorCategory, Modality, RunStatus
from app.domain.services.normalizer import AliasRegistry
from tests.conftest import FakeProvider


async def no_price(_key: str) -> None:
    return None


async def test_executor_timeout_marks_run() -> None:
    events: list[RunEvent] = []

    async def emit(e: RunEvent) -> None:
        events.append(e)

    outcome = await execute_target(
        provider=FakeProvider(),
        aliases=AliasRegistry(),
        pricing_lookup=no_price,
        target=RunTarget(base_url="https://p.test/v1", model="slow", api_key="k"),
        spec=PromptSpec(modality=Modality.CHAT, prompt="hi"),
        timeout_s=0.05,
        emit=emit,
    )
    assert outcome.metrics.status is RunStatus.TIMEOUT
    assert outcome.metrics.error_category is ErrorCategory.TIMEOUT
    assert [e.type for e in events] == ["start", "error", "metrics"]


def test_run_target_repr_hides_key() -> None:
    t = RunTarget(base_url="https://p.test/v1", model="m", api_key="sk-supersecret")
    assert "sk-supersecret" not in repr(t)
    assert t.provider_label == "p.test"


def test_vision_messages() -> None:
    spec = PromptSpec(
        modality=Modality.VISION,
        prompt="what?",
        system="s",
        history=(("user", "a"), ("assistant", "b")),
        images=("data:image/png;base64,AA",),
    )
    msgs = spec.to_messages()
    assert [m["role"] for m in msgs] == ["system", "user", "assistant", "user"]
    assert msgs[-1]["content"][1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}


async def test_stream_worker_cancels_on_consumer_exit() -> None:
    cancelled = asyncio.Event()

    async def work(emit) -> None:
        await emit(RunEvent("start", {}))
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    stream = stream_worker(work)
    assert (await anext(stream)).type == "start"
    await stream.aclose()
    assert cancelled.is_set()


def test_cooldown_gate() -> None:
    now = [datetime(2026, 1, 1, tzinfo=UTC)]
    gate = CooldownGate(3600, now=lambda: now[0])
    assert gate.remaining_s() == 0
    gate.mark()
    assert gate.remaining_s() == 3600
    now[0] += timedelta(minutes=59)
    assert gate.remaining_s() == 60
    now[0] += timedelta(minutes=2)
    assert gate.remaining_s() == 0


def test_cooldown_seed_from_db_after_restart() -> None:
    now = datetime(2026, 1, 1, 12, tzinfo=UTC)
    gate = CooldownGate(3600, now=lambda: now)
    gate.seed(datetime(2026, 1, 1, 11, 30))  # naive (SQLite) is treated as UTC
    assert gate.remaining_s() == 1800


def test_cursor_roundtrip() -> None:
    assert decode_cursor(encode_cursor(75)) == 75
    assert decode_cursor(None) == 0


def test_attachments_become_openai_content_parts() -> None:
    spec = PromptSpec(
        modality=Modality.CHAT,
        prompt="summarize",
        attachments=(
            ("audio", "note.mp3", "data:audio/mpeg;base64,SUQz"),
            ("file", "a.pdf", "data:application/pdf;base64,JVBE"),
        ),
    )
    parts = spec.to_messages()[-1]["content"]
    assert parts[0] == {"type": "text", "text": "summarize"}
    assert parts[1] == {"type": "input_audio", "input_audio": {"data": "SUQz", "format": "mp3"}}
    assert parts[2] == {"type": "file", "file": {"filename": "a.pdf", "file_data": "data:application/pdf;base64,JVBE"}}


def test_attachment_only_message_has_no_empty_text_part() -> None:
    spec = PromptSpec(
        modality=Modality.CHAT, prompt="", attachments=(("audio", "a.wav", "data:audio/wav;base64,UklG"),)
    )
    assert [p["type"] for p in spec.to_messages()[-1]["content"]] == ["input_audio"]


async def test_ttft_counts_streamed_reasoning() -> None:
    """A thinking model streams reasoning for minutes before its answer; TTFT must not be
    the answer's arrival (that made 9.9k tokens look like they came in 0.3 s)."""
    from app.domain.ports.provider import ChatChunk

    class Thinker:
        async def stream_chat(self, base_url, api_key, request):
            yield ChatChunk(reasoning="let me think " * 200)
            await asyncio.sleep(0.2)
            yield ChatChunk(text="U2 R'")

    async def emit(_e: RunEvent) -> None:
        pass

    outcome = await execute_target(
        provider=Thinker(),
        aliases=AliasRegistry(),
        pricing_lookup=no_price,
        target=RunTarget(base_url="https://p.test/v1", model="thinker", api_key="k"),
        spec=PromptSpec(modality=Modality.CHAT, prompt="solve"),
        timeout_s=5,
        emit=emit,
    )
    assert outcome.metrics.ttft_ms is not None and outcome.metrics.ttft_ms < 100
    assert outcome.metrics.total_ms >= 200
