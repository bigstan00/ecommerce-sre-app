# One security group, shared by every node in the cluster (control plane +
# workers). This is a deliberate simplification for a learning cluster —
# real production usually splits this into a control-plane SG and a
# worker SG with only the exact ports each role needs open between them
# (6443 for the API server, 2379-2380 for etcd, 10250 for kubelet, etc.).
# Enumerating every one of those individually is where most of the real
# debugging pain in a from-scratch kubeadm cluster comes from — worth
# doing later as a hardening exercise once the basics actually work.
resource "aws_security_group" "cluster" {
  name        = "${var.project_name}-cluster"
  description = "Shared SG for all Kubernetes nodes"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-cluster-sg"
  }
}

# Anything inside the cluster can talk to anything else inside the
# cluster, on any port. This is what a real production setup would NOT
# do — it's the difference between "trust the whole internal network" and
# "trust only these specific ports." We're accepting that trade-off here
# to get a working cluster faster; it's a named simplification, not an
# oversight.
resource "aws_security_group_rule" "cluster_internal" {
  type              = "ingress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.cluster.id
  self              = true
}

# SSH — locked to your IP only. This is the one rule that must never be
# widened to 0.0.0.0/0.
resource "aws_security_group_rule" "ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  security_group_id = aws_security_group.cluster.id
  cidr_blocks       = [var.allowed_admin_cidr]
  description       = "SSH from admin IP only"
}

# Kubernetes API server — also locked to your IP, so you can run kubectl
# straight from your laptop once the cluster exists, without it being
# reachable by anyone else.
resource "aws_security_group_rule" "kube_api" {
  type              = "ingress"
  from_port         = 6443
  to_port           = 6443
  protocol          = "tcp"
  security_group_id = aws_security_group.cluster.id
  cidr_blocks       = [var.allowed_admin_cidr]
  description       = "Kubernetes API server from admin IP only"
}

# NodePort range — deliberately open to the whole internet, so a service
# exposed via NodePort is actually reachable for testing (e.g. hitting the
# storefront from a browser). This is the other rule that's NOT
# production-shaped: a real setup would front NodePort/ClusterIP services
# with a proper Load Balancer or Ingress instead of exposing the node port
# range directly — that's exactly what we build in a later phase.
resource "aws_security_group_rule" "nodeport" {
  type              = "ingress"
  from_port         = 30000
  to_port           = 32767
  protocol          = "tcp"
  security_group_id = aws_security_group.cluster.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "NodePort range, open for now (replace with Ingress or LB later)"
}

# Standard: nodes can initiate any outbound connection (pulling container
# images, talking to AWS APIs, etc.).
resource "aws_security_group_rule" "egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.cluster.id
  cidr_blocks       = ["0.0.0.0/0"]
}
