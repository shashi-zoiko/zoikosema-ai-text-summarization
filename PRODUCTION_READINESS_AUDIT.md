# Zoiko Meet — Production Readiness Audit

**Target workload:** 50 participants · single meeting · 3–4 continuous hours · camera + mic + chat + screen share + active interaction
**Audit type:** Read-only inspection, static analysis, and analytical simulation. **No code was modified.**
**Date:** 2026-06-26 · **Branch:** `ashrafv1`
**Methodology:** Full source inspection (client + server + infra + CI), LiveKit/WebRTC architecture analysis, and capacity modelling. Live load tests were **not** executed — no staging cluster or LiveKit load harness was accessible from this environment. All "simulation" numbers below are analytical projections derived from the code and from known LiveKit/Cloud Run behaviour, with assumptions stated. They are estimates, not measurements.

---

## 1. Executive Summary

Zoiko Meet is a **genuinely SFU-only** application built on **LiveKit Cloud** (media) + **FastAPI** (signaling/REST) + **React 19 / livekit-client 2.19** (frontend), deployed as a **single unified container on GCP Cloud Run**. The media-plane engineering is **strong**: adaptive stream, dynacast, simulcast, per-subscriber quality tiers, single-track publishing, and clean reconnect logic are all present and correct. If media were the only concern, 50 participants would be comfortably within LiveKit Cloud's capability.

**However, the application as currently configured cannot reliably host 50 participants for 3–4 hours.** The blocker is **not** the media plane — it is the **app's own signaling/control plane** colliding with its deployment topology:

> **The meeting control WebSocket (`meet_manager`) is an in-memory, per-process pub/sub with no Redis fanout and no session affinity, while Cloud Run is configured with `--concurrency=40 --max-instances=10`. Each participant holds one long-lived control WebSocket. Cloud Run counts every open WebSocket as one in-flight request, so the 41st concurrent participant forces a second instance — at which point chat, roster, reactions, raise-hand, and waiting-room admission silently fragment: participants on instance A cannot see events from participants on instance B.**

