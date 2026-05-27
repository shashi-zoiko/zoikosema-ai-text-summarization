# LiveKit in production (Cloud Run + Cloud Run-friendly SFU)

> **TL;DR:** the current Cloud Run deployment runs **mesh only** — `MEDIA_PROVIDER`
> isn't set, so the server falls back to `null` and every new meeting is
> stamped `media_provider='mesh'`. To enable the SFU room (`/room-lk`) in
> production you need (a) a LiveKit SFU reachable over WSS from the public
> internet, and (b) five env vars on the Cloud Run service.
>
> Cloud Run itself **cannot host the SFU** — it doesn't expose UDP, scales
> to zero, and rotates container IPs. Use LiveKit Cloud (easiest) or run
> LiveKit on a GCE VM with a static external IP.

## Step 1 — Stand up a LiveKit server

### Option A — LiveKit Cloud (recommended)

1. Sign up at https://cloud.livekit.io and create a project.
2. Copy the API key, secret, and `wss://` URL from the project dashboard.
3. Done — there's no infra to maintain.

### Option B — Self-host on a GCE VM

1. Create a small e2-standard-2 VM in the same region as Cloud Run
   (lower RTT to the FastAPI server).
2. Reserve a static external IP and open firewall rules:
   - TCP 443 (signaling, TURN over TLS)
   - TCP 7881 (TURN/TCP fallback)
   - UDP 50000-60000 (RTP)
3. Point a DNS A record at the VM:
   `media.zoiko-meet.example.com` → `<static IP>`.
4. Issue a TLS cert with Let's Encrypt (e.g. caddy or certbot).
5. Run the LiveKit container:
   ```bash
   docker run -d --restart unless-stopped \
     --network host \
     -v /etc/livekit/livekit.yaml:/etc/livekit.yaml:ro \
     -v /etc/livekit/tls:/etc/livekit/tls:ro \
     livekit/livekit-server:v1.12.0 --config /etc/livekit.yaml
   ```
   Template `infra/livekit/livekit.prod.yaml` for the config — fill in
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, Redis creds, and
   `PUBLIC_DOMAIN`.

## Step 2 — Configure the Cloud Run service

Add these env vars to the FastAPI Cloud Run service (Console → Edit & deploy
new revision → Variables):

| Variable | Example | Notes |
|---|---|---|
| `MEDIA_PROVIDER` | `livekit` | Switches the default for **new** meetings. |
| `LIVEKIT_API_KEY` | `APIxxxx` | Same value as the SFU's `keys:` config. |
| `LIVEKIT_API_SECRET` | `<32 char>` | Same as above. |
| `LIVEKIT_WS_URL` | `wss://media.example.com` | Server-side reach. |
| `LIVEKIT_PUBLIC_WS_URL` | `wss://media.example.com` | Browser-visible — typically the same as `LIVEKIT_WS_URL` when there's no internal hostname. |

Optional but recommended:

| Variable | Notes |
|---|---|
| `REDIS_URL` | `redis://...` — only needed for multi-node LiveKit; single-node is fine without it. |

## Step 3 — Verify

1. Hit `GET /api/health/ready` — the response should still be `{"status":"ok"}`.
2. Create a new meeting. The lobby's request to `GET /api/meetings/{code}`
   should return `"media_provider": "livekit"` in the JSON.
3. Click *Join now*. The browser should navigate to `/meet/{code}/room-lk`
   (the lobby uses `pickRoomPath` to decide based on `media_provider`).
4. Watch for the `Reconnecting…` pill in the top-left — if it sticks, check:
   - `wss://` URL is reachable from the browser (Cloud Run's HTTPS cert covers `*.run.app`; the SFU needs its own cert).
   - UDP 50000-60000 is open at the SFU edge.
   - LiveKit API key/secret match on both ends.

## Existing-meeting behaviour

Meetings created **before** LiveKit was enabled keep their stored
`media_provider='mesh'` and continue to use the mesh path. To migrate, end
those meetings and create new ones, or `UPDATE meetings SET
media_provider='livekit' WHERE …` directly if you want to convert in place.

## Per-meeting override

The frontend honours `?lk=1` on the lobby URL to force the LiveKit room for
debugging an old meeting (`pickRoomPath` in `MeetLobby.jsx`). This is a
client-only switch and assumes the SFU is configured — it will 503 on
`/media-token` otherwise.

## When `/api/meetings/{code}/media-token` returns 503

The 503 detail now reads:

> LiveKit is not enabled in this environment. Set `MEDIA_PROVIDER=livekit` +
> `LIVEKIT_*` credentials on the server (see `infra/livekit/README.md`) to
> enable the SFU room.

If you see this in `/room-lk`, the user deep-linked the LK room on a
deployment where LiveKit isn't configured. Either configure it (above), or
remove `?lk=1` / set `meeting.media_provider='mesh'` for that meeting.
