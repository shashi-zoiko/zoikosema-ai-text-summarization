"""Concurrent WebSocket load test for a single large Zoiko meeting.

Proves the claim the scalability work rests on: one Cloud Run instance
(concurrency=200, admitted sockets holding ZERO idle DB connections) survives
100 simultaneous participants without DB-pool exhaustion, 429s, or dropped
sockets. This drives the CONTROL plane (join / welcome / chat / heartbeat /
leave) — LiveKit media is a separate SFU that scales independently, so it is
deliberately out of scope here.

Uses only already-installed deps: httpx (mint guest tokens) + websockets.

USAGE
    # 1. Create a meeting whose waiting room is OFF and guests are ON, so
    #    guests are admitted straight through with no host in the loop.
    # 2. Point this at a RUNNING server (local uvicorn or the Cloud Run URL):
    python server/tests/load/websocket_load_test.py \
        --base-url http://localhost:8001 --code ABC123 --users 100

    # Watch pool/socket usage in another terminal while it runs:
    #   watch -n1 curl -s http://localhost:8001/api/health/metrics

NOTES
  * 100 guests from one IP is under the 250/IP/hr guest cap, so a single run is
    fine; back-to-back runs will eventually 429 (by design — that's the abuse
    control working). Restart the server or wait an hour to reset the window.
  * A non-zero "waiting_room" count means the target meeting has its waiting
    room ON — those users never got admitted (no host), so their result is
    inconclusive, not a failure. Turn the waiting room off and re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

import httpx
import websockets


async def _virtual_user(idx: int, args, loop_clock) -> dict:
    """One participant: mint token → open WS → welcome → heartbeat+chat for the
    hold duration → close. Returns a per-user result record."""
    r = {"idx": idx, "token_ms": None, "connect_ms": None, "welcome_ms": None,
         "msgs": 0, "admitted": False, "waiting": False, "error": None}
    base = args.base_url.rstrip("/")
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    try:
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{base}/api/meetings/{args.code}/guest-token",
                json={"display_name": f"Load{idx:03d}", "password": args.password or None},
            )
        if resp.status_code == 429:
            r["error"] = "429 rate-limited (guest cap hit — see notes)"
            return r
        if resp.status_code != 201:
            r["error"] = f"guest-token {resp.status_code}: {resp.text[:120]}"
            return r
        token = resp.json()["access_token"]
        r["token_ms"] = (time.perf_counter() - t0) * 1000

        pwd = args.password or ""
        url = f"{ws_base}/ws/meetings/{args.code}?token={token}&pwd={pwd}"
        t1 = time.perf_counter()
        async with websockets.connect(url, max_size=2**20, open_timeout=30) as ws:
            r["connect_ms"] = (time.perf_counter() - t1) * 1000
            # Read until our own welcome (or waiting-room-hold) arrives. The
            # server adds this socket to the room BEFORE sending it welcome, so
            # under a simultaneous-join burst another peer's peer-joined /
            # media-state broadcast can land ahead of our welcome — exactly what
            # the real event-driven client tolerates. Don't assume frame order.
            deadline0 = loop_clock() + 30
            while True:
                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                t = frame.get("type")
                if t == "waiting-room-hold":
                    r["waiting"] = True
                    return r  # no host to admit us; nothing more to prove here
                if t == "welcome":
                    break
                if loop_clock() > deadline0:
                    r["error"] = f"no welcome within 30s (last frame: {t})"
                    return r
                # else: a broadcast that raced ahead of welcome — keep reading.
            r["welcome_ms"] = (time.perf_counter() - t1) * 1000
            r["admitted"] = True

            # Announce media state (what a real client does on join), then
            # heartbeat + occasional chat until the hold window elapses.
            await ws.send(json.dumps({"type": "media-state", "audio": True, "video": True}))
            r["msgs"] += 1
            deadline = loop_clock() + args.duration
            beat = 0
            while loop_clock() < deadline:
                await asyncio.sleep(args.heartbeat)
                beat += 1
                # ping keeps the socket warm; every 5th beat send a chat so the
                # broadcast fan-out (O(participants) per message) is exercised.
                if beat % 5 == 0:
                    await ws.send(json.dumps({"type": "chat", "body": f"zk1:load-{idx}-{beat}"}))
                else:
                    await ws.send(json.dumps({"type": "ping"}))
                r["msgs"] += 1
                # Drain anything the server pushed (others' chats/joins) so the
                # receive buffer never backs up and stalls the connection.
                try:
                    while True:
                        await asyncio.wait_for(ws.recv(), timeout=0.001)
                except (asyncio.TimeoutError, Exception):
                    pass
            # Leaving = just close the socket; the server's finally handles it.
    except Exception as e:  # noqa: BLE001 — any failure is a failed VU
        r["error"] = f"{type(e).__name__}: {str(e)[:120]}"
    return r


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = min(len(values) - 1, int(round((p / 100) * (len(values) - 1))))
    return values[k]


async def main() -> None:
    ap = argparse.ArgumentParser(description="Concurrent WS load test for one meeting")
    ap.add_argument("--base-url", required=True, help="e.g. http://localhost:8001")
    ap.add_argument("--code", required=True, help="meeting code (waiting room OFF)")
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--duration", type=float, default=30.0, help="seconds each VU stays")
    ap.add_argument("--heartbeat", type=float, default=2.0, help="seconds between frames")
    ap.add_argument("--ramp", type=float, default=0.0,
                    help="spread joins over N seconds (0 = all at once, the worst case)")
    ap.add_argument("--password", default="", help="meeting password if set")
    args = ap.parse_args()

    clock = asyncio.get_event_loop().time
    print(f"Launching {args.users} users -> {args.base_url} meeting {args.code} "
          f"(hold {args.duration}s, ramp {args.ramp}s)")

    async def staggered(i):
        if args.ramp:
            await asyncio.sleep((i / args.users) * args.ramp)
        return await _virtual_user(i, args, clock)

    t0 = time.perf_counter()
    results = await asyncio.gather(*(staggered(i) for i in range(args.users)))
    wall = time.perf_counter() - t0

    admitted = [r for r in results if r["admitted"]]
    waiting = [r for r in results if r["waiting"]]
    errored = [r for r in results if r["error"]]
    connect_ms = [r["connect_ms"] for r in results if r["connect_ms"] is not None]
    welcome_ms = [r["welcome_ms"] for r in admitted if r["welcome_ms"] is not None]

    print("\n" + "=" * 56)
    print(f"  users .............. {args.users}")
    print(f"  admitted (ok) ...... {len(admitted)}  ({100*len(admitted)/args.users:.0f}%)")
    print(f"  waiting room ....... {len(waiting)}  (waiting room ON — see notes)" if waiting else "  waiting room ....... 0")
    print(f"  errored ............ {len(errored)}")
    print(f"  total msgs sent .... {sum(r['msgs'] for r in results)}")
    if connect_ms:
        print(f"  WS connect  p50/p95  {_pct(connect_ms,50):.0f} / {_pct(connect_ms,95):.0f} ms")
    if welcome_ms:
        print(f"  welcome     p50/p95  {_pct(welcome_ms,50):.0f} / {_pct(welcome_ms,95):.0f} ms  "
              f"(max {max(welcome_ms):.0f})")
    print(f"  wall clock ......... {wall:.1f}s")
    print("=" * 56)
    if errored:
        # Group errors so 100 identical failures print once, not 100 times.
        from collections import Counter
        for msg, n in Counter(r["error"] for r in errored).most_common():
            print(f"  [{n:>3}x] {msg}")

    ok = len(errored) == 0 and len(admitted) == args.users
    print("\nRESULT:", "PASS" if ok else "FAIL (see above)")


if __name__ == "__main__":
    asyncio.run(main())
