# Look up the latest official Ubuntu 22.04 AMI dynamically instead of
# hardcoding an AMI ID. AMI IDs are region-specific AND change every time
# Canonical ships a new patched image — hardcoding one means your
# Terraform slowly rots as it references an increasingly outdated image.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical's official AWS account

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# The control-plane node. Deliberately just a bare Ubuntu box — no
# container runtime, no kubeadm, nothing installed. Terraform's job ends
# at "the machine exists and is reachable"; Ansible (next phase) is what
# actually turns it into a Kubernetes node. Keeping that boundary clean is
# the whole point of using both tools.
resource "aws_instance" "control_plane" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type           = "t3.medium" # kubeadm's documented minimum: 2 vCPU / 4GB RAM
  subnet_id               = aws_subnet.public[0].id
  vpc_security_group_ids  = [aws_security_group.cluster.id]
  key_name                = aws_key_pair.cluster.key_name
  iam_instance_profile    = aws_iam_instance_profile.csi_driver.name

  # AWS drops any packet whose destination IP doesn't match the receiving
  # ENI's own IP, by default, on every instance — a sane default for a
  # normal EC2 box, but fatal for a Kubernetes node. Calico's overlay
  # network (VXLAN) works by having one node send another node's pod
  # traffic wrapped inside a packet addressed to that node's IP, then
  # unwrapping it once it arrives. AWS sees a packet addressed to the node
  # but "not really for" the node's own IP (it's carrying someone else's
  # pod traffic inside) and silently drops it. Disabling this check is
  # what makes overlay networking possible at all.
  source_dest_check      = false

  root_block_device {
    volume_size = 30 # default 8GB is too tight once you're pulling container images
    volume_type = "gp3"
  }

  tags = {
    Name = "${var.project_name}-control-plane"
    Role = "control-plane"
  }
}

resource "aws_instance" "worker" {
  count                    = 2
  ami                      = data.aws_ami.ubuntu.id
  instance_type            = "t3.medium"
  # Spread the two workers across both AZs — the control plane stays
  # single-node for now (that's its own future HA exercise), but there's
  # no reason not to spread the workers, and it's what a real cluster
  # would do from day one.
  subnet_id                = aws_subnet.public[count.index % length(aws_subnet.public)].id
  vpc_security_group_ids   = [aws_security_group.cluster.id]
  key_name                 = aws_key_pair.cluster.key_name
  iam_instance_profile     = aws_iam_instance_profile.csi_driver.name

  # Same reason as the control plane above: without this, AWS drops the
  # VXLAN-wrapped pod traffic Calico sends between nodes, which breaks
  # cross-node pod-to-pod networking.
  source_dest_check        = false

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = {
    Name = "${var.project_name}-worker-${count.index}"
    Role = "worker"
  }
}

# A STATIC public IP for the control plane specifically, not the
# auto-assigned one every instance gets. This matters in a way that's
# easy to miss: the control plane's IP gets baked into every worker's
# join command and into the TLS certificates kubeadm generates. An
# auto-assigned public IP CHANGES if you stop and restart the instance
# (e.g. to save cost overnight) — which would silently break the whole
# cluster. An Elastic IP persists across stop/start. It's free as long as
# it stays attached to a running instance; AWS only charges for an EIP
# that's allocated but NOT attached to anything.
resource "aws_eip" "control_plane" {
  instance = aws_instance.control_plane.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-control-plane-eip"
  }
}
