"""Add memory hierarchy fields and relations table

Revision ID: 015
Revises: 014
Create Date: 2026-11-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Note: pgvector stores memories in a custom vector table, not in a standard SQLite/Postgres table.
    # These fields need to be added to the vector store's payload metadata.
    # This migration serves as documentation and will be used when we implement the pgvector schema extension.
    
    # Memory hierarchy fields (to be added to pgvector payload):
    # - layer: VARCHAR(2) - one of L0, L1, L2, L3, L4
    # - importance: FLOAT - 1.0 to 10.0
    # - weight: FLOAT - calculated runtime weight
    # - context: VARCHAR(100) - chat, project-*, debug-*, release-*
    # - observed_at: TIMESTAMP - when the event actually happened
    # - confidence: FLOAT - 0.0 to 1.0
    # - source: VARCHAR(50) - user-stated, inferred, observed, document
    # - verified: BOOLEAN - whether user confirmed
    
    # Create memory links table for tracking relationships
    op.create_table(
        "memory_links",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("from_memory_id", sa.String(255), nullable=False),
        sa.Column("to_memory_id", sa.String(255), nullable=False),
        sa.Column("link_type", sa.String(20), nullable=False),  # linked, derived, contradicts, supersedes
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    
    # Create indexes for efficient queries
    op.create_index("idx_memory_links_from", "memory_links", ["from_memory_id"])
    op.create_index("idx_memory_links_to", "memory_links", ["to_memory_id"])
    op.create_index("idx_memory_links_type", "memory_links", ["link_type"])


def downgrade() -> None:
    op.drop_index("idx_memory_links_type", table_name="memory_links")
    op.drop_index("idx_memory_links_to", table_name="memory_links")
    op.drop_index("idx_memory_links_from", table_name="memory_links")
    op.drop_table("memory_links")
