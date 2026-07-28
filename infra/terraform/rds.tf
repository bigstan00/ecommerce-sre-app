# RDS needs to know which subnets it's allowed to place its network
# interface in. Reusing the same public subnets the cluster nodes live
# in (not spinning up dedicated private subnets for this) — the database
# itself is NOT internet-reachable regardless of which subnet it's in,
# because `publicly_accessible = false` below is the setting that
# actually controls that, not subnet choice.
resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnets"
  subnet_ids = aws_subnet.public[*].id

  tags = {
    Name = "${var.project_name}-db-subnets"
  }
}

# A dedicated security group for the database tier, allowing Postgres
# (5432) ONLY from the cluster's own security group — not from any CIDR
# block. This is the idiomatic way to say "only my Kubernetes nodes can
# reach this," rather than trying to enumerate their IPs (which can
# change).
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds"
  description = "Allows Postgres access from the Kubernetes cluster nodes only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-rds-sg"
  }
}

resource "aws_security_group_rule" "rds_from_cluster" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.cluster.id
  description              = "Postgres from Kubernetes nodes"
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro" # smallest ARM-based tier — cheapest option that isn't the free-tier-only db.t3.micro

  allocated_storage = 20
  storage_type      = "gp3"

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # the actual control that keeps this off the internet, regardless of subnet

  db_name  = "ecommerce"
  username = "app_admin"

  # AWS generates and rotates the master password automatically via
  # Secrets Manager — Terraform (and its state file) never sees the
  # plaintext value at all. This is the current best-practice approach,
  # specifically avoiding the older pattern of generating a password
  # yourself and having it sit in plaintext in .tfstate forever.
  manage_master_user_password = true

  # Single-AZ, no read replica, minimal backup retention — deliberate
  # cost/simplicity choices for a learning cluster. Production would use
  # Multi-AZ for automatic failover and a longer retention window.
  multi_az                = false
  backup_retention_period = 1
  skip_final_snapshot     = true # so `terraform destroy` doesn't hang waiting for a manual snapshot decision

  tags = {
    Name = "${var.project_name}-postgres"
  }
}
