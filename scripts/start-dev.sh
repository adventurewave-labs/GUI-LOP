#!/bin/bash

# ==========================================
# GUI-LOP Development Environment Starter
# Quick start for local development
# ==========================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}GUI-LOP Development Environment${NC}"
echo -e "${BLUE}=================================${NC}"

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."

    if ! command -v docker >/dev/null 2>&1; then
        echo -e "${RED}Docker is not installed${NC}"
        exit 1
    fi

    if ! command -v docker-compose >/dev/null 2>&1; then
        echo -e "${RED}Docker Compose is not installed${NC}"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}Docker daemon is not running${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Prerequisites check passed${NC}"
}

# Setup environment
setup_environment() {
    echo "Setting up environment..."

    # Create .env file if it doesn't exist
    if [[ ! -f .env ]]; then
        echo "Creating .env file from template..."
        cp .env.example .env
        echo -e "${YELLOW}⚠ Please edit .env file with your configuration${NC}"
    fi

    # Create necessary directories
    mkdir -p logs data/{postgres,redis} backups

    echo -e "${GREEN}✓ Environment setup completed${NC}"
}

# Start development services
start_services() {
    echo "Starting development services..."

    # Stop any existing services
    docker-compose -f docker-compose.dev.yml down || true

    # Start services
    docker-compose -f docker-compose.dev.yml up -d --build

    echo -e "${GREEN}✓ Services started successfully${NC}"
}

# Wait for services to be ready
wait_for_services() {
    echo "Waiting for services to be ready..."

    # Wait for backend
    echo "Waiting for backend..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if curl -f http://localhost:3001/health >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Backend is ready${NC}"
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done

    if [ $timeout -eq 0 ]; then
        echo -e "${RED}✗ Backend failed to start${NC}"
        exit 1
    fi

    # Wait for frontend
    echo "Waiting for frontend..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if curl -f http://localhost:3000 >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Frontend is ready${NC}"
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done

    if [ $timeout -eq 0 ]; then
        echo -e "${RED}✗ Frontend failed to start${NC}"
        exit 1
    fi
}

# Show service URLs and information
show_info() {
    echo ""
    echo -e "${BLUE}Development Environment Ready!${NC}"
    echo -e "${BLUE}==============================${NC}"
    echo ""
    echo "📱 Frontend Application:"
    echo "   URL: http://localhost:3000"
    echo ""
    echo "🔧 Backend API:"
    echo "   URL: http://localhost:3001"
    echo "   Health: http://localhost:3001/health"
    echo "   API Docs: http://localhost:3001/api/docs"
    echo ""
    echo "🗄️ Database Tools:"
    echo "   pgAdmin: http://localhost:5050"
    echo "   Credentials: admin@admin.com / admin"
    echo ""
    echo "🔴 Redis Tools:"
    echo "   Redis Commander: http://localhost:8081"
    echo ""
    echo "📊 Monitoring:"
    echo "   Health Check: ./docker/monitoring/health-check.sh"
    echo "   Logs: ./logs/"
    echo ""
    echo "🛠️ Development Commands:"
    echo "   View logs: docker-compose -f docker-compose.dev.yml logs -f"
    echo "   Stop services: docker-compose -f docker-compose.dev.yml down"
    echo "   Restart services: docker-compose -f docker-compose.dev.yml restart"
    echo ""
    echo "🔐 Default Credentials:"
    echo "   Admin User: admin@gui-lop.com / admin123"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    setup_environment
    start_services
    wait_for_services
    show_info
}

# Run main function
main "$@"