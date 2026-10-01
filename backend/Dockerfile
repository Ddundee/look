# Shared image for both the REST API (backend service) and the MCP server
# (mcp service) — they're the same codebase, just started with a different
# command in docker-compose.yml. Builds natively on both amd64 and arm64
# (Raspberry Pi) since python:3.12-slim publishes multi-arch manifests.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# libpq is needed at runtime by psycopg (even the "binary" wheel dynamically
# links it on some platforms); curl is used by the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# Git commit this image was built from (CI passes --build-arg); reported
# at /api/system/version so the web app can tell when it's been updated.
ARG APP_REVISION=
ENV APP_REVISION=$APP_REVISION

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
