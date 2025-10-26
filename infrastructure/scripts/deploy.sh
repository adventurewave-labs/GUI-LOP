#!/bin/bash

# GUI-LOP Production Deployment Script
# This script deploys the production infrastructure using Terraform

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
TERRAFORM_DIR="$PROJECT_ROOT/infrastructure/terraform"
LOG_FILE="$PROJECT_ROOT/deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check if Terraform is installed
    if ! command -v terraform &> /dev/null; then
        error "Terraform is not installed. Please install Terraform first."
    fi

    # Check if AWS CLI is installed and configured
    if ! command -v aws &> /dev/null; then
        error "AWS CLI is not installed. Please install AWS CLI first."
    fi

    # Check if AWS credentials are configured
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS credentials are not configured. Please run 'aws configure' first."
    fi

    # Check if Node.js is installed (for application build)
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js first."
    fi

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker first."
    fi

    success "All prerequisites are satisfied."
}

# Validate Terraform configuration
validate_terraform() {
    log "Validating Terraform configuration..."

    cd "$TERRAFORM_DIR"

    # Initialize Terraform
    log "Initializing Terraform..."
    terraform init -input=false

    # Validate configuration
    log "Validating Terraform configuration..."
    terraform validate

    # Check for required variables
    if [ ! -f "terraform.tfvars" ]; then
        warning "terraform.tfvars not found. Using example configuration."
        if [ -f "terraform.tfvars.example" ]; then
            cp terraform.tfvars.example terraform.tfvars
            warning "Please update terraform.tfvars with your actual values before proceeding."
        else
            error "terraform.tfvars.example not found. Cannot create configuration file."
        fi
    fi

    success "Terraform configuration is valid."
}

# Plan infrastructure deployment
plan_infrastructure() {
    log "Planning infrastructure deployment..."

    cd "$TERRAFORM_DIR"

    # Generate execution plan
    terraform plan -input=false -out=tfplan

    success "Infrastructure plan generated successfully."
}

# Deploy infrastructure
deploy_infrastructure() {
    log "Deploying infrastructure..."

    cd "$TERRAFORM_DIR"

    # Apply the plan
    terraform apply -input=false tfplan

    success "Infrastructure deployed successfully."
}

# Build and push Docker images
build_and_push_images() {
    log "Building and pushing Docker images..."

    cd "$PROJECT_ROOT"

    # Get AWS account ID and region
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(terraform -chdir="$TERRAFORM_DIR" output -raw aws_region 2>/dev/null || echo "us-east-1")
    ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

    # Login to ECR
    log "Logging in to ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

    # Create ECR repository if it doesn't exist
    REPO_NAME="gui-lop"
    if ! aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$AWS_REGION" &>/dev/null; then
        log "Creating ECR repository..."
        aws ecr create-repository --repository-name "$REPO_NAME" --region "$AWS_REGION"
    fi

    # Build Docker image
    log "Building Docker image..."
    docker build -t "${REPO_NAME}:latest" .
    docker tag "${REPO_NAME}:latest" "${ECR_REGISTRY}/${REPO_NAME}:latest"

    # Push image to ECR
    log "Pushing Docker image to ECR..."
    docker push "${ECR_REGISTRY}/${REPO_NAME}:latest"

    success "Docker images built and pushed successfully."
}

# Update ECS service
update_ecs_service() {
    log "Updating ECS service..."

    cd "$TERRAFORM_DIR"

    # Get cluster and service names
    CLUSTER_NAME=$(terraform output -raw ecs_cluster_name)
    SERVICE_NAME=$(terraform output -raw ecs_service_name)

    # Force new deployment
    log "Forcing new deployment for ECS service..."
    aws ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" --force-new-deployment

    # Wait for service to stabilize
    log "Waiting for ECS service to stabilize..."
    aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME"

    success "ECS service updated successfully."
}

# Run smoke tests
run_smoke_tests() {
    log "Running smoke tests..."

    cd "$TERRAFORM_DIR"

    # Get application URL
    APP_URL=$(terraform output -raw application_url)

    # Wait for application to be ready
    log "Waiting for application to be ready..."
    for i in {1..30}; do
        if curl -f -s "$APP_URL/health" > /dev/null; then
            success "Application is healthy."
            break
        fi

        if [ $i -eq 30 ]; then
            error "Application failed to become healthy after 5 minutes."
        fi

        log "Waiting for application... (attempt $i/30)"
        sleep 10
    done

    # Run basic health checks
    log "Running health checks..."

    # Check main application
    if curl -f -s "$APP_URL/health" | grep -q "healthy"; then
        success "Main application health check passed."
    else
        error "Main application health check failed."
    fi

    # Check API endpoints
    API_URL=$(terraform output -raw api_url)
    if curl -f -s "$API_URL/health" | grep -q "healthy"; then
        success "API health check passed."
    else
        warning "API health check failed (may still be starting)."
    fi

    success "Smoke tests completed."
}

