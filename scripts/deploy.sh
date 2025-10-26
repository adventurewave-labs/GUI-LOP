#!/bin/bash

# ==========================================
# GUI-LOP Deployment Script
# Automated deployment for different environments
# ==========================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_ROOT/logs/deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT=${1:-production}
BRANCH=${2:-main}
SKIP_TESTS=${SKIP_TESTS:-false}
SKIP_BACKUP=${SKIP_BACKUP:-false}
FORCE_UPDATE=${FORCE_UPDATE:-false}

# Environment configurations
declare -A ENV_CONFIGS=(
    ["development"]=""
    ["staging"]=""
    ["production"]=""
)

# Docker compose files
declare -A COMPOSE_FILES=(
    ["development"]="docker-compose.dev.yml"
    ["staging"]="docker-compose.staging.yml"
    ["production"]="docker-compose.yml"
)

# Logging function
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    echo -e "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
    log "ERROR" "$1"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log "INFO" "Checking deployment prerequisites..."

    # Check Docker
    if ! command -v docker >/dev/null 2>&1; then
        error_exit "Docker is not installed or not in PATH"
    fi

    # Check Docker Compose
    if ! command -v docker-compose >/dev/null 2>&1; then
        error_exit "Docker Compose is not installed or not in PATH"
    fi

    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        error_exit "Docker daemon is not running"
    fi

    # Check if we're in a git repository
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        error_exit "Not in a git repository"
    fi

    # Check if .env file exists
    if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
        error_exit ".env file not found. Please copy .env.example to .env and configure it."
    fi

    log "INFO" "Prerequisites check passed"
}

# Validate environment
validate_environment() {
    local env=$1

    if [[ ! -n "${COMPOSE_FILES[$env]}" ]]; then
        error_exit "Invalid environment: $env. Valid environments: development, staging, production"
    fi

    log "INFO" "Environment validated: $env"
}

# Backup current deployment
backup_deployment() {
    local env=$1

    if [[ "$SKIP_BACKUP" == "true" ]]; then
        log "INFO" "Skipping backup as requested"
        return 0
    fi

    log "INFO" "Creating backup of current deployment..."

    local backup_dir="$PROJECT_ROOT/backups/$(date '+%Y%m%d_%H%M%S')_$env"
    mkdir -p "$backup_dir"

    # Backup database
    if docker ps --format "{{.Names}}" | grep -q "gui-lop-postgres"; then
        log "INFO" "Backing up database..."
        docker exec gui-lop-postgres pg_dump -U gui-lop gui_lop > "$backup_dir/database.sql" || {
            log "WARN" "Failed to backup database"
        }
    fi

    # Backup Redis
    if docker ps --format "{{.Names}}" | grep -q "gui-lop-redis"; then
        log "INFO" "Backing up Redis..."
        docker exec gui-lop-redis redis-cli BGSAVE || {
            log "WARN" "Failed to backup Redis"
        }
        sleep 5
        docker cp gui-lop-redis:/data/dump.rdb "$backup_dir/redis.rdb" || {
            log "WARN" "Failed to copy Redis data"
        }
    fi

    # Backup configuration
    cp "$PROJECT_ROOT/.env" "$backup_dir/.env" || {
        log "WARN" "Failed to backup .env file"
    }

    # Backup Docker images list
    docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}" | grep gui-lop > "$backup_dir/images.txt" || true

    log "INFO" "Backup completed: $backup_dir"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log "INFO" "Skipping tests as requested"
        return 0
    fi

    log "INFO" "Running tests before deployment..."

    # Run unit tests
    log "INFO" "Running unit tests..."
    npm test || error_exit "Unit tests failed"

    # Run integration tests
    log "INFO" "Running integration tests..."
    npm run test:integration || error_exit "Integration tests failed"

    # Run security tests
    log "INFO" "Running security tests..."
    npm run test:security:ci || error_exit "Security tests failed"

    log "INFO" "All tests passed"
}

