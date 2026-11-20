"""site accounts created by the extension on employer careers portals

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-20 18:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('site_accounts',
    sa.Column('host', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('password_encrypted', sa.Text(), nullable=False),
    sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'host', name='uq_site_accounts_user_host'),
    )
    op.create_index(op.f('ix_site_accounts_user_id'), 'site_accounts', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_site_accounts_user_id'), table_name='site_accounts')
    op.drop_table('site_accounts')
