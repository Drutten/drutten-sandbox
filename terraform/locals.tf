locals {
  api_service_name = "api"

  default_services = {
    (local.api_service_name) = {
      image_name            = local.api_service_name
      image_tag             = "latest"
      cpu                   = "1"
      memory                = "512Mi"
      max_instances         = 10
      min_instances         = 0
      allow_unauthenticated = false
    }
  }

  services = var.services == null ? local.default_services : var.services
}
