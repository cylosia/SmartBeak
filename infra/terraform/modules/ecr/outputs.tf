output "repository_urls" {
  description = "Map of repository names to their URLs"
  value       = { for name, repo in aws_ecr_repository.repos : name => repo.repository_url }
}

output "registry_id" {
  description = "The registry ID (AWS account ID)"
  value       = values(aws_ecr_repository.repos)[0].registry_id
}