# Build images
build_images() {
    local env=$1

    log "INFO" "Building Docker images for $env environment..."

    # Build backend image
    log "INFO" "Building backend image..."
    docker build -f docker/backend/Dockerfile -t gui-lop-backend:latest . || {
        error_exit "Failed to build backend image"
    }

    # Build frontend image
    log "INFO" "Building frontend image..."
    docker build -f docker/frontend/Dockerfile -t gui-lop-frontend:latest . || {
        error_exit "Failed to build frontend image"
    }

    log "INFO" "Docker images built successfully"
}

# Pull latest images
pull_images() {
    local env=$1

    log "INFO" "Pulling latest images for $env environment..."

    cd "$PROJECT_ROOT"

    if [[ "$FORCE_UPDATE" == "true" ]]; then
        docker-compose -f "${COMPOSE_FILES[$env]}" pull --include-deps
    else
        docker-compose -f "${COMPOSE_FILES[$env]}" pull
    fi

    log "INFO" "Images pulled successfully"
}

# Deploy services
deploy_services() {
    local env=$1

    log "INFO" "Deploying services to $env environment..."

    cd "$PROJECT_ROOT"

    # Stop existing services
    log "INFO" "Stopping existing services..."
    docker-compose -f "${COMPOSE_FILES[$env]}" down || true

    # Start new services
    log "INFO" "Starting new services..."
    docker-compose -f "${COMPOSE_FILES[$env]}" up -d || {
        error_exit "Failed to start services"
    }

    log "INFO" "Services deployed successfully"
}

# Health check deployment
health_check_deployment() {
    local env=$1
    local max_wait=300
    local wait_time=0

    log "INFO" "Performing health check on deployment..."

    # Run health check script
    if [[ -f "$PROJECT_ROOT/docker/monitoring/health-check.sh" ]]; then
        while [[ $wait_time -lt $max_wait ]]; do
            if "$PROJECT_ROOT/docker/monitoring/health-check.sh" > /dev/null 2>&1; then
                log "INFO" "Health check passed"
                return 0
            fi

            log "INFO" "Waiting for services to be healthy... (${wait_time}s/${max_wait}s)"
            sleep 10
            wait_time=$((wait_time + 10))
        done

        error_exit "Health check failed after $max_wait seconds"
    else
        log "WARN" "Health check script not found, skipping health check"
        sleep 30  # Give services time to start
    fi
}

# Cleanup old images
cleanup_images() {
    log "INFO" "Cleaning up old Docker images..."

    # Remove dangling images
    docker image prune -f || true

    # Remove old versions of our images (keep last 3)
    local images=("gui-lop-backend" "gui-lop-frontend")

    for image in "${images[@]}"; do
        local image_count=$(docker images "$image" --format "{{.ID}}" | wc -l)
        if [[ $image_count -gt 3 ]]; then
            docker images "$image" --format "{{.ID}}" | tail -n +4 | xargs -r docker rmi || true
        fi
    done

    log "INFO" "Cleanup completed"
}

# Show deployment status
show_deployment_status() {
    local env=$1

    log "INFO" "Deployment status for $env environment:"

    echo ""
    echo "=== Running Containers ==="
    docker-compose -f "${COMPOSE_FILES[$env]}" ps

    echo ""
    echo "=== Service URLs ==="
    case $env in
        "development")
            echo "Frontend: http://localhost:3000"
            echo "Backend:  http://localhost:3001"
            echo "pgAdmin:  http://localhost:5050"
            echo "Redis Commander: http://localhost:8081"
            ;;
        "staging")
            echo "Frontend: http://localhost:3000"
            echo "Backend:  http://localhost:3001"
            echo "Grafana:  http://localhost:3002"
            echo "Prometheus: http://localhost:9090"
            ;;
        "production")
            echo "Frontend: http://localhost:3000"
            echo "Backend:  http://localhost:3001"
            ;;
    esac

    echo ""
    echo "=== Logs ==="
    echo "Application logs: $PROJECT_ROOT/logs/"
    echo "Deployment log:   $LOG_FILE"
}

