# syntax=docker/dockerfile:1
# =============================================================================
# SmartBeak Multi-Stage Dockerfile
#
# Targets:
#   web    - Next.js frontend (port 3000)
#   api    - Fastify control-plane API (port 3001)
#   worker - BullMQ background job worker
#
# Usage:
#   docker build --target web -t smartbeak-web .
#   docker build --target api -t smartbeak-api .
#   docker build --target worker -t smartbeak-worker .
# =============================================================================

# ---------------------------------------------------------------------------
# Stage: base
# ---------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat wget
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: deps — install all dependencies (including devDependencies for build)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN mkdir -p apps/api apps/web \
    packages/adapters packages/analytics packages/cache packages/config \
    packages/database packages/errors packages/kernel packages/middleware \
    packages/ml packages/monitoring packages/security packages/shutdown \
    packages/types packages/utils
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/cache/package.json ./packages/cache/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/errors/package.json ./packages/errors/
COPY packages/kernel/package.json ./packages/kernel/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/ml/package.json ./packages/ml/
COPY packages/monitoring/package.json ./packages/monitoring/
COPY packages/security/package.json ./packages/security/
COPY packages/shutdown/package.json ./packages/shutdown/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
RUN npm ci

# ---------------------------------------------------------------------------
# Stage: builder — compile TypeScript and build Next.js
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY . .
RUN npm run build
RUN npm run build:web

# ---------------------------------------------------------------------------
# Stage: prod-deps — production-only node_modules
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN mkdir -p apps/api apps/web \
    packages/adapters packages/analytics packages/cache packages/config \
    packages/database packages/errors packages/kernel packages/middleware \
    packages/ml packages/monitoring packages/security packages/shutdown \
    packages/types packages/utils
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/cache/package.json ./packages/cache/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/errors/package.json ./packages/errors/
COPY packages/kernel/package.json ./packages/kernel/
COPY packages/middleware/package.json ./packages/middleware/
COPY packages/ml/package.json ./packages/ml/
COPY packages/monitoring/package.json ./packages/monitoring/
COPY packages/security/package.json ./packages/security/
COPY packages/shutdown/package.json ./packages/shutdown/
COPY packages/types/package.json ./packages/types/
COPY packages/utils/package.json ./packages/utils/
RUN npm ci --omit=dev

# =============================================================================
# Target: web — Next.js standalone server
# =============================================================================
FROM base AS web

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]

# =============================================================================
# Target: api — Fastify control-plane API
# =============================================================================
FROM base AS api

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 smartbeak

# Production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# Source files needed by tsx at runtime (path alias resolution)
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY control-plane/ ./control-plane/
COPY domains/ ./domains/
COPY plugins/ ./plugins/
COPY themes/ ./themes/
COPY apps/api/ ./apps/api/

# Install tsx for TypeScript execution with path alias support
RUN npm install -g tsx

USER smartbeak

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --spider http://localhost:3001/health || exit 1

CMD ["node", "--import", "tsx/esm", "control-plane/api/http.ts"]

# =============================================================================
# Target: worker — BullMQ background job processor
# =============================================================================
FROM base AS worker

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 smartbeak

# Production node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# Source files needed by tsx at runtime (path alias resolution)
COPY tsconfig.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY control-plane/ ./control-plane/
COPY domains/ ./domains/
COPY plugins/ ./plugins/
COPY themes/ ./themes/
COPY apps/api/ ./apps/api/

# Install tsx for TypeScript execution with path alias support
RUN npm install -g tsx

USER smartbeak

ENV NODE_ENV=production

CMD ["node", "--import", "tsx/esm", "apps/api/src/jobs/worker.ts"]
