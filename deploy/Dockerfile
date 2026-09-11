# syntax=docker/dockerfile:1

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles from source when no prebuild matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build --workspace @homestead/server \
 && npm run build --workspace @homestead/web \
 && npm prune --omit=dev

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOMESTEAD_DATA_DIR=/data \
    HOMESTEAD_FILES_DIR=/data/files \
    HOMESTEAD_WEB_DIR=/app/apps/web/dist \
    PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data homestead \
 && mkdir -p /data && chown homestead:homestead /data

# The workspace layout is preserved so Node resolves the native modules the
# bundle leaves external (better-sqlite3, argon2).
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=root:root /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=root:root /app/apps/web/dist ./apps/web/dist

VOLUME ["/data"]
EXPOSE 8080
USER homestead

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/main.js"]
