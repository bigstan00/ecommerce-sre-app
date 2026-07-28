# Pins the Terraform CLI version and the AWS provider version. Pinning
# matters for production IaC: an unpinned provider can silently pick up a
# new major version with breaking changes the next time someone runs
# `terraform init` on a fresh machine.
terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
