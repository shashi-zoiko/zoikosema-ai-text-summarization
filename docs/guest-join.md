# Guest Join (anonymous meeting access)

Lets anyone open a meeting link, type a display name, and join — **no account, no
sign-in** — exactly like Microsoft Teams / Google Meet / Zoom. The existing
authenticated flow is unchanged; guest support is purely additive.

---

## 1. Identity model — ephemeral guest users

The entire meeting backend keys participants on an **integer `user_id`** (FK to
`users.id`): the waiting-room sockets (`_user_ws`, `_status_events` keyed
`(meeting_id, user_id)`), admit/deny/kick/promote, the roster, and the LiveKit
`u:{user_id}` identity. Rather than thread a parallel guest identity through all
of that, a guest **is** a real `users` row, flagged ephemeral:

| Column | Guest value |
|---|---|
| `is_guest` | `true` |
| `email` | `NULL` (column is now nullable; unique index still holds for real accounts) |
| `password_hash` | `NULL` |
| `avatar_color` | from a distinct guest palette (`app/core/guest.py`) |
| `guest_expires_at` | `now + LIVEKIT_TOKEN_TTL` (6h) |

This means waiting room, admit/kick, roster, and token minting all work
**unchanged**. Guest rows are deleted when the meeting ends (and swept by a
periodic backstop) — see [Cleanup](#6-cleanup).

Guests are gated per-meeting by `meetings.guests_enabled` (**default `true`** so
existing links accept guests; host can disable it via `PATCH /api/meetings/{code}`).

---

## 2. Token model & the dependency split (security)

Two JWT types share one secret/algorithm:

- `type: "access"` — signed-in accounts (unchanged), 7-day TTL.
- `type: "guest"` — anonymous guests, 6h TTL (`create_guest_token`, `app/core/security.py`).

Two FastAPI dependencies enforce the boundary:

| Dependency | Accepts | Used by |
|---|---|---|
| `get_current_user` | **access only** (rejects guests, and rejects any `is_guest` row) | everything by default — dashboard, chat, org, **all host actions** |
| `get_current_participant` | access **or** guest | only `join`, `media-token`, `recording` (GET), `participants`, and the control WS |

Because guest tokens are rejected by `get_current_user`, a guest **cannot** call
any account-only endpoint or host action — a 401 in addition to the existing
role checks. The LiveKit grant also forces `room_admin=false`/`room_record=false`
for guests regardless of role.

---

## 3. New endpoints

### `GET /api/meetings/{code}/public` — no auth
Safe metadata for the pre-join screen. Never exposes the password hash, host id,
or participant list. Throttled per IP to blunt code enumeration.

```json
{ "code": "vaf-ptkc-qjz", "title": "Standup", "host_name": "Ashraf",
  "org_logo_url": null, "is_active": true, "password_protected": false,
  "waiting_room_enabled": true, "guests_enabled": true }
```

### `POST /api/meetings/{code}/guest-token` — no auth
Mints an ephemeral guest identity + token. Body:

```json
{ "display_name": "Ashraf", "password": "optional", "captcha_token": "optional" }
```

Server steps: rate-limit (per IP) → meeting active/`guests_enabled`/not-locked →
password check → **sanitize display name** → create guest `users` row → issue
guest JWT → audit log. Response:

```json
{ "access_token": "<jwt>", "token_type": "guest", "user_id": 9001,
  "name": "Ashraf", "is_guest": true, "waiting_room_enabled": true }
```

After this, the guest client calls the **existing** `/join` + `/media-token` and
opens the control WS with the guest token — identical to a signed-in user.

---

## 4. Display-name validation (`app/core/guest.py`)

`sanitize_display_name` is the single server-side chokepoint (the client mirrors
it in `client/src/features/meeting/guestName.js` for instant feedback, but the
server always re-validates):

- NFC normalize; strip control (`Cc`) + format (`Cf`) + zero-width/bidi/BOM chars;
- strip HTML angle brackets (`<`/`>`); collapse whitespace; trim;
- enforce **2–50 chars** → otherwise HTTP **422**.

SQL injection is already impossible (SQLAlchemy parameterizes), but stripping
markup hardens every render surface (tiles, chat, waiting room, LiveKit metadata).

---

## 5. Rate limiting / abuse (`app/core/rate_limit.py`)

`SlidingWindowLimiter` (in-memory, per-process):

- `guest_join_limiter` — **20 guest-tokens / IP / hour** → 429 + `Retry-After`.
- `invalid_room_limiter` — throttles repeated misses on `/public` (code enumeration).
- `captcha_token` is accepted on the request and validated only when a provider is
  wired (hook stub — none by default).

The global auth `RateLimitMiddleware` is untouched.

---

## 6. Cleanup (`app/core/guest_cleanup.py`)

- **Immediate** — `end_meeting` (REST) and the `end-meeting` WS action call
  `purge_meeting_guests(meeting_id, db)`; deleting a guest cascades its
  participant rows.
- **Periodic** — `guest_cleanup_loop()` (started in `main.py` lifespan beside the
  recording loop) purges guests past `guest_expires_at` — a backstop for crashed
  sessions.

---

## 7. Realtime payloads

`is_guest` is added to: control-WS `welcome.self`/`peers`, `peer-joined`, `chat`,
the waiting-room list, and the `GET /{code}/participants` roster. The LiveKit
token also carries `{"guest": true, ...}` in participant metadata. The display
name is **not** mutated server-side — the client renders the `(Guest)` badge from
the flag.

---

## 8. Client

- **Routing** (`App.jsx`): `/meet/:code` is now public; `MeetLobby` branches
  authed vs guest. Room routes use `RequireMeetingAccess` (signed-in user **or** a
  guest session for that code).
- **Auth context** (`AuthContext.jsx`): adds `guest`, `isGuest`,
  `joinAsGuest(code, …)`, `clearGuest()`. The guest token lives in `sessionStorage`
  (`api/client.js`), so a refresh reconnects; the API client sends it as a Bearer
  automatically. A signed-in account token always takes precedence.
- **Pre-join** (`MeetLobby.jsx`): reuses the entire device-preview/permission/
  audio-level UI; guests get a validated **Display Name** field + **Remember my
  name** (localStorage), password input when required, and meeting title/host/logo
  from `/public`.
- **In-room** (`GuestBadge.jsx`): a shared `Guest` pill rendered in
  `ParticipantTile`, `ParticipantsPanel`, `WaitingRoomPanel`, and `ChatPanel`.
  `MeetRoomLivekit` silently re-mints an expired guest token (using the remembered
  name) before surfacing an error, and routes guests back to the public lobby when
  the meeting ends.

---

## 9. Permission model

| Capability | Guest | Host/Co-host |
|---|---|---|
| Join, publish audio/video, chat, raise hand, view participants, receive media | ✅ | ✅ |
| Screen share | ✅ if `screenshare_enabled` | ✅ |
| Admit/deny/kick, end meeting, lock, change settings, promote, recording, analytics, org admin | ❌ (401) | ✅ |

---

## 10. Tests

`server/tests/test_guest_join.py` (run: `venv/Scripts/python.exe tests/test_guest_join.py`)
covers token issuance/claims, name validation, `guests_enabled`/locked/password
gates, waiting-room admit, direct admit, the dependency split, the roster flag,
rate limiting, reconnect, and an authenticated-flow regression check.
