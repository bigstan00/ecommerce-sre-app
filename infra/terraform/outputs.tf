output "vpc_id" {
  description = "ID of the VPC — you'll want this later for anything created outside this Terraform project that needs to attach to it."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the two public subnets, in AZ order."
  value       = aws_subnet.public[*].id
}

output "security_group_id" {
  description = "ID of the shared cluster security group — referenced by the EC2 instances we'll add in the next phase."
  value       = aws_security_group.cluster.id
}

output "key_pair_name" {
  description = "Name of the SSH key pair registered in AWS — referenced by the EC2 instances we'll add next."
  value       = aws_key_pair.cluster.key_name
}

output "control_plane_public_ip" {
  description = "Static (Elastic IP) public address of the control-plane node — SSH here, this is also what kubeadm init/join will reference."
  value       = aws_eip.control_plane.public_ip
}

output "control_plane_private_ip" {
  description = "Private IP of the control-plane node, inside the VPC — used for internal cluster traffic (kubelets talking to the API server, etc.), not for SSH from your laptop."
  value       = aws_instance.control_plane.private_ip
}

output "worker_public_ips" {
  description = "Public IPs of the worker nodes — SSH here. NOT static like the control plane's; if you stop/restart a worker its public IP will change (fine, workers are disposable — you just re-run kubeadm join with the new address if needed for anything referencing it directly)."
  value       = aws_instance.worker[*].public_ip
}

output "worker_private_ips" {
  description = "Private IPs of the worker nodes, inside the VPC."
  value       = aws_instance.worker[*].private_ip
}

output "rds_endpoint" {
  description = "Postgres connection endpoint (host:port) — services running in the cluster connect here. The actual password is managed by AWS Secrets Manager, not exposed as a Terraform output."
  value       = aws_db_instance.postgres.endpoint
}

output "rds_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the auto-generated Postgres master password — fetch the actual value with `aws secretsmanager get-secret-value` when wiring it into a Kubernetes Secret."
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
}

output "redis_endpoint" {
  description = "Redis connection endpoint — services running in the cluster connect here. No AUTH token (see elasticache.tf for why); access is restricted purely by security group."
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
}
