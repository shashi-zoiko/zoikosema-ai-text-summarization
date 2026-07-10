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
are grouped under timestamp headings — a new heading starts whenever the gap
since the previous line exceeds 20s — then rendered as `Name: text` per
line, matching the Google Meet / Gemini notetaker transcript layout.

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

### 6. Fixed Conversations heading clock to match the meeting's Duration

Headings in item 4 initially showed time elapsed since the *first captured
caption* (always starting at `00:00:00`), which drifts from the actual
meeting clock — e.g. a caption said 2m40s into the call showed as `00:00:05`
instead of `02:40`. `ConversationsPanel` now takes a `joinedAt` prop (passed
from `MeetRoomLivekit.jsx`, same value the header's own Duration readout
uses) and computes each heading relative to that, so a heading always
matches what the header clock read at that moment. Format also switched
from a forced `HH:MM:SS` to the header's own convention — `mm:ss`, only
showing an hour segment past 60 minutes.

**Frontend:**
- `client/src/features/meeting/components/ConversationsPanel.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`

### 7. Conversations/Summarizer session now starts at the summarizer click, not the meeting join

Supersedes item 6's use of `joinedAt`. The session zero-point is now
`summarizerStartedAt` — a timestamp stamped in `MeetRoomLivekit.jsx` the
*first* time the Meet Summarizer button is clicked (later clicks don't move
it). Both `ConversationsPanel` and `MeetSummaryPanel` receive it as a
`startedAt` prop, so they share one session boundary.

