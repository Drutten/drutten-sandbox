locals {
  energy_ingestion_service_name = "energy-ingestion"
  legacy_api_service_name       = "api"

  default_services = {
    (local.energy_ingestion_service_name) = {
      image_name            = local.energy_ingestion_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
      deletion_protection   = true
    }

    # Temporary migration entry. Keep it for one successful apply so Terraform
    # can disable deletion protection before removing the old api service.
    (local.legacy_api_service_name) = {
      image_name            = local.legacy_api_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
      deletion_protection   = false
    }
  }

  services = var.services == null ? local.default_services : var.services

  energy_ingestion_enabled = contains(keys(local.services), local.energy_ingestion_service_name)
}
