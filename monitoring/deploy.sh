#!/bin/bash

# GUI-LOP Monitoring System Deployment Script
# Deploys the comprehensive monitoring and alerting infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    log_info "Checking dependencies..."

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi

    log_success "All dependencies are installed and running."
}

setup_environment() {
    log_info "Setting up environment..."

    # Create .env file if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
        log_info "Creating .env file from template..."

        cat > "$ENV_FILE" << EOF
# Elasticsearch Configuration
ELASTICSEARCH_PASSWORD=changeme_elastic_password
KIBANA_PASSWORD=changeme_kibana_password

# Grafana Configuration
GRAFANA_PASSWORD=changeme_grafana_password

# Database Configuration
POSTGRES_PASSWORD=changeme_postgres_password
REDIS_PASSWORD=changeme_redis_password

# Notification Configuration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
SMTP_HOST=smtp.example.com
SMTP_USER=alerts@example.com
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=alerts@example.com

# Security Configuration
SECURITY_ENCRYPTION_KEY=your_32_byte_encryption_key_here

# Application Configuration
ENVIRONMENT=production
CLUSTER_NAME=gui-lop
DATACENTER=primary

# External Integrations (Optional)
# JIRA_URL=https://your-domain.atlassian.net
# JIRA_USERNAME=your_username
# JIRA_TOKEN=your_api_token
# PAGERDUTY_INTEGRATION_KEY=your_integration_key
EOF

        log_warning "Environment file created with default passwords. Please update them before proceeding."
        log_warning "Edit $ENV_FILE with your actual configuration values."

        read -p "Do you want to continue with default values? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Please edit $ENV_FILE and run this script again."
            exit 1
        fi
    fi

    # Source environment file
    if [ -f "$ENV_FILE" ]; then
        source "$ENV_FILE"
        log_success "Environment configuration loaded."
    fi
}

generate_certificates() {
    log_info "Generating SSL certificates..."

    CERT_DIR="$SCRIPT_DIR/elasticsearch/certificates"

    # Create certificates directory
    mkdir -p "$CERT_DIR/ca"
    mkdir -p "$CERT_DIR/elasticsearch-node-1"
    mkdir -p "$CERT_DIR/elasticsearch-node-2"
    mkdir -p "$CERT_DIR/elasticsearch-node-3"
    mkdir -p "$CERT_DIR/kibana"
    mkdir -p "$CERT_DIR/logstash"

    # Generate CA certificate
    if [ ! -f "$CERT_DIR/ca/ca.crt" ]; then
        log_info "Generating CA certificate..."
        openssl genrsa -out "$CERT_DIR/ca/ca.key" 2048
        openssl req -new -x509 -key "$CERT_DIR/ca/ca.key" -days 3650 -out "$CERT_DIR/ca/ca.crt" -subj "/C=US/ST=CA/L=San Francisco/O=GUI-LOP/OU=Monitoring/CN=CA"
    fi

    # Generate Elasticsearch certificates
    for i in 1 2 3; do
        NODE_DIR="$CERT_DIR/elasticsearch-node-$i"
        if [ ! -f "$NODE_DIR/elasticsearch-node-$i.crt" ]; then
            log_info "Generating certificate for elasticsearch-node-$i..."
            openssl genrsa -out "$NODE_DIR/elasticsearch-node-$i.key" 2048
            openssl req -new -key "$NODE_DIR/elasticsearch-node-$i.key" -out "$NODE_DIR/elasticsearch-node-$i.csr" -subj "/C=US/ST=CA/L=San Francisco/O=GUI-LOP/OU=Monitoring/CN=elasticsearch-node-$i"
            openssl x509 -req -in "$NODE_DIR/elasticsearch-node-$i.csr" -CA "$CERT_DIR/ca/ca.crt" -CAkey "$CERT_DIR/ca/ca.key" -CAcreateserial -out "$NODE_DIR/elasticsearch-node-$i.crt" -days 3650
        fi
    done

    # Generate Kibana certificate
    if [ ! -f "$CERT_DIR/kibana/kibana.crt" ]; then
        log_info "Generating Kibana certificate..."
        openssl genrsa -out "$CERT_DIR/kibana/kibana.key" 2048
        openssl req -new -key "$CERT_DIR/kibana/kibana.key" -out "$CERT_DIR/kibana/kibana.csr" -subj "/C=US/ST=CA/L=San Francisco/O=GUI-LOP/OU=Monitoring/CN=kibana"
        openssl x509 -req -in "$CERT_DIR/kibana/kibana.csr" -CA "$CERT_DIR/ca/ca.crt" -CAkey "$CERT_DIR/ca/ca.key" -CAcreateserial -out "$CERT_DIR/kibana/kibana.crt" -days 3650
    fi

    # Generate Logstash certificate
    if [ ! -f "$CERT_DIR/logstash/logstash.crt" ]; then
        log_info "Generating Logstash certificate..."
        openssl genrsa -out "$CERT_DIR/logstash/logstash.key" 2048
        openssl req -new -key "$CERT_DIR/logstash/logstash.key" -out "$CERT_DIR/logstash/logstash.csr" -subj "/C=US/ST=CA/L=San Francisco/O=GUI-LOP/OU=Monitoring/CN=logstash"
        openssl x509 -req -in "$CERT_DIR/logstash/logstash.csr" -CA "$CERT_DIR/ca/ca.crt" -CAkey "$CERT_DIR/ca/ca.key" -CAcreateserial -out "$CERT_DIR/logstash/logstash.crt" -days 3650
    fi

    log_success "SSL certificates generated successfully."
}