`ConversationsPanel` now filters the transcript to lines with
`ts >= startedAt` — anything said before the summarizer was first opened is
excluded, not just relabeled — and headings count up from `00:00` at that
point rather than reading the meeting's overall duration. Before the
summarizer has ever been clicked (`startedAt` is `null`), the panel shows a
distinct empty state ("Click Meet Summarizer to start capturing the
conversation.") instead of the normal "captions are off" message.

**Frontend:**
- `client/src/features/meeting/MeetRoomLivekit.jsx` (also now passes
  `startedAt` to `MeetSummaryPanel` — that component doesn't consume it yet,
  since it's still all mock data with nothing timestamped to filter)
- `client/src/features/meeting/components/ConversationsPanel.jsx`

### 8. Meet Summarizer now force-enables captions on every click

Previously, if captions were toggled off, clicking Meet Summarizer opened
the panel but nothing ever got captured — capture is entirely gated on the
captions on/off state in `CaptionProvider`. Now every click of Meet
Summarizer force-enables capture regardless of that state (also clears a
stale mic-permission error, same as the manual CC toggle would), so the
host/participant never has to separately remember to turn captions on for
the summarizer to work.

Implementation note: the click handler lives in `MeetRoomLivekit.jsx`, which
renders `<CaptionProvider>` but isn't itself a descendant of its context —
so it can't reach `toggle` through `useCaptionControls()`. First tried
threading a "signal" prop through and reacting to it with a `useEffect`
inside `CaptionProvider`, but that's exactly the setState-in-effect
anti-pattern (and the lint rule caught it). Fixed by exposing an imperative
`forceEnable()` off `CaptionProvider` via `forwardRef` +
`useImperativeHandle`, called directly from the click handler — no effect
involved, since it's a direct response to a user action.

**Frontend:**
- `client/src/features/meeting/captions/CaptionProvider.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`

### 9. Corrected item 8 — Meet Summarizer capture must NOT touch the visible CC toggle

Item 8 was wrong: `forceEnable()` flipped the *same* `enabled` flag the
visible captions bubble overlay and toolbar CC toggle read from, so clicking
Meet Summarizer visibly turned captions on — not asked for, and not what
"capture audio to text for the Conversations container" means.

`CaptionProvider` now has two fully independent flags:
- `enabled` — unchanged meaning: the visible CC toggle (toolbar button,
  `C`/`Shift+C` shortcut, persisted to localStorage). `CaptionOverlay`
  already gated the bubble UI on this directly, so it needed no changes.
- `summarizerCapturing` — new, set once via the renamed `startCapture()`
  (was `forceEnable()`). Never persisted, never touches `enabled` or
  localStorage, sticky for the rest of the session once set.

Speech recognition itself runs when **either** flag is true — one shared
mic tap, since a browser only reliably runs one recognition session at a
time — but only `enabled` decides what's shown on screen. So clicking Meet
Summarizer now starts feeding the transcript silently in the background;
the CC toggle stays exactly as the user left it, untouched and unaffected.

**Frontend:**
- `client/src/features/meeting/captions/CaptionProvider.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`

### 10. "Start Summarizing" button moved inside the Meet Summarizer panel

The header's gradient button now only opens/closes the panel — it no longer
triggers capture itself. A new "Start Summarizing" button lives INSIDE
`MeetSummaryPanel` (a status row above the title: a pulsing green dot +
"Summarizing this conversation" once started, or "Not started yet" with the
button, before). Clicking it is what now calls `startSummarizing()` in
`MeetRoomLivekit.jsx` — stamps `summarizerStartedAt` (first click only) and
calls `captionProviderRef.current?.startCapture()`, same as before, just
moved to a deliberate in-panel action instead of firing the instant the
panel opens. Once started, the button shows a disabled "Started" state
(there's no stop).

**Frontend:**
- `client/src/features/meeting/components/MeetSummaryPanel.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`

### 11. Meet Summarizer header button styling tweak

Made the button a true circle (`h-9 w-9`, `grid place-items-center` — same
shape as the Info/Conversations buttons, dropping the pill-shaped
`inline-flex`/`px-3` it had before), tightened the gap between the star and
pencil icons to none, and shrank the star from `h-2.5 w-2.5` to `h-2 w-2`.

**Frontend:**
- `client/src/features/meeting/components/MeetingHeader.jsx`

### 12. Start/Pause toggle + listening glow on the header button

Two changes landed together since they share the same underlying rework:

**Toggle, not one-way start.** "Start Summarizing" inside `MeetSummaryPanel`
is now a real on/off toggle — "Pause Summarizing" (green pill, pause icon)
once capturing, back to "Start Summarizing" (gradient, sparkle icon) when
toggled off. `summarizerStartedAt` still only stamps on the *first* ever
turn-on (headings in Conversations keep one stable session clock across
pause/resume — gaps where capture was off just have no lines, which needs
no special handling since nothing gets captured during them anyway).

**Architecture simplified along the way.** Item 9's `forwardRef` +
`useImperativeHandle` workaround on `CaptionProvider` is gone — realized
`MeetingHeader` and `MeetSummaryPanel` both already render *inside*
`<CaptionProvider>` in the tree, so they can read/drive `capturing` straight
off `CaptionsControlContext` instead of routing through a ref. `MeetRoomLivekit`
now only owns `summarizerStartedAt`; `MeetSummaryPanel` calls
`setCapturing`/reads `capturing` from context directly and fires the
parent's `onStart` callback (session-stamp only) whenever it toggles on.

**Listening glow on the header button.** New `zk-summarizer-glow` CSS
animation (`index.css`, registered in the existing `prefers-reduced-motion`
guard) — a pulsing violet/pink box-shadow ring plus a breathing
scale(1) ↔ scale(1.08), matching the visual language of the existing
active-speaker tile glow (`zk-tile-speak`) but genuinely alternating in
scale rather than a static bump. Applied to the Meet Summarizer header
button whenever `capturing` is true (read from context, same as above) —
tied to the live on/off state, so it appears and disappears with each
toggle, not just once-ever-started.

**Frontend:**
- `client/src/features/meeting/captions/CaptionProvider.jsx`
- `client/src/features/meeting/captions/useCaptions.js`
- `client/src/features/meeting/components/MeetSummaryPanel.jsx`
- `client/src/features/meeting/components/MeetingHeader.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx`
- `client/src/index.css`

### 13. Swapped pink for blue across the Meet Summarizer color scheme

No more pink anywhere in this feature. Both button gradients
(`bg-gradient-to-br from-violet-500 to-pink-500`, on the header button and
on the panel's "Start Summarizing" state) are now `from-violet-500
to-blue-500`. The `zk-summarizer-glow` keyframes' pink rgba values
(`rgba(236,72,153,*)`) are now blue (`rgba(59,130,246,*)` — Tailwind's
blue-500), so the glow still matches the button's own gradient.

**Frontend:**
- `client/src/features/meeting/components/MeetingHeader.jsx`
- `client/src/features/meeting/components/MeetSummaryPanel.jsx`
- `client/src/index.css`

### 14. Removed MOCK_SUMMARY — panel now calls the real intelligence pipeline

Investigated the existing backend before touching anything (see the full
findings this was based on, condensed below) — turned out **no backend
changes were needed at all**. `POST /api/meetings/{code}/intelligence`
already accepts an arbitrary inline `chat_log: list[dict]` in its request
body; `_format_chat_log` (`server/app/core/ai.py`) reads `time`/`name`/`body`
(with `timestamp`/`sender`/`user`/`text`/`content` fallbacks), so our caption
transcript maps onto it directly with no schema changes.

**What actually changed, frontend only:**
- `MOCK_SUMMARY` constant is gone.
- On open, `MeetSummaryPanel` now `GET`s `/api/meetings/{code}/intelligence`
  to load whatever summary already exists (server returns `200` with a
  `null` body if none — not a 404 — so this cleanly lands on the empty
  state, not an error).
- Host/co-host (`isHostOrCohost`) gets a **Generate/Regenerate Summary**
  button. It reshapes the live `transcript` (from `useLiveCaptions()`) into
  `{time, name, body}` entries and `POST`s them as `chat_log` with
  `force: true`. Polls every 2.5s while the response status is
  `generating`/`pending`, same pattern as the existing full-page dashboard
  (`pages/MeetingIntelligence.jsx`).
- Non-host participants see a read-only view (no generate button) — the
  backend already enforces this server-side (403 for non-host POSTs), the
  frontend just doesn't render a button that would fail anyway.

**Response shape turned out richer than the mock ever was** — the real
`ai_generate_intelligence` payload has `tldr`, `score`, `topics`,
`decisions`, `action_items` (`{task, owner, due, priority, depends_on}`),
`risks`, `speakers`, `sentiment`, `follow_ups`, `contradictions`,
`knowledge_nuggets` — not `{title, summary, key_takeaways}`. Mapped it onto
this panel's existing visual structure rather than inventing a new one:
`intel.tldr` → the paragraph under the "Meeting Summary" heading;
`action_items` (assignee = `owner`) + `decisions` + `risks` flattened into
one Key Takeaways list, same assignee-tagged-vs-plain-point rendering as
before. This is a materially better fit for "important points in the
project / anything important" than the old made-up mock shape was.

Also confirmed: `INTEL_SOURCE_TRANSCRIPT` (mentioned in earlier items as a
dormant field) is still never set anywhere server-side — every row this
panel creates is still tagged `source=INTEL_SOURCE_CHAT` internally, since
the endpoint has no source-awareness at all; it just calls
`ai_generate_intelligence` on whatever `chat_log` it's given, transcript or
otherwise. Fine functionally (the AI doesn't care what the source column
says), but worth knowing if `source` is ever surfaced/filtered on later.

**Frontend:**
- `client/src/features/meeting/components/MeetSummaryPanel.jsx`
- `client/src/features/meeting/MeetRoomLivekit.jsx` (now passes `code` and
  `isHostOrCohost` down)

## Not yet implemented

- Persisting the transcript anywhere durable server-side. It's still only
  ever sent inline in the POST body at generate-time — nothing accumulates
  it across sessions, so a transcript from a call that's already ended
  can't be summarized later.
- Edit / copy / share actions on the generated summary (named in the
  original feature ask — not yet built on top of the panel structure).
- `source` on `MeetingIntelligence` still always says `chat` even when the
  content was actually a caption transcript — cosmetic/data-hygiene gap,
  not a functional one.
