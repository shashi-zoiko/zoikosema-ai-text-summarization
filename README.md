# ZoikoSema

A Google Meet–style video meeting app with Microsoft Teams–style chat, built on a
FastAPI + React stack.

## Features

**Meetings (Google Meet–style)**
- Instant meetings with shareable link/code (`abc-defg-hij`)
- Pre-join lobby with camera/mic preview
- WebRTC **mesh** video + audio (good for ~6 participants)
- Screen sharing (via `getDisplayMedia`)
- In-meeting chat, participant list, raise hand, floating emoji reactions
- Mute / camera toggle, leave call

**Chat (Teams-style)**
- Channels and direct messages
- Realtime messaging over WebSocket
- Typing indicators and last-message previews
- Group channels with custom names

**Auth**
- Email/password register + login
- JWT sessions

## Tech stack

- **Backend:** FastAPI · SQLAlchemy 2 · Postgres (Supabase / local) or SQLite (dev) · python-jose · passlib · bcrypt
- **Frontend:** React 19 · Vite · React Router v6 · plain CSS (dark theme)
- **Realtime:** FastAPI WebSocket (chat + WebRTC signaling)
- **Media:** Browser WebRTC (mesh topology), Google STUN
- **Deploy:** Docker + docker-compose (Postgres + FastAPI + nginx-served React build)
- **Desktop:** Electron 33 + electron-builder + electron-updater (Windows / macOS / Linux, auto-updates via GitHub Releases)

## Project layout

```
server/
  app/
    core/         config, db, security, auth deps
    models/       SQLAlchemy models (user, chat, meeting)
    schemas/      Pydantic request/response schemas
    api/          REST routers (auth, users, chat, meetings)
    websocket/    chat WS + WebRTC signaling WS
    main.py       FastAPI app factory
  requirements.txt
  .env.example

client/
  src/
    api/          fetch wrapper + WS helper
    context/      AuthContext
    components/   Layout (Teams-style sidebar), Avatar
    pages/        Login, Register, Home, Chat, Meet, MeetLobby, MeetRoom
    App.jsx       router
  package.json
  .env.example
```

## Quick start — Docker (recommended)

This spins up **Postgres + FastAPI + nginx-served React** with one command.

```bash
cp .env.example .env          # edit JWT_SECRET; defaults work for local dev
docker compose up --build
```

Then open:
- App: http://localhost:8080
- API docs: http://localhost:8001/docs

Shut down: `docker compose down`  ·  Wipe DB volume: `docker compose down -v`

### Using Supabase as the database

Supabase is just managed Postgres — so you only need to change **one env var**.

1. In Supabase dashboard → **Project Settings → Database → Connection string → URI** and copy it.
2. In your root `.env`, uncomment and set:
   ```
   DATABASE_URL=postgresql+psycopg2://postgres.xxxxxxxxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
   (Make sure the scheme is `postgresql+psycopg2://`, not plain `postgresql://` — SQLAlchemy needs the driver prefix.)
3. Run `docker compose up --build server client` — the local `db` service is ignored and the backend talks directly to Supabase.

On first boot the backend auto-creates all tables via `init_db()`.

### Using MongoDB

MongoDB is a deeper swap than Supabase because the backend currently uses **SQLAlchemy ORM models** with relational joins. Switching would require rewriting `server/app/models/` with Motor/Beanie and re-doing the queries in `server/app/api/chat.py`. If you want that, let me know and I'll do it as a separate pass.

## Manual setup (without Docker)

### 1. Backend

```bash
cd server
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
cp .env.example .env           # edit JWT_SECRET
uvicorn app.main:app --reload --port 8001   # or: python -m app.main
```

> The local API **must** run on port **8001** — the client (`client/.env.local`
> + the Vite proxy) and docker-compose's `8001:8080` mapping all expect it there.
> Any other port makes the browser fail with "Failed to fetch". `python -m app.main`
> defaults to 8001 automatically.

API docs: http://localhost:8001/docs

### 2. Frontend

```bash
cd client
npm install
cp .env.example .env           # adjust VITE_API_BASE if needed
npm run dev
```

App: http://localhost:5173

## Desktop app (Electron)

ZoikoSema also ships as a cross-platform desktop app with **auto-updates** via GitHub Releases.

### Run in dev

```bash
cd client
npm install
npm run electron:dev
```

This starts Vite at `http://localhost:5173` and launches Electron against it with hot reload.

### Build an installer locally

```bash
cd client
npm run electron:dist     # builds + publishes
npm run electron:pack     # builds an unpacked app without publishing
```

Artifacts land in `client/release/` — `.exe` (NSIS) on Windows, `.dmg` on macOS, `.AppImage` on Linux.

### Release flow (auto-update)

1. Bump `client/package.json` `version`.
2. Commit and tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. GitHub Actions (`.github/workflows/release.yml`) builds on Windows + macOS + Linux and publishes installers **and** the `latest*.yml` update feed to a new GitHub Release.
4. Running desktop clients check the feed every 4 hours, download the new version in the background, and show an in-app toast with a **Restart** button (see `client/src/components/UpdateToast.jsx`).

### Branded icons

Drop `icon.ico`, `icon.icns`, and `icon.png` into `client/build/` before cutting a release. Without them, electron-builder falls back to the default Electron icon.

### Pointing the desktop app at prod

Set the `VITE_API_BASE` GitHub Actions variable (Repo → Settings → Variables) to your production API URL before tagging a release. The workflow bakes it into the built bundle.

## How to use

1. **Register** two accounts (in two browsers or one browser + incognito).
2. Sign in with each.
3. **Chat:** go to *Chat* → *+ New*, pick the other user to start a DM. Type — messages stream in realtime.
4. **Meet:** go to *Home* → *Start instant meeting*. Copy the invite link and open it in the second browser (signed into the other account). Allow camera/mic, click *Join now*. You should see each other's video.
5. In the meeting, try: mute/unmute, camera off/on, screen share, raise hand, reactions, and the side chat panel.

## Notes & limits

- **Mesh topology** works well up to ~6 participants. For larger rooms, swap in an SFU (LiveKit, mediasoup).
- **STUN only** — peers on symmetric NATs may fail to connect. Add a TURN server (`coturn`, Twilio, etc.) to the `ICE_SERVERS` list in `client/src/pages/MeetRoom.jsx`.
- **Database**: defaults to SQLite in local dev (no `DATABASE_URL`), Dockerized Postgres via `docker compose up`, or Supabase by setting `DATABASE_URL` in `.env`.
- For HTTPS (required for camera/mic on non-localhost), deploy behind a TLS terminator (Caddy/Nginx) or run Vite with `--https`.

## Docker services

| Service  | Port | Purpose                                    |
|----------|------|--------------------------------------------|
| `db`     | 5432 | Postgres 16 (skipped if `DATABASE_URL` points elsewhere) |
| `server` | 8080 | FastAPI app                                |
| `client` | 8080 | Production React build served by nginx     |

Rebuild one service after code changes: `docker compose up --build server`
