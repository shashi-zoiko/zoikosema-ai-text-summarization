# AI Summarization Feature — Context & End-to-End Plan

Background/decisions doc for the meeting-summarizer feature. For a running
log of actual code changes, see [progress.md](./progress.md) in this folder.

## Original ask

The feature as first framed, before the codebase was inspected:

> We are trying to build a feature in the meet — it will summarize the
> conversation and return all the meet agenda. It's using React as FE, no BE.
> OpenAI API to summarize the conversation. Features: edit, copy, share.
> As we are not using the BE we will store the text in local storage since
> it's mostly just KBs. When shared, the whole text will be shared in a link
> format so others can access the summary — is this possible without a
> backend or database?

Follow-up context added on top of that: this is meant to work like Google
Meet's own AI summarizer — during a live call, a couple of members share
their perspective and counterpoints, and at the end a component summarizes
the whole conversation into a text note.

## Why the "no BE / no DB" framing doesn't apply here

That framing is realistic in general (see analysis below), but this app
(`zoikotime/Zoiko_Meet`, cloned locally as `zoikosema-text`) turned out to
already be a full-stack product, not a blank slate:

- **Backend:** FastAPI + SQLAlchemy + Postgres + Redis, with **LiveKit** as
  the media SFU.
- **Live captions already exist:** `client/src/features/meeting/captions/`
  uses the browser Web Speech API per participant and broadcasts caption
  text E2EE over a LiveKit data channel (topic `"captions"`). The server
  relays this but **never persists a transcript** anywhere.
- **An AI summarization pipeline already exists** — but using **Anthropic
  Claude**, not OpenAI: `server/app/core/ai.py` (`ai_summarize`,
  `ai_suggest_actions`, `ai_generate_intelligence`), exposed at
  `/api/meetings/{code}/intelligence`. It currently summarizes **the chat
  log only** — not the spoken conversation.
- There's a reserved-but-unused `INTEL_SOURCE_TRANSCRIPT` value on the
  `MeetingIntelligence.source` model field (`server/app/models/meeting.py`)
  — someone already anticipated wiring an audio-derived transcript in and
  never finished it.

So the real gap isn't "how do we do this with no backend" — it's "how do we
finish the half-built pipeline that's already here."

## General analysis: is a no-BE/no-DB summarizer possible? (for reference)

Answered in general terms, independent of this repo, in case it's useful
elsewhere:

- **Summarize + edit + copy + share + auto-delete**, given a transcript
  already in hand, is trivial with no backend: localStorage for the text,
  call an LLM API directly from the browser (BYOK to avoid exposing a
  shared API key), encode the summary into the URL **hash fragment**
  (`#d=...`, compressed) for link-sharing — fragments never hit a server, so
  a static host works. Tools like Excalidraw use this pattern.
- **Producing the transcript from a live multi-party call** is the hard
  part. Web Speech API only transcribes the local mic of the browser it
  runs in — there's no clean way to transcribe *remote* participants'
  audio purely client-side. The realistic no-BE path is: each participant's
  browser transcribes its own mic and broadcasts the caption text over
  whatever real-time channel the call already uses (which is exactly what
  this repo already does over LiveKit data channels).
- Where it stops being "no backend": persisting that transcript anywhere,
  or running production-grade STT server-side (Whisper/Deepgram/etc. instead
  of Web Speech API).

## Revised end-to-end plan (given what already exists)

1. **Persist the caption stream for a meeting's duration.** Captions already
   flow over the LiveKit data channel; nothing stores them today. Could be
   as lightweight as accumulating in Redis for the meeting's lifetime and
   discarding after summarization, if long-term storage isn't wanted.
2. **Feed the accumulated transcript into the existing intelligence
   pipeline** — flip on the dormant `INTEL_SOURCE_TRANSCRIPT` path in
   `ai_generate_intelligence` (`server/app/core/ai.py`) alongside or instead
   of the chat-log source.
3. **Frontend summary panel** with edit / copy / share, opened from the
   meeting UI. The gradient pencil+star button added to
   `MeetingHeader.jsx` (see progress.md) is the intended entry point —
   currently a no-op stub, action not yet wired.
4. **Share mechanism**: since a real backend + DB already exist here (unlike
   the original no-BE framing), sharing can just be "fetch this meeting's
   persisted intelligence record by code/id" via the existing API, rather
   than encoding the whole summary into a URL. Simpler and avoids the
   URL-length/snapshot caveats that a pure no-BE approach would have.

## Open decisions

- What exactly the header button should do on click (currently a stub —
  candidates discussed: open the AI summary panel, rename the meeting).
- Whether the transcript should be persisted only transiently (Redis, gone
  after summarization) or durably (Postgres, alongside the meeting record).
- Whether to standardize on Claude (already integrated, has a working
  pipeline) rather than introducing OpenAI as a second AI vendor.
