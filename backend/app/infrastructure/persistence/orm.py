"""Database schema.

╔══════════════════════════════════════════════════════════════════════════════╗
║ NO credential columns (api_key/secret/token/password).                        ║
║ NO content columns (prompt/output/messages/response).                         ║
║ NO client identity (ip, ip_hash, user agent).                                 ║
║ Enforced by tests/guard/test_no_credentials_or_content.py — do not weaken it. ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSONType = JSON().with_variant(JSONB(), "postgresql")
# SQLite only auto-increments INTEGER PRIMARY KEY.
BigIntPK = BigInteger().with_variant(Integer(), "sqlite")


class Base(DeclarativeBase):
    pass


class CanonicalModelRow(Base):
    __tablename__ = "canonical_models"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    canonical_key: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    family: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    supports_chat: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_image_gen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ModelAliasRow(Base):
    __tablename__ = "model_aliases"
    __table_args__ = (UniqueConstraint("raw_name", "canonical_key", name="uq_model_aliases_raw_canonical"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    raw_name: Mapped[str] = mapped_column(String(300), nullable=False)
    canonical_key: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # "auto" | "aliases.json"


class ArenaSessionRow(Base):
    __tablename__ = "arena_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    strategy: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RunRow(Base):
    __tablename__ = "runs"
    __table_args__ = (
        Index("ix_runs_model_created", "canonical_model_id", "created_at"),
        Index("ix_runs_created", "created_at"),
        Index("ix_runs_provider", "provider_label"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    canonical_model_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("canonical_models.id", ondelete="CASCADE"), nullable=False
    )
    raw_model_name: Mapped[str] = mapped_column(String(300), nullable=False)
    provider_label: Mapped[str] = mapped_column(String(128), nullable=False)
    modality: Mapped[str] = mapped_column(String(16), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    arena_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("arena_sessions.id", ondelete="SET NULL"), nullable=True
    )
    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_ms: Mapped[float] = mapped_column(Float, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False)
    throughput_tps: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    error_category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ChallengeResultRow(Base):
    """Checked challenge results — scores and timings only (no puzzle, no answer text)."""

    __tablename__ = "challenge_results"
    __table_args__ = (
        Index("ix_challenge_results_board", "challenge_id", "difficulty", "created_at"),
        Index("ix_challenge_results_model", "canonical_model_id"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    ticket_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    canonical_model_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("canonical_models.id", ondelete="CASCADE"), nullable=False
    )
    raw_model_name: Mapped[str] = mapped_column(String(300), nullable=False)
    provider_label: Mapped[str] = mapped_column(String(128), nullable=False)
    challenge_id: Mapped[str] = mapped_column(String(32), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    solved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    moves: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timed_out: Mapped[bool] = mapped_column(Boolean, nullable=False)
    time_limit_s: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_ms: Mapped[float] = mapped_column(Float, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PricingEntryRow(Base):
    __tablename__ = "pricing_entries"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    canonical_key: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    raw_name: Mapped[str] = mapped_column(String(300), nullable=False)
    input_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_per_1m: Mapped[float | None] = mapped_column(Float, nullable=True)
    image_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ResearchLogRow(Base):
    __tablename__ = "research_logs"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    sources_status: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    entries_updated: Mapped[int] = mapped_column(Integer, nullable=False)
    alias_candidates: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
