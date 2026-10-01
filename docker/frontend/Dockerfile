# ==========================================
# GUI-LOP Frontend Multi-Stage Dockerfile
# Production-optimized React application with Nginx
# ==========================================

# Build stage - Build React application
FROM node:24-alpine AS builder

# Set environment variables for build
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=error
ENV NPM_CONFIG_PROGRESS=false
ENV GENERATE_SOURCEMAP=false
ENV INLINE_RUNTIME_CHUNK=false

# Create app directory
WORKDIR /app

# Build context is the REPO ROOT (docker-compose.staging.yml, CI). This used
# to copy the root package.json / src/ / public/ — i.e. the backend — so the
# image could not build; there was also no frontend lockfile for `npm ci`.
COPY src/frontend/package.json src/frontend/package-lock.json src/frontend/.npmrc ./

# Dev dependencies are needed to build (react-scripts).
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force

COPY src/frontend/public/ ./public/
COPY src/frontend/src/ ./src/

# Build the React application
RUN npm run build

# Production stage - Nginx serving
FROM nginx:alpine AS production

# Install additional tools for health checks
RUN apk add --no-cache curl

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Nginx configuration. Templates are rendered by the image's entrypoint
# (envsubst, only for variables that are set) into /etc/nginx/conf.d.
COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf
COPY docker/frontend/templates/ /etc/nginx/templates/
# Extra CSP connect-src origins (leading space), e.g.
#   " https://api.example.com wss://api.example.com". Empty = same-origin only.
ENV CSP_CONNECT_EXTRA=""

# Copy built React application from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Create directories for runtime
# conf.d must be writable by the non-root user for the template step.
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run && \
    rm -f /etc/nginx/conf.d/default.conf && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/run /etc/nginx/conf.d

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Switch to non-root user
USER nginx

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]