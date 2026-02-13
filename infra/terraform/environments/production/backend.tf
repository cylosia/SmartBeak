terraform {
  backend "s3" {
    bucket         = "smartbeak-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "smartbeak-terraform-locks"
    encrypt        = true
  }
}
