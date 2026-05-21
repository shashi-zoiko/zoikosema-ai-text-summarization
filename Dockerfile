# Root Dockerfile for Cloud Run.
# Cloud Run / `gcloud run deploy --source .` expects a Dockerfile at the repo
# root. The server lives in server/, so we COPY from that subdirectory here.
# Keep in sync with server/Dockerfile (used by docker-compose for local dev).

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

# Built frontend (Vite output). Cloud Run serves the SPA from the same
# container as the API — main.py mounts /assets and an SPA catch-all when
# /app/dist is present. Run `npm --prefix client run build` before deploying.
COPY client/dist ./dist

EXPOSE 8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
