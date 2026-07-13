"""Provider Connection Service — connect/get/disconnect a calendar provider.

Nothing else in the codebase is allowed to mutate connect_provider_connections
or handle raw provider tokens. Same shape as session_service: validate tenant
context, write the domain row, log an audit event, enqueue an outbox event —
all inside one transaction.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.provider_connections.adapters import get_adapter
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared import crypto
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.core.config import get_settings

# Distinguishes an OAuth-state token from a real auth access/refresh token
# signed with the same jwt_secret, so one can never be replayed as the other.
_STATE_PURPOSE = "provider_oauth_state"
_STATE_TTL = timedelta(minutes=10)


def create_oauth_state(user_id: int, provider: str) -> str:
    """Sign a short-lived, single-purpose state token for the OAuth redirect
    round-trip. The callback (a plain browser redirect from Google/Microsoft)
    carries no Authorization header, so this token — not a bearer token — is
    what lets /callback recover which user/provider initiated the connect,
    while also acting as the CSRF-protecting `state` param."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "provider": provider,
        "purpose": _STATE_PURPOSE,
        "iat": now,
        "exp": now + _STATE_TTL,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_oauth_state(state: str, *, expected_provider: str) -> int:
    """Decode+verify a state token, returning the user_id it was issued for."""
    settings = get_settings()
    try:
        payload = jwt.decode(state, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise Invalid("Invalid or expired OAuth state") from exc
    if payload.get("purpose") != _STATE_PURPOSE or payload.get("provider") != expected_provider:
        raise Invalid("Invalid or expired OAuth state")
    return int(payload["sub"])


async def connect_provider(
    db: DbSession, ctx: TenantContext, *, provider: str, authorization_code: str,
) -> ProviderConnection:
    adapter = get_adapter(provider)
    tokens = await adapter.exchange_code(authorization_code)

    existing = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.user_id == ctx.user_id,
            ProviderConnection.provider == provider,
        )
        .first()
    )
    encrypted_refresh = crypto.encrypt(tokens.refresh_token)
    encrypted_access = crypto.encrypt(tokens.access_token)

    if existing:
        existing.provider_account_email = tokens.account_email
        existing.scopes = tokens.scopes
        existing.encrypted_refresh_token = encrypted_refresh
        existing.encrypted_access_token = encrypted_access
        existing.access_token_expires_at = tokens.access_token_expires_at
        existing.status = "active"
        connection = existing
    else:
        connection = ProviderConnection(
            id=uuid7_str(),
            tenant_id=ctx.tenant_id,
            user_id=ctx.user_id,
            provider=provider,
            provider_account_email=tokens.account_email,
            scopes=tokens.scopes,
            encrypted_refresh_token=encrypted_refresh,
            encrypted_access_token=encrypted_access,
            access_token_expires_at=tokens.access_token_expires_at,
            status="active",
            correlation_id=get_correlation_id(),
            created_by=ctx.user_id,
        )
        db.add(connection)
    db.flush()

    audit.log(
        db, type="provider_connection.connected", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="provider_connection",
        resource_id=connection.id,
        metadata={"provider": provider, "account_email": tokens.account_email},
    )
    env = EventEnvelope(
        type=etypes.PROVIDER_CONNECTION_CONNECTED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"connection_id": connection.id, "provider": provider},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"provider_connection:{connection.id}")
    return connection


def list_connections(db: DbSession, ctx: TenantContext) -> list[ProviderConnection]:
    return (
        db.query(ProviderConnection)
        .filter(ProviderConnection.tenant_id == ctx.tenant_id, ProviderConnection.user_id == ctx.user_id)
        .all()
    )


async def disconnect_provider(db: DbSession, ctx: TenantContext, *, provider: str) -> None:
    connection = _load_tenant_scoped(db, ctx, provider)
    connection.status = "revoked"
    # Purge secrets on revoke — a revoked row is kept for audit trail (who
    # disconnected what, when), the tokens themselves must not linger.
    connection.encrypted_refresh_token = ""
    connection.encrypted_access_token = None

    audit.log(
        db, type="provider_connection.disconnected", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="provider_connection",
        resource_id=connection.id, metadata={"provider": provider},
    )
    env = EventEnvelope(
        type=etypes.PROVIDER_CONNECTION_DISCONNECTED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"connection_id": connection.id, "provider": provider},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"provider_connection:{connection.id}")


def _load_tenant_scoped(db: DbSession, ctx: TenantContext, provider: str) -> ProviderConnection:
    connection = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.user_id == ctx.user_id,
            ProviderConnection.provider == provider,
            ProviderConnection.status == "active",
        )
        .first()
    )
    if connection is None:
        raise NotFound("Provider connection not found")
    return connection
