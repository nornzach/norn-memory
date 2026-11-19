"""Structured memory and reviewed revisions.

Revision ID: 018
Revises: 017
"""

import sqlalchemy as sa
from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def _scope():
    return [sa.Column(name, sa.Text, nullable=False) for name in ("user_id", "agent_id", "run_id", "project")]


def upgrade():
    op.create_table(
        "knowledge_items",
        sa.Column("id", sa.Uuid, primary_key=True),
        *_scope(),
        sa.Column("key", sa.String(160), nullable=False),
        sa.Column("layer", sa.String(2), nullable=False),
        sa.Column("revision", sa.Integer, nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
        sa.Column("semantic_index", sa.JSON),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "agent_id", "run_id", "project", "key"),
    )
    op.create_index("ix_knowledge_items_user_id", "knowledge_items", ["user_id"])
    op.create_table(
        "knowledge_proposals",
        sa.Column("id", sa.Uuid, primary_key=True),
        *_scope(),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("fingerprint", name="uq_knowledge_proposal_fingerprint"),
    )
    op.create_index("ix_knowledge_proposals_user_id", "knowledge_proposals", ["user_id"])
    op.create_table(
        "knowledge_revisions",
        sa.Column("item_id", sa.Uuid, sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer, primary_key=True),
        sa.Column("snapshot", sa.JSON, nullable=False),
    )


def downgrade():
    op.drop_table("knowledge_revisions")
    op.drop_table("knowledge_proposals")
    op.drop_table("knowledge_items")
