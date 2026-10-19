"""Create exact_records and exact_record_versions, with pg_trgm for keyword search

Revision ID: 010
Revises: 009
Create Date: 2026-10-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_table(
        "exact_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False, server_default="note"),
        sa.Column("title", sa.String(255), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("fields", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "key", name="uq_exact_records_user_key"),
    )
    # Prefix listing (key LIKE 'server/%') needs pattern ops; the unique index uses the DB collation.
    op.execute("CREATE INDEX ix_exact_records_user_key_prefix ON exact_records (user_id, key text_pattern_ops)")
    op.create_index("ix_exact_records_user_kind", "exact_records", ["user_id", "kind"])
    op.execute("CREATE INDEX ix_exact_records_tags ON exact_records USING gin (tags)")
    # Serves both ILIKE '%term%' and the word-similarity (<%) typo match.
    op.execute("CREATE INDEX ix_exact_records_search_trgm ON exact_records USING gin (search_text gin_trgm_ops)")

    op.create_table(
        "exact_record_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(255), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("change", sa.String(16), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_exact_record_versions_record_id", "exact_record_versions", ["record_id"])
    op.create_index("ix_exact_record_versions_user_key", "exact_record_versions", ["user_id", "key"])


def downgrade() -> None:
    op.drop_table("exact_record_versions")
    op.drop_table("exact_records")
    # pg_trgm is left installed: other objects may depend on it.
