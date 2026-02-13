output "api_role_arn" {
  description = "IAM role ARN for the API service account"
  value       = module.api_irsa.iam_role_arn
}

output "worker_role_arn" {
  description = "IAM role ARN for the worker service account"
  value       = module.worker_irsa.iam_role_arn
}

output "github_ecr_role_arn" {
  description = "IAM role ARN for GitHub Actions ECR push"
  value       = aws_iam_role.github_ecr.arn
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions deployment"
  value       = aws_iam_role.github_deploy.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider"
  value       = local.github_oidc_arn
}