create_directories() {
    log_info "Creating necessary directories..."

    # Create data directories
    mkdir -p "$SCRIPT_DIR/data/elasticsearch"
    mkdir -p "$SCRIPT_DIR/data/logstash"
    mkdir -p "$SCRIPT_DIR/data/kibana"
    mkdir -p "$SCRIPT_DIR/data/prometheus"
    mkdir -p "$SCRIPT_DIR/data/grafana"
    mkdir -p "$SCRIPT_DIR/data/redis"
    mkdir -p "$SCRIPT_DIR/data/postgresql"
    mkdir -p "$SCRIPT_DIR/logs"

    # Set proper permissions
    chmod 755 "$SCRIPT_DIR/data"
    chmod 755 "$SCRIPT_DIR/logs"

    log_success "Directories created successfully."
}

deploy_infrastructure() {
    log_info "Deploying monitoring infrastructure..."

    # Pull latest images
    log_info "Pulling Docker images..."
    docker-compose -f "$COMPOSE_FILE" pull

    # Start services
    log_info "Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d

    log_success "Infrastructure deployment started."
}

wait_for_services() {
    log_info "Waiting for services to be ready..."

    # Wait for Elasticsearch
    log_info "Waiting for Elasticsearch..."
    for i in {1..30}; do
        if curl -s -k "https://localhost:9200/_cluster/health" | grep -q '"status":"green"'; then
            log_success "Elasticsearch is ready."
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "Elasticsearch failed to start within 5 minutes."
            return 1
        fi
        sleep 10
    done

    # Wait for Kibana
    log_info "Waiting for Kibana..."
    for i in {1..30}; do
        if curl -s -k "https://localhost:5601/api/status" | grep -q '"overall":{"level":"available"'; then
            log_success "Kibana is ready."
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "Kibana failed to start within 5 minutes."
            return 1
        fi
        sleep 10
    done

    # Wait for Prometheus
    log_info "Waiting for Prometheus..."
    for i in {1..20}; do
        if curl -s "http://localhost:9090/-/healthy" | grep -q "Prometheus is Healthy"; then
            log_success "Prometheus is ready."
            break
        fi
        if [ $i -eq 20 ]; then
            log_error "Prometheus failed to start within 3 minutes."
            return 1
        fi
        sleep 9
    done

    # Wait for Grafana
    log_info "Waiting for Grafana..."
    for i in {1..20}; do
        if curl -s "http://localhost:3000/api/health" | grep -q "OK"; then
            log_success "Grafana is ready."
            break
        fi
        if [ $i -eq 20 ]; then
            log_error "Grafana failed to start within 3 minutes."
            return 1
        fi
        sleep 9
    done
}

configure_elasticsearch() {
    log_info "Configuring Elasticsearch..."

    # Wait for Elasticsearch to be fully ready
    sleep 30

    # Set built-in user passwords
    log_info "Setting Elasticsearch passwords..."

    # Set kibana_system user password
    curl -k -u elastic:$ELASTICSEARCH_PASSWORD -X POST "https://localhost:9200/_security/user/kibana_system/_password" \
        -H "Content-Type: application/json" \
        -d "{\"password\":\"$KIBANA_PASSWORD\"}" || log_warning "Failed to set kibana_system password"

    # Set logstash_system user password
    curl -k -u elastic:$ELASTICSEARCH_PASSWORD -X POST "https://localhost:9200/_security/user/logstash_system/_password" \
        -H "Content-Type: application/json" \
        -d "{\"password\":\"changeme_logstash_password\"}" || log_warning "Failed to set logstash_system password"

    log_success "Elasticsearch configuration completed."
}

