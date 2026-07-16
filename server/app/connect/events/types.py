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
# Native (Sema-authoritative) calendar events — Phase 2 slice 3. Fires on
# every create/update/delete/restore of a connect_native_calendar_events
# version row; already named in CONTEXT.md §1's reuse table, added here now
# that native events actually exist.
CALENDAR_EVENT_MUTATED = "calendar.event.mutated.v1"

# Mail plane (Sema Calendar & Mail, spec §12.2 — Phase 3 slice 2). One event
# per sync run, not per message, same "no per-item consumer yet" reasoning
# calendar.sync.completed already established.
MAIL_MESSAGE_SYNCED = "mail.message.synced.v1"

# Policy Engine plane (Sema Calendar & Mail, spec §12.2 — Phase 2 slice 1).
# `policy.evaluated` is audit-logged on every resolution but deliberately
# has no outbox/event-bus constant yet: no Observability consumer exists to
# read per-evaluation fanout, matching calendar_service's own precedent for
# skipping per-event emission with no real subscriber (see calendar_service
# /service.py). Add one when a real consumer needs it.
SETTINGS_POLICY_VERSIONED = "settings.policy.versioned.v1"

# Action Review Queue plane (Sema Calendar & Mail, spec §12.2 — Phase 2
# slice 2). AGENT_ACTION_CREATED matches spec's canonical name even though
# this MVP's staged items may be human- or agent-drafted — the queue
# doesn't distinguish at the event-naming level, only via the
# proposed_by_user_id / proposed_by_agent fields on the row itself. The
# transition events have no spec-canonical name (§12.2's table isn't
# exhaustive) — named consistently with the existing `.v{N}` convention.
AGENT_ACTION_CREATED = "agent.action.created.v1"
ACTION_REVIEW_APPROVED = "action_review.approved.v1"
ACTION_REVIEW_REJECTED = "action_review.rejected.v1"
ACTION_REVIEW_REDRAFT_REQUESTED = "action_review.redraft_requested.v1"
ACTION_REVIEW_ESCALATED = "action_review.escalated.v1"

# Mail send plane (Sema Calendar & Mail, spec §12.2 — Phase 3 slice 9, the
# first L3 feature: agent/human sends within a cancellable delay window).
MAIL_SEND_BUFFERED = "mail.send.buffered.v1"
MAIL_SEND_CANCELLED = "mail.send.cancelled.v1"
MAIL_SEND_RELEASED = "mail.send.released.v1"
MAIL_SEND_FAILED = "mail.send.failed.v1"
