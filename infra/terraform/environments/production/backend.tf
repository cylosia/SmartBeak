terraform {
  backend "s3" {
    bucket         = "smartbeak-terraform-state-production"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "smartbeak-terraform-locks-production"
    encrypt        = true
  }
}
