# --------------------------------------------------------------------------
# RDS Module — PostgreSQL 15 Managed Database
# --------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "smartbeak-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "smartbeak-${var.environment}-db-subnet"
    Environment = var.environment
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "smartbeak-${var.environment}-rds-"
  description = "Security group for SmartBeak RDS instance"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS nodes"
    from_port       = 5432
    to_port         = 5432
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
    Name        = "smartbeak-${var.environment}-rds"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_kms_key" "rds" {
  description             = "RDS encryption key for smartbeak-${var.environment}"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Environment = var.environment
  }
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "smartbeak-${var.environment}-pg15-"
  family      = "postgres15"
  description = "SmartBeak PostgreSQL 15 parameter group"

  parameter {
    name  = "statement_timeout"
    value = "30000"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier = "smartbeak-${var.environment}"

  engine         = "postgres"
  engine_version = "15"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  db_name  = "smartbeak"
  username = "smartbeak"

  manage_master_user_password = true

  multi_az            = var.multi_az
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period = var.backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "smartbeak-production-final" : null

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn

  tags = {
    Name        = "smartbeak-${var.environment}"
    Environment = var.environment
  }
}
