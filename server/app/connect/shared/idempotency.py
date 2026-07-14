"""Idempotency-Key dedupe backed by Redis.

Clients may send `Idempotency-Key: <uuid>` on POSTs. The first request
completes normally and the response hash is cached for 24h; identical
replays short-circuit and return the cached response.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from app.connect.shared.redis import get_redis

log = logging.getLogger(__name__)

_TTL_SECONDS = 24 * 3600


def _cache_key(tenant_id: str, user_id: int, route: str, idem_key: str) -> str:
    h = hashlib.sha256(f"{tenant_id}|{user_id}|{route}|{idem_key}".encode()).hexdigest()
    return f"connect:idem:{h}"


async def check(tenant_id: str, user_id: int, route: str, idem_key: str) -> dict[str, Any] | None:
    redis = await get_redis()
    if redis is None:
        return None
    # get_redis() only constructs a lazy client — it never verifies
    # connectivity, so a down/unreachable Redis surfaces here, not there.
    # Best-effort like bus.publish(): a dedupe check that can't run just
    # means "treat this as a fresh request," not a 500.
    try:
        cached = await redis.get(_cache_key(tenant_id, user_id, route, idem_key))
    except Exception:  # noqa: BLE001
        log.warning("Idempotency check failed (Redis unavailable?); treating as a fresh request")
        return None
    return json.loads(cached) if cached else None


async def store(tenant_id: str, user_id: int, route: str, idem_key: str, response: dict[str, Any]) -> None:
    redis = await get_redis()
    if redis is None:
        return
    try:
        await redis.set(
            _cache_key(tenant_id, user_id, route, idem_key),
            json.dumps(response, default=str),
            ex=_TTL_SECONDS,
        )
    except Exception:  # noqa: BLE001
        log.warning("Idempotency store failed (Redis unavailable?); request already completed successfully")
