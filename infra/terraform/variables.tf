variable "aws_region" {
  description = "AWS region the cluster lives in."
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Short name prefixed onto every resource, so everything this project owns is easy to find/filter in the AWS console."
  type        = string
  default     = "k8s-learning"
}

variable "vpc_cidr" {
  description = "IP address range for the whole VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Two subnets in two different Availability Zones — spreading across AZs is what makes a cluster survive a single data-center failure, a real production concern even though we're not doing HA control-plane yet."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "allowed_admin_cidr" {
  description = "Your own IP (as a /32), for SSH and kubectl access. NEVER set this to 0.0.0.0/0 — that would let anyone on the internet attempt to SSH into the nodes."
  type        = string
  # Auto-filled with your public IP at the time this project was set up.
  # IPs change (new network, VPN, ISP rotation) — if SSH or kubectl access
  # stops working later, this is the first thing to check and update.
  default     = "102.88.54.98/32"
}

variable "ssh_public_key_path" {
  description = "Path to the public half of the SSH key pair used to log into the nodes."
  type        = string
  default     = "~/.ssh/k8s-cluster-key.pub"
}
