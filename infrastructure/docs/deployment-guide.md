# GUI-LOP Production Deployment Guide

## Overview
This guide provides comprehensive instructions for deploying the GUI-LOP platform to production infrastructure using Infrastructure as Code (IaC) with Terraform.

## Prerequisites

### Required Tools
- **Terraform** (v1.5.0+)
- **AWS CLI** (v2.0+)
- **Node.js** (v18+)
- **Docker** (v20.0+)
- **Git**
- **jq** (for JSON parsing)

### Required AWS Permissions
The deploying user/role must have the following permissions:
- **EC2**: Full access for instances, security groups, and networking
- **ECS**: Full access for clusters, services, and task definitions
- **RDS**: Full access for database instances and snapshots
- **ElastiCache**: Full access for Redis clusters
- **S3**: Full access for buckets and objects
- **CloudFront**: Full access for distributions
- **Route 53**: Full access for DNS records
- **IAM**: Full access for roles and policies
- **CloudWatch**: Full access for monitoring and alarms
- **Secrets Manager**: Full access for secrets
- **ACM**: Full access for SSL certificates

### Required External Services
- **CloudFlare account** with API access
- **Domain name** registered and pointing to CloudFlare
- **SSL certificate** (can be managed via AWS ACM)
- **PagerDuty account** (optional, for critical alerts)
- **Slack workspace** (optional, for notifications)

## Initial Setup

### 1. Configure AWS CLI
```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region (us-east-1)
# Enter default output format (json)
```

### 2. Verify AWS Configuration
```bash
aws sts get-caller-identity
aws configure list
```

### 3. Clone Repository
```bash
git clone https://github.com/your-org/gui-lop.git
cd gui-lop
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Configure Terraform Backend
Create an S3 bucket for Terraform state:
```bash
aws s3 mb s3://gui-lop-terraform-state --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning --bucket gui-lop-terraform-state --versioning-configuration Status=Enabled

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 6. Configure SSL Certificate
Using AWS Certificate Manager:
```bash
# Request certificate (must be in us-east-1 for CloudFront)
aws acm request-certificate \
  --domain-name gui-lop.com \
  --subject-alternative-names www.gui-lop.com api.gui-lop.com \
  --validation-method DNS

# Wait for validation and get certificate ARN
aws acm list-certificates
```

## Configuration

### 1. Terraform Variables
Copy the example configuration and customize it:
```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your specific values:
```hcl
# AWS Configuration
aws_region = "us-east-1"

# Domain Configuration
domain_name = "gui-lop.com"
certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"

# Security Configuration
allowed_ips = ["203.0.113.0/24", "198.51.100.0/24"] # Your office IP ranges
ssh_key_name = "gui-lop-prod"

# CloudFlare Configuration
cloudflare_api_token = "your_cloudflare_api_token_here"
cloudflare_zone_id = "your_cloudflare_zone_id_here"

# Monitoring and Alerting
alert_email = "alerts@gui-lop.com"
pagerduty_service_key = "your_pagerduty_integration_key" # Optional
```

### 2. CloudFlare Configuration
1. Log in to your CloudFlare dashboard
2. Get your Zone ID from the domain overview page
3. Create an API token with Zone:Zone:Read and Zone:DNS:Edit permissions
4. Update the CloudFlare configuration in `terraform.tfvars`

### 3. Environment Variables
Create a `.env.production` file:
```bash
NODE_ENV=production
AWS_REGION=us-east-1
DOMAIN_NAME=gui-lop.com
CLOUDFLARE_API_TOKEN=your_token_here
CLOUDFLARE_ZONE_ID=your_zone_id_here
```

## Deployment Process

### Option 1: Automated Deployment (Recommended)
Use the provided deployment script:
```bash
./infrastructure/scripts/deploy.sh deploy
```

This script will:
1. Validate prerequisites
2. Initialize Terraform
3. Plan infrastructure changes
4. Apply infrastructure changes
5. Build and push Docker images
6. Update ECS services
7. Run smoke tests
8. Generate deployment report

### Option 2: Manual Step-by-Step Deployment

#### Step 1: Initialize Terraform
```bash
cd infrastructure/terraform
terraform init
```

#### Step 2: Plan Infrastructure
```bash
terraform plan -out=tfplan
```

#### Step 3: Review and Apply Infrastructure
```bash
# Review the plan carefully
terraform apply tfplan
```

#### Step 4: Configure DNS
Wait for the load balancer to be created, then configure DNS:
```bash
# Get load balancer DNS name
aws elbv2 describe-load-balancers \
  --names gui-lop-prod-alb \
  --query 'LoadBalancers[0].DNSName' \
  --output text
