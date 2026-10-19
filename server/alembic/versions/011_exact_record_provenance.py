"""Record where each exact record was written: device, agent, project, folder and API key label

Revision ID: 011
Revises: 010
Create Date: 2026-10-19

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (("device", 64), ("agent", 64), ("project", 255), ("cwd", 1024), ("key_label", 255))


def upgrade() -> None:
    for name, length in COLUMNS:
        op.add_column("exact_records", sa.Column(name, sa.String(length), nullable=True))
    op.create_index("ix_exact_records_user_project", "exact_records", ["user_id", "project"])


def downgrade() -> None:
    op.drop_index("ix_exact_records_user_project", table_name="exact_records")
    for name, _ in reversed(COLUMNS):
        op.drop_column("exact_records", name)
