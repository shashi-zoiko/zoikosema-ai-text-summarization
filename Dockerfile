# Root Dockerfile for Cloud Run.
FROM node:20-slim AS frontend-build
WORKDIR /client
COPY client/package*.json ./
RUN npm install
COPY client/ .
ARG VITE_API_BASE
ARG VITE_USE_LIVEKIT
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_USE_LIVEKIT=$VITE_USE_LIVEKIT
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libpq-dev \
 && rm -rf /var/lib/apt/lists/*
COPY server/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY server/app ./app
COPY server/preflight.py ./preflight.py
# Copy built frontend from previous stage
COPY --from=frontend-build /client/dist ./dist
EXPOSE 8080
# Production: gunicorn supervising uvicorn async workers (auto-restarts a crashed
# worker). WORKERS DEFAULT TO 1 — identical to the previous single-uvicorn
# behaviour, so this does NOT regress the current single-instance deploy. Scale
# with WEB_CONCURRENCY, but raise it above 1 ONLY once REDIS_URL is set: without
# Redis, separate workers hold separate in-process meeting state with no fanout
# and a meeting would split across workers. `python preflight.py` hard-fails that
# combination. Dev is unaffected — `python -m app.main` still runs uvicorn with
# --reload. (gunicorn is Linux-only, which is fine: Cloud Run runs Linux.)
CMD exec gunicorn app.main:app \
    -k uvicorn.workers.UvicornWorker \
    --workers ${WEB_CONCURRENCY:-1} \
    --timeout 3600 \
    --graceful-timeout 30 \
    --bind 0.0.0.0:${PORT} \
    --access-logfile - --error-logfile -
