terraform {
  backend "s3" {
    bucket         = "smartbeak-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "smartbeak-terraform-locks"
    encrypt        = true
  }
}
