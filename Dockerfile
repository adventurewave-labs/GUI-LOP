# syntax=docker/dockerfile:1.7
# ==========================================================================
# GUI-LOP production image (DDD bootstrap entry point)
# Per ADR 0020: multi-stage, node:18-alpine, non-root, /health HEALTHCHECK.
# Entry point: src/backend/bootstrap/index.js
# ==========================================================================

# --- Stage 1: builder ----------------------------------------------------
# Installs the production node_modules tree and copies the source.
# We deliberately do NOT run a TypeScript build: the runtime is plain
# ESM JavaScript under src/backend/, and tsconfig is for type-checking only.
FROM node:18-alpine AS builder

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_PROGRESS=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Build toolchain for any native modules (bcrypt). Removed in the runtime stage.
RUN apk add --no-cache python3 make g++ \
 && rm -rf /var/cache/apk/*

WORKDIR /app

# Layer 1: dependency manifests only — maximises Docker cache hits.
COPY package.json package-lock.json ./

# Production-only install. --omit=dev skips devDependencies.
RUN npm ci --omit=dev \
 && npm cache clean --force

# Layer 2: source. Only the directories the runtime actually needs.
COPY src ./src
COPY database ./database
COPY scripts ./scripts

# --- Stage 2: runtime ----------------------------------------------------
# Minimal runtime image. dumb-init reaps zombies and forwards signals so the
# graceful shutdown handler in bootstrap/index.js receives SIGTERM cleanly.
FROM node:18-alpine AS runtime

# OCI labels — populated for traceability and registry policies (ADR 0020).
LABEL org.opencontainers.image.title="gui-lop" \
      org.opencontainers.image.description="Generative UI & Human-in-the-Loop Orchestration Platform (DDD bootstrap)" \
      org.opencontainers.image.source="https://github.com/your-org/GUI-LOP" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="GUI-LOP Platform Team"

ENV NODE_ENV=production \
    PORT=3001 \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# curl is required by the HEALTHCHECK; dumb-init handles PID-1 signal forwarding.
RUN apk add --no-cache dumb-init curl \
 && rm -rf /var/cache/apk/*

WORKDIR /app

# Bring across the prebuilt production tree from the builder stage.
# `node` is the built-in non-root user shipped in node:*-alpine (uid/gid 1000).
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/database ./database
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --chown=node:node package.json ./
COPY --chown=node:node infrastructure/scripts/start-with-migrations.sh /usr/local/bin/start-with-migrations.sh
RUN chmod +x /usr/local/bin/start-with-migrations.sh

# Drop privileges. Read-only root filesystem is enforced at the orchestrator
# level (Helm sets readOnlyRootFilesystem: true on the container's
# securityContext) — see ADR 0020.
USER node

EXPOSE 3001

# Liveness check used by docker-compose and any local `docker run`. Kubernetes
# does its own probe via the Helm chart and ignores this directive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-3001}/health" >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/backend/bootstrap/index.js"]
