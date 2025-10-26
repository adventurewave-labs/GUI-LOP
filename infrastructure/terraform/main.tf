terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket = "gui-lop-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"

    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "GUI-LOP"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Team        = "Platform"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# Local values for commonly used configurations
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
    Team        = "Platform"
    CostCenter  = "Engineering"
  }

  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}