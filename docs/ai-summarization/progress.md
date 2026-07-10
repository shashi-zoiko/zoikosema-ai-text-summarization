# AI Summarization — Progress Log

Tracks changes made by Shashi (branch `shashi-changes`) toward the in-meeting
AI summarizer/agenda feature. Newest entries at the top.

## Changes

### 1. Gradient "Edit" button in the meeting header

Added a violet-to-pink gradient pill button in the top-right corner of the
in-meeting header (rightmost element, past the host menu) — white pencil icon
with a small star beside it (star sits left of the pencil, top-aligned so it
reads above the pencil's vertical midpoint). Wired to an `onEdit` prop that
defaults to a no-op stub — the click action itself is not yet decided
(candidates: open an AI meeting-summary panel, rename the meeting, or
something else).

**Frontend:**
- `client/src/features/meeting/components/MeetingHeader.jsx`

### 2. Fixed Docker container name collisions

Renamed `container_name` entries in the local dev compose file from the
generic `zoiko-*` prefix to `zoikosema-*` — the generic names collided with
an unrelated Docker stack already running on the dev machine. Cosmetic only;
inter-service networking uses the compose service names (`db`, `redis`,
`livekit`), not `container_name`.

**Config:**
- `docker-compose.yml`

## Not yet implemented

- The `onEdit` button's actual behavior.
- Persisting the live-caption transcript. Captions are currently captured
  client-side via the Web Speech API and broadcast E2EE over a LiveKit data
  channel, but nothing stores a full transcript anywhere today.
  - `client/src/features/meeting/captions/useSpeechRecognition.js`
  - `client/src/features/meeting/captions/captionTransport.js`
  - `client/src/features/meeting/captions/CaptionProvider.jsx`
- Wiring a persisted transcript into the existing AI intelligence pipeline.
  `ai_generate_intelligence` currently summarizes only the chat log; the
  `MeetingIntelligence.source` model already has a reserved, unused
  `INTEL_SOURCE_TRANSCRIPT` value anticipating this.
  - `server/app/core/ai.py`
  - `server/app/api/intelligence.py`
  - `server/app/models/meeting.py`
- Frontend summary panel with edit / copy / share actions (the actual
  feature this button is meant to expose).
