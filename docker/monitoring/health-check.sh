#!/bin/bash

# ==========================================
# GUI-LOP Health Check Script
# Monitors all services and reports status
# ==========================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
LOG_FILE="$PROJECT_ROOT/logs/health-check.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Service URLs and endpoints
declare -A SERVICES=(
    ["frontend"]="http://localhost:3000/health"
    ["backend"]="http://localhost:3001/health"
    ["postgres"]="localhost:5432"
    ["redis"]="localhost:6379"
    ["prometheus"]="http://localhost:9090/-/healthy"
    ["grafana"]="http://localhost:3002/api/health"
)

# Health check functions
check_http_service() {
    local service_name=$1
    local url=$2
    local timeout=${3:-10}

    echo -n "Checking $service_name... "

    if curl -f -s --max-time "$timeout" "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

check_database() {
    local service_name=$1
    local host=$2
    local port=$3

    echo -n "Checking $service_name... "

    if pg_isready -h "$host" -p "$port" -q; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

check_redis() {
    local service_name=$1
    local host=$2
    local port=$3

    echo -n "Checking $service_name... "

    if redis-cli -h "$host" -p "$port" ping > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

check_docker_container() {
    local container_name=$1

    if docker ps --format "table {{.Names}}" | grep -q "^$container_name$"; then
        local status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "unknown")

        if [[ "$status" == "healthy" ]]; then
            echo -e "${GREEN}HEALTHY${NC}"
            return 0
        elif [[ "$status" == "unhealthy" ]]; then
            echo -e "${RED}UNHEALTHY${NC}"
            return 1
        else
            echo -e "${YELLOW}UNKNOWN${NC}"
            return 2
        fi
    else
        echo -e "${RED}NOT RUNNING${NC}"
        return 1
    fi
}

# Main health check function
run_health_checks() {
    local failed_checks=0
    local total_checks=0

    echo -e "${BLUE}GUI-LOP Platform Health Check${NC}"
    echo -e "${BLUE}===============================${NC}"
    echo "Timestamp: $TIMESTAMP"
    echo ""

    # Check HTTP services
    for service in frontend backend prometheus grafana; do
        if [[ -n "${SERVICES[$service]}" ]]; then
            ((total_checks++))
            if ! check_http_service "$service" "${SERVICES[$service]}"; then
                ((failed_checks++))
            fi
        fi
    done

    # Check PostgreSQL
    if command -v pg_isready >/dev/null 2>&1; then
        ((total_checks++))
        if ! check_database "postgres" "localhost" "5432"; then
            ((failed_checks++))
        fi
    else
        echo -e "${YELLOW}PostgreSQL client not found, skipping database check${NC}"
    fi

    # Check Redis
    if command -v redis-cli >/dev/null 2>&1; then
        ((total_checks++))
        if ! check_redis "redis" "localhost" "6379"; then
            ((failed_checks++))
        fi
    else
        echo -e "${YELLOW}Redis client not found, skipping Redis check${NC}"
    fi

    echo ""
    echo -e "${BLUE}Docker Container Status${NC}"
    echo -e "${BLUE}======================${NC}"

    # Check Docker containers
    local containers=("gui-lop-frontend" "gui-lop-backend" "gui-lop-postgres" "gui-lop-redis")

    for container in "${containers[@]}"; do
        echo -n "$container: "
        check_docker_container "$container"
    done

    echo ""
    echo -e "${BLUE}Summary${NC}"
    echo -e "${BLUE}=======${NC}"
    echo "Total checks: $total_checks"
    echo "Passed: $((total_checks - failed_checks))"
    echo "Failed: $failed_checks"

    if [[ $failed_checks -eq 0 ]]; then
        echo -e "${GREEN}All services are healthy!${NC}"
        return 0
    else
        echo -e "${RED}$failed_checks service(s) are unhealthy${NC}"
        return 1
    fi
}

# Docker service health check
check_docker_services() {
    echo -e "${BLUE}Docker Services Health Check${NC}"
    echo -e "${BLUE}===========================${NC}"

    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${RED}Docker is not installed or not in PATH${NC}"
        return 1
    fi

    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}Docker daemon is not running${NC}"
        return 1
    fi

    # Check Docker Compose services
    if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
        echo "Checking Docker Compose services..."
        cd "$PROJECT_ROOT"

        # Show running containers
        echo ""
        echo "Running containers:"
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

        echo ""
        echo "Container health status:"
        docker ps --format "table {{.Names}}\t{{.Status}}" | while read -r line; do
            if [[ "$line" == *"NAMES"* ]]; then
                echo "$line"
            else
                local container=$(echo "$line" | awk '{print $1}')
                local status=$(echo "$line" | awk '{print $2}')
                local health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-healthcheck")
                echo "$container\t$status\t$health"
            fi
        done

    else
        echo -e "${YELLOW}docker-compose.yml not found in project root${NC}"
        return 1
    fi
}

# System resource check
check_system_resources() {
    echo -e "${BLUE}System Resources${NC}"
    echo -e "${BLUE}================${NC}"

    # Memory usage
    if command -v free >/dev/null 2>&1; then
        echo "Memory usage:"
        free -h
    fi

    # Disk usage
    echo ""
    echo "Disk usage:"
    df -h | grep -E "(Filesystem|/dev/)" | head -5

    # Docker system info
    if command -v docker >/dev/null 2>&1; then
        echo ""
        echo "Docker system info:"
        docker system df --format "table {{.Type}}\t{{.TotalCount}}\t{{.Size}}\t{{.Reclaimable}}"
    fi
}

# Main execution
main() {
    # Create log directory
    mkdir -p "$(dirname "$LOG_FILE")"

    # Run health checks
    {
        echo "================================"
        echo "Health Check Started: $TIMESTAMP"
        echo "================================"
        echo ""

        run_health_checks
        local health_status=$?

        echo ""
        check_docker_services

        echo ""
        check_system_resources

        echo ""
        echo "================================"
        echo "Health Check Completed: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "================================"
        echo ""

    } | tee -a "$LOG_FILE"

    return $health_status
}

# Run main function
main "$@"