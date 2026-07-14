"""Zoiko Connect v3 bounded-context services.

This package is intentionally isolated from the legacy `app.api` and
`app.websocket` trees. Legacy code stays running for backwards compatibility
during the strangler-fig migration; new features land here.

Mounting: `app.main` imports `connect.router` and mounts it at `/api/connect`.
"""
from fastapi import APIRouter

from app.connect.session_service.api import router as session_router
from app.connect.conversation_service.api import router as conversation_router
from app.connect.messaging_service.api import router as messaging_router
from app.connect.presence_service.api import router as presence_router
from app.connect.media_service.api import router as media_router
from app.connect.gateway.ws import router as gateway_ws_router
from app.connect.provider_connections.api import router as provider_connections_router
from app.connect.calendar_service.api import router as calendar_router
from app.connect.policy_engine.api import router as policy_engine_router
from app.connect.action_review.api import router as action_review_router

router = APIRouter(prefix="/api/connect", tags=["connect-v3"])
router.include_router(session_router)
router.include_router(conversation_router)
router.include_router(messaging_router)
router.include_router(presence_router)
router.include_router(media_router)
router.include_router(gateway_ws_router)
router.include_router(provider_connections_router)
router.include_router(calendar_router)
router.include_router(policy_engine_router)
router.include_router(action_review_router)

__all__ = ["router"]
