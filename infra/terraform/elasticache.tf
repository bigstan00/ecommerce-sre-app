resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project_name}-cache-subnets"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_security_group" "elasticache" {
  name        = "${var.project_name}-elasticache"
  description = "Allows Redis access from the Kubernetes cluster nodes only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-elasticache-sg"
  }
}

resource "aws_security_group_rule" "elasticache_from_cluster" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.elasticache.id
  source_security_group_id = aws_security_group.cluster.id
  description              = "Redis from Kubernetes nodes"
}

# Single node, no AUTH token, no in-transit encryption — a deliberate
# simplification worth being honest about, not an oversight. RDS above
# gets AWS-managed credentials essentially for free (one config line);
# ElastiCache doesn't have that same automatic-secrets-management
# feature, so adding a Redis AUTH token here means generating and
# tracking a plaintext secret ourselves. For a cache that's already
# unreachable from anywhere except the cluster's own nodes (enforced by
# the security group above, not by anything at the application layer),
# network isolation is doing the real security work here — the
# incremental benefit of also adding AUTH is small relative to the
# extra secret-handling complexity it adds to every service that
# connects to it. A real production setup handling sensitive data would
# still add it (defense in depth), but this is a reasonable, explicit
# trade-off for a learning cluster.
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.project_name}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.elasticache.id]

  tags = {
    Name = "${var.project_name}-redis"
  }
}
