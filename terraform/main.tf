terraform {
  required_version = ">= 1.0"
  
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Configure backend for state storage
  backend "gcs" {
    bucket = "rosi-dev-tfstate"
    prefix = "drutten-sandbox"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
