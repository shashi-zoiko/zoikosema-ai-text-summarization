"""Production deployment preflight gate for Zoiko Sema.

Run BEFORE (or at the start of) a production deploy:

    python preflight.py            # exits non-zero on any hard failure

It validates only environment configuration - it does NOT touch the app, the DB,
or meeting logic. Hard failures (exit 1) are the misconfigs that have actually
caused outages in this project; warnings are advisory.

Hard failures:
  * DATABASE_URL missing.
  * DATABASE_URL points at the Supabase SESSION pooler / direct connection
    (:5432, 15-client cap) - the classic "meetings die at ~15 users" trigger.
    Production must use the TRANSACTION pooler (:6543).
  * MEDIA_PROVIDER=livekit but LIVEKIT credentials are incomplete → /media-token
    503s and video is dead.
  * Multi-worker requested (WEB_CONCURRENCY>1) without REDIS_URL - separate
    workers keep meeting state in-process with no fanout, so a meeting split
    across workers breaks. Redis is mandatory the moment you run >1 worker.

Warnings (deploy continues):
  * REDIS_URL unset with a single worker - fine for one instance, but you cannot
    run more than one instance/worker until Redis is provisioned.
"""
from __future__ import annotations

import os
import sys


def _get(name: str) -> str:
    return (os.getenv(name) or "").strip()


def main() -> int:
    failures: list[str] = []
    warnings: list[str] = []
    ok: list[str] = []

    # ── DATABASE_URL ────────────────────────────────────────────────────────
    db = _get("DATABASE_URL")
    if not db:
        failures.append("DATABASE_URL is not set.")
    elif "supabase" in db and ":5432" in db:
        failures.append(
            "DATABASE_URL uses the Supabase session pooler / direct connection "
            "(:5432, 15-client cap). Use the TRANSACTION pooler (:6543)."
        )
    elif "supabase" in db and ":6543" in db:
        ok.append("DATABASE_URL -> Supabase transaction pooler (:6543).")
    else:
        # Non-Supabase (self-host Postgres, local) - allowed, just note it.
        ok.append("DATABASE_URL is set (non-Supabase host).")

    # ── LiveKit (only required when the SFU is the media provider) ───────────
    provider = _get("MEDIA_PROVIDER") or "null"
    if provider == "livekit":
        key = _get("LIVEKIT_API_KEY")
        secret = _get("LIVEKIT_API_SECRET")
        ws = _get("LIVEKIT_WS_URL") or _get("LIVEKIT_URL")
        missing = [
            n for n, v in (
                ("LIVEKIT_API_KEY", key),
                ("LIVEKIT_API_SECRET", secret),
                ("LIVEKIT_WS_URL/LIVEKIT_URL", ws),
            ) if not v
        ]
        if missing:
            failures.append(
                "MEDIA_PROVIDER=livekit but missing: " + ", ".join(missing)
            )
        else:
            ok.append("LiveKit credentials present (MEDIA_PROVIDER=livekit).")
    else:
        warnings.append(f"MEDIA_PROVIDER={provider!r} - SFU video is OFF.")

    # ── Redis vs worker/instance count ───────────────────────────────────────
    redis_url = _get("REDIS_URL")
    try:
        workers = int(_get("WEB_CONCURRENCY") or "1")
    except ValueError:
        workers = 1
        warnings.append("WEB_CONCURRENCY is not an integer; treating as 1.")

    if redis_url:
        ok.append(f"REDIS_URL is set (fanout available; WEB_CONCURRENCY={workers}).")
    elif workers > 1:
        failures.append(
            f"WEB_CONCURRENCY={workers} (multi-worker) but REDIS_URL is unset. "
            "Cross-worker meeting fanout requires Redis - a meeting would split "
            "across workers and break. Set REDIS_URL or run a single worker."
        )
    else:
        warnings.append(
            "REDIS_URL unset (single worker OK). You cannot scale beyond one "
            "worker/instance until Redis is provisioned."
        )

    # ── Report ────────────────────────────────────────────────────────────────
    print("== Zoiko Sema deploy preflight ==")
    for line in ok:
        print(f"  [ OK ]   {line}")
    for line in warnings:
        print(f"  [WARN]   {line}")
    for line in failures:
        print(f"  [FAIL]   {line}")

    if failures:
        print(f"\nPREFLIGHT: FAIL ({len(failures)} blocking issue(s)). Do not deploy.")
        return 1
    print(f"\nPREFLIGHT: PASS ({len(warnings)} warning(s)).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
