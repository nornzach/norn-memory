"""Record which API key made each request

Revision ID: 012
Revises: 011
Create Date: 2026-10-20

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("request_logs", sa.Column("key_label", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("request_logs", "key_label")
