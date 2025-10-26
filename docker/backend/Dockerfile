# ==========================================
# GUI-LOP Backend Multi-Stage Dockerfile
# Production-optimized Node.js application
# ==========================================

# Build stage - Install dependencies and build the application
FROM node:18-alpine AS builder

# Set environment variables for build
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=error
ENV NPM_CONFIG_PROGRESS=false

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies, including devDependencies
RUN npm ci --only=production=false && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY database/ ./database/
COPY scripts/ ./scripts/

# Build the application (TypeScript compilation if needed)
RUN npm run build

# Production stage - Minimal runtime image
FROM node:18-alpine AS production

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV user=appuser

# Install runtime dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S $user && \
    adduser -S $user -u 1001

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=$user:$user /app/src ./src
COPY --from=builder --chown=$user:$user /app/database ./database
COPY --from=builder --chown=$user:$user /app/scripts ./scripts
COPY --from=builder --chown=$user:$user /app/node_modules ./node_modules

# Create directories for logs and uploads
RUN mkdir -p /app/logs /app/uploads && \
    chown -R $user:$user /app

# Switch to non-root user
USER $user

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE 3001

# Start the application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/backend/simple-server.js"]