# Uploads the PUBLIC half of the SSH key you generated locally to AWS.
# AWS stores it and, later, when we create EC2 instances referencing this
# key pair, injects it into each instance's ~/.ssh/authorized_keys at
# boot. Your private key never leaves your machine — this file only ever
# reads the .pub file.
resource "aws_key_pair" "cluster" {
  key_name   = "${var.project_name}-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
}
