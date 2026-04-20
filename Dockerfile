# syntax=docker/dockerfile:1.6
# ============================================================
# ERP LINE Bot — Multi-stage Docker image for Fly.io / any OCI host
# ============================================================

# ---------- builder ----------
FROM node:20-slim AS builder
WORKDIR /app

# ca-certificates + curl for the CJK font download step.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including dev deps) for build.
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build artifacts.
COPY . .

# Generate Prisma client, download NotoSansTC, compile TS → dist/.
RUN npx prisma generate \
    && npm run fonts:download \
    && npm run build

# Prune dev deps so /app/node_modules becomes production-only.
RUN npm prune --omit=dev


# ---------- runner ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Commit SHA for /api/version. The control plane uses this to detect outdated
# instances. Pass via: fly deploy --build-arg GIT_COMMIT=$(git rev-parse HEAD)
# Defaults to "dev" for local builds that forget it — control plane then
# renders the customer as "未知" (unknown) instead of comparing.
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=${GIT_COMMIT}

# postgresql-client for pg_dump backups (src/jobs/daily-backup.ts).
# If the binary is missing the backup job falls back to a JSON export,
# so installing it is an improvement but not a hard requirement.
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy pruned production deps + build output + static assets.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Ref: src/index.ts binds 0.0.0.0:$PORT (default 3000). Fly.io maps
# internal_port 3000 → external 443 via [http_service].
CMD ["node", "dist/index.js"]