```

Update your CloudFlare DNS records to point to the load balancer.

#### Step 5: Build and Push Docker Images
```bash
# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(terraform output -raw aws_region)
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Create ECR repository if it doesn't exist
aws ecr create-repository --repository-name gui-lop --region "$AWS_REGION" || true

# Build and push image
docker build -f infrastructure/docker/Dockerfile.production -t gui-lop:latest .
docker tag gui-lop:latest "${ECR_REGISTRY}/gui-lop:latest"
docker push "${ECR_REGISTRY}/gui-lop:latest"
```

#### Step 6: Update ECS Service
```bash
# Force new deployment
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name)
SERVICE_NAME=$(terraform output -raw ecs_service_name)

aws ecs update-service \
  --cluster "$CLUSTER_NAME" \
  --service "$SERVICE_NAME" \
  --force-new-deployment

# Wait for service to stabilize
aws ecs wait services-stable \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME"
```

#### Step 7: Configure Application Secrets
Update secrets in AWS Secrets Manager:
```bash
# Update database URL
aws secretsmanager update-secret \
  --secret-id "gui-lop-prod/database/url" \
  --secret-string "postgresql://username:password@db-endpoint:5432/gui_lop_prod"

# Update other application secrets as needed
```

## Post-Deployment Verification

### 1. Health Checks
```bash
# Wait for DNS propagation
sleep 300

# Check application health
curl -f https://gui-lop.com/health

# Check API health
curl -f https://api.gui-lop.com/health

# Check WebSocket connectivity
wscat -c wss://gui-lop.com/socket.io/?EIO=4&transport=websocket
```

### 2. Smoke Tests
```bash
# Run application smoke tests
npm run test:smoke -- --baseUrl=https://gui-lop.com

# Run API smoke tests
npm run test:api:e2e -- --baseUrl=https://api.gui-lop.com
```

### 3. Performance Tests
```bash
# Run quick load test
npm run test:load:quick

# Run full load test (during maintenance window)
npm run test:load:full
```

### 4. Security Tests
```bash
# Run security scan
npm run test:security:ci

# Check SSL certificate
openssl s_client -connect gui-lop.com:443 -servername gui-lop.com
```

## Monitoring Setup

### 1. CloudWatch Dashboards
Access the CloudWatch dashboard:
```bash
# Get dashboard URL
echo "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=gui-lop-prod-dashboard"
```

### 2. Configure Alerts
Verify alert configurations:
```bash
# Check SNS topic
aws sns list-subscriptions-by-topic --topic-arn "$(terraform output -raw sns_topic_arn)"

# Test alarm
aws cloudwatch set-alarm-state \
  --alarm-name "gui-lop-prod-high-cpu" \
  --state-value ALARM \
  --state-reason "Test alarm"
```

### 3. Configure Slack Notifications (Optional)
1. Create a Slack webhook URL
2. Update the deployment script with your webhook URL
3. Test Slack notifications

## Backup Configuration

### 1. Verify Backup Configuration
```bash
# Check RDS backup retention
aws rds describe-db-instances \
  --db-instance-identifier "$(terraform output -raw db_identifier)" \
  --query 'DBInstances[0].BackupRetentionPeriod'

# Check S3 versioning
aws s3api get-bucket-versioning \
  --bucket "$(terraform output -raw static_assets_bucket_name)"
```

### 2. Run Backup Verification
```bash
./infrastructure/scripts/backup-verify.sh verify
```

## Troubleshooting

### Common Issues

#### 1. Terraform State Lock Issues
```bash
# Unlock Terraform state (be careful!)
terraform force-unlock LOCK_ID
```

#### 2. ECS Service Fails to Start
```bash
# Check service events
aws ecs describe-services \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --services "$(terraform output -raw ecs_service_name)" \
  --query 'services[0].events'

# Check task definition
aws ecs describe-task-definition \
  --task-definition "$(terraform output -raw ecs_task_definition_arn)"
```

#### 3. Database Connection Issues
```bash
# Check database security group
aws ec2 describe-security-groups \
  --group-ids "$(terraform output -raw rds_security_group_id)"

