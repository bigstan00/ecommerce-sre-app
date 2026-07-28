# The AWS provider reads credentials from the same place the `aws` CLI
# does (the profile/keys you set up with `aws configure`) — nothing here
# needs a hardcoded key.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "k8s-cluster-learning"
      ManagedBy = "terraform"
    }
  }
}
