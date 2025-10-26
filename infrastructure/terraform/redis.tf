# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-cache-subnet-group"
  subnet_ids = aws_subnet.database[*].id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cache-subnet-group"
  })
}

# ElastiCache Parameter Group
resource "aws_elasticache_parameter_group" "main" {
  family = "redis7.x"
  name   = "${local.name_prefix}-redis-parameter-group"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  parameter {
    name  = "timeout"
    value = "300"
  }

  tags = local.common_tags
}

# ElastiCache Replication Group
resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "${local.name_prefix}-redis"
  description                = "Redis cluster for GUI-LOP"

  node_type                  = var.redis_node_type
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.main.name

  automatic_failover_enabled = true
  multi_az_enabled           = true
  num_cache_clusters         = var.redis_num_shards

  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.elasticache.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth_token.result

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  auto_minor_version_upgrade = true

  snapshot_retention_limit   = 7
  snapshot_window           = "06:30-07:30"

  maintenance_window        = "sun:07:00-sun:08:00"

  apply_immediately         = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis-cluster"
  })
}

# Random auth token for Redis
resource "random_password" "redis_auth_token" {
  length  = 64
  special = false
}

# Store Redis auth token in Secrets Manager
resource "aws_secretsmanager_secret" "redis_auth_token" {
  name = "${local.name_prefix}/redis/auth-token"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_auth_token" {
  secret_id = aws_secretsmanager_secret.redis_auth_token.id
  secret_string = random_password.redis_auth_token.result
}

# Redis URL secret
resource "aws_secretsmanager_secret" "redis_url" {
  name = "${local.name_prefix}/redis/url"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://:${random_password.redis_auth_token.result}@${aws_elasticache_replication_group.primary_endpoint_address}:${aws_elasticache_replication_group.port}/0"
}

# CloudWatch Log Group for Redis
resource "aws_cloudwatch_log_group" "redis_slow" {
  name              = "/aws/elasticache/redis/${local.name_prefix}/slow"
  retention_in_days = 14

  tags = local.common_tags
}