# Test database connectivity from bastion host
ssh -i ~/.ssh/gui-lop-prod.pem ec2-user@<bastion-ip>
psql -h <db-endpoint> -U <username> -d <database>
```

#### 4. SSL Certificate Issues
```bash
# Check certificate status
aws acm describe-certificate \
  --certificate-arn "$(terraform output -raw certificate_arn)"

# Validate certificate
openssl s_client -connect gui-lop.com:443 -servername gui-lop.com
```

### Log Collection

#### Application Logs
```bash
# Get CloudWatch log group
aws logs describe-log-groups --log-group-name-prefix "/aws/ecs/gui-lop"

# Tail application logs
aws logs tail "/aws/ecs/gui-lop-prod/application" --follow
```

#### Infrastructure Logs
```bash
# Load balancer logs
aws s3 ls s3://gui-lop-prod-alb-logs/

# CloudFront logs
aws s3 ls s3://gui-lop-cloudfront-logs/
```

## Maintenance Operations

### 1. Updating Application
```bash
# Build and push new image version
docker build -f infrastructure/docker/Dockerfile.production -t gui-lop:v1.1.0 .
docker tag gui-lop:v1.1.0 "${ECR_REGISTRY}/gui-lop:v1.1.0"
docker push "${ECR_REGISTRY}/gui-lop:v1.1.0"

# Update task definition with new image
# (Modify infrastructure/terraform/ecs.tf and run terraform apply)
```

### 2. Scaling Infrastructure
```bash
# Update auto-scaling limits
# (Modify infrastructure/terraform/variables.tf and run terraform apply)
```

### 3. Database Maintenance
```bash
# Create snapshot before maintenance
aws rds create-db-snapshot \
  --db-instance-identifier "$(terraform output -raw db_identifier)" \
  --db-snapshot-identifier "pre-maintenance-$(date +%Y%m%d-%H%M%S)"

# Apply maintenance during window
aws rds apply-pending-maintenance-action \
  --resource-identifier "$(terraform output -raw db_identifier)" \
  --apply-action system-update \
  --opt-in-type immediate
```

## Rollback Procedures

### 1. Infrastructure Rollback
```bash
# Rollback to previous Terraform state
terraform plan -destroy -out=destroy-plan
terraform apply destroy-plan
# Then apply previous known good state
```

### 2. Application Rollback
```bash
# Get previous task definition
PREVIOUS_TASK_DEF=$(aws ecs list-task-definitions \
  --family gui-lop-prod-app \
  --sort DESC \
  --max-items 2 \
  --query 'taskDefinitionArns[1]' \
  --output text)

# Update service to previous version
aws ecs update-service \
  --cluster "$(terraform output -raw ecs_cluster_name)" \
  --service "$(terraform output -raw ecs_service_name)" \
  --task-definition "$PREVIOUS_TASK_DEF"
```

### 3. Database Rollback
```bash
# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "gui-lop-prod-db-rollback" \
  --db-snapshot-identifier <snapshot-name> \
  --db-instance-class db.r6g.2xlarge

# Wait for restoration and update connection string
```

## Security Best Practices

### 1. Access Control
- Use IAM roles with least privilege
- Rotate access keys regularly
- Enable MFA for all IAM users
- Use AWS SSO for centralized access

### 2. Network Security
- Configure security groups to allow only necessary traffic
- Use VPC endpoints for AWS services
- Enable flow logs for VPC monitoring
- Regularly review security group rules

### 3. Data Protection
- Enable encryption at rest and in transit
- Use customer-managed KMS keys
- Regularly rotate secrets
- Implement data classification policies

## Cost Optimization

### 1. Compute Savings
- Use Compute Savings Plans for predictable workloads
- Consider Spot instances for non-critical workloads
- Right-size instances based on utilization

### 2. Storage Optimization
- Use S3 Intelligent-Tiering
- Implement lifecycle policies
- Regularly clean up old backups and logs

### 3. Network Optimization
- Use CloudFront for static content
- Optimize data transfer patterns
- Consider Direct Connect for high-volume workloads

## Support and Documentation

### Getting Help
- **AWS Support**: 1-877-429-6738
- **CloudFlare Support**: Through dashboard
- **Internal Documentation**: `/infrastructure/docs/`
- **Runbooks**: `/infrastructure/docs/runbooks/`

### Documentation Maintenance
- Update documentation with each infrastructure change
- Review runbooks after each incident
- Keep contact information current
- Regular security reviews

This deployment guide should be kept in sync with the infrastructure code and reviewed quarterly for accuracy and completeness.