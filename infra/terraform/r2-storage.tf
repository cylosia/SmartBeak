# Terraform configuration for Cloudflare R2 Storage
# Alternative: Can be adapted for AWS S3, Google Cloud Storage, or MinIO

# Variables
variable "r2_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "r2_access_key_id" {
  description = "R2 Access Key ID"
  type        = string
  sensitive   = true
}

variable "r2_secret_access_key" {
  description = "R2 Secret Access Key"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment (production, staging, development)"
  type        = string
  default     = "production"
}

variable "cors_allowed_origins" {
  description = "Allowed origins for CORS (restrict to known domains in production)"
  type        = list(string)
  default     = ["https://app.smartbeak.com", "https://staging-app.smartbeak.com"]
}

# Locals
locals {
  bucket_name = "smartbeak-shards-${var.environment}"
}

# Configure AWS provider for R2 (S3-compatible)
provider "aws" {
  alias      = "r2"
  region     = "auto"
  access_key = var.r2_access_key_id
  secret_key = var.r2_secret_access_key

  # Required for R2 compatibility
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3 = "https://${var.r2_account_id}.r2.cloudflarestorage.com"
  }
}

# Create the main shards bucket
resource "aws_s3_bucket" "shards" {
  provider = aws.r2
  bucket   = local.bucket_name
}

# Enable versioning for rollback capability
resource "aws_s3_bucket_versioning" "shards_versioning" {
  provider = aws.r2
  bucket   = aws_s3_bucket.shards.id

  versioning_configuration {
    status = "Enabled"
  }
}

# CORS configuration
resource "aws_s3_bucket_cors_configuration" "shards_cors" {
  provider = aws.r2
  bucket   = aws_s3_bucket.shards.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag", "Content-Length"]
    max_age_seconds = 3600
  }
}

# Lifecycle rules for old versions
resource "aws_s3_bucket_lifecycle_configuration" "shards_lifecycle" {
  provider = aws.r2
  bucket   = aws_s3_bucket.shards.id

  rule {
    id     = "cleanup-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Bucket policy
resource "aws_s3_bucket_policy" "shards_policy" {
  provider = aws.r2
  bucket   = aws_s3_bucket.shards.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureConnections"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.shards.arn,
          "${aws_s3_bucket.shards.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# Public access block (private bucket)
resource "aws_s3_bucket_public_access_block" "shards_public_access" {
  provider = aws.r2
  bucket   = aws_s3_bucket.shards.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Outputs
output "bucket_name" {
  description = "Name of the created R2 bucket"
  value       = aws_s3_bucket.shards.bucket
}

output "bucket_endpoint" {
  description = "R2 bucket endpoint URL"
  value       = "https://${var.r2_account_id}.r2.cloudflarestorage.com"
}

output "bucket_arn" {
  description = "ARN of the R2 bucket"
  value       = aws_s3_bucket.shards.arn
}