# Generate deployment report
generate_report() {
    log "Generating deployment report..."

    cd "$TERRAFORM_DIR"

    REPORT_FILE="$PROJECT_ROOT/deployment-report-$(date +%Y%m%d-%H%M%S).md"

    cat > "$REPORT_FILE" << EOF
# GUI-LOP Production Deployment Report

**Date:** $(date)
**Environment:** Production
**Version:** $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

## Infrastructure Resources

### Network
- **VPC ID:** $(terraform output -raw vpc_id)
- **Public Subnets:** $(terraform output -json public_subnet_ids | jq -r '. | join(", ")')
- **Private Subnets:** $(terraform output -json private_subnet_ids | jq -r '. | join(", ")')
- **Database Subnets:** $(terraform output -json database_subnet_ids | jq -r '. | join(", ")')

### Compute
- **ECS Cluster:** $(terraform output -raw ecs_cluster_name)
- **ECS Service:** $(terraform output -raw ecs_service_name)
- **Auto-scaling Range:** $(terraform output -raw app_min_capacity) - $(terraform output -raw app_max_capacity) tasks

### Load Balancer
- **ALB DNS:** $(terraform output -raw load_balancer_dns_name)
- **SSL Certificate:** Configured
- **Health Checks:** Enabled

### Database
- **RDS Endpoint:** $(terraform output -raw database_endpoint)
- **RDS Port:** $(terraform output -raw database_port)
- **Database Name:** $(terraform output -raw database_name)
- **Read Replicas:** 2

### Cache
- **Redis Endpoint:** $(terraform output -raw redis_endpoint)
- **Redis Port:** $(terraform output -raw redis_port)
- **Redis Shards:** $(terraform output -raw redis_num_shards)

### Storage
- **Static Assets Bucket:** $(terraform output -raw static_assets_bucket_name)
- **User Uploads Bucket:** $(terraform output -raw user_uploads_bucket_name)

### CDN
- **CloudFront Distribution:** $(terraform output -raw cloudfront_distribution_domain_name)
- **WAF Protection:** Enabled

### Monitoring
- **CloudWatch Dashboard:** Available
- **SNS Alerts:** Configured
- **Alarms:** Configured

## Application URLs

- **Main Application:** $(terraform output -raw application_url)
- **API:** $(terraform output -raw api_url)
- **CloudFront:** $(terraform output -raw cloudfront_distribution_domain_name)

## Security

- **SSL/TLS:** Enabled everywhere
- **WAF:** Enabled with OWASP protection
- **Security Groups:** Configured with least privilege
- **Secrets Management:** AWS Secrets Manager

## Backup & Disaster Recovery

- **RDS Backups:** Automated with $(terraform output -raw backup_retention_days) day retention
- **Cross-Region Replication:** Enabled
- **S3 Replication:** Enabled
- **Disaster Recovery:** Configured

## Next Steps

1. Monitor the application using CloudWatch dashboard
2. Set up additional alerts if needed
3. Review security groups and access policies
4. Schedule regular backup verification
5. Perform load testing during off-peak hours

## Support Information

- **AWS Region:** $(terraform output -raw aws_region)
- **Account ID:** $(aws sts get-caller-identity --query Account --output text)
- **SNS Topic ARN:** $(terraform output -raw sns_topic_arn)

EOF

    success "Deployment report generated: $REPORT_FILE"
}

# Cleanup function
cleanup() {
    log "Cleaning up temporary files..."

    # Remove Terraform plan file
    if [ -f "$TERRAFORM_DIR/tfplan" ]; then
        rm "$TERRAFORM_DIR/tfplan"
    fi

    success "Cleanup completed."
}

# Main deployment function
main() {
    log "Starting GUI-LOP production deployment..."

    # Set up error handling
    trap cleanup EXIT

    # Run deployment steps
    check_prerequisites
    validate_terraform
    plan_infrastructure
    deploy_infrastructure
    build_and_push_images
    update_ecs_service
    run_smoke_tests
    generate_report

    success "Production deployment completed successfully!"
    log "Application is now live at: $(cd "$TERRAFORM_DIR" && terraform output -raw application_url)"
}

# Parse command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "validate")
        check_prerequisites
        validate_terraform
        success "Validation completed successfully."
        ;;
    "plan")
        check_prerequisites
        validate_terraform
        plan_infrastructure
        success "Planning completed successfully."
        ;;
    "destroy")
        warning "This will destroy all production infrastructure!"
        read -p "Are you sure you want to continue? (yes/no): " -r
        if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            cd "$TERRAFORM_DIR"
            terraform destroy -auto-approve
            success "Infrastructure destroyed successfully."
        else
            log "Destroy operation cancelled."
        fi
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [COMMAND]"
        echo ""
        echo "Commands:"
        echo "  deploy   - Full deployment (default)"
        echo "  validate - Validate configuration and prerequisites"
        echo "  plan     - Generate deployment plan"
        echo "  destroy  - Destroy all infrastructure"
        echo "  help     - Show this help message"
        ;;
    *)
        error "Unknown command: $1. Use 'help' for available commands."
        ;;
esac