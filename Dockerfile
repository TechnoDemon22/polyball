# ---------------------------------------------------------------------------
# Polyball Multi-Stage Production Dockerfile
# Unified container serving static frontend + WebSocket server on one port.
# ---------------------------------------------------------------------------

# Stage 1: Build application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root & workspace package files
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY client/package.json client/tsconfig.json client/tsconfig.node.json client/vite.config.ts ./client/
COPY server/package.json server/tsconfig.json ./server/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source trees
COPY shared/ ./shared/
COPY client/ ./client/
COPY server/ ./server/

# Build all packages (shared -> server bundle -> client static dist)
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV SERVE_STATIC=true
ENV CLIENT_DIR=/app/client/dist

# Install dumb-init for proper signal handling and PID 1 reaping
RUN apk add --no-cache dumb-init curl

# Create app structure and copy production artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/client/dist /app/client/dist
COPY --from=builder /app/node_modules ./node_modules

# Run as non-root user for security
USER node

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/dist/server.js"]
