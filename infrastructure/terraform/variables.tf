# AWS Region for primary deployment
variable "aws_region" {
  description = "AWS region for primary deployment"
  type        = string
  default     = "us-east-1"
}

# Project configuration
variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "gui-lop"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

# Domain configuration
variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "gui-lop.com"
}

variable "certificate_arn" {
  description = "ARN of SSL certificate"
  type        = string
}

# Networking configuration
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.20.0/24", "10.0.30.0/24"]
}

variable "database_subnet_cidrs" {
  description = "CIDR blocks for database subnets"
  type        = list(string)
  default     = ["10.0.40.0/24", "10.0.50.0/24", "10.0.60.0/24"]
}

# ECS configuration
variable "app_min_capacity" {
  description = "Minimum number of tasks"
  type        = number
  default     = 2
}

variable "app_max_capacity" {
  description = "Maximum number of tasks"
  type        = number
  default     = 50
}

variable "app_target_cpu" {
  description = "Target CPU utilization for auto-scaling"
  type        = number
  default     = 60
}

variable "app_target_memory" {
  description = "Target memory utilization for auto-scaling"
  type        = number
  default     = 70
}

# Database configuration
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.2xlarge"
}

variable "db_allocated_storage" {
  description = "Initial storage allocation for RDS"
  type        = number
  default     = 1000
}

variable "db_max_allocated_storage" {
  description = "Maximum storage allocation for RDS"
  type        = number
  default     = 5000
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "gui_lop_prod"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "gui_lop_admin"
}

# Redis configuration
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.xlarge"
}

variable "redis_num_shards" {
  description = "Number of Redis shards"
  type        = number
  default     = 3
}

# Security configuration
variable "allowed_ips" {
  description = "Allowed IP addresses for SSH access"
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "SSH key pair name"
  type        = string
  default     = "gui-lop-prod"
}

# Monitoring and alerting
variable "alert_email" {
  description = "Email for alerts"
  type        = string
  default     = "alerts@gui-lop.com"
}

variable "pagerduty_service_key" {
  description = "PagerDuty service integration key"
  type        = string
  default     = ""
}

# Cloudflare configuration
variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

# Backup configuration
variable "backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 35
}

variable "cross_region_backup" {
  description = "Enable cross-region backup"
  type        = bool
  default     = true
}

variable "backup_region" {
  description = "Region for cross-region backups"
  type        = string
  default     = "us-west-2"
}