#!/bin/bash

# ==========================================
# GUI-LOP Graceful Shutdown Script
# Ensures clean shutdown of all services
# ==========================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
DEV_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.dev.yml"
STAGING_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.staging.yml"
TIMEOUT=${SHUTDOWN_TIMEOUT:-60}
LOG_FILE="$PROJECT_ROOT/logs/shutdown.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Check if service is healthy
wait_for_service_shutdown() {
    local service_name=$1
    local max_wait=$2
    local wait_time=0

    log "INFO" "Waiting for $service_name to shut down gracefully..."

    while [[ $wait_time -lt $max_wait ]]; do
        if ! docker ps --format "{{.Names}}" | grep -q "^gui-lop-$service_name$"; then
            log "INFO" "$service_name has shut down gracefully"
            return 0
        fi

        sleep 5
        wait_time=$((wait_time + 5))
        log "INFO" "Waiting for $service_name... (${wait_time}s/${max_wait}s)"
    done

    log "WARN" "$service_name did not shut down within $max_wait seconds"
    return 1
}

# Stop service gracefully
stop_service_gracefully() {
    local service_name=$1
    local compose_file=$2

    log "INFO" "Stopping $service_name gracefully..."

    if docker-compose -f "$compose_file" ps --services | grep -q "^$service_name$"; then
        # Send SIGTERM signal
        docker-compose -f "$compose_file" stop -t $TIMEOUT "$service_name" || {
            log "WARN" "Failed to stop $service_name gracefully, forcing shutdown..."
            docker-compose -f "$compose_file" kill "$service_name"
        }

        # Wait for service to stop
        if ! wait_for_service_shutdown "$service_name" $((TIMEOUT + 30)); then
            log "WARN" "Force removing $service_name..."
            docker-compose -f "$compose_file" rm -f "$service_name" || true
        fi
    else
        log "INFO" "$service_name is not running"
    fi
}

# Backup data before shutdown
backup_data() {
    local env=${1:-production}

    log "INFO" "Creating data backup before shutdown..."

    # Create backup directory
    local backup_dir="$PROJECT_ROOT/backups/$(date '+%Y%m%d_%H%M%S')"
    mkdir -p "$backup_dir"

    # Backup PostgreSQL
    if docker ps --format "{{.Names}}" | grep -q "gui-lop-postgres"; then
        log "INFO" "Backing up PostgreSQL database..."
        docker exec gui-lop-postgres pg_dump -U gui-lop gui_lop > "$backup_dir/postgres_backup.sql" || {
            log "WARN" "Failed to backup PostgreSQL database"
        }
    fi

    # Backup Redis
    if docker ps --format "{{.Names}}" | grep -q "gui-lop-redis"; then
        log "INFO" "Backing up Redis data..."
        docker exec gui-lop-redis redis-cli BGSAVE || {
            log "WARN" "Failed to trigger Redis background save"
        }

        # Copy Redis data
        if docker exec gui-lop-redis test -f /data/dump.rdb; then
            docker cp gui-lop-redis:/data/dump.rdb "$backup_dir/redis_backup.rdb" || {
                log "WARN" "Failed to copy Redis data"
            }
        fi
    fi

    # Backup application logs
    if [[ -d "$PROJECT_ROOT/logs" ]]; then
        log "INFO" "Backing up application logs..."
        cp -r "$PROJECT_ROOT/logs" "$backup_dir/" || {
            log "WARN" "Failed to backup application logs"
        }
    fi

    log "INFO" "Backup completed: $backup_dir"
}

# Cleanup resources
cleanup_resources() {
    local env=${1:-production}

    log "INFO" "Cleaning up Docker resources..."

    # Remove stopped containers
    docker container prune -f || true

    # Remove unused images (keep last 5)
    docker image prune -a -f --filter "until=24h" || true

    # Remove unused volumes (be careful with this)
    if [[ "$env" == "development" ]]; then
        log "INFO" "Removing unused volumes in development mode..."
        docker volume prune -f || true
    fi

    # Remove unused networks
    docker network prune -f || true

    log "INFO" "Cleanup completed"
}

# Shutdown services in order
shutdown_services() {
    local compose_file=$1
    local env=$2

    log "INFO" "Starting graceful shutdown for $env environment..."

    # Stop services in reverse dependency order
    local services=("frontend" "backend" "postgres" "redis")

    for service in "${services[@]}"; do
        stop_service_gracefully "$service" "$compose_file"
    done

    log "INFO" "All services have been shut down"
}

# Emergency shutdown (force)
emergency_shutdown() {
    local compose_file=$1

    log "WARN" "Performing emergency shutdown..."

    # Kill all containers immediately
    docker-compose -f "$compose_file" kill || true

    # Remove containers
    docker-compose -f "$compose_file" rm -f || true

    log "WARN" "Emergency shutdown completed"
}

# Show shutdown status
show_shutdown_status() {
    local compose_file=$1

    log "INFO" "Checking shutdown status..."

    echo ""
    echo "=== Container Status ==="
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep gui-lop || echo "No GUI-LOP containers running"

    echo ""
    echo "=== Volume Status ==="
    docker volume ls | grep gui-lop || echo "No GUI-LOP volumes found"

    echo ""
    echo "=== Network Status ==="
    docker network ls | grep gui-lop || echo "No GUI-LOP networks found"
}

# Main function
main() {
    local action=${1:-graceful}
    local env=${2:-production}

    # Create log directory
    mkdir -p "$(dirname "$LOG_FILE")"

    # Determine compose file
    case $env in
        "dev"|"development")
            COMPOSE_FILE="$DEV_COMPOSE_FILE"
            ;;
        "staging")
            COMPOSE_FILE="$STAGING_COMPOSE_FILE"
            ;;
        *)
            COMPOSE_FILE="$COMPOSE_FILE"
            ;;
    esac

    # Check if compose file exists
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log "ERROR" "Compose file not found: $COMPOSE_FILE"
        exit 1
    fi

    log "INFO" "Starting shutdown process: action=$action, environment=$env"
    log "INFO" "Using compose file: $COMPOSE_FILE"

    case $action in
        "graceful")
            backup_data "$env"
            shutdown_services "$COMPOSE_FILE" "$env"
            cleanup_resources "$env"
            ;;
        "emergency")
            emergency_shutdown "$COMPOSE_FILE"
            ;;
        "backup-only")
            backup_data "$env"
            ;;
        "cleanup-only")
            cleanup_resources "$env"
            ;;
        *)
            echo "Usage: $0 [graceful|emergency|backup-only|cleanup-only] [production|staging|development]"
            exit 1
            ;;
    esac

    show_shutdown_status "$COMPOSE_FILE"
    log "INFO" "Shutdown process completed"
}

# Trap signals for graceful shutdown
trap 'log "INFO" "Received interrupt signal, performing emergency shutdown..."; emergency_shutdown "$COMPOSE_FILE"; exit 130' INT TERM

# Execute main function
main "$@"