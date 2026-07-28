# The EBS CSI driver runs as pods on the cluster's own nodes and needs
# AWS API access to create/attach/detach/delete EBS volumes on this
# cluster's behalf. On EKS this comes for free via IRSA (IAM Roles for
# Service Accounts, which needs an OIDC provider wired into the
# cluster) — on a self-managed cluster the simplest real equivalent is
# granting the permission directly to the EC2 instance itself via an
# instance profile. Pods on the node pick these permissions up
# automatically through the node's own instance metadata service, no
# extra plumbing required. Simpler than setting up IRSA for a
# single-tenant learning cluster, at the cost of every pod on the node
# technically having access to these permissions, not just the CSI
# driver specifically — an acceptable trade-off here, but a real
# hardening step (IRSA, or a stricter node-level policy boundary) for a
# genuine multi-tenant production cluster.
resource "aws_iam_role" "csi_driver" {
  name = "${var.project_name}-ebs-csi-driver"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

# AWS's own managed policy — grants exactly the EBS volume
# create/attach/detach/delete/snapshot permissions the CSI driver
# needs. Maintained by AWS itself rather than hand-rolled here, so it
# stays correct as the driver's requirements evolve.
resource "aws_iam_role_policy_attachment" "csi_driver" {
  role       = aws_iam_role.csi_driver.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_iam_instance_profile" "csi_driver" {
  name = "${var.project_name}-ebs-csi-driver"
  role = aws_iam_role.csi_driver.name
}
