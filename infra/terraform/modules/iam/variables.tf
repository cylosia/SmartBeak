variable "environment" {
  description = "Environment name (staging, production)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "oidc_provider_arn" {
  description = "ARN of the EKS OIDC provider for IRSA"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository in org/repo format"
  type        = string
}

variable "create_github_oidc" {
  description = "Whether to create the GitHub OIDC provider (only needed once per account)"
  type        = bool
  default     = false
}

variable "github_oidc_provider_arn" {
  description = "ARN of existing GitHub OIDC provider (if create_github_oidc is false)"
  type        = string
  default     = ""
}
