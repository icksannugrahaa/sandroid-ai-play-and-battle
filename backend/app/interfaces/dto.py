"""Request/response DTOs (Pydantic v2) — the validated API boundary."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.entities import ArenaStrategy, Modality

MAX_PROMPT_CHARS = 100_000
MAX_IMAGES = 4
DATA_URL_PREFIXES = (
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/webp;base64,",
    "data:image/gif;base64,",
)

BaseUrl = Annotated[str, Field(min_length=8, max_length=2048, examples=["https://api.openai.com/v1"])]
ModelName = Annotated[str, Field(min_length=1, max_length=300)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ models/fetch
class FetchModelsRequest(_Strict):
    base_url: BaseUrl


class FetchedModelDTO(BaseModel):
    id: str
    display_name: str
    canonical_key: str
    family: str
    capabilities: list[Modality]
    owned_by: str | None


class FetchModelsResponse(BaseModel):
    models: list[FetchedModelDTO]


# ------------------------------------------------------------------ prompt config
class GenerationParams(_Strict):
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=200_000)
    top_p: float | None = Field(default=None, ge=0, le=1)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    seed: int | None = None
    stop: list[Annotated[str, Field(max_length=64)]] | None = Field(default=None, max_length=4)

    def to_payload(self) -> dict[str, object]:
        return self.model_dump(exclude_none=True)


class HistoryMessage(_Strict):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_PROMPT_CHARS)


AUDIO_DATA_PREFIXES = (
    "data:audio/wav;base64,",
    "data:audio/x-wav;base64,",
    "data:audio/wave;base64,",
    "data:audio/mpeg;base64,",
    "data:audio/mp3;base64,",
)
FILE_DATA_URL = r"^data:[a-z]+/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*$"
MAX_ATTACHMENTS = 8


class AttachmentDTO(_Strict):
    """Non-image input: audio (OpenAI `input_audio`, WAV/MP3) or a file such as a PDF (`file` part)."""

    kind: Literal["audio", "file"]
    name: str = Field(min_length=1, max_length=255)
    data_url: str = Field(pattern=FILE_DATA_URL)

    @model_validator(mode="after")
    def _audio_format(self) -> AttachmentDTO:
        if self.kind == "audio" and not self.data_url.startswith(AUDIO_DATA_PREFIXES):
            raise ValueError("audio must be a WAV or MP3 data URL")
        return self


class PromptConfig(_Strict):
    modality: Modality = Modality.CHAT
    prompt: str = Field(default="", max_length=MAX_PROMPT_CHARS)
    system: str | None = Field(default=None, max_length=MAX_PROMPT_CHARS)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=100)
    images: list[str] = Field(default_factory=list, max_length=MAX_IMAGES)
    attachments: list[AttachmentDTO] = Field(default_factory=list, max_length=MAX_ATTACHMENTS)
    image_size: str | None = Field(default=None, pattern=r"^\d{2,4}x\d{2,4}$")
    params: GenerationParams = Field(default_factory=GenerationParams)

    @field_validator("images")
    @classmethod
    def _images_are_data_urls(cls, images: list[str]) -> list[str]:
        for img in images:
            if not img.startswith(DATA_URL_PREFIXES):
                raise ValueError("images must be base64 data URLs (png, jpeg, webp, gif)")
        return images

    @model_validator(mode="after")
    def _has_input(self) -> PromptConfig:
        if not self.prompt.strip() and not self.images and not self.attachments:
            raise ValueError("prompt is empty — type a message or attach something")
        return self


# ------------------------------------------------------------------ runs
class PlaygroundRunRequest(_Strict):
    base_url: BaseUrl
    model: ModelName
    config: PromptConfig
    contribute: bool = True
    timeout_s: int = Field(default=120, ge=5, le=3600)


class ArenaSlotDTO(_Strict):
    base_url: BaseUrl
    model: ModelName
    # This model's own previous turns, so each model continues ITS conversation.
    # When omitted, `config.history` (shared) is used.
    history: list[HistoryMessage] | None = Field(default=None, max_length=100)
    # This model's own prompt (challenge follow-up turns: each model is at a different
    # puzzle state). When omitted, `config.prompt` (shared) is used.
    prompt: str | None = Field(default=None, max_length=MAX_PROMPT_CHARS)


class ArenaRunRequest(_Strict):
    # 1 is allowed for challenge follow-up turns, when only one model is still solving;
    # the UI still requires 2+ models to start a battle.
    slots: list[ArenaSlotDTO] = Field(min_length=1, max_length=4)
    strategy: ArenaStrategy = ArenaStrategy.PARALLEL
    config: PromptConfig
    contribute: bool = True
    timeout_s: int = Field(default=120, ge=5, le=3600)


# ------------------------------------------------------------------ leaderboard
class LeaderboardRowDTO(BaseModel):
    key: str
    display_name: str
    family: str
    variants: int
    total_runs: int
    success_rate: float | None
    avg_latency_ms: float | None
    p50_latency_ms: float | None
    p95_latency_ms: float | None
    avg_ttft_ms: float | None
    avg_throughput_tps: float | None
    avg_cost_usd: float | None
    last_tested: datetime | None
    composite_score: float | None
    insufficient_data: bool


class FacetsDTO(BaseModel):
    modalities: list[str]
    families: list[str]
    providers: list[str]


class LeaderboardResponse(BaseModel):
    rows: list[LeaderboardRowDTO]
    next_cursor: str | None
    facets: FacetsDTO | None
    composite_formula: str
    min_runs: int


# ------------------------------------------------------------------ pricing
class PricingEntryDTO(BaseModel):
    canonical_key: str
    raw_name: str
    input_per_1m: float | None
    output_per_1m: float | None
    image_price: float | None
    currency: str
    source: str
    fetched_at: datetime


class SourceStatusDTO(BaseModel):
    ok: bool
    entries: int
    error: str | None


class AliasCandidateDTO(BaseModel):
    model_key: str
    suggested_key: str
    score: float


class ResearchLogDTO(BaseModel):
    sources_status: dict[str, SourceStatusDTO]
    entries_updated: int
    created_at: datetime
    alias_candidates: list[AliasCandidateDTO]


class PricingResponse(BaseModel):
    entries: list[PricingEntryDTO]
    total: int
    next_cursor: str | None
    cooldown_remaining_s: int
    last_research: ResearchLogDTO | None


class ResearchResponse(BaseModel):
    research: ResearchLogDTO
    cooldown_remaining_s: int


# ------------------------------------------------------------------ catalog
class CatalogModelDTO(BaseModel):
    canonical_key: str
    display_name: str
    family: str
    modalities: list[Modality]
    first_seen: datetime
    aliases: list[str]


class CatalogResponse(BaseModel):
    models: list[CatalogModelDTO]
    total: int
    next_cursor: str | None


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    retry_after_s: int | None = None


# ---------------------------------------------------------------------------- challenge leaderboard
ChallengeLevel = Literal["easy", "medium", "hard", "expert"]


class ChallengeResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket: str = Field(min_length=10, max_length=4000, description="Run ticket from the arena's `ticket` event")
    challenge_id: str = Field(pattern=r"^[a-z0-9_-]{1,32}$")
    difficulty: ChallengeLevel
    seed: int = Field(ge=0, le=2**53)
    score: int = Field(ge=0, le=100)
    solved: bool
    moves: int | None = Field(default=None, ge=0, le=100_000)
    time_limit_s: int | None = Field(default=None, ge=5, le=3600)


class ChallengeResultsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[ChallengeResultIn] = Field(min_length=1, max_length=4)


class ChallengeResultsResponse(BaseModel):
    stored: int


class ChallengeBoardRowDTO(BaseModel):
    rank: int
    key: str
    display_name: str
    family: str
    variants: int
    runs: int
    avg_score: float
    solve_rate: float
    best_score: int
    avg_moves_solved: float | None
    avg_time_ms: float
    avg_tokens: float
    avg_cost_usd: float | None
    timeouts: int
    last_tested: datetime
    insufficient_data: bool


class ChallengeBoardCellDTO(BaseModel):
    challenge_id: str
    difficulty: str
    runs: int
    models: int


class ChallengeBoardResponse(BaseModel):
    challenge_id: str
    difficulty: str
    rows: list[ChallengeBoardRowDTO]
    cells: list[ChallengeBoardCellDTO]
    min_runs: int
    ranking: str
