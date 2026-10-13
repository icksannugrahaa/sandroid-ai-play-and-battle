"""initial schema

Revision ID: 0001
Revises: (none)
Create Date: 2026-10-02 13:50:40.630714
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "arena_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("strategy", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "canonical_models",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("canonical_key", sa.String(length=200), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("family", sa.String(length=200), nullable=False),
        sa.Column("supports_chat", sa.Boolean(), nullable=False),
        sa.Column("supports_vision", sa.Boolean(), nullable=False),
        sa.Column("supports_image_gen", sa.Boolean(), nullable=False),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("canonical_key"),
    )
    with op.batch_alter_table("canonical_models", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_canonical_models_family"), ["family"], unique=False)

    op.create_table(
        "model_aliases",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("raw_name", sa.String(length=300), nullable=False),
        sa.Column("canonical_key", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("raw_name", "canonical_key", name="uq_model_aliases_raw_canonical"),
    )
    with op.batch_alter_table("model_aliases", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_model_aliases_canonical_key"), ["canonical_key"], unique=False)

    op.create_table(
        "pricing_entries",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("canonical_key", sa.String(length=200), nullable=False),
        sa.Column("raw_name", sa.String(length=300), nullable=False),
        sa.Column("input_per_1m", sa.Float(), nullable=True),
        sa.Column("output_per_1m", sa.Float(), nullable=True),
        sa.Column("image_price", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("canonical_key"),
    )
    op.create_table(
        "research_logs",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column(
            "sources_status",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("entries_updated", sa.Integer(), nullable=False),
        sa.Column(
            "alias_candidates",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("research_logs", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_research_logs_created_at"), ["created_at"], unique=False)

    op.create_table(
        "runs",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("canonical_model_id", sa.BigInteger(), nullable=False),
        sa.Column("raw_model_name", sa.String(length=300), nullable=False),
        sa.Column("provider_label", sa.String(length=128), nullable=False),
        sa.Column("modality", sa.String(length=16), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("arena_session_id", sa.Uuid(), nullable=True),
        sa.Column("ttft_ms", sa.Float(), nullable=True),
        sa.Column("total_ms", sa.Float(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("tokens_estimated", sa.Boolean(), nullable=False),
        sa.Column("throughput_tps", sa.Float(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error_category", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["arena_session_id"], ["arena_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["canonical_model_id"], ["canonical_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("runs", schema=None) as batch_op:
        batch_op.create_index("ix_runs_created", ["created_at"], unique=False)
        batch_op.create_index("ix_runs_model_created", ["canonical_model_id", "created_at"], unique=False)
        batch_op.create_index("ix_runs_provider", ["provider_label"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("runs", schema=None) as batch_op:
        batch_op.drop_index("ix_runs_provider")
        batch_op.drop_index("ix_runs_model_created")
        batch_op.drop_index("ix_runs_created")

    op.drop_table("runs")
    with op.batch_alter_table("research_logs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_research_logs_created_at"))

    op.drop_table("research_logs")
    op.drop_table("pricing_entries")
    with op.batch_alter_table("model_aliases", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_model_aliases_canonical_key"))

    op.drop_table("model_aliases")
    with op.batch_alter_table("canonical_models", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_canonical_models_family"))

    op.drop_table("canonical_models")
    op.drop_table("arena_sessions")
