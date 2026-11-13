"""consolidation_runs.pool_size: how many memories the run was asked to scan

Revision ID: 017
Revises: 016
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("consolidation_runs", sa.Column("pool_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("consolidation_runs", "pool_size")
