# Root Dockerfile for Cloud Run.
FROM node:20-slim AS frontend-build
WORKDIR /client
COPY client/package*.json ./
RUN npm install
COPY client/ .
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE
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
# Copy built frontend from previous stage
COPY --from=frontend-build /client/dist ./dist
EXPOSE 8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
