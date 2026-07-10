# AI Summarization — Progress Log

Tracks changes made by Shashi (branch `shashi-changes`) toward the in-meeting
AI summarizer/agenda feature, in the order implemented.

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

### 3. "Conversations" button in the meeting header

Added a plain circular icon button (matches the existing Info button's
style — bordered, dark fill, no gradient) directly to the left of the
gradient edit button, using a `MessagesSquare` icon.

**Frontend:**
- `client/src/features/meeting/components/MeetingHeader.jsx`

### 4. Live transcript accumulation + Conversations panel

`CaptionProvider` previously only kept the *latest* caption line per speaker
(replaced on every new result, nothing accumulated). Added a second piece of
state, `transcript` — every FINAL caption (interims excluded, since they're
corrections-in-progress) is appended, in order, across all speakers, capped
at 4000 lines so a long meeting can't grow it unboundedly. Exposed through
the existing `CaptionsLiveContext` alongside `bySpeaker`.

The "Conversations" button now opens `ConversationsPanel` (wired through the
same `sidebar` state the other drawers — chat/people/info/settings — already
use): a 50%-width, full-height panel docked to the right, dark backdrop
behind it. Clicking anywhere on the backdrop (outside the panel) or pressing
Escape closes it, same as clicking the header button again. Transcript lines
are grouped under timestamp headings (`HH:MM:SS`, elapsed since the first
captured line) — a new heading starts whenever the gap since the previous
line exceeds 20s — then rendered as `Name: text` per line, matching the
Google Meet / Gemini notetaker transcript layout.

Caveat: this is in-memory only, scoped to each participant's own browser tab.
Since captions are already broadcast to everyone over the LiveKit data
channel, every participant's panel ends up showing the same full
conversation — but it does **not** survive a refresh/rejoin, and isn't
persisted anywhere server-side yet.

**Frontend:**
- `client/src/features/meeting/captions/CaptionProvider.jsx`
- `client/src/features/meeting/captions/useCaptions.js`
- `client/src/features/meeting/components/ConversationsPanel.jsx` (new)
- `client/src/features/meeting/MeetRoomLivekit.jsx`

### 5. "Meet Summarizer" panel (mock data)

Renamed the gradient header button from generic "Edit" to "Meet Summarizer"
(`onEdit` prop renamed to `onOpenSummary` in `MeetingHeader.jsx`, same icon —
pencil + star, unchanged). It now opens `MeetSummaryPanel`, same overlay
shell as `ConversationsPanel` (50%-width, full-height, backdrop click /
Escape to close), wired through the `sidebar` state the same way (`sidebar
=== 'summary'`).

Panel layout: a big, bold, centered title, a paragraph summary below it,
then a "Key Takeaways" section — each takeaway is a bullet; ones with an
assignee render as `Name: text` (action items), the rest as plain important
points (project status, risks, decisions).

**This renders a hardcoded `MOCK_SUMMARY` constant** — title, summary text,
and takeaways are not generated from anything yet. The shape of that
constant (`{ title, summary, keyTakeaways: [{ assignee?, text }] }`) is
intended to match what a real response will look like once this is wired to
the transcript from item 4 via the AI intelligence pipeline.

**Frontend:**
- `client/src/features/meeting/components/MeetSummaryPanel.jsx` (new)
- `client/src/features/meeting/components/MeetingHeader.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`

## Not yet implemented

- Replacing `MOCK_SUMMARY` with a real generated summary — feed the
  accumulated transcript (item 4) into the AI intelligence pipeline.
  `ai_generate_intelligence` currently summarizes only the chat log; the
  `MeetingIntelligence.source` model already has a reserved, unused
  `INTEL_SOURCE_TRANSCRIPT` value anticipating this.
  - `server/app/core/ai.py`
  - `server/app/api/intelligence.py`
  - `server/app/models/meeting.py`
- Persisting the transcript anywhere durable (currently in-memory only, lost
  on refresh/leave, not written to the backend).
- Edit / copy / share actions on the generated summary (named in the
  original feature ask — not yet built on top of the panel structure).