configure_grafana() {
    log_info "Configuring Grafana..."

    # Wait for Grafana to be ready
    sleep 15

    # Update admin password
    GRAFANA_API="http://admin:admin@localhost:3000/api"

    # Change admin password
    curl -s -X PUT "$GRAFANA_API/user/password" \
        -H "Content-Type: application/json" \
        -d "{\"oldPassword\":\"admin\",\"newPassword\":\"$GRAFANA_PASSWORD\",\"confirmNewPassword\":\"$GRAFANA_PASSWORD\"}" || log_warning "Failed to update Grafana admin password"

    log_success "Grafana configuration completed."
}

verify_deployment() {
    log_info "Verifying deployment..."

    # Check service status
    echo "Service Status:"
    docker-compose -f "$COMPOSE_FILE" ps

    # Health checks
    echo ""
    echo "Health Checks:"

    # Elasticsearch
    if curl -s -k "https://localhost:9200/_cluster/health" | grep -q '"status":"green"'; then
        log_success "✓ Elasticsearch: Healthy"
    else
        log_error "✗ Elasticsearch: Unhealthy"
    fi

    # Kibana
    if curl -s -k "https://localhost:5601/api/status" | grep -q '"level":"available"'; then
        log_success "✓ Kibana: Healthy"
    else
        log_error "✗ Kibana: Unhealthy"
    fi

    # Prometheus
    if curl -s "http://localhost:9090/-/healthy" | grep -q "Prometheus is Healthy"; then
        log_success "✓ Prometheus: Healthy"
    else
        log_error "✗ Prometheus: Unhealthy"
    fi

    # Grafana
    if curl -s "http://localhost:3000/api/health" | grep -q "OK"; then
        log_success "✓ Grafana: Healthy"
    else
        log_error "✗ Grafana: Unhealthy"
    fi

    # AlertManager
    if curl -s "http://localhost:9093/-/healthy" | grep -q "OK"; then
        log_success "✓ AlertManager: Healthy"
    else
        log_error "✗ AlertManager: Unhealthy"
    fi
}

show_access_info() {
    log_success "Deployment completed successfully!"
    echo ""
    echo "Access Information:"
    echo "=================="
    echo ""
    echo "Kibana Dashboard:"
    echo "  URL: https://localhost:5601"
    echo "  Username: elastic"
    echo "  Password: $ELASTICSEARCH_PASSWORD"
    echo ""
    echo "Grafana Dashboard:"
    echo "  URL: http://localhost:3000"
    echo "  Username: admin"
    echo "  Password: $GRAFANA_PASSWORD"
    echo ""
    echo "Prometheus:"
    echo "  URL: http://localhost:9090"
    echo ""
    echo "AlertManager:"
    echo "  URL: http://localhost:9093"
    echo ""
    echo "Jaeger Tracing:"
    echo "  URL: http://localhost:16686"
    echo ""
    echo "Elasticsearch API:"
    echo "  URL: https://localhost:9200"
    echo "  Username: elastic"
    echo "  Password: $ELASTICSEARCH_PASSWORD"
    echo ""
    echo "Important Notes:"
    echo "- Change default passwords before production use"
    echo "- Configure SSL certificates for production"
    echo "- Set up backup procedures"
    echo "- Review and adjust alerting rules"
    echo "- Configure notification channels"
}

cleanup() {
    log_info "Cleaning up on interrupt..."
    # Add cleanup logic here if needed
    exit 1
}

# Set up trap for cleanup
trap cleanup SIGINT SIGTERM

# Main deployment process
main() {
    echo "GUI-LOP Monitoring System Deployment"
    echo "====================================="
    echo ""

    check_dependencies
    setup_environment
    generate_certificates
    create_directories
    deploy_infrastructure
    wait_for_services
    configure_elasticsearch
    configure_grafana
    verify_deployment
    show_access_info

    log_success "Deployment completed successfully!"
}

# Run main function
main "$@"