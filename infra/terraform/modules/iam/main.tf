# --------------------------------------------------------------------------
# IAM Module — IRSA Roles + GitHub Actions OIDC
# --------------------------------------------------------------------------

# ---- IRSA: API Service Account ----

module "api_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "smartbeak-${var.environment}-api"

  oidc_providers = {
    main = {
      provider_arn               = var.oidc_provider_arn
      namespace_service_accounts = ["smartbeak-${var.environment}:smartbeak-api"]
    }
  }

  role_policy_arns = {
    ses     = aws_iam_policy.ses_send.arn
    s3      = aws_iam_policy.s3_access.arn
    secrets = aws_iam_policy.secrets_read.arn
  }

  tags = {
    Environment = var.environment
  }
}

# ---- IRSA: Worker Service Account ----

module "worker_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "smartbeak-${var.environment}-worker"

  oidc_providers = {
    main = {
      provider_arn               = var.oidc_provider_arn
      namespace_service_accounts = ["smartbeak-${var.environment}:smartbeak-worker"]
    }
  }

  role_policy_arns = {
    ses     = aws_iam_policy.ses_send.arn
    s3      = aws_iam_policy.s3_access.arn
    secrets = aws_iam_policy.secrets_read.arn
  }

  tags = {
    Environment = var.environment
  }
}

# ---- Shared IAM Policies ----

resource "aws_iam_policy" "ses_send" {
  name        = "smartbeak-${var.environment}-ses-send"
  description = "Allow sending emails via SES"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ]
      Resource = "*"
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_policy" "s3_access" {
  name        = "smartbeak-${var.environment}-s3-access"
  description = "Allow read/write to SmartBeak media storage"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ]
      Resource = [
        "arn:aws:s3:::smartbeak-shards-${var.environment}",
        "arn:aws:s3:::smartbeak-shards-${var.environment}/*"
      ]
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_policy" "secrets_read" {
  name        = "smartbeak-${var.environment}-secrets-read"
  description = "Allow reading secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:smartbeak/${var.environment}/*"
    }]
  })

  tags = {
    Environment = var.environment
  }
}

data "aws_caller_identity" "current" {}

# ---- GitHub Actions OIDC Provider ----

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    Environment = var.environment
  }
}

locals {
  github_oidc_arn = var.create_github_oidc ? aws_iam_openid_connect_provider.github[0].arn : var.github_oidc_provider_arn
}

# ---- GitHub Actions: ECR Push Role ----

resource "aws_iam_role" "github_ecr" {
  name = "smartbeak-${var.environment}-github-ecr"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
        }
      }
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "github_ecr" {
  name = "ecr-push"
  role = aws_iam_role.github_ecr.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/smartbeak/*"
      }
    ]
  })
}

# ---- GitHub Actions: Deploy Role ----

resource "aws_iam_role" "github_deploy" {
  name = "smartbeak-${var.environment}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:*"
        }
      }
    }]
  })

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "eks-deploy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster",
          "eks:ListClusters"
        ]
        Resource = "arn:aws:eks:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cluster/smartbeak-${var.environment}"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer"
        ]
        Resource = "arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/smartbeak/*"
      }
    ]
  })
}
