"""Add access level and scope allowlists to API keys

Revision ID: 009
Revises: 008
Create Date: 2026-10-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCOPE_COLUMNS = ("user_ids", "agent_ids", "run_ids", "categories")


def upgrade() -> None:
    # Existing keys keep full access: read_write and no allowlists.
    op.add_column("api_keys", sa.Column("access", sa.String(16), nullable=False, server_default="read_write"))
    for column in SCOPE_COLUMNS:
        op.add_column("api_keys", sa.Column(column, sa.JSON(), nullable=True))


def downgrade() -> None:
    for column in reversed(SCOPE_COLUMNS):
        op.drop_column("api_keys", column)
    op.drop_column("api_keys", "access")
