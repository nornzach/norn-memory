"""Drop the memory_links table: nothing reads or writes it

The hierarchy work ships layers, importance and context in the memory payload itself; the relation
table from 015 was never wired to any code, so it would only collect dust.

Revision ID: 016
Revises: 015
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("memory_links")


def downgrade() -> None:
    op.create_table(
        "memory_links",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("from_memory_id", sa.String(255), nullable=False),
        sa.Column("to_memory_id", sa.String(255), nullable=False),
        sa.Column("link_type", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    op.create_index("idx_memory_links_from", "memory_links", ["from_memory_id"])
    op.create_index("idx_memory_links_to", "memory_links", ["to_memory_id"])
    op.create_index("idx_memory_links_type", "memory_links", ["link_type"])
