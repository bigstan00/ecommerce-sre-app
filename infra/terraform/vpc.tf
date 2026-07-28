# Which Availability Zones actually exist in this region — asked for
# dynamically instead of hardcoding "eu-north-1a"/"eu-north-1b", so this
# still works unchanged if the region ever changes.
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

# The VPC's door to the internet. Without this, nothing inside the VPC —
# not even something in a "public" subnet — can actually reach or be
# reached from outside AWS.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

# Two subnets, one per AZ. "Public" here specifically means: instances in
# it CAN get a public IP and the route table (below) sends internet-bound
# traffic to the Internet Gateway. Nodes go directly on the public internet
# for now (see the security-group file for how that's locked down) —
# production would instead put nodes in a private subnet behind a NAT
# Gateway, which we're deliberately skipping to avoid its ~$32/month cost
# on a learning cluster.
resource "aws_subnet" "public" {
  count                   = length(var.public_subnet_cidrs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-${count.index}"
  }
}

# The routing rule that makes a subnet "public": anything not destined for
# inside the VPC (0.0.0.0/0) goes out through the Internet Gateway.
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
