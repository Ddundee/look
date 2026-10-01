# Multi-stage build producing a minimal Next.js "standalone" server.
# node:20-slim publishes multi-arch manifests, so this builds natively on
# both amd64 dev machines and arm64 (Raspberry Pi).

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts's rewrites() destination is resolved once, at build time,
# into the compiled routes manifest — the standalone server does NOT
# re-read this env var at container start. It must match the backend
# service's name in docker-compose.yml (overridable via --build-arg if you
# rename that service).
ARG INTERNAL_API_BASE_URL=http://backend:8000
ENV INTERNAL_API_BASE_URL=$INTERNAL_API_BASE_URL
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Git commit this image was built from (CI passes --build-arg).
ARG APP_REVISION=
ENV APP_REVISION=$APP_REVISION

# node:20-slim already ships a non-root "node" user (uid/gid 1000) —
# reuse it instead of creating a second uid 1000 user, which errors.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
