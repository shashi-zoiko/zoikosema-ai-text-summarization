"""Separate declarative Base for connect_* tables.

Reason: connect_* tables are Postgres-specific (JSONB, UUID, ARRAY,
partitioning, RLS) and are managed by migrations/connect_v3_001_init.sql —
NEVER by SQLAlchemy's create_all(). Using a separate Base keeps them out
of the legacy `Base.metadata` so they are managed solely via SQL migrations.
"""
from sqlalchemy.orm import DeclarativeBase


class ConnectBase(DeclarativeBase):
    pass
