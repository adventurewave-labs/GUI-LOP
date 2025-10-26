# ==========================================
# GUI-LOP Frontend Multi-Stage Dockerfile
# Production-optimized React application with Nginx
# ==========================================

# Build stage - Build React application
FROM node:18-alpine AS builder

# Set environment variables for build
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=error
ENV NPM_CONFIG_PROGRESS=false
ENV GENERATE_SOURCEMAP=false
ENV INLINE_RUNTIME_CHUNK=false

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false && npm cache clean --force

# Copy source code
COPY public/ ./public/
COPY src/ ./src/

# Build the React application
RUN npm run build

# Production stage - Nginx serving
FROM nginx:alpine AS production

# Install additional tools for health checks
RUN apk add --no-cache curl

# Remove default Nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy custom Nginx configuration
COPY docker/frontend/nginx.conf /etc/nginx/nginx.conf
COPY docker/frontend/default.conf /etc/nginx/conf.d/default.conf

# Copy built React application from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Create directories for runtime
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/run

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Switch to non-root user
USER nginx

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]