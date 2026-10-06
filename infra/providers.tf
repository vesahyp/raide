terraform {
  # 1.10 is the floor: use_lockfile below is the S3-native state lock,
  # and it does not exist before then. .mise.toml pins the exact version.
  required_version = ">= 1.10"

  # State lives in the personal backup bucket, keyed
  # tfstate/<repo>/<stack>.tfstate, the same as keitos and jeeves.
  backend "s3" {
    bucket       = "vesa-backup-699166197771"
    key          = "tfstate/raide/infra.tfstate"
    region       = "eu-north-1"
    profile      = "personal"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Default provider. S3 buckets live here.
provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

# CloudFront requires its ACM certificate in us-east-1. Unused until the
# game gets a domain, but kept so adding the cert later is a diff, not a
# restructure.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
}
