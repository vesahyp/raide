variable "aws_profile" {
  description = "AWS named profile to use. Leave null to use the default credential chain."
  type        = string
  default     = null
}

variable "region" {
  description = "Region for the S3 buckets. CloudFront is global; ACM (when a domain arrives) is pinned to us-east-1."
  type        = string
  default     = "eu-north-1"
}

variable "bucket_name" {
  description = "Globally-unique S3 bucket name for the site content (today just the tracking pixel; later the whole game)."
  type        = string
  default     = "raide-site-content"
}

variable "logs_bucket_name" {
  description = "Globally-unique S3 bucket name for CloudFront access logs (the analytics datastore)."
  type        = string
  default     = "raide-cloudfront-logs"
}
