terraform {
  backend "s3" {
    bucket         = "smartbeak-terraform-state-staging"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "smartbeak-terraform-locks-staging"
    encrypt        = true
  }
}
