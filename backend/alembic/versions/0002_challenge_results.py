"""challenge results (challenge leaderboard)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-06 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "challenge_results",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("ticket_id", sa.String(length=32), nullable=False),
        sa.Column("canonical_model_id", sa.BigInteger(), nullable=False),
        sa.Column("raw_model_name", sa.String(length=300), nullable=False),
        sa.Column("provider_label", sa.String(length=128), nullable=False),
        sa.Column("challenge_id", sa.String(length=32), nullable=False),
        sa.Column("difficulty", sa.String(length=16), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("solved", sa.Boolean(), nullable=False),
        sa.Column("moves", sa.Integer(), nullable=True),
        sa.Column("timed_out", sa.Boolean(), nullable=False),
        sa.Column("time_limit_s", sa.Integer(), nullable=True),
        sa.Column("total_ms", sa.Float(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["canonical_model_id"], ["canonical_models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticket_id"),
    )
    op.create_index(
        "ix_challenge_results_board", "challenge_results", ["challenge_id", "difficulty", "created_at"], unique=False
    )
    op.create_index("ix_challenge_results_model", "challenge_results", ["canonical_model_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_challenge_results_model", table_name="challenge_results")
    op.drop_index("ix_challenge_results_board", table_name="challenge_results")
    op.drop_table("challenge_results")
