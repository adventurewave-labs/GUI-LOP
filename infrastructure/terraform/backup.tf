# Backup Configuration

# Cross-Region Backup for RDS
resource "aws_db_snapshot_copy" "cross_region" {
  count                  = var.cross_region_backup ? 1 : 0
  source_db_snapshot_arn = aws_db_instance.main.latest_restorable_time
  source_region          = var.aws_region
  target_region          = var.backup_region

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-cross-region-backup"
    Type = "CrossRegionBackup"
  })
}

# Backup Vault
resource "aws_backup_vault" "main" {
  name = "${local.name_prefix}-backup-vault"

  encryption_key_arn = aws_kms_key.backup.arn

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-backup-vault"
  })
}

# KMS Key for Backup Encryption
resource "aws_kms_key" "backup" {
  description             = "KMS key for backup encryption"
  deletion_window_in_days = 7

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow backup service to use the key"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*"
        ]
        Resource = "*"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_kms_alias" "backup" {
  name          = "alias/${local.name_prefix}-backup"
  target_key_id = aws_kms_key.backup.key_id
}

# Backup Plan for RDS
resource "aws_backup_plan" "rds" {
  name = "${local.name_prefix}-rds-backup-plan"

  rule {
    name              = "daily-backups"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 * * ? *)"

    lifecycle {
      delete_after = var.backup_retention_days
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "Daily"
    })
  }

  rule {
    name              = "weekly-backups"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 2 ? * SUN *)"

    lifecycle {
      delete_after = var.backup_retention_days * 4 # Weekly backups kept longer
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "Weekly"
    })
  }

  rule {
    name              = "monthly-backups"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 1 1 * ? *)"

    lifecycle {
      delete_after = var.backup_retention_days * 12 # Monthly backups kept longest
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "Monthly"
    })
  }

  tags = local.common_tags
}

# Backup Selection for RDS
resource "aws_backup_selection" "rds" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${local.name_prefix}-rds-selection"
  plan_id      = aws_backup_plan.rds.id

  resources = [
    aws_db_instance.main.arn,
  ]

  selection_tag {
    type  = "STRING_EQUALS"
    key   = "Backup"
    value = "Enabled"
  }
}

# Backup Plan for S3
resource "aws_backup_plan" "s3" {
  name = "${local.name_prefix}-s3-backup-plan"

  rule {
    name              = "daily-s3-backups"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 4 * * ? *)"

    lifecycle {
      delete_after = 30
    }

    recovery_point_tags = merge(local.common_tags, {
      BackupType = "S3-Daily"
    })
  }

  tags = local.common_tags
}

# Backup Selection for S3
resource "aws_backup_selection" "s3" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${local.name_prefix}-s3-selection"
  plan_id      = aws_backup_plan.s3.id

  resources = [
    aws_s3_bucket.static_assets.arn,
    aws_s3_bucket.user_uploads.arn,
  ]

  selection_tag {
    type  = "STRING_EQUALS"
    key   = "Backup"
    value = "Enabled"
  }
}

# IAM Role for Backup
resource "aws_iam_role" "backup" {
  name = "${local.name_prefix}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "backup_service" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

# Disaster Recovery - Cross-Region Infrastructure

# Secondary VPC for Disaster Recovery
resource "aws_vpc" "dr" {
  count             = var.cross_region_backup ? 1 : 0
  provider          = aws.backup
  cidr_block        = "10.1.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-vpc"
    Type = "DisasterRecovery"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# DR Subnets
resource "aws_subnet" "dr_public" {
  count             = var.cross_region_backup ? 3 : 0
  provider          = aws.backup
  vpc_id            = aws_vpc.dr[0].id
  cidr_block        = "10.1.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.backup.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-public-${count.index + 1}"
    Type = "DR-Public"
  })
}

resource "aws_subnet" "dr_private" {
  count             = var.cross_region_backup ? 3 : 0
  provider          = aws.backup
  vpc_id            = aws_vpc.dr[0].id
  cidr_block        = "10.1.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.backup.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-private-${count.index + 1}"
    Type = "DR-Private"
  })
}

