# --------------------------------------------------------------------------
# Production Environment — Composes all infrastructure modules (HA config)
# --------------------------------------------------------------------------

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "smartbeak"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "github_repo" {
  description = "GitHub repository in org/repo format"
  type        = string
}

locals {
  environment  = "production"
  cluster_name = "smartbeak-production"
}

# ---- Networking ----

module "networking" {
  source = "../../modules/networking"

  environment        = local.environment
  vpc_cidr           = "10.1.0.0/16"
  cluster_name       = local.cluster_name
  single_nat_gateway = false # One NAT per AZ for HA
}

# ---- EKS ----

module "eks" {
  source = "../../modules/eks"

  environment         = local.environment
  cluster_name        = local.cluster_name
  cluster_version     = "1.29"
  vpc_id              = module.networking.vpc_id
  private_subnet_ids  = module.networking.private_subnet_ids
  node_instance_types = ["m5.large"]
  node_min_size       = 3
  node_max_size       = 10
  node_desired_size   = 3
}

# ---- RDS (PostgreSQL 15) — HA config ----

module "rds" {
  source = "../../modules/rds"

  environment                = local.environment
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  eks_node_security_group_id = module.eks.node_security_group_id
  instance_class             = "db.r6g.large"
  allocated_storage          = 50
  max_allocated_storage      = 500
  multi_az                   = true
  backup_retention_period    = 35
  deletion_protection        = true
}

# ---- ElastiCache (Redis 7) — HA config ----

module "elasticache" {
  source = "../../modules/elasticache"

  environment                = local.environment
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  eks_node_security_group_id = module.eks.node_security_group_id
  node_type                  = "cache.r6g.large"
  num_cache_clusters         = 3
  automatic_failover         = true
}

# ---- ECR ----

module "ecr" {
  source = "../../modules/ecr"

  environment = local.environment
}

# ---- IAM ----

module "iam" {
  source = "../../modules/iam"

  environment             = local.environment
  aws_region              = var.aws_region
  oidc_provider_arn       = module.eks.oidc_provider_arn
  github_repo             = var.github_repo
  create_github_oidc      = false # Reuse provider created in staging
  github_oidc_provider_arn = var.github_oidc_provider_arn
}

variable "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider (created in staging)"
  type        = string
}

# ---- Outputs ----

output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "redis_endpoint" {
  value = module.elasticache.primary_endpoint
}

output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "github_ecr_role_arn" {
  value = module.iam.github_ecr_role_arn
}

output "github_deploy_role_arn" {
  value = module.iam.github_deploy_role_arn
}
