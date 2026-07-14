"""Versioned event type constants. Each constant = one JSON Schema.

Renaming or changing payload shape requires bumping the `.v{N}` suffix so
consumers can migrate independently.
"""

# Messaging plane
MESSAGE_SENT = "message.sent.v1"
MESSAGE_EDITED = "message.edited.v1"
MESSAGE_DELETED = "message.deleted.v1"
MESSAGE_REACTION_ADDED = "message.reaction.added.v1"
MESSAGE_READ = "message.read.v1"

# Session plane
SESSION_CREATED = "session.created.v1"
SESSION_STARTED = "session.started.v1"
SESSION_ENDED = "session.ended.v1"
SESSION_MEMBER_JOINED = "session.member.joined.v1"
SESSION_MEMBER_LEFT = "session.member.left.v1"
SESSION_MEMBER_ADMITTED = "session.member.admitted.v1"
SESSION_MEMBER_DENIED = "session.member.denied.v1"
SESSION_MEMBER_KICKED = "session.member.kicked.v1"

# Conversation plane
CONVERSATION_CREATED = "conversation.created.v1"
CONVERSATION_MEMBER_ADDED = "conversation.member.added.v1"
CONVERSATION_MEMBER_REMOVED = "conversation.member.removed.v1"

# Presence plane
PRESENCE_CHANGED = "presence.changed.v1"
TYPING_STARTED = "typing.started.v1"
TYPING_STOPPED = "typing.stopped.v1"

# Provider connection plane (Sema Calendar & Mail, spec §7.4)
PROVIDER_CONNECTION_CONNECTED = "provider_connection.connected.v1"
PROVIDER_CONNECTION_DISCONNECTED = "provider_connection.disconnected.v1"

# Calendar plane (Sema Calendar & Mail, spec §12.2)
CALENDAR_SYNC_COMPLETED = "calendar.sync.completed.v1"

# Policy Engine plane (Sema Calendar & Mail, spec §12.2 — Phase 2 slice 1).
# `policy.evaluated` is audit-logged on every resolution but deliberately
# has no outbox/event-bus constant yet: no Observability consumer exists to
# read per-evaluation fanout, matching calendar_service's own precedent for
# skipping per-event emission with no real subscriber (see calendar_service
# /service.py). Add one when a real consumer needs it.
SETTINGS_POLICY_VERSIONED = "settings.policy.versioned.v1"
