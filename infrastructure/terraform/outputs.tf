output "vpc_id" {
  description = "The ID of the VPC"
  value       = aws_vpc.main.id
}

output "vpc_cidr_block" {
  description = "The CIDR block of the VPC"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "List of public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "database_subnet_ids" {
  description = "List of database subnet IDs"
  value       = aws_subnet.database[*].id
}

output "ecs_cluster_id" {
  description = "The ID of the ECS cluster"
  value       = aws_ecs_cluster.main.id
}

output "ecs_cluster_name" {
  description = "The name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "The name of the ECS service"
  value       = aws_ecs_service.app.name
}

output "load_balancer_dns_name" {
  description = "The DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "load_balancer_zone_id" {
  description = "The zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "database_endpoint" {
  description = "The endpoint of the RDS database"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "database_port" {
  description = "The port of the RDS database"
  value       = aws_db_instance.main.port
}

output "database_name" {
  description = "The name of the database"
  value       = aws_db_instance.main.db_name
}

output "redis_endpoint" {
  description = "The endpoint of the Redis cluster"
  value       = aws_elasticache_replication_group.primary_endpoint_address
  sensitive   = true
}

output "redis_port" {
  description = "The port of the Redis cluster"
  value       = aws_elasticache_replication_group.port
}

output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.main.id
}

output "cloudfront_distribution_domain_name" {
  description = "The domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "static_assets_bucket_name" {
  description = "The name of the S3 bucket for static assets"
  value       = aws_s3_bucket.static_assets.id
}

output "user_uploads_bucket_name" {
  description = "The name of the S3 bucket for user uploads"
  value       = aws_s3_bucket.user_uploads.id
}

output "sns_topic_arn" {
  description = "The ARN of the SNS topic for alerts"
  value       = aws_sns_topic.alerts.arn
}

output "cloudwatch_dashboard_url" {
  description = "The URL of the CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

# Security Group Outputs
output "alb_security_group_id" {
  description = "The ID of the ALB security group"
  value       = aws_security_group.alb.id
}

output "ecs_tasks_security_group_id" {
  description = "The ID of the ECS tasks security group"
  value       = aws_security_group.ecs_tasks.id
}

output "rds_security_group_id" {
  description = "The ID of the RDS security group"
  value       = aws_security_group.rds.id
}

output "elasticache_security_group_id" {
  description = "The ID of the ElastiCache security group"
  value       = aws_security_group.elasticache.id
}

# Secrets Manager Outputs
output "database_password_secret_arn" {
  description = "The ARN of the database password secret"
  value       = aws_secretsmanager_secret.db_password.arn
  sensitive   = true
}

output "database_url_secret_arn" {
  description = "The ARN of the database URL secret"
  value       = aws_secretsmanager_secret.database_url.arn
  sensitive   = true
}

output "redis_auth_token_secret_arn" {
  description = "The ARN of the Redis auth token secret"
  value       = aws_secretsmanager_secret.redis_auth_token.arn
  sensitive   = true
}

output "redis_url_secret_arn" {
  description = "The ARN of the Redis URL secret"
  value       = aws_secretsmanager_secret.redis_url.arn
  sensitive   = true
}

output "jwt_secret_arn" {
  description = "The ARN of the JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
  sensitive   = true
}

output "app_secrets_arn" {
  description = "The ARN of the application secrets"
  value       = aws_secretsmanager_secret.app_secrets.arn
  sensitive   = true
}

# IAM Role Outputs
output "ecs_task_role_arn" {
  description = "The ARN of the ECS task role"
  value       = aws_iam_role.ecs_task_role.arn
}

output "ecs_execution_role_arn" {
  description = "The ARN of the ECS execution role"
  value       = aws_iam_role.ecs_execution_role.arn
}

# Auto Scaling Outputs
output "auto_scaling_target_arn" {
  description = "The ARN of the auto scaling target"
  value       = aws_appautoscaling_target.ecs_target.arn
}

# WAF Outputs
output "waf_web_acl_arn" {
  description = "The ARN of the WAF Web ACL"
  value       = aws_wafv2_web_acl.main.arn
}

# Route 53 Outputs (if using Route 53)
output "route53_zone_id" {
  description = "The ID of the Route 53 hosted zone"
  value       = var.cloudflare_zone_id
}

# Application URLs
output "application_url" {
  description = "The URL of the application"
  value       = "https://${var.domain_name}"
}

output "api_url" {
  description = "The URL of the API"
  value       = "https://api.${var.domain_name}"
}