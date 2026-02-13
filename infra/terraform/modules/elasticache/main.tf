# --------------------------------------------------------------------------
# ElastiCache Module — Redis 7 Cluster
# --------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name       = "smartbeak-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Environment = var.environment
  }
}

resource "aws_security_group" "redis" {
  name_prefix = "smartbeak-${var.environment}-redis-"
  description = "Security group for SmartBeak ElastiCache Redis"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from EKS nodes"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.eks_node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "smartbeak-${var.environment}-redis"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "smartbeak-${var.environment}"
  description          = "SmartBeak Redis cluster for ${var.environment}"

  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_clusters
  port                 = 6379

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  automatic_failover_enabled = var.automatic_failover
  multi_az_enabled           = var.automatic_failover

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  snapshot_retention_limit = var.environment == "production" ? 7 : 1
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"

  apply_immediately = var.environment != "production"

  tags = {
    Name        = "smartbeak-${var.environment}"
    Environment = var.environment
  }
}
