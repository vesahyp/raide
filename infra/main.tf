########################################################################
# Raide: analytics pixel host on AWS (copied from sora, which took it from hoyry, which took it
# from tienoo, itself from clavesa-dev/site).
#
#   S3 (private) ── OAC ──> CloudFront ──> access logs ──> S3 logs bucket
#
# The game itself deploys to GitHub Pages for now; this stack only serves
# /t.gif so beacon query strings land in CloudFront access logs (the
# zero-cost analytics datastore the whole tracker family uses). When
# raide gets a real domain, this same distribution becomes the site
# host: add ACM cert + Route53 aliases + canonical-redirect function
# (copy them from tienoo/infra) and sync dist/ to the content bucket.
########################################################################

########################################################################
# S3 content bucket (private; only CloudFront reads it via OAC).
########################################################################

resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Allow only this CloudFront distribution to GetObject.
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.site.arn
        }
      }
    }]
  })
}

########################################################################
# CloudFront access-log bucket (the analytics datastore — the t.gif
# pipeline reads these). ACLs must stay enabled (BucketOwnerPreferred):
# CloudFront legacy logging grants the log-delivery account via bucket
# ACL, not policy.
########################################################################

resource "aws_s3_bucket" "logs" {
  bucket = var.logs_bucket_name
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule { object_ownership = "BucketOwnerPreferred" }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-old-logs"
    status = "Enabled"
    filter { prefix = "cloudfront/" }
    expiration { days = 90 }
  }
}

########################################################################
# CloudFront: OAC + distribution on the default *.cloudfront.net domain
# (no aliases/cert until raide has a domain).
########################################################################

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "raide-site-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # NA + EU edges; cheapest.
  comment             = "raide pixel host (future site host)"

  # Legacy standard access logging -> the analytics datastore. Beacons
  # sent as POST get a 403 (only GET/HEAD allowed) but still land in the
  # logs with their query string intact, which is all the pipeline reads
  # — same trick the sibling sites rely on.
  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-raide-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-raide-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS-managed "CachingOptimized" policy (honors origin Cache-Control,
    # so t.gif's no-store upload metadata keeps every beacon hitting the
    # logs).
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # SPA error responses (403/404 -> /index.html) belong here once the
  # game moves in; with a pixel-only bucket they'd just mask upload
  # mistakes, so they wait for the domain migration.

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