This is a **hard, deterministic failure that occurs at ~41 participants — below the 50 target** — and it is invisible in small tests (it only appears once Cloud Run scales out). On top of this sit several **long-session memory growth** issues (unbounded chat and whiteboard arrays), **client-side rendering load** (all 50 video tiles subscribed and decoded with no virtualization), and **ephemeral recording storage** (recordings written to a Cloud Run instance's local disk are lost on scale-down/redeploy).

**Verdict: NO** — not in the current configuration. **Realistic reliable maximum today: ~25–35 participants**, and only for sessions where Cloud Run does not scale past one instance. With the fixes in §9/§13 (Redis-backed WS fanout, raised/decoupled concurrency, bounded client state, GCS egress, tile virtualization), 50 participants for 3–4 hours is achievable.

**Overall production-readiness score: 54 / 100** (detailed scorecard in §10).

---

## 2. Architecture Analysis

### 2.1 Topology
```
Browser (React 19 + livekit-client 2.19)
   │
   ├──── HTTPS REST ─────────────►  FastAPI (Cloud Run, single unified image)
   │      (join, token mint,           ├─ /api/meetings/*    (join, admit, token)
   │       admit, recording)           ├─ /api/recordings/*
   │                                   ├─ core: auth, rate-limit, DB pool
   ├──── Control WebSocket ──────►     └─ /ws/meetings/{code}  (meet_manager, IN-MEMORY)
   │      (chat, reactions,                     │
   │       raise-hand, roster,                  └─ Postgres (Supabase, txn pooler :6543)
   │       waiting-room)
   │
   └──── Media (WebRTC/SFU) ─────►  LiveKit Cloud  (wss://<project>.livekit.cloud)
          camera/mic/screen              └─ TURN/STUN provided by LiveKit Cloud
```

| Layer | Implementation | Reference |
|---|---|---|
| Frontend | React 19, livekit-client 2.19, @livekit/components-react 2.9, Vite, Zustand, Framer Motion | `client/package.json` |
| Backend | FastAPI + uvicorn (single worker), SQLAlchemy 2.0 (sync psycopg2), python-jose JWT | `server/requirements.txt`, `server/Dockerfile` |
| Media | LiveKit Cloud SFU (confirmed, not self-hosted in prod) | `deploy.yml:79` `MEDIA_PROVIDER=livekit` |
| Signaling | App control WebSocket, in-memory `RoomManager` | `server/app/websocket/manager.py:84-85` |
| DB | Supabase Postgres, transaction pooler :6543, pool 20+10 | `server/app/core/database.py:34` |
| Deploy | GCP Cloud Run, unified Docker image via GitHub Actions → Artifact Registry | `.github/workflows/deploy.yml` |

### 2.2 Signaling flow
Client opens `wss://…/ws/meetings/{code}?token=<JWT>` (`useMeetingControlWs.js`). Token comes from `getAuthToken()` (works for both registered users in localStorage and guests in sessionStorage — a previously-fixed guest bug). Reconnect uses exponential backoff `min(8000, 200·2^attempt) + jitter`, with hard-stop close codes (4001/4401/4403/4404/4410/4423) that suppress reconnect. An outbox queue buffers messages while the socket is down. **Cleanup is correct** (timer cleared, socket closed on unmount).

### 2.3 Media flow
`MeetRoomLivekit.jsx:44-63` connects with:
```js
{ adaptiveStream: true, dynacast: true,
  publishDefaults: { simulcast: true,
    videoSimulcastLayers: [h180, h360, h720],
    screenShareEncoding: h1080fps30, screenShareSimulcastLayers: [h720fps15, h1080fps30],
    degradationPreference: 'maintain-resolution', dtx: true, red: true },
  videoCaptureDefaults: { resolution: h720 } }
```
This is a **best-practice config** for large rooms. Media reconnect is delegated to LiveKit's built-in logic; the app only handles terminal disconnect reasons (kick/shutdown/room-deleted) explicitly.

### 2.4 Room / join / leave / waiting room
- **Lazy room creation** on first media-token request; `ensure_room` is idempotent with `max_participants=200`, `empty_timeout=300s` (`livekit_provider.py`).
- **Join** writes 1–3 DB rows (participant upsert + connect-session member); handles concurrent-first-join IntegrityError race.
- **Waiting room** admission was recently re-engineered to be event-driven (`asyncio.Event` push, ~6–16 ms) with batch admit-all — this is good.
- **Leave** updates session member status.

### 2.5 TURN/STUN
Provided entirely by **LiveKit Cloud**. No app-side coturn. This is correct and removes a whole class of self-hosting risk. (A self-hosted GCE option is documented in `docs/livekit-production.md` but is not the prod path.)

### 2.6 Authentication
JWT (python-jose). **LiveKit access token TTL = 21600 s (6 h)** (`config.py:46`) — deliberately raised to survive long meetings + reconnects. **Adequate for a 3–4 h meeting with margin**; there is no client-side token refresh, so meetings beyond ~6 h would fail on reconnect.

### 2.7 WebSocket lifecycle
Connections tracked in-memory in `RoomManager._rooms: dict[room → set[WebSocket]]`, two singletons `chat_manager` / `meet_manager`. Broadcast is a sequential `for ws in room: await ws.send_json(...)` with dead-socket reaping. **No Redis fanout, no cross-instance delivery, no application-level heartbeat/idle-timeout, no backpressure.** This is the architectural fault line (see §3, §9).

---

## 3. LiveKit Compliance Report

| Requirement | Status | Evidence |
|---|---|---|
| LiveKit SFU only | ✅ PASS | `MEDIA_PROVIDER=livekit` (`deploy.yml:79`); providers are `LiveKitMediaProvider` / `NullMediaProvider` only |
| No mesh / P2P fallback | ✅ PASS | No `RTCPeerConnection`, no mesh code. `MeetRoomLivekit.jsx:318` comment: "LiveKit is the only media plane." "mesh" appears only as a legacy DB default string |
| No unnecessary RTCPeerConnections | ✅ PASS | All peer connections owned by livekit-client SFU transport |
| Exactly one camera track | ✅ PASS | `setCameraEnabled()` toggles a single track |
| Exactly one mic track | ✅ PASS | `setMicrophoneEnabled()` |
| Exactly one screen track | ✅ PASS | `setScreenShareEnabled()`; latest-share-wins (single active) |
| No duplicate publishers | ✅ PASS | Virtual-bg replaces the raw track via `setProcessor` — no second publish |
| Subscriptions managed | ⚠️ PARTIAL | Quality is tiered per-subscriber (HIGH hero / LOW gallery) and adaptiveStream is on, **but** `Stage.jsx` uses `onlySubscribed: false` → every participant is **subscribed** even when off-screen; no unsubscribe-on-scroll |

> **Stale-doc correction:** `docs/livekit-production.md` opens with "the current Cloud Run deployment runs **mesh only**." This is **out of date** — the live `deploy.yml` hardcodes `MEDIA_PROVIDER=livekit`. The doc should be updated to avoid misleading future operators.

**LiveKit implementation grade: strong.** The only compliance gap is the always-subscribe model, which is a client-CPU concern (§4/§5) rather than a correctness bug.

---

## 4. Performance Benchmarks (analytical projections)

> No live harness was run. Figures below are modelled from the code paths and known LiveKit/Cloud Run characteristics. Treat as order-of-magnitude planning numbers, not measurements.

| Metric | Projected behaviour | Basis |
|---|---|---|
| Room creation time | ~50–150 ms (lazy, idempotent `ensure_room`) | `livekit_provider.py` |
| Token generation time | <10 ms (local JWT sign) | `livekit_provider.py` |
| Join latency (REST + token + LK connect) | ~0.4–1.2 s typical | 2–3 sync DB queries + LK handshake |
| Track subscription latency | ~0.2–0.6 s/track (SFU) | LiveKit Cloud typical |
| Audio startup | <0.5 s | DTX/RED enabled |
| Video startup | ~0.5–1.5 s (simulcast negotiation) | h180/h360/h720 ladder |
| Screen-share startup | ~0.5–1.0 s | dedicated h1080fps30 publish |
| Chat latency (single instance) | ~10–40 ms | in-memory broadcast |
| Chat latency (if scaled to 2 instances) | **∞ for cross-instance peers** | no Redis fanout |
| Reconnect time (control WS) | 0.2–8 s backoff | `useMeetingControlWs.js` |
| RTT / jitter / loss | governed by LiveKit Cloud + client network | not app-controlled |

---

## 5. Load Test Results (modelled)

Assumption for the WebSocket projection: **Cloud Run counts each active WebSocket as one concurrent request** (documented Cloud Run behaviour), and the control WS lives for the whole meeting. Config under test: `--concurrency=40 --max-instances=10`, no session affinity, in-memory `meet_manager`.

| Users | Media (LiveKit) | Control WS / signaling | DB pool (30/inst) | Client render | Outcome |
|---|---|---|---|---|---|
| 5 | ✅ trivial | ✅ 1 instance | ✅ | ✅ | Healthy |
| 10 | ✅ | ✅ 1 instance | ✅ | ✅ | Healthy |
| 20 | ✅ | ✅ 1 instance | ✅ | ✅ ~20 tiles | Healthy |
| 30 | ✅ | ✅ 1 instance (30 WS < 40) | ⚠️ pool pressure under chat bursts | ⚠️ CPU rising | Degrading but functional |
| 40 | ✅ | ⚠️ at the concurrency edge (40 WS + REST = scale-out imminent) | ⚠️ queueing | ⚠️ | Edge of failure |
| **50** | ✅ media fine | ❌ **scales to 2 instances → signaling fragments** | ⚠️ | ❌ 50 decoded tiles | **FAIL (signaling split-brain)** |

**Key result:** the media plane scales to 50 effortlessly; the **app signaling plane breaks first**, at ~41 concurrent participants, due to the concurrency/in-memory-fanout interaction. This is the single most important finding of the audit.

---

## 6. Long-Duration Stability Results (4-hour projection)

| Concern | Finding | Severity |
|---|---|---|
| **Chat memory growth** | `chatMessages` array (`MeetRoomLivekit.jsx:145`, append `:209`) is **unbounded** — every message kept forever, full array copied on each append, full list re-diffed in `ChatPanel`. Over 4 h × 50 users this is the most likely OOM/jank source. (Ironically, reactions are capped at 49 and toasts at 4, but chat — the highest-volume stream — is uncapped.) | **Critical** |
| **Whiteboard stroke growth** | `wbStrokes` (`:149`/`:271`) **and** Whiteboard's internal `strokes` both grow unbounded; `wb-clear` resets the prop but not the internal state; every resize re-draws every stroke ever made (O(n)). | **High** |
| **Background-image blob URLs** | `URL.createObjectURL` in `addUpload` (`:405`) never `revokeObjectURL`'d; `bgUploads` only grows. | **Medium** |
| Token expiry | 6 h TTL > 4 h meeting → OK, no margin beyond ~6 h | Low |
| LiveKit listener cleanup | `useRoomEvents` correctly pairs `.on`/`.off` in cleanup | ✅ clean |
| Timers/intervals | All `setInterval`/`setTimeout`/RAF in scope have matching cleanup (HostMenu, MeetingHeader, captions, reactions, active-speaker) | ✅ clean |
| AudioContext | `sounds.js` deliberately uses `new Audio(dataURI)`, not Web Audio — no AudioContext leak; live elements tracked + removed on `ended`/`error` | ✅ clean |
| Virtual-bg RAF | `requestVideoFrameCallback`/RAF loop + segmenter `close()` correctly torn down on unmount | ✅ clean (but sustained CPU on CPU-fallback devices) |
| Track attach/detach | `<VideoTrack>` + manual `PresenterPiP` attach/detach both clean | ✅ clean |
| Server WS state | `_conn_info`/`_user_ws` cleaned in `finally`; `_status_events` may retain stale entries (minor) | Low |

**Net:** leak *hygiene* on listeners/timers/audio is genuinely good. The long-session risk is concentrated in **two uncapped state arrays (chat, whiteboard)** plus framer-motion FLIP across many tiles.

---

## 7. Cross-Browser Compatibility Results

> Assessed by capability analysis of the stack (livekit-client 2.19 supports all evergreen browsers; MediaPipe tasks-vision requires WebGL2/WASM). Not device-lab tested.

| Platform | Camera | Mic | Screen share | Chat/UI | Virtual BG | Notes |
|---|---|---|---|---|---|---|
| Chrome (desktop) | ✅ | ✅ | ✅ | ✅ | ✅ (GPU) | Reference platform |
| Edge (desktop) | ✅ | ✅ | ✅ | ✅ | ✅ | Chromium parity |
| Firefox (desktop) | ✅ | ✅ | ✅ | ✅ | ✅ | Simulcast OK; screen-share picker differs |
| Safari (macOS) | ✅ | ✅ | ✅ | ✅ | ⚠️ | WebGL/WASM perf lower; verify segmenter |
| Safari iPhone | ✅ | ✅ | ❌ getDisplayMedia unsupported on iOS Safari | ✅ | ⚠️ heavy | Screen share not available on iOS; prior iOS screenshare toast handling noted in history |
| Safari iPad | ✅ | ✅ | ⚠️ limited | ✅ | ⚠️ | iPadOS varies |
| Android Chrome | ✅ | ✅ | ⚠️ varies by OEM | ✅ | ⚠️ thermal | Background/tab-suspend can drop media |

**Mobile caveat for a 50-person gallery:** mobile devices cannot decode dozens of simultaneous streams. The hero+rail layout mitigates this, but full gallery on mobile at 50 is not viable — acceptable as a product constraint, but must be enforced (cap visible tiles on small screens).

---

## 8. Resource Usage Estimates (50 participants, single room)

**Assumptions:** ~80–150 kbps/stream for LOW gallery tiles, ~600 kbps–1.2 Mbps for HIGH hero, one active screen share at ~1.5–2.5 Mbps, audio ~30 kbps/talker with DTX.

### Per-client (downlink)
- 50 subscribed cameras at mostly LOW (simulcast) + 1 hero HIGH + 1 screen share + audio ≈ **8–18 Mbps down** with adaptiveStream trimming off-screen tiles. **Decoding ~30–50 concurrent streams is the real client bottleneck** (40–60% CPU on a 4-year-old laptop; mobile cannot sustain it).
- Uplink per client: 1 camera (simulcast 3 layers ≈ 1.2–1.6 Mbps) + audio.

### LiveKit Cloud (SFU) — the heavy lifting is here, not on your servers
- Aggregate SFU egress for 50 participants in active gallery can reach **hundreds of Mbps to low Gbps**; this is LiveKit Cloud's capacity and **billed bandwidth**, not your Cloud Run cost. Budget LiveKit Cloud minutes/bandwidth accordingly — a 50-person 4-h meeting is a meaningful bandwidth line item.

### Backend (Cloud Run) — light, *if* it stays one instance
- CPU: 2 vCPU ample for signaling/REST (no media transits the backend).
- RAM: 1 GiB is **tight** with active WS fanout; the chat-array growth is client-side, but server holds 50 WS + per-conn dicts — fine at 1 GiB for one meeting.
- **DB:** 30 connections (20+10) per instance vs `--concurrency=40` → up to ~10 requests queue on the pool under burst. Each join = 1–3 writes; each chat/reaction = a broadcast (no DB write for in-call chat, which is ephemeral). Postgres load is modest for one meeting; the mismatch matters under chat/reaction bursts.
- **Disk/IO:** negligible except recording (see below).
- **Redis:** not provisioned in prod env (`REDIS_URL` absent from `deploy.yml`). The legacy meeting WS doesn't use it anyway — which is exactly the scaling problem.

### Recording
- Composite egress ≈ headless Chromium (~500 MB RAM + ~1 vCPU per recording). A 3–4 h composite ≈ **~3.6–10 GB**. **Written to the instance's local `/app/recordings`** → **lost on scale-down/redeploy** (Cloud Run is ephemeral). Needs GCS egress output.

---

## 9. Bottlenecks and Risk Assessment

| # | Severity | Bottleneck | File / Component | Reason | Impact | Recommended fix |
|---|---|---|---|---|---|---|
| B1 | **Critical** | Signaling fragments when Cloud Run scales out | `manager.py:84-85` (in-memory) + `deploy.yml:91-95` (`concurrency=40`, no affinity) | 50 long-lived WS > 40 concurrency → 2nd instance; `meet_manager` only sees local sockets; no Redis fanout | Chat/roster/reactions/raise-hand/admission split-brain for half the room at ~41 users | Add Redis pub/sub fanout to `RoomManager` **and** raise/decouple WS concurrency (e.g. dedicated WS service or `--concurrency` ≥ expected peak); enable session affinity as a stopgap |
| B2 | **Critical** | Unbounded `chatMessages` array | `MeetRoomLivekit.jsx:145,209` + `ChatPanel.jsx` | Never capped; full-array copy per append; full re-diff | Memory growth + UI jank over 3–4 h | Cap to last ~300–500 and/or virtualize chat list |
| B3 | **High** | All 50 video tiles subscribed + rendered, no virtualization | `Stage.jsx:33-39` (`onlySubscribed:false`), `StageLayout.jsx`, `useGridLayout.js` | Off-screen tiles stay subscribed/decoded | High client CPU (40–60% on mid laptops), unusable on mobile gallery | Unsubscribe/`VideoQuality.OFF` off-screen tiles; paginate/virtualize gallery above ~12–16 |
| B4 | **High** | Unbounded whiteboard strokes + O(n) redraw | `MeetRoomLivekit.jsx:149,271`, `Whiteboard.jsx:194,202-210` | Two growing arrays; `wb-clear` misses internal state; redraw-all on resize | Memory + canvas jank in long collab sessions | Cap/segment strokes; clear internal state on `wb-clear`; incremental draw |
| B5 | **High** | Recordings on ephemeral local disk | `recording_cleanup.py:15`, egress to `/app/recordings` | Cloud Run instances are ephemeral | Recordings lost on scale-down/redeploy | Configure LiveKit egress → GCS (`GCPUpload`); serve via signed URLs |
| B6 | **Medium** | DB pool < Cloud Run concurrency | `database.py:34` (30) vs `deploy.yml` (40) | 40 concurrent requests, 30 connections | ~10 requests queue under burst → latency | Raise pool to ~40–45 or lower concurrency to 30 |
| B7 | **Medium** | Sequential WS broadcast, no backpressure | `manager.py:55-81` | One slow/full socket stalls the loop for all subsequent peers | Latency spikes for everyone when one client is slow | `asyncio.gather` parallel sends with per-send timeout |
| B8 | **Medium** | No WS heartbeat / idle timeout | `signaling.py` main loop | Relies on TCP keepalive only | Zombie connections hold roster slots | App-level ping/idle-close |
| B9 | **Medium** | Framer-motion FLIP across many tiles | `StageLayout.jsx:44-99` | `LayoutGroup`+`layoutId` measures all animated nodes on any layout change | Jank at 50 tiles on join/leave/hero-swap | Disable layout animation above a tile threshold |
| B10 | **Medium** | No reaction/raise-hand rate limit | `signaling.py` | Unbounded emoji/hand toggles fan out O(N) | Malicious/buggy client can flood 50 peers | Per-user throttle (e.g. 5/s) |
| B11 | **Low/Med** | Repeated `setVideoQuality` churn | `Stage.jsx:144-162` | Re-runs across all cams on every hero/cams change | SFU signalling churn in speaker view | Debounce / skip redundant calls |
| B12 | Low | In-memory rate limiters | `core/rate_limit.py` | Per-process; don't aggregate across instances | Limits weaken under multi-instance | Redis-backed limiter (same Redis as B1) |
| B13 | Low | No client token refresh | `config.py:46` (6 h TTL) | Fine for ≤6 h | Meetings >6 h fail on reconnect | Refresh token before expiry |
| B14 | Low | Stale doc says "mesh only" | `docs/livekit-production.md` | Contradicts `deploy.yml` | Operator confusion | Update doc |

---

## 10. Production Readiness Scorecard

| Dimension | Score /100 | Rationale |
|---|---|---|
| Architecture | 70 | Clean SFU separation, good media config; let down by in-memory signaling not matching the autoscaled deploy |
| Scalability | 35 | Hard signaling break at ~41 concurrent; no cross-instance fanout; pool/concurrency mismatch |
| Reliability | 50 | Solid reconnect + waiting-room; undermined by split-brain risk and lost recordings |
| Performance | 55 | Excellent media tuning; client-side 50-tile decode + unbounded arrays drag it down |
| Maintainability | 72 | Well-organized, documented, good cleanup hygiene; some dead code + stale docs |
| Cross-browser | 65 | Strong desktop; iOS screen-share + mobile gallery limits |
| LiveKit implementation | 88 | Best-practice options; only gap is always-subscribe model |
| Resource efficiency | 58 | Backend light; client decode heavy; 1 GiB RAM tight; ephemeral recording waste |
| Security | 62 | JWT + rate limits + guest-token caps present; limiters/affinity weaken at scale; TURN handled by LiveKit |
| **Production readiness (overall)** | **54** | Media-ready, **signaling + deploy topology not ready for 50** |

---

## 11. Maximum Supported Participant Estimate

| Metric | Estimate | Limiting factor |
|---|---|---|
| Max participants before **signaling** failure | **~40** (breaks at 41 when Cloud Run scales out) | B1 — in-memory WS + `concurrency=40`, no affinity/Redis |
| Max participants with **good** quality (single instance, modern clients) | **~25–35** | Client CPU (50-tile decode), DB pool burst, framer FLIP |
| Max **active video tiles** rendered well on mid-range client | **~16–25** | No virtualization; all subscribed |
| Max **active screen shares** | 1 (by design, latest-wins) | Product choice — fine |
| Max **simultaneous chat users** (single instance) | ~50 functionally, but unbounded client array degrades over hours | B2 |
| Max **sustainable meeting duration** | ~3–4 h before chat/whiteboard memory growth bites; hard token wall at 6 h | B2/B4/B13 |
| LiveKit Cloud media ceiling | ≫ 50 (not the bottleneck) | LiveKit Cloud capacity/billing |

**Realistic reliable maximum today: ~25–35 participants**, single Cloud Run instance, desktop clients, modest chat/whiteboard use.

---

## 12. Final Go / No-Go Recommendation

### Can the current application reliably support 50 participants for 3–4 continuous hours?

# ❌ NO — not in the current configuration.

**Why (in priority order):**

1. **Signaling split-brain at ~41 participants (B1).** The meeting control WebSocket is an in-memory per-process bus with no Redis fanout and no session affinity, while Cloud Run is set to `--concurrency=40 --max-instances=10`. The 41st concurrent control-WS forces a second instance, and from that moment chat, roster, reactions, raise-hand, and waiting-room admission stop crossing between instances. This happens *below* the 50 target and is invisible until you actually run >40 concurrently. **This alone is disqualifying.**

2. **Unbounded client memory over a long session (B2, B4).** `chatMessages` and whiteboard strokes grow without limit for the entire meeting, with full-array copies and O(n) redraws — exactly the failure mode a 3–4 h session exercises.

3. **Client rendering load (B3).** All 50 camera tracks stay subscribed and decoded with no virtualization — 40–60% CPU on mid-range laptops, unusable in gallery on mobile.

4. **Recordings are lost (B5).** Egress writes to ephemeral Cloud Run disk; any scale-down/redeploy destroys the file.

**What the app does well (so the fix is tractable, not a rewrite):** genuine SFU-only architecture, excellent LiveKit options (adaptiveStream/dynacast/simulcast/per-subscriber quality), single-track publishing, correct listener/timer/audio cleanup, solid reconnect and event-driven waiting room, sensible 6 h token TTL.

### Path to YES (ordered)
1. **Fix the signaling topology (B1)** — the gating item. Either: (a) add Redis pub/sub fanout to `RoomManager` so any number of instances share room state, **and** raise WS concurrency / move the WS to a dedicated always-on service; or (b) as an interim, pin WS concurrency above expected peak (single instance) + session affinity, and load-test the ceiling. Add Redis-backed rate limiters (B12) on the same Redis.
2. **Bound client state (B2, B4)** — cap/virtualize chat; cap whiteboard strokes + clear internal state on `wb-clear`.
3. **Virtualize/limit the gallery (B3, B9)** — unsubscribe off-screen tiles, paginate above ~16, gate FLIP animation.
4. **GCS egress for recordings (B5).**
5. **Align DB pool with concurrency (B6)**, add WS backpressure + heartbeat + reaction throttle (B7/B8/B10), and fix the stale doc (B14).

With items 1–4 done, **50 participants for 3–4 hours becomes achievable** on this stack (LiveKit Cloud already supports the media). Until B1 is fixed, **cap meetings at ~30 participants** and pin to a single Cloud Run instance to stay correct.

---

*Audit performed read-only. No application code was modified. Live load/long-duration figures are analytical projections (no staging/LiveKit load harness was accessible); all assumptions are stated inline. File:line references point to the `ashrafv1` branch at time of audit.*
