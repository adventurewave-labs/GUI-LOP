#!/bin/sh

# ==========================================
# Redis Docker Entrypoint Script
# Handles initialization and health checks
# ==========================================

set -e

# Function to check Redis connection
check_redis() {
    redis-cli -h localhost -p 6379 ping > /dev/null 2>&1
}

# Function to wait for Redis to be ready
wait_for_redis() {
    echo "Waiting for Redis to start..."
    local timeout=30
    local count=0

    while [ $count -lt $timeout ]; do
        if check_redis; then
            echo "Redis is ready!"
            return 0
        fi
        echo "Redis not ready yet, waiting... ($count/$timeout)"
        sleep 1
        count=$((count + 1))
    done

    echo "Redis failed to start within $timeout seconds"
    return 1
}

# Function to create Redis data directories
setup_directories() {
    echo "Setting up Redis directories..."
    mkdir -p /data /var/log/redis
    chown -R redis:redis /data /var/log/redis
}

# Function to initialize Redis with default data
initialize_redis() {
    echo "Initializing Redis with default configuration..."

    # Set some default keys if this is a fresh start
    if [ ! -f /data/dump.rdb ]; then
        echo "Fresh Redis instance - setting up default keys..."

        # Wait a moment for Redis to fully start
        sleep 2

        # Set application-specific keys
        redis-cli -h localhost -p 6379 SET "app:version" "1.0.0" EX 86400 > /dev/null 2>&1 || true
        redis-cli -h localhost -p 6379 SET "app:initialized_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" EX 86400 > /dev/null 2>&1 || true
        redis-cli -h localhost -p 6379 HSET "app:config" "cache_ttl" "3600" "max_connections" "1000" > /dev/null 2>&1 || true

        echo "Redis initialization completed"
    fi
}

# Main setup
setup_directories

# Start Redis in background
echo "Starting Redis server..."
exec redis-server /usr/local/etc/redis/redis.conf --daemonize yes --supervised systemd

# Wait for Redis to be ready
wait_for_redis

# Initialize Redis data
initialize_redis

# Bring Redis to foreground
echo "Redis server is running and ready"
tail -f /dev/null