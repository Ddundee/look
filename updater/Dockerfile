# Self-update helper: Python (stdlib only) plus the Docker CLI and Compose
# plugin, so it can `docker compose pull/up` the app services through the
# mounted Docker socket. Multi-arch via python:3.12-alpine.
FROM python:3.12-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /srv
COPY updater.py .

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "/srv/updater.py"]
