output "bucket_name" {
  description = "S3 bucket holding the pixel (later the site content)."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution ID (invalidation target)."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain" {
  description = "CloudFront domain name, the tracker endpoint host until raide has a domain."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "pixel_url" {
  description = "The tracking pixel (VITE_PIXEL_URL)."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/t.gif"
}