# Rollback function
rollback_deployment() {
    local env=$1
    local backup_dir=$2

    log "WARN" "Rolling back deployment to $backup_dir..."

    if [[ ! -d "$backup_dir" ]]; then
        error_exit "Backup directory not found: $backup_dir"
    fi

    # Stop current deployment
    docker-compose -f "${COMPOSE_FILES[$env]}" down || true

    # Restore database
    if [[ -f "$backup_dir/database.sql" ]]; then
        log "INFO" "Restoring database..."
        docker-compose -f "${COMPOSE_FILES[$env]}" up -d postgres
        sleep 10
        docker exec gui-lop-postgres psql -U gui-lop -d gui_lop < "$backup_dir/database.sql" || {
            log "WARN" "Failed to restore database"
        }
    fi

    # Restore Redis
    if [[ -f "$backup_dir/redis.rdb" ]]; then
        log "INFO" "Restoring Redis..."
        docker-compose -f "${COMPOSE_FILES[$env]}" up -d redis
        sleep 5
        docker cp "$backup_dir/redis.rdb" gui-lop-redis:/data/dump.rdb || {
            log "WARN" "Failed to restore Redis"
        }
        docker restart gui-lop-redis || true
    fi

    # Restore configuration
    if [[ -f "$backup_dir/.env" ]]; then
        cp "$backup_dir/.env" "$PROJECT_ROOT/.env" || {
            log "WARN" "Failed to restore .env file"
        }
    fi

    # Start services
    docker-compose -f "${COMPOSE_FILES[$env]}" up -d || {
        error_exit "Failed to start services during rollback"
    }

    log "INFO" "Rollback completed"
}

# Main deployment function
deploy() {
    local env=$1

    log "INFO" "Starting deployment to $env environment"
    log "INFO" "Branch: $BRANCH"
    log "INFO" "Skip tests: $SKIP_TESTS"
    log "INFO" "Skip backup: $SKIP_BACKUP"
    log "INFO" "Force update: $FORCE_UPDATE"

    # Create log directory
    mkdir -p "$(dirname "$LOG_FILE")"

    # Run deployment steps
    check_prerequisites
    validate_environment "$env"
    backup_deployment "$env"
    run_tests
    build_images "$env"
    pull_images "$env"
    deploy_services "$env"
    health_check_deployment "$env"
    cleanup_images
    show_deployment_status "$env"

    log "INFO" "Deployment completed successfully!"
}

# Show usage
show_usage() {
    echo "Usage: $0 [environment] [branch] [options]"
    echo ""
    echo "Environments:"
    echo "  development  Deploy to development environment"
    echo "  staging      Deploy to staging environment"
    echo "  production   Deploy to production environment (default)"
    echo ""
    echo "Branch:"
    echo "  Branch to deploy (default: main)"
    echo ""
    echo "Options:"
    echo "  SKIP_TESTS=true      Skip running tests before deployment"
    echo "  SKIP_BACKUP=true     Skip creating backup before deployment"
    echo "  FORCE_UPDATE=true    Force update of all images"
    echo ""
    echo "Examples:"
    echo "  $0 production main"
    echo "  $0 staging develop"
    echo "  SKIP_TESTS=true $0 development main"
    echo "  ROLLBACK=true $0 production /path/to/backup"
}

# Check if rollback is requested
if [[ "${ROLLBACK:-false}" == "true" ]]; then
    if [[ -z "$2" ]]; then
        error_exit "Backup directory required for rollback"
    fi
    validate_environment "$1"
    rollback_deployment "$1" "$2"
    exit 0
fi

# Parse command line arguments
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Trap signals for cleanup
trap 'log "WARN" "Deployment interrupted"; exit 130' INT TERM

# Execute main function
main() {
    case "$1" in
        "")
            deploy "production"
            ;;
        "development"|"staging"|"production")
            deploy "$1"
            ;;
        *)
            error_exit "Invalid environment: $1"
            ;;
    esac
}

# Run main function
main "$ENVIRONMENT"