# DR RDS Instance (Read Replica promoted in disaster)
resource "aws_db_instance" "dr" {
  count             = var.cross_region_backup ? 1 : 0
  provider          = aws.backup
  identifier        = "${local.name_prefix}-dr-db"
  instance_class    = var.db_instance_class

  engine         = "postgres"
  engine_version = "15.4"

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  port = 5432

  vpc_security_group_ids = [aws_security_group.dr_rds[0].id]
  db_subnet_group_name   = aws_db_subnet_group.dr[0].name

  backup_retention_period = var.backup_retention_days
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  skip_final_snapshot = true
  delete_automated_backups = false

  performance_insights_enabled = false # Disabled in DR to save costs
  monitoring_interval = 0

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-database"
    Type = "DisasterRecovery"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# DR Database Subnet Group
resource "aws_db_subnet_group" "dr" {
  count     = var.cross_region_backup ? 1 : 0
  provider  = aws.backup
  name      = "${local.name_prefix}-dr-db-subnet-group"
  subnet_ids = aws_subnet.dr_private[*].id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-db-subnet-group"
    Type = "DisasterRecovery"
  })
}

# DR Security Groups
resource "aws_security_group" "dr_rds" {
  count     = var.cross_region_backup ? 1 : 0
  provider  = aws.backup
  name      = "${local.name_prefix}-dr-rds-sg"
  vpc_id    = aws_vpc.dr[0].id

  ingress {
    description = "PostgreSQL from DR private subnets"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.1.10.0/24", "10.1.20.0/24", "10.1.30.0/24"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-dr-rds-sg"
    Type = "DisasterRecovery"
  })
}

# Data source for backup region availability zones
data "aws_availability_zones" "backup" {
  count    = var.cross_region_backup ? 1 : 0
  provider = aws.backup
  state    = "available"
}

# AWS Provider for backup region
provider "aws" {
  alias  = "backup"
  region = var.backup_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = "${var.environment}-dr"
      ManagedBy   = "Terraform"
      Team        = "Platform"
      Type        = "DisasterRecovery"
    }
  }
}

# S3 Cross-Region Replication
resource "aws_s3_bucket" "backup_static_assets" {
  count  = var.cross_region_backup ? 1 : 0
  provider = aws.backup
  bucket = "${local.name_prefix}-static-assets-backup"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-static-assets-backup"
    Type = "DisasterRecovery"
  })
}

resource "aws_s3_bucket_versioning" "backup_static_assets" {
  count  = var.cross_region_backup ? 1 : 0
  provider = aws.backup
  bucket = aws_s3_bucket.backup_static_assets[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_replication_configuration" "static_assets" {
  count  = var.cross_region_backup ? 1 : 0
  role   = aws_iam_role.s3_replication.arn
  bucket = aws_s3_bucket.static_assets.id

  rule {
    id = "backup-replication"
    priority = 1

    filter {
      prefix = ""
    }

    destination {
      bucket = aws_s3_bucket.backup_static_assets[0].arn
      storage_class = "STANDARD_IA"

      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }
    }

    delete_marker_replication {
      status = "Enabled"
    }
  }
}

# IAM Role for S3 Replication
resource "aws_iam_role" "s3_replication" {
  name = "${local.name_prefix}-s3-replication-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "s3_replication" {
  name = "${local.name_prefix}-s3-replication-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = [
          aws_s3_bucket.static_assets.arn,
          "${aws_s3_bucket.static_assets.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:List*",
          "s3:GetBucketVersioning",
          "s3:PutBucketVersioning"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetObjectAcl",
          "s3:GetObjectTagging",
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:PutObjectTagging",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion"
        ]
        Resource = [
          aws_s3_bucket.backup_static_assets[0].arn,
          "${aws_s3_bucket.backup_static_assets[0].arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_replication" {
  role       = aws_iam_role.s3_replication.name
  policy_arn = aws_iam_policy.s3_replication.arn
}