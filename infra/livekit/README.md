# LiveKit deployment notes

## Files

- `livekit.yaml` — local dev SFU config (auto_create=false, no TURN, hardcoded
  devkey/secret).
- `egress.yaml` — local dev egress config (RoomComposite → /out).
- `livekit.prod.yaml` — production SFU template (templated env vars; do not
  commit real keys).

## Local dev

```sh
docker compose up -d db redis livekit livekit-egress server
```

Recording is written to the `zoiko_recordings` volume which both
`livekit-egress` (writes to `/out`) and `server` (serves from
`/app/recordings`) mount. The FastAPI app exposes them at
`/api/recordings/files/{filename}`.

## Production checklist

1. **Secrets.** `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` must be unique per env
   and stored in your secrets manager (AWS SM, GCP Secret Manager, Vault).
   Same secret is used by:
   - the SFU's `keys:` config
   - egress's `api_key/api_secret`
   - FastAPI's `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
   - webhook signature verification

2. **DNS + LB topology.**
   - `api.example.com` → FastAPI (ALB, TLS terminated at LB)
   - `media.example.com:443/tcp` → LiveKit signaling (NLB or ALB,
     WSS terminated at LB)
   - UDP `50000-60000/udp` → LiveKit nodes **direct**, not through ALB. Use
     EIP per node or an NLB target group with UDP listeners.
   - `turn.example.com:443/tcp` → LiveKit TURN (TLS, distinct cert)

3. **Set `VITE_LIVEKIT_WS_URL=wss://media.example.com`** at frontend build
   time. `LIVEKIT_PUBLIC_WS_URL` is the same value (server returns it to the
   client in `/media-token`).

4. **`use_external_ip: true`** lets LiveKit auto-detect the public IP. Verify
   it picks the right one if you have multiple ENIs — set the IP explicitly
   via `node_ip: x.x.x.x` if not.

5. **Redis** must be reachable from livekit-server, livekit-egress, AND
   FastAPI. AWS ElastiCache + cluster mode disabled is the simplest.

6. **Egress sizing.** Each composite egress launches a headless Chromium ≈
   ~500 MB RAM + 1 vCPU under load. Scale egress workers independently of
   the SFU; rule of thumb is one egress worker per ~5 concurrent recordings.

7. **Object storage.** `egress.yaml` should write to S3/GCS in prod, not a
   local volume. Update the API call in
   `server/app/connect/media_service/livekit_provider.py` to use
   `S3Upload`/`GCPUpload` outputs and drop the local mount.

8. **Webhook URL** must be HTTPS in prod. LiveKit signs each request with
   a JWT in `Authorization`; our handler in `server/app/api/webhooks.py`
   verifies it via `livekit.api.WebhookReceiver`.

9. **k8s.** LiveKit ships a Helm chart at
   https://github.com/livekit/livekit-helm. Key gotchas:
   - SFU pods need `hostNetwork: true` or a UDP-aware NLB.
   - Egress pods need `securityContext.capabilities: [SYS_ADMIN]` for
     Chromium sandboxing (matches the docker-compose `cap_add`).
   - Both need the LIVEKIT secret as a Kubernetes Secret + envFrom.

10. **Recording retention.** The cleanup loop in
    `server/app/core/recording_cleanup.py` purges old files by
    `recording_retention_days` (config). In prod, set this to whatever your
    legal/compliance policy requires (default 30d).
