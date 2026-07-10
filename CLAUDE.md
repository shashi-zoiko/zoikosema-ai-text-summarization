# Zoiko Meet (ZoikoSema)

Video meetings + team chat product. Web app (React) and desktop app (Electron) share one client; a FastAPI backend serves both.

## Stack

- **Client** (`client/`): React 19 + Vite, Tailwind CSS 4, Zustand for state, React Router, Electron for desktop packaging, LiveKit (`livekit-client`, `@livekit/components-react`) for video/audio, Tiptap for rich text (chat).
- **Server** (`server/`): FastAPI + SQLAlchemy 2.0 + Pydantic v2, Postgres (`psycopg2`), Redis (pub/sub, presence, idempotency cache), JWT auth (`python-jose` + `passlib`/`bcrypt`), LiveKit server SDK (`livekit-api`) for room/token admin.
- Infra: Docker/Docker Compose, GCP deployment (see `docs/GCP_DEPLOYMENT.md`), `infra/`.

## Commands

Client (run from `client/`):
```
npm run dev              # Vite dev server (localhost:5173)
npm run build             # production build
npm run lint               # ESLint
npm run electron:dev      # Vite + Electron together (desktop dev)
```

Server (run from `server/`, inside the venv):
```
uvicorn app.main:app --reload --port 8001
pytest                     # run tests (server/tests/)
```

Root: `dev.ps1` boots both client and server for local dev on Windows/PowerShell.

## Conventions

- No comments explaining *what* code does — only non-obvious *why* (see existing `no-empty` catch blocks in `client/eslint.config.js` for the established exception: silent-fail catches for best-effort calls are intentional).
- Context files intentionally co-export a hook alongside their Provider — don't "fix" this into separate files.
- Keep client/server changes scoped to their own directory unless the task is explicitly cross-cutting (e.g. an API contract change).
- Follow existing patterns in `architecture/SPEC.md` and `architecture/SPEC-AI.md` before introducing new architectural concepts.

## Working here

- This is a Windows dev machine; use PowerShell syntax when running shell commands directly (not WSL/bash-isms), though the Bash tool (Git Bash) is also available.
- Auth/session and video-room code (LiveKit tokens, admission/waiting-room logic) is sensitive — read `docs/guest-join.md` and `docs/livekit-production.md` before changing it.
- Check `PRODUCTION_READINESS_AUDIT.md` before assuming a subsystem is production-hardened